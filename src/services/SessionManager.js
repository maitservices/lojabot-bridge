const { Client, LocalAuth } = require('whatsapp-web.js');
// 🔥 JUSTIFICATIVA: Trocamos o 'qrcode-terminal' pelo 'qrcode'. 
// O terminal não serve para SaaS. Precisamos gerar uma imagem para a web.
const qrcode = require('qrcode'); 

class SessionManager {
    constructor() {
        this.sessions = new Map(); 
        // 🔥 JUSTIFICATIVA: Criamos uma variável para guardar a instância do WebSocket.
        // Isso respeita o princípio de Injeção de Dependência. O SessionManager não cria o servidor web, ele apenas o usa.
        this.io = null; 
    }

    /**
     * Recebe a instância do WebSocket criada lá no index.js
     */
    setIO(ioInstance) {
        this.io = ioInstance;
    }

    /**
     * 🔥 JUSTIFICATIVA: Quando o lojista abre a página de Conexão, o front-end pergunta "Qual meu status?".
     * Este método verifica na memória do Puppeteer se o WhatsApp daquela loja específica já está logado ou não.
     */
    getSessionStatus(tenantId) {
        const client = this.sessions.get(tenantId);
        if (!client) return { state: 'DISCONNECTED' };
        
        // Se existir o objeto 'info' e 'wid', significa que o celular já escaneou e está pareado
        if (client.info && client.info.wid) {
            return { state: 'CONNECTED', number: client.info.wid.user, time: new Date() };
        }
        
        // Se o cliente existe mas não tem 'info', ele está gerando QR Code
        return { state: 'WAITING_QR' };
    }

    async createSession(tenantId, onMessageCallback) {
        if (this.sessions.has(tenantId)) {
            console.log(`[SessionManager] ⚠️ Sessão para a loja ${tenantId} já está rodando.`);
            return this.sessions.get(tenantId);
        }

        console.log(`[SessionManager] 🚀 Iniciando container lógico para a loja: ${tenantId}`);

        const client = new Client({
            authStrategy: new LocalAuth({ clientId: tenantId }),
            puppeteer: {
                headless: true,
                args: [
                    '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
                    '--disable-accelerated-2d-canvas', '--no-first-run', '--no-zygote',
                    '--single-process', '--disable-gpu'
                ]
            }
        });

        // ---------------------------------------------------------
        // 🔥 OS NOVOS EVENTOS DO WHATSAPP (Roteados para o Frontend)
        // ---------------------------------------------------------

        client.on('qr', async (qr) => {
            console.log(`[SessionManager] 📲 Novo QR Code gerado para a loja: ${tenantId}`);
            
            try {
                // Converte o texto bruto do QR em uma string de imagem (Data URI Base64)
                const qrImageBase64 = await qrcode.toDataURL(qr);
                
                if (this.io) {
                    // JUSTIFICATIVA DE SEGURANÇA: Usamos o '.to(tenantId)' para garantir que o QR Code
                    // seja enviado APENAS para a sala (room) daquele lojista. Uma loja nunca verá o QR da outra.
                    this.io.to(tenantId).emit('whatsapp_qr', qrImageBase64);
                    this.io.to(tenantId).emit('whatsapp_status', { state: 'WAITING_QR' });
                }
            } catch (err) {
                console.error(`[SessionManager] Erro ao converter QR para Base64 na loja ${tenantId}:`, err);
            }
        });

        client.on('ready', () => {
            console.log(`[SessionManager] ✅ Loja ${tenantId} conectada e pronta para operar!`);
            if (this.io) {
                // Assim que conecta, avisa o front-end para trocar a tela do QR para o "Card Verde" de Sucesso
                this.io.to(tenantId).emit('whatsapp_ready', { 
                    state: 'CONNECTED', 
                    number: client.info.wid.user, 
                    time: new Date() 
                });
            }
        });

        client.on('disconnected', (reason) => {
            console.log(`[SessionManager] ❌ Loja ${tenantId} desconectada. Motivo: ${reason}`);
            if (this.io) {
                this.io.to(tenantId).emit('whatsapp_status', { state: 'DISCONNECTED' });
            }
            client.destroy();
            this.sessions.delete(tenantId);
            
            // Auto-healing: Tenta reiniciar a sessão do Puppeteer se ela cair sozinha
            setTimeout(() => this.createSession(tenantId, onMessageCallback), 5000);
        });

        // O roteamento das mensagens continua igual
        client.on('message', async (msg) => {
            await onMessageCallback(tenantId, client, msg);
        });

        this.sessions.set(tenantId, client);
        client.initialize();
        
        return client;
    }

    getSession(tenantId) {
        return this.sessions.get(tenantId);
    }
}

module.exports = new SessionManager();
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode'); 

class SessionManager {
    constructor() {
        this.sessions = new Map(); 
        this.io = null; 
        
        // 🔥 NOVO: Cache de QR Codes. Guarda a última imagem gerada para cada loja.
        // Previne a "Síndrome do Convidado Atrasado".
        this.qrCodes = new Map(); 
    }

    setIO(ioInstance) {
        this.io = ioInstance;
    }

    /**
     * Retorna o status atual da loja. Se estiver esperando QR Code, 
     * devolve a imagem Base64 junto no pacote.
     */
    getSessionStatus(tenantId) {
        const client = this.sessions.get(tenantId);
        
        if (!client) return { state: 'DISCONNECTED' };
        
        // Se o WhatsApp já está pareado e pronto
        if (client.info && client.info.wid) {
            return { state: 'CONNECTED', number: client.info.wid.user, time: new Date() };
        }
        
        // Se está gerando QR Code, busca a imagem do Cache
        const cachedQR = this.qrCodes.get(tenantId);
        if (cachedQR) {
            return { state: 'WAITING_QR', qrData: cachedQR };
        }
        
        // Se o navegador ainda está abrindo e não gerou nenhum QR
        return { state: 'WAITING_QR' };
    }

    async createSession(tenantId, onMessageCallback) {
        if (this.sessions.has(tenantId)) {
            console.log(`[SessionManager] ⚠️ Sessão para a loja ${tenantId} já está rodando.`);
            return this.sessions.get(tenantId);
        }

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

        client.on('qr', async (qr) => {
            console.log(`[SessionManager] 📲 Novo QR Code gerado para a loja: ${tenantId}`);
            
            try {
                const qrImageBase64 = await qrcode.toDataURL(qr);
                
                // 1. Salva no cache da memória RAM para os visitantes atrasados
                this.qrCodes.set(tenantId, qrImageBase64);
                
                // 2. Transmite ao vivo para quem já está na página de Conexão
                if (this.io) {
                    this.io.to(tenantId).emit('whatsapp_qr', qrImageBase64);
                    this.io.to(tenantId).emit('whatsapp_status', { state: 'WAITING_QR' });
                }
            } catch (err) {
                console.error(`[SessionManager] Erro ao converter QR para Base64 na loja ${tenantId}:`, err);
            }
        });

        client.on('ready', () => {
            console.log(`[SessionManager] ✅ Loja ${tenantId} conectada e pronta para operar!`);
            
            // Limpa o cache do QR Code (Prevenção de vazamento de memória)
            this.qrCodes.delete(tenantId);
            
            if (this.io) {
                this.io.to(tenantId).emit('whatsapp_ready', { 
                    state: 'CONNECTED', 
                    number: client.info.wid.user, 
                    time: new Date() 
                });
            }
        });

        client.on('disconnected', (reason) => {
            console.log(`[SessionManager] ❌ Loja ${tenantId} desconectada. Motivo: ${reason}`);
            
            this.qrCodes.delete(tenantId); // Limpeza de segurança
            
            if (this.io) {
                this.io.to(tenantId).emit('whatsapp_status', { state: 'DISCONNECTED' });
            }
            client.destroy();
            this.sessions.delete(tenantId);
            
            // Auto-healing: Reinicia o container do WhatsApp após 5 segundos
            setTimeout(() => this.createSession(tenantId, onMessageCallback), 5000);
        });

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
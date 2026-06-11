const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode'); 
const fs = require('fs');     // 🔥 Adicionado para manipular arquivos
const path = require('path'); // 🔥 Adicionado para resolver caminhos

class SessionManager {
    constructor() {
        this.sessions = new Map(); 
        this.qrCodes = new Map(); 
        this.io = null; 
    }

    setIO(ioInstance) {
        this.io = ioInstance;
    }

    /**
     * AUTO-HEALING: Remove cadeados fantasmas do Chromium deixados por desligamentos abruptos.
     */
    clearPhantomLocks(tenantId) {
        // O whatsapp-web.js salva as sessões nesta estrutura de pastas:
        const authPath = path.join(process.cwd(), '.wwebjs_auth', `session-${tenantId}`);
        
        if (!fs.existsSync(authPath)) return; // Se a pasta não existe, não há o que limpar

        // O Chromium pode esconder o cadeado na raiz ou na pasta Default
        const locksToDestroy = [
            path.join(authPath, 'SingletonLock'),
            path.join(authPath, 'SingletonCookie'),
            path.join(authPath, 'SingletonSocket'),
            path.join(authPath, 'Default', 'SingletonLock'),
            path.join(authPath, 'Default', 'SingletonCookie'),
            path.join(authPath, 'Default', 'SingletonSocket')
        ];

        locksToDestroy.forEach(lockPath => {
            try {
                // Tenta apagar silenciosamente. Se conseguir, avisa no log.
                if (fs.existsSync(lockPath)) {
                    fs.unlinkSync(lockPath);
                    console.log(`[Auto-Healing] 🔨 Cadeado fantasma destruído para a loja ${tenantId}`);
                }
            } catch (error) {
                // Ignora erros de permissão
            }
        });
    }

    // Função NOVA para o botão "Mostrar QR Code" buscar
    getLastQRCode(tenantId) {
        return this.qrCodes.get(tenantId);
    }

    getSessionStatus(tenantId) {
        const client = this.sessions.get(tenantId);
        if (!client) return { state: 'DISCONNECTED' };
        
        if (client.info && client.info.wid) {
            return { state: 'CONNECTED', number: client.info.wid.user };
        }
        
        if (this.qrCodes.has(tenantId)) {
            return { state: 'QR_READY' }; // Novo estado da nossa arquitetura
        }
        
        return { state: 'STARTING' };
    }

    async createSession(tenantId, onMessageCallback) {
        // Se já está rodando, avisa que já está pronto
        if (this.sessions.has(tenantId)) {
            if(this.qrCodes.has(tenantId) && this.io) {
                this.io.to(tenantId).emit('whatsapp_status', { state: 'QR_READY' });
            }
            return this.sessions.get(tenantId);
        }

        this.clearPhantomLocks(tenantId);

        const client = new Client({
            authStrategy: new LocalAuth({ clientId: tenantId }),
            qrMaxRetries: 15, // Mantém o motor ligado por bastante tempo no servidor
            puppeteer: {
                headless: true,
                args: [
                    '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
                    '--disable-gpu', '--single-process'
                ]
            }
        });

        client.on('qr', async (qr) => {
            try {
                const qrImageBase64 = await qrcode.toDataURL(qr);
                this.qrCodes.set(tenantId, qrImageBase64); // Atualiza o cache silenciosamente
                
                if (this.io) {
                    // Manda apenas o SINAL de que está pronto. Não manda a imagem pesada!
                    this.io.to(tenantId).emit('whatsapp_status', { state: 'QR_READY' });
                }
            } catch (err) {
                console.error("Erro QR:", err);
            }
        });

        client.on('ready', () => {
            this.qrCodes.delete(tenantId); 
            if (this.io) {
                this.io.to(tenantId).emit('whatsapp_ready', { number: client.info.wid.user });
            }
        });

        client.on('disconnected', () => {
            this.qrCodes.delete(tenantId); 
            if (this.io) {
                this.io.to(tenantId).emit('whatsapp_status', { state: 'DISCONNECTED' });
            }
            client.destroy();
            this.sessions.delete(tenantId);
        });

        client.on('message', async (msg) => {
            await onMessageCallback(tenantId, client, msg);
        });

        this.sessions.set(tenantId, client);
        client.initialize();
        
        return client;
    }
}

module.exports = new SessionManager();
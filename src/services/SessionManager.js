const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode'); 
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

class SessionManager {
    constructor() {
        this.sessions = new Map(); 
        this.qrCodes = new Map(); 
        this.io = null; 
    }

    setIO(ioInstance) {
        this.io = ioInstance;
    }

    // =========================================================
    // 1. UTILITÁRIOS DE INFRAESTRUTURA E LIMPEZA
    // =========================================================

    /**
     * Remove cadeados fantasmas. Executado sempre antes do boot.
     */
    clearPhantomLocks(tenantId) {
        const authPath = path.join(process.cwd(), '.wwebjs_auth', `session-${tenantId}`);
        if (fs.existsSync(authPath)) {
            try {
                execSync(`find ${authPath} -name "Singleton*" -delete || true`);
                console.log(`[Auto-Healing] 🔨 Cadeados removidos para loja ${tenantId}`);
            } catch (error) {
                console.error(`[Auto-Healing] Erro no shell (Loja ${tenantId}):`, error.message);
            }
        }
    }

    /**
     * Limpeza Nuclear: Se a sessão for corrompida, apaga tudo para recomeçar do zero.
     */
    destroySession(tenantId) {
        console.log(`[SessionManager] 🧹 Limpando resíduos da loja ${tenantId}...`);
        const client = this.sessions.get(tenantId);
        
        if (client) {
            try { client.destroy(); } catch(e) {}
            this.sessions.delete(tenantId);
        }
        
        this.qrCodes.delete(tenantId);
        
        const authPath = path.join(process.cwd(), '.wwebjs_auth', `session-${tenantId}`);
        if (fs.existsSync(authPath)) {
            try {
                fs.rmSync(authPath, { recursive: true, force: true });
                console.log(`[Auto-Healing] 🗑️ Pasta corrompida removida.`);
            } catch (error) {
                console.error(`[Auto-Healing] Erro ao remover pasta:`, error.message);
            }
        }
    }

    // =========================================================
    // 2. CONTROLE DE ESTADOS (MÁQUINA DE ESTADO)
    // =========================================================

    getLastQRCode(tenantId) {
        return this.qrCodes.get(tenantId);
    }

    getSessionStatus(tenantId) {
        const client = this.sessions.get(tenantId);
        
        // Se não existe cliente na memória, está desligado
        if (!client) return { state: 'DISCONNECTED' };
        
        // Se existe e tem as chaves ativas do WhatsApp, está pronto
        if (client.info && client.info.wid) {
            return { state: 'CONNECTED', number: client.info.wid.user };
        }
        
        // Se gerou um QR Code, está aguardando leitura
        if (this.qrCodes.has(tenantId)) {
            return { state: 'QR_READY' }; 
        }
        
        // Se o cliente existe na memória, mas não tem QR e nem Info, está carregando
        return { state: 'STARTING' };
    }

    broadcastStatus(tenantId) {
        if (this.io) {
            const status = this.getSessionStatus(tenantId);
            this.io.to(tenantId).emit('whatsapp_status', { 
                state: status.state, 
                number: status.number,
                timestamp: Date.now() // Força atualização no front
            });
        }
    }

    // =========================================================
    // 3. O MOTOR PRINCIPAL (BOOT DA SESSÃO)
    // =========================================================

    async createSession(tenantId, onMessageCallback) {
        if (this.sessions.has(tenantId)) {
            this.broadcastStatus(tenantId);
            return this.sessions.get(tenantId);
        }

        this.clearPhantomLocks(tenantId);

        const client = new Client({
            authStrategy: new LocalAuth({ clientId: tenantId }),
            qrMaxRetries: 15, 
            webVersionCache: { type: 'none' }, // Bypass do limbo infinito de cache
            puppeteer: {
                headless: true,
                args: [
                    '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
                    '--disable-gpu', '--single-process'
                ]
            }
        });

        // --- ROTEAMENTO DE EVENTOS DA BIBLIOTECA ---

        client.on('qr', async (qr) => {
            try {
                const qrImageBase64 = await qrcode.toDataURL(qr);
                this.qrCodes.set(tenantId, qrImageBase64); 
                this.broadcastStatus(tenantId); // Avisa o frontend que o QR está pronto
            } catch (err) {
                console.error("Erro QR:", err);
            }
        });

        client.on('loading_screen', (percent, message) => {
            console.log(`[SessionManager] ⏳ [${tenantId}] Carregando: ${percent}% - ${message}`);
            this.broadcastStatus(tenantId);
        });

        client.on('authenticated', () => {
            console.log(`[SessionManager] 🔐 [${tenantId}] Autenticação validada pelo WhatsApp!`);
        });

        client.on('ready', () => {
            console.log(`[SessionManager] ✅ [${tenantId}] Loja online e pronta para operar!`);
            this.qrCodes.delete(tenantId); 
            this.broadcastStatus(tenantId); // 🔥 CRÍTICO: Força o frontend a ficar verde!
        });

        client.on('auth_failure', msg => {
            console.error(`[SessionManager] 🛑 [${tenantId}] Falha fatal de autenticação:`, msg);
            this.destroySession(tenantId); // Destrói o zumbi
            this.broadcastStatus(tenantId); // Volta o botão pro frontend
        });

        client.on('disconnected', (reason) => {
            console.warn(`[SessionManager] ❌ [${tenantId}] Desconectado. Motivo: ${reason}`);
            this.destroySession(tenantId);
            this.broadcastStatus(tenantId);
        });

        client.on('message', async (msg) => {
            await onMessageCallback(tenantId, client, msg);
        });

        // --- INICIALIZAÇÃO BLINDADA ---
        this.sessions.set(tenantId, client);
        
        // Se o Puppeteer explodir internamente, capturamos o erro e limpamos a memória
        client.initialize().catch(err => {
            console.error(`[SessionManager] 🔥 Falha crítica ao inicializar o Chromium na loja ${tenantId}:`, err.message);
            this.destroySession(tenantId);
            this.broadcastStatus(tenantId);
        });
        
        return client;
    }
}

module.exports = new SessionManager();
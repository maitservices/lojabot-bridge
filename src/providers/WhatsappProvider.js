const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');

class WhatsappProvider {
    constructor() {
        this.client = new Client({
            authStrategy: new LocalAuth(), 
            puppeteer: { args: ['--no-sandbox', '--disable-setuid-sandbox'] }
        });
        
        this.onMessageCallback = null; 
    }

    initialize() {
        this.client.on('qr', (qr) => {
            console.log('\n=================================================');
            console.log('POR FAVOR, ESCANEIE O QR CODE ABAIXO:');
            console.log('=================================================\n');
            qrcode.generate(qr, { small: true });
        });

        this.client.on('ready', () => {
            console.log('\n✅ [WhatsappProvider] Cliente conectado com sucesso!\n');
        });

        this.client.on('message', async (msg) => {
            // Único filtro que fica aqui: Ignora mensagens vazias ou de sistema (bugs da lib)
            if (!msg.body || msg.body.trim() === '') return;

            // Inversão de Controle: Repassa o objeto bruto para quem chamou (o index.js)
            if (this.onMessageCallback) {
                await this.onMessageCallback(msg); // Bug corrigido aqui
            }
        });

        console.log('🔄 [WhatsappProvider] Inicializando cliente...');
        this.client.initialize();
    }

    onMessage(callback) {
        this.onMessageCallback = callback;
    }

    async sendText(to, message) {
        try {
            await this.client.sendMessage(to, message);
            console.log(`📤 Enviado para ${to}: ${message}`);
        } catch (error) {
            console.error(`❌ Erro ao enviar para ${to}:`, error);
        }
    }
}

module.exports = new WhatsappProvider();
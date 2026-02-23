const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');

class WhatsappProvider {
    constructor() {
        // Configuração do cliente
        this.client = new Client({
            // LocalAuth salva a sessão numa pasta local para não precisar ler QR Code toda vez
            authStrategy: new LocalAuth(), 
            puppeteer: {
                // Necessário para rodar em servidores Linux sem interface gráfica
                args: ['--no-sandbox', '--disable-setuid-sandbox'],
            }
        });
        
        this.onMessageCallback = null; // Callback para injetar a lógica de negócio depois
    }

    initialize() {
        // Evento: Quando o QR Code é gerado
        this.client.on('qr', (qr) => {
            console.log('\n=================================================');
            console.log('POR FAVOR, ESCANEIE O QR CODE ABAIXO NO SEU WHATSAPP:');
            console.log('=================================================\n');
            qrcode.generate(qr, { small: true });
        });

        // Evento: Quando a conexão é bem sucedida
        this.client.on('ready', () => {
            console.log('\n✅ [WhatsappProvider] Cliente conectado com sucesso!\n');
        });

        // Evento: Quando chega mensagem
        this.client.on('message', async (msg) => {
            // Lógica Refinada: Ignora grupos (@g.us), status e broadcasts
            const isGroup = msg.from.includes('@g.us');
            const isStatus = msg.from === 'status@broadcast';
            
            if (isGroup || isStatus) return;

            // SRP: O provider apenas avisa que chegou uma mensagem e passa o objeto
            if (this.onMessageCallback) {
                await this.onMessageCallback(msg);
            }
        });

        // Inicia o processo
        console.log('🔄 [WhatsappProvider] Inicializando cliente...');
        this.client.initialize();
    }

    /**
     * Define a função que processará as mensagens recebidas
     * (Inversão de Dependência: quem usa a classe define o que ela faz)
     */
    onMessage(callback) {
        this.onMessageCallback = callback;
    }

    /**
     * Envia mensagem de texto
     */
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
const { Client, LocalAuth, MessageMedia }= require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const axios = require('axios');

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

    /**
     * 🔥 NOVO MÉTODO: Baixa uma imagem da URL e envia como mídia nativa no WhatsApp
     * @param {string} to - JID do destinatário (msg.from)
     * @param {string} imageUrl - URL pública da imagem (do Supabase)
     * @param {string} caption - Legenda opcional (Nome do produto)
     */
    async sendImageFromUrl(to, imageUrl, caption = "") {
        try {
            console.log(`[WhatsappProvider] 🖼️ Tentando enviar imagem nativa da URL: ${imageUrl}`);
            
            // 1. Baixa a imagem da internet para a memória do servidor (como ArrayBuffer)
            const response = await axios.get(imageUrl, { responseType: 'arraybuffer' });
            
            // 2. Pega o tipo do arquivo (ex: image/jpeg) direto do cabeçalho da resposta
            const contentType = response.headers['content-type'];
            
            // 3. Converte o buffer binário em uma String Base64 (formato que a lib exige)
            const base64Image = Buffer.from(response.data, 'binary').toString('base64');

            // 4. Cria o objeto de Mídia do WhatsApp
            const media = new MessageMedia(contentType, base64Image);

            // 5. Envia a mídia nativamente
            await this.client.sendMessage(to, media, { caption: caption });
            
            console.log(`📤 [WhatsappProvider] Imagem enviada com sucesso para ${to}`);

        } catch (error) {
            console.error(`❌ [WhatsappProvider] Erro fatal ao enviar imagem da URL para ${to}:`, error.message);
            // Fallback: Se a imagem falhar, avisa o usuário via texto para não deixar ele no vácuo
            await this.sendText(to, `Peço desculpas, mas tive um problema ao carregar a foto do produto agora. 😔`);
        }
    }
}

module.exports = new WhatsappProvider();
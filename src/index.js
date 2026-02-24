const whatsapp = require('./providers/WhatsappProvider');
const gemini = require('./services/GeminiService'); // Substituindo o TypebotService
require('dotenv').config();

const delay = (ms) => new Promise((res) => setTimeout(res, ms));

async function bootstrap() {
    // Inicializa o provedor de conexão
    whatsapp.initialize();

    // Evento disparado para cada mensagem recebida (Ignora grupos automaticamente no Provider)
    whatsapp.onMessage(async (msg) => {
        const chatId = msg.from;   
        const userText = msg.body; 

        console.log(`[Lojabot] Atendendo: ${chatId} - Mensagem: ${userText}`);

        // 1. O Agente Gemini processa a pergunta com base nas instruções de sistema
        // A temperatura 0.3 garante que ele não invente links
        const responseText = await gemini.generateResponse(chatId, userText);

        console.log(`[Lojabot] Resposta gerada.`);

        // 2. Simula tempo de digitação para proteção de banimento (UX)
        //await delay(parseInt(process.env.MESSAGE_DELAY) || 2000);
        const randomDelay = () => Math.floor(Math.random() * (parseInt(process.env.MESSAGE_DELAY) - 3000 + 1) + 3000);
        await delay(randomDelay());

        // 3. Envia a resposta final de volta ao cliente no WhatsApp
        await whatsapp.sendText(chatId, responseText);
        
        console.log(`[Lojabot] Resposta enviada com sucesso para ${chatId}`);
    });
}

// Tratamento de erros fatais para manter o serviço rodando
bootstrap().catch(err => {
    console.error("🔥 Erro Crítico na Inicialização:", err);
    process.exit(1);
});
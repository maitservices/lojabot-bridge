require('dotenv').config();
const whatsapp = require('./providers/WhatsappProvider');
const gemini = require('./services/GeminiService');
const commandRouter = require('./services/CommandRouter');
const messageFilter = require('./utils/MessageFilter');

async function bootstrap() {
    try {
        console.log('🚀 Iniciando Lojabot...');
        await gemini.initialize();
        whatsapp.initialize();

        whatsapp.onMessage(async (msg) => {
             
            
            // -----------------------------------------------------
            // ETAPA 1: Roteador de Comandos (ChatOps)
            // -----------------------------------------------------
            // Se for um comando (ex: /estoque), executa e encerra a iteração
            const contact = await msg.getContact();
            const numero = contact.number;
            console.log(`msg.from: ${numero})`);
            const chatId = msg.from;
            const isCommand = await commandRouter.handle(msg, whatsapp);
            if (isCommand) return; 

            // -----------------------------------------------------
            // ETAPA 2: Filtro de Regras de Negócio
            // -----------------------------------------------------
            // Verifica se é grupo, se é mensagem velha ou se é do próprio bot
            if (!messageFilter.isValidForAI(msg)) return;

            // -----------------------------------------------------
            // ETAPA 3: Inteligência Artificial
            // -----------------------------------------------------
            console.log(`[Lojabot] Atendendo: ${chatId}, MSG: ${msg.body}`);
            
            const responseText = await gemini.generateResponse(chatId, msg.body);
            
            // Adicione seu delay aqui se necessário
            await whatsapp.sendText(chatId, responseText);
        });

    } catch (err) {
        console.error("🔥 Erro Crítico:", err.message);
        process.exit(1); 
    }
}

bootstrap();
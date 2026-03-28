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
            
            // -----------------------------------------------------
            // ETAPA 3: Preparação da Mensagem (Texto e Mídia)
            // -----------------------------------------------------
            console.log(`[Lojabot] Atendendo: ${chatId}`);
            
            let textoUsuario = msg.body;
            let pacoteMidia = null; // Inicializa como nulo por padrão (para textos normais)

            // Se o cliente mandou um áudio ou imagem, nós extraímos aqui
            if (msg.hasMedia) {
                try {
                    const media = await msg.downloadMedia();
                    
                    // Se for mensagem de voz/áudio
                    if (media.mimetype.includes('audio') || media.mimetype.includes('ogg')) {
                        console.log(`[Lojabot] 🎙️ Áudio recebido de ${chatId}. Preparando pacote para a IA...`);
                        
                        // Monta o objeto no padrão rigoroso da API do Gemini
                        pacoteMidia = {
                            inlineData: {
                                data: media.data, // O Base64 do áudio
                                mimeType: media.mimetype
                            }
                        };
                        
                        // Injeta um prompt invisível para guiar a IA, já que msg.body vem vazio no áudio
                        textoUsuario = "Por favor, ouça este áudio do cliente e responda de acordo com o nosso catálogo.";
                    }
                } catch (error) {
                    console.error(`[Lojabot] ❌ Erro ao baixar mídia do WhatsApp: ${error.message}`);
                    await whatsapp.sendText(chatId, "Desculpe, não consegui carregar o seu áudio. Pode digitar?");
                    return; // Interrompe para não mandar lixo pra IA
                }
            }

            // -----------------------------------------------------
            // ETAPA 4: Inteligência Artificial e Resposta
            // -----------------------------------------------------
            try {
                // Agora sim, enviamos as 3 variáveis corretamente
                const respostaIA = await gemini.generateResponse(chatId, textoUsuario, pacoteMidia);
                
               // 🚨 Interceptação do Comando Interno de Imagem
                if (respostaIA.includes('[ACORDO:ENVIAR_FOTO|')) {
                    const partes = respostaIA.replace('[', '').replace(']', '').split('|');
                    
                    // A IA agora mandou o SKU (Ex: SKU_01)
                    const skuDoProduto = String(partes[1]).trim();
                    const nomeDoProduto = partes[2] || "produto";

                    // O Node.js busca a URL perfeita e imaculada no dicionário
                    const urlExataDaFoto = gemini.dicionarioImagens.get(skuDoProduto);

                    if (urlExataDaFoto) {
                        // Se encontrou, manda a mídia nativa
                        await whatsapp.sendImageFromUrl(chatId, urlExataDaFoto, `Aqui está a foto do ${nomeDoProduto}! 😍`);
                    } else {
                        // Segurança caso a IA invente um SKU que não tem foto
                        console.error(`[Lojabot] IA tentou enviar foto do SKU ${skuDoProduto}, mas não tem URL no dicionário.`);
                        await whatsapp.sendText(chatId, `Desculpe, a foto do ${nomeDoProduto} está indisponível no momento.`);
                    }

                } else {
                    // Fluxo normal de texto
                    await whatsapp.sendText(chatId, respostaIA);
                }
            } catch (error) {
                console.error(`[Lojabot] ❌ Erro no processamento da IA: ${error.message}`);
            }
        });

    } catch (err) {
        console.error("🔥 Erro Crítico:", err.message);
        process.exit(1); 
    }
}

bootstrap();
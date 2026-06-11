require('dotenv').config();
const sessionManager = require('./services/SessionManager');
const supabaseService = require('./services/SupabaseService');
const gemini = require('./services/GeminiService');
const commandRouter = require('./services/CommandRouter');
const messageFilter = require('./utils/MessageFilter');
const sessionControl = require('./services/SessionControlService');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const { MessageMedia } = require('whatsapp-web.js');
const axios = require('axios');

const app = express();
app.use(cors());
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*', methods: ['GET', 'POST'] } });


io.on('connection', (socket) => {
    
    // 1. O painel apenas pede "Como está a situação?"
    socket.on('request_current_status', async (tenantId) => {
        socket.join(tenantId); 
        const status = sessionManager.getSessionStatus(tenantId);
        socket.emit('whatsapp_status', { state: status.state, number: status.number });
    });

    // 2. O usuário clicou no Botão "Conectar WhatsApp"
    socket.on('action_start_session', async (tenantId) => {
        socket.join(tenantId);
        socket.emit('whatsapp_status', { state: 'STARTING' });
        try {
            // 🔥 ADICIONE ESTA LINHA AQUI: Inicializa a IA para o clique manual
            await gemini.initializeTenant(tenantId);
            
            // Pede pro SessionManager ligar a máquina daquela loja
            await sessionManager.createSession(tenantId, handleIncomingMessage);
        } catch (error) {
            console.error(`[Erro ao inicializar Loja ${tenantId} via botão]:`, error);
        }
    });

    // 3. O usuário clicou no Botão "Mostrar QR Code"
    socket.on('action_get_qr', async (tenantId) => {
        socket.join(tenantId);
        const qrBase64 = sessionManager.getLastQRCode(tenantId);
        
        if (qrBase64) {
            socket.emit('deliver_qr_code', qrBase64);
        } else {
            // Se por acaso a imagem não estiver pronta, avisa que ainda tá processando
            socket.emit('whatsapp_status', { state: 'STARTING' });
        }
    });
});
/**
 * O NOVO PIPELINE DE MENSAGENS (SaaS Multi-Tenant)
 */
async function handleIncomingMessage(tenantId, client, msg) {
    try {
        const contact = await msg.getContact();
        const numero = contact.number; // Número puro (ex: 554199999999)
        const chatId = msg.from;       // ID do WhatsApp (ex: 554199999999@c.us)
        
        // -----------------------------------------------------
        // ETAPA 1 e 2: Comandos e Filtros Base
        // -----------------------------------------------------
        const isCommand = await commandRouter.handle(msg, client, tenantId);
        if (isCommand) return; 

        if (!messageFilter.isValidForAI(msg)) return;

        // -----------------------------------------------------
        // ETAPA 3: A CATRACA DE ESTADO (Mute da IA)
        // -----------------------------------------------------
        // Consulta o Supabase para saber se um humano já assumiu esse cliente
        const sessionStatus = await sessionControl.getSessionStatus(tenantId, numero);

        if (sessionStatus === 'WAITING_HUMAN' || sessionStatus === 'HUMAN_ATTENDING') {
            console.log(`[Loja ${tenantId}] 🤫 Bot mutado para ${numero} (Status: ${sessionStatus}). Mensagem ignorada.`);
            return; // Interrompe o fluxo. A IA não processa essa mensagem.
        }

        // -----------------------------------------------------
        // ETAPA 4: Preparação da Mensagem (Texto e Mídia)
        // -----------------------------------------------------
        console.log(`[Loja: ${tenantId}] IA Atendendo: ${chatId}`);
        
        let textoUsuario = msg.body;
        let pacoteMidia = null; 

        if (msg.hasMedia) {
            try {
                const media = await msg.downloadMedia();
                if (media.mimetype.includes('audio') || media.mimetype.includes('ogg')) {
                    console.log(`[Loja: ${tenantId}] 🎙️ Áudio recebido. Preparando...`);
                    pacoteMidia = { inlineData: { data: media.data, mimeType: media.mimetype } };
                    textoUsuario = "Por favor, ouça este áudio do cliente e responda de acordo com o nosso catálogo.";
                }
            } catch (error) {
                console.error(`[Loja: ${tenantId}] ❌ Erro de mídia: ${error.message}`);
                await client.sendMessage(chatId, "Desculpe, não consegui carregar o seu áudio. Pode digitar?");
                return; 
            }
        }

        // -----------------------------------------------------
        // ETAPA 5: Inteligência Artificial e Roteamento
        // -----------------------------------------------------
        const respostaIA = await gemini.generateResponse(tenantId, chatId, textoUsuario, pacoteMidia);
        
        // 🚨 INTERCEPTAÇÃO 1: Roteamento para Humano
        if (respostaIA.includes('[ACORDO:CHAMAR_HUMANO]')) {
            console.log(`[Loja ${tenantId}] 🚨 Transbordo solicitado pela IA para o cliente ${numero}!`);
            
            // 1. Muta a IA no banco de dados IMEDIATAMENTE
            await sessionControl.updateSessionStatus(tenantId, numero, 'WAITING_HUMAN');

            // 2. Avisa o cliente final que a transferência está ocorrendo
            await client.sendMessage(chatId, "⏳ Entendi! Estou transferindo seu atendimento para um de nossos especialistas. Por favor, aguarde um instante.");

            // 3. Pede para a IA gerar um resumo da conversa para o vendedor não ficar perdido
            const resumo = await gemini.generateSummary(tenantId, chatId);

            // 4. Busca quem são os vendedores cadastrados nesta loja
            const atendentes = await supabaseService.getHumanAttendants(tenantId);

            if (atendentes.length > 0) {
                // 5. Dispara o Alerta para os celulares dos vendedores
                for (const atendente of atendentes) {
                    // Garante que o número está no formato do WhatsApp Web JS
                    const targetId = atendente.whatsapp_number.includes('@c.us') ? atendente.whatsapp_number : `${atendente.whatsapp_number}@c.us`;
                    
                    const mensagemAlerta = `🚨 *NOVO TRANSBORDO SOLICITADO*\n\n` +
                                           `👤 *Cliente:* wa.me/${numero.replace('@c.us', '')}\n\n` +
                                           `📝 *Resumo da Conversa:*\n${resumo}\n\n` +
                                           `⚙️ _Use o comando '/assumir ${numero.replace('@c.us', '')}' para travar este atendimento para você._`;
                                           
                    await client.sendMessage(targetId, mensagemAlerta);
                }
            } else {
                console.warn(`[Loja ${tenantId}] Transbordo acionado, mas não há humanos cadastrados/ativos.`);
            }
            return; // Encerra o fluxo
        }

        // 🚨 INTERCEPTAÇÃO 2: Envio Nativos de Imagem
        if (respostaIA.includes('[ACORDO:ENVIAR_FOTO|')) {
            const partes = respostaIA.replace('[', '').replace(']', '').split('|');
            const skuDoProduto = String(partes[1]).trim();
            const nomeDoProduto = partes[2] || "produto";

            const urlExataDaFoto = gemini.getImagemUrl(tenantId, skuDoProduto);

            if (urlExataDaFoto) {
                await enviarImagem(client, chatId, urlExataDaFoto, `Aqui está a foto do ${nomeDoProduto}! 😍`);
            } else {
                await client.sendMessage(chatId, `Desculpe, a foto do ${nomeDoProduto} está indisponível no momento.`);
            }
        } else {
            // Fluxo normal de texto
            await client.sendMessage(chatId, respostaIA);
        }

    } catch (error) {
        console.error(`[Erro no Pipeline - Loja ${tenantId}]:`, error);
    }
}

/**
 * Função Auxiliar para enviar imagem via URL
 */
async function enviarImagem(client, to, imageUrl, caption) {
    try {
        const response = await axios.get(imageUrl, { responseType: 'arraybuffer' });
        const base64Image = Buffer.from(response.data, 'binary').toString('base64');
        const media = new MessageMedia(response.headers['content-type'], base64Image);
        await client.sendMessage(to, media, { caption: caption });
    } catch (error) {
        console.error("Erro ao enviar imagem:", error.message);
        await client.sendMessage(to, `Tive um problema ao carregar a foto agora. 😔`);
    }
}
/**
 * BOOTSTRAP DO SAAS
 */
async function bootstrap() {
    console.log('🚀 Iniciando Plataforma SaaS Lojabot...');
    try {
        // 🔥 JUSTIFICATIVA: Injetamos o servidor de WebSockets no gerenciador. 
        // Agora o SessionManager tem o poder de enviar imagens para o front-end.
        sessionManager.setIO(io);

        const lojasAtivas = await supabaseService.buscarLojasAtivas();
        
        if (!lojasAtivas || lojasAtivas.length === 0) {
            console.warn("Nenhuma loja ativa encontrada para iniciar.");
            // Não damos return aqui, pois o servidor web ainda precisa subir para novos clientes se cadastrarem
        } else {
            let i = 0;
            for (const loja of lojasAtivas) {
                console.log(`🚀 configurando Loja: ${++i}`);
                await gemini.initializeTenant(loja.id);
                await sessionManager.createSession(loja.id, handleIncomingMessage);
                await new Promise(res => setTimeout(res, 4000));
            }
        }

        // 🔥 JUSTIFICATIVA CRÍTICA: Sem isso, o seu servidor Node.js é apenas um script local.
        // O 'server.listen' abre a porta 3001 para que o seu painel front-end consiga se conectar ao WebSocket.
        server.listen(3001, () => {
            console.log("          [ ]           .----------.");
            console.log("           |            | uhuull!  |");
            console.log("       .-------.        '----------'");
            console.log("       | o   o |       /            ");
            console.log("       |  ___  | <----'             ");
            console.log("       | |___| |                    ");
            console.log("       '-------'                    ");
            console.log("      /|       |\\                  ");
            console.log("     / | [===] | \\                 ");
            console.log("    O  |       |  O                 ");
            console.log("       '-------'                    ");
            console.log("        |     |                     ");
            console.log("      [___] [___]                   ");
            console.log("                                    ");
            console.log("🤖 LOJABOT ONLINE E PRONTO PARA VENDER! 🚀");
        });

    } catch (err) {
        console.error("🔥 Erro Crítico no Bootstrap:", err.message);
        process.exit(1); 
    }
}

bootstrap();
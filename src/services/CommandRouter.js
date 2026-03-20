const googleDrive = require('./GoogleDriveService');
const productImport = require('./ProductImportService');
const gemini = require('./GeminiService'); // Importação adicionada para orquestrar a IA

class CommandRouter {
    /**
     * Verifica se a mensagem é um comando administrativo e o executa
     * @param {Object} msg - Objeto da mensagem
     * @param {Object} whatsapp - Instância do WhatsappProvider para enviar respostas
     * @returns {Promise<boolean>} True se foi um comando processado, False se for uma conversa normal
     */
    async handle(msg, whatsapp) {
        // Regra de Segurança: Valida se o remetente é o Administrador
        const contact = await msg.getContact();
        const numero = contact.number;
        const isAdmin = numero === process.env.ADMIN_NUMBER;
        
        console.log(`[CommandRouter] Analisando mensagem de: ${numero}`);
        
        if (!isAdmin){
            console.log("[CommandRouter] 🔒 Bloqueado: Remetente não é admin.");
            return false;
        } 

        // Gatilho: Comando /estoque + URL
        if (msg.body.startsWith('/estoque ')) {
            const url = msg.body.replace('/estoque ', '').trim();
            console.log(`[CommandRouter] 🚀 Iniciando fluxo de atualização de estoque via Google Drive.`);
            
            // Define para onde enviar a resposta (Se for msg.fromMe, responde no próprio chat)
            const chatDestino = msg.fromMe ? msg.to : msg.from;

            await whatsapp.sendText(chatDestino, "⏳ *Processando:* Iniciando download da planilha do Drive...");

            try {
                // 1. Baixa a planilha para a memória
                const fileBuffer = await googleDrive.downloadSheetAsBuffer(url);
                await whatsapp.sendText(chatDestino, "✅ Download concluído. Sincronizando com o Supabase...");

                // 2. Realiza o Upsert no banco de dados
                const report = await productImport.processFile(fileBuffer);

                // 3. INVALIDEZ DE CACHE: Atualiza a memória da IA em tempo real com os dados que acabaram de entrar
                console.log("[CommandRouter] 🧠 Acionando atualização de memória do Agente de IA...");
                await gemini.atualizarCacheCatalogo();

                // 4. Feedback final pro usuário (UX aprimorada)
                const relatorioMsg = `*🏁 Sincronização Concluída!*\n\n` +
                                     `📊 Total de Linhas: ${report.total_processado}\n` +
                                     `✅ Sucesso: ${report.sucesso}\n` +
                                     `❌ Falhas: ${report.falhas}\n` +
                                     (report.falhas > 0 ? `\n*Detalhes:*\n${report.detalhes_falhas.join('\n')}` : '') +
                                     `\n\n🤖 _A memória do atendente virtual foi atualizada com os novos produtos e preços._`;

                await whatsapp.sendText(chatDestino, relatorioMsg);

            } catch (error) {
                console.error(`[CommandRouter] 🔥 Erro na execução do comando: ${error.message}`);
                await whatsapp.sendText(chatDestino, `❌ *Erro Crítico na Importação:*\n${error.message}`);
            }

            return true; // Comando interceptado e executado. Para o fluxo de mensagens aqui.
        }

        return false; // Não é um comando válido, permite que a mensagem siga para a IA
    }
}

module.exports = new CommandRouter();
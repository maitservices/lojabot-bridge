const googleDrive = require('./GoogleDriveService');
const productImport = require('./ProductImportService');

class CommandRouter {
    /**
     * Verifica se a mensagem é um comando administrativo e o executa
     * @param {Object} msg - Objeto da mensagem
     * @param {Object} whatsapp - Instância do WhatsappProvider para enviar respostas
     * @returns {Promise<boolean>} True se foi um comando processado, False se for uma conversa normal
     */
    async handle(msg, whatsapp) {
        // Regra de Segurança: Só aceita comandos se vier do seu número ou for uma "Self-Message" (fromMe)
        const contact = await msg.getContact();
        const numero = contact.number;
        const isAdmin = numero === process.env.ADMIN_NUMBER;
        console.log(`msg.from: ${numero})`);
        if (!isAdmin){
            console.log("Não é admin.");
            return false;
        } 

        // Gatilho: Comando /estoque + URL
        if (msg.body.startsWith('/estoque ')) {
            const url = msg.body.replace('/estoque ', '').trim();
            console.log("iniciando atualização de estoque.");
            
            // Define para onde enviar a resposta (Se for msg.fromMe, responde no próprio chat)
            const chatDestino = msg.fromMe ? msg.to : msg.from;

            await whatsapp.sendText(chatDestino, "⏳ *Processando:* Iniciando download da planilha do Drive...");

            try {
                // 1. Baixa a planilha para a memória (Serviço discutido anteriormente)
                const fileBuffer = await googleDrive.downloadSheetAsBuffer(url);
                
                await whatsapp.sendText(chatDestino, "✅ Download concluído. Sincronizando com o Supabase...");

                // 2. Envia para o processador bater na Edge Function linha por linha
                const report = await productImport.processFile(fileBuffer);

                // 3. Feedback formatado
                const relatorioMsg = `*🏁 Sincronização Concluída!*\n\n` +
                                     `📊 Total de Linhas: ${report.total_processado}\n` +
                                     `✅ Sucesso: ${report.sucesso}\n` +
                                     `❌ Falhas: ${report.falhas}\n` +
                                     (report.falhas > 0 ? `\n*Detalhes:*\n${report.detalhes_falhas.join('\n')}` : '');

                await whatsapp.sendText(chatDestino, relatorioMsg);

            } catch (error) {
                await whatsapp.sendText(chatDestino, `❌ *Erro Crítico:*\n${error.message}`);
            }

            return true; // Comando interceptado e resolvido. Para o fluxo aqui.
        }

        return false; // Não é um comando, deixa a mensagem seguir o fluxo.
    }
}

module.exports = new CommandRouter();
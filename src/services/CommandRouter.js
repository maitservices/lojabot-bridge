const googleDrive = require('./GoogleDriveService');
const productImport = require('./ProductImportService');
const gemini = require('./GeminiService'); 

class CommandRouter {
    /**
     * Verifica se a mensagem é um comando administrativo e o executa
     * @param {Object} msg - Objeto da mensagem
     * @param {Object} client - Instância isolada do WhatsApp-web.js desta loja
     * @param {string} tenantId - ID da loja no Supabase
     * @returns {Promise<boolean>} True se foi um comando processado, False se for uma conversa normal
     */
    async handle(msg, client, tenantId) {
        // Regra de Segurança: Valida se o remetente é o Administrador
       const contact = await msg.getContact();
        const numeroRemetente = contact.number;
        
        // 🔥 VERIFICAÇÃO DINÂMICA DE ADMIN
        const config = await supabaseService.getTenantConfig(tenantId);
        const isAdmin = config && numeroRemetente === config.admin_number;
        
        if (!isAdmin){
            console.log(`[Loja ${tenantId}] 🔒 Bloqueado: Remetente não é o admin da loja.`);
            return false;
        }

        // Gatilho: Comando /estoque + URL
        if (msg.body.startsWith('/estoque ')) {
            const url = msg.body.replace('/estoque ', '').trim();
            console.log(`[Loja ${tenantId} | CommandRouter] 🚀 Iniciando fluxo de atualização de estoque via Google Drive.`);
            
            const chatDestino = msg.fromMe ? msg.to : msg.from;

            // ATUALIZAÇÃO: Usamos o client específico da loja
            await client.sendMessage(chatDestino, "⏳ *Processando:* Iniciando download da planilha do Drive...");

            try {
                const fileBuffer = await googleDrive.downloadSheetAsBuffer(url);
                await client.sendMessage(chatDestino, "✅ Download concluído. Sincronizando com o Supabase...");

                // Nota: O productImport precisará do tenantId na próxima etapa da nossa arquitetura
                const report = await productImport.processFile(fileBuffer);

                // INVALIDEZ DE CACHE: Atualiza APENAS a memória da IA desta loja específica
                console.log(`[Loja ${tenantId} | CommandRouter] 🧠 Acionando atualização de memória do Agente de IA...`);
                await gemini.atualizarCacheCatalogo(tenantId);

                const relatorioMsg = `*🏁 Sincronização Concluída!*\n\n` +
                                     `📊 Total de Linhas: ${report.total_processado}\n` +
                                     `✅ Sucesso: ${report.sucesso}\n` +
                                     `❌ Falhas: ${report.falhas}\n` +
                                     (report.falhas > 0 ? `\n*Detalhes:*\n${report.detalhes_falhas.join('\n')}` : '') +
                                     `\n\n🤖 _A memória do atendente virtual foi atualizada com os novos produtos e preços._`;

                await client.sendMessage(chatDestino, relatorioMsg);

            } catch (error) {
                console.error(`[Loja ${tenantId} | CommandRouter] 🔥 Erro na execução do comando: ${error.message}`);
                await client.sendMessage(chatDestino, `❌ *Erro Crítico na Importação:*\n${error.message}`);
            }

            return true; 
        }

        return false; 
    }
}

module.exports = new CommandRouter();
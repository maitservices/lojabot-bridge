const xlsx = require('xlsx');
const axios = require('axios');
require('dotenv').config();

class ProductImportService {
    constructor() {
        // A URL da sua Edge Function e a chave extraída de forma segura com .trim()
        this.apiUrl = 'https://aiqpxlxrynlfyylsrrrl.supabase.co/functions/v1/insert-product-stock';
        this.token = process.env.SUPABASE_ANON_KEY?.trim();
    }

    /**
     * Ponto de entrada do serviço. Recebe o buffer do arquivo (CSV/XLSX),
     * extrai os dados e orquestra o envio.
     * * @param {Buffer|string} fileData - O conteúdo do arquivo em Buffer ou Base64
     * @returns {Promise<Object>} Resumo da operação
     */
    async processFile(fileData) {
        console.info("\n[ProductImport] 📥 Iniciando leitura do arquivo de lote...");

        try {
            // 1. Leitura do arquivo (a lib xlsx abstrai a diferença entre CSV e Excel)
            const workbook = xlsx.read(fileData, { type: 'buffer' }); // Altere para 'base64' se o input vier como base64
            
            // Pega a primeira aba da planilha
            const firstSheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[firstSheetName];
            
            // 2. Conversão da aba para um Array de Objetos JSON
            const rows = xlsx.utils.sheet_to_json(worksheet);

            if (!rows || rows.length === 0) {
                console.warn("[ProductImport] ⚠️ O arquivo está vazio ou formatado incorretamente.");
                return { status: 'empty', total: 0 };
            }

            console.info(`[ProductImport] 📊 ${rows.length} linhas extraídas. Iniciando sincronização com Supabase...`);
            
            // 3. Delega para o método de sincronização
            return await this.syncWithDatabase(rows);

        } catch (error) {
            console.error(`[ProductImport] 🔥 Erro fatal na extração do arquivo: ${error.message}`);
            throw error;
        }
    }

    /**
     * Varre o array de dados, valida regras de negócio (Fail Fast) e envia para a Edge Function.
     * * @param {Array<Object>} rows - Array de produtos extraídos da planilha
     */
    async syncWithDatabase(rows) {
        let successCount = 0;
        let errorCount = 0;
        const errorDetails = [];

        // Usamos for...of para processar sequencialmente e evitar gargalos de rede
        for (const [index, row] of rows.entries()) {
            const linhaReal = index + 2; // +2 porque o array começa em 0 e a linha 1 é o cabeçalho no Excel

            try {
                // 1. Mapeamento Defensivo (garante que os dados tenham a estrutura esperada)
                const payload = {
                    user_id: row.user_id ? String(row.user_id) : process.env.ADMIN_USER_ID, // Pode injetar um default do .env se faltar
                    sku: row.sku ? String(row.sku) : null,
                    nome_produto: row.nome_produto,
                    valor_un: Number(row.valor_un) || 0,
                    qtd: Number(row.qtd) || 0
                };

                // 2. Validação Local (Fail Fast) - Evita bater na API se já sabemos que vai dar erro 400
                if (!payload.nome_produto || !payload.user_id) {
                    throw new Error(`Campos obrigatórios ausentes (user_id ou nome_produto)`);
                }

                // 3. Chamada HTTP para a Edge Function
                const response = await axios.post(this.apiUrl, payload, {
                    headers: {
                        'Authorization': `Bearer ${this.token}`,
                        'Content-Type': 'application/json'
                    }
                });

                successCount++;
                console.info(`[ProductImport] ✅ Linha ${linhaReal} (${payload.nome_produto}): Salvo com ID ${response.data.result.id}`);

            } catch (error) {
                errorCount++;
                // Captura a mensagem de erro da Edge Function (se for 400/500) ou o erro de validação local
                const errorMsg = error.response?.data?.error || error.message;
                console.error(`[ProductImport] ❌ Linha ${linhaReal} falhou: ${errorMsg}`);
                errorDetails.push(`Linha ${linhaReal}: ${errorMsg}`);
            }
        }

        const report = {
            total_processado: rows.length,
            sucesso: successCount,
            falhas: errorCount,
            detalhes_falhas: errorDetails
        };

        console.info(`\n[ProductImport] 🏁 Importação concluída. Sucesso: ${successCount} | Falhas: ${errorCount}`);
        return report;
    }
}

module.exports = new ProductImportService();
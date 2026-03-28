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
     * @param {Buffer|string} fileData - O conteúdo do arquivo em Buffer ou Base64
     * @returns {Promise<Object>} Resumo da operação
     */
    async processFile(fileData) {
        console.info("\n[ProductImport] 📥 Iniciando leitura do arquivo de lote...");

        try {
            // 1. Leitura do arquivo (a lib xlsx abstrai a diferença entre CSV e Excel)
            const workbook = xlsx.read(fileData, { type: 'buffer' }); 
            
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
     * @param {Array<Object>} rows - Array de produtos extraídos da planilha
     */
    async syncWithDatabase(rows) {
        let successCount = 0;
        let errorCount = 0;
        const errorDetails = [];

        // Usamos for...of para processar sequencialmente e evitar gargalos de rede
        for (const [index, row] of rows.entries()) {
            const linhaReal = index + 2; // +2 porque o array começa em 0 e a linha 1 é o cabeçalho no Excel

            try {
                // --- REGRA DE NEGÓCIO: DISPONIBILIDADE ---
                // Padrão: Vazio ou 'Y' (Yes) = true | 'N' (No) = false
                let disponivelBool = true; // Assume verdadeiro se vier vazio
                if (row.disponivel !== undefined && row.disponivel !== null) {
                    const valorPlanilha = String(row.disponivel).trim().toUpperCase();
                    if (valorPlanilha === 'N') {
                        disponivelBool = false;
                    }
                }

                // 1. Mapeamento Defensivo (garante que os dados tenham a estrutura esperada)
                const payload = {
                    user_id: row.user_id ? String(row.user_id) : process.env.ADMIN_USER_ID,
                    sku: row.sku ? String(row.sku) : null,
                    nome_produto: row.nome_produto,
                    valor_un: Number(row.valor_un) || 0,
                    qtd: Number(row.qtd) || 0,
                    
                    // Novos campos com checagem de existência para não mandar "undefined" como texto
                    descricao: row.descricao ? String(row.descricao).trim() : undefined,
                    imagens_urls: row.imagens_urls ? String(row.imagens_urls).trim() : undefined,
                    disponivel: disponivelBool
                };

                // Remove chaves 'undefined' do objeto para gerar um JSON limpo
                // Isso garante que se não houver 'descricao' na planilha, ele nem envia o campo
                Object.keys(payload).forEach(key => payload[key] === undefined && delete payload[key]);

                // 2. Validação Local (Fail Fast)
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
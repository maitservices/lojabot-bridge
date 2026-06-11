const axios = require('axios');
const path = require('path');
// Força o Node a procurar o .env na raiz do projeto
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
// Adicione este log temporário para testar. Se imprimir 'undefined', o erro persiste no arquivo .env
console.log("🔑 Token Supabase:", process.env.SUPABASE_ANON_KEY ? "Carregado" : "Falhou");
class SupabaseService {

    /**
     * Busca as instruções dinâmicas do agente via Edge Function
     * @param {string} agentName - Nome do agente a ser buscado (ex: MeuAgente)
     * @returns {Promise<string>} O texto da instrução
     */
    async fetchAgentInstruction(agentName) {
        try {
            console.log(`[Supabase] Buscando instruções para o agente: ${agentName}...`);
            
            const url = process.env.SUPABASE_URL_FUNCTION_INSTRUCTION_AGENT;
            const token = process.env.SUPABASE_ANON_KEY;

            // 🚨 DEBUG: Vamos ver exatamente o que o Node.js está segurando
            console.log("-------------------------------------------------");
            console.log("URL:", url);
            console.log("Token Carregado?", token ? "SIM" : "NÃO");
            console.log("Primeiros 15 chars do token:", token ? token.substring(0, 15) : "undefined");
            console.log("Tamanho do token:", token ? token.length : 0);
            console.log("-------------------------------------------------");
            console.log("agentName: ",agentName);
            const response = await axios.get(url, {
                params: { nome_agente: agentName },
                headers: {
                    'Authorization': `Bearer ${token}` // O espaço depois do Bearer é crucial
                }
            });
            // Retorna o valor contido no campo esperado
            if (response.data.result && response.data.result.instrucao_agente) {
                return response.data.result.instrucao_agente;
            } else {
                throw new Error("Campo 'instrucao_agente' não encontrado no payload de retorno.");
            }

        } catch (error) {
            console.error(`❌ [Supabase] Erro ao buscar instruções: ${error.message}`);
            throw error; // Propaga o erro para impedir a inicialização do bot sem instruções
        }
    }

    /**
     * Busca os números de WhatsApp dos vendedores de uma loja específica
     * @param {string} tenantId 
     * @returns {Promise<Array>} Ex: [{ whatsapp_number: '554199999999', nome: 'João' }]
     */
    async getHumanAttendants(tenantId) {
        try {
            const baseUrl = process.env.SUPABASE_URL_FUNCTION;
            const url = `${baseUrl}/functions/v1/get-human-attendants`;
            
            const response = await axios.post(url, { tenant_id: tenantId }, {
                headers: {
                    'Authorization': `Bearer ${process.env.SUPABASE_ANON_KEY?.trim()}`,
                    'Content-Type': 'application/json'
                }
            });

            return response.data.result || [];
        } catch (error) {
            console.error(`[SupabaseService] Erro ao buscar atendentes da loja ${tenantId}:`, error.message);
            return [];
        }
    }

    async getTenantCatalog(tenantId) {
        try {
            const baseUrl = process.env.SUPABASE_URL_FUNCTION;
            const url = `${baseUrl}/functions/v1/get-tenant-catalog`;
            
            const response = await axios.post(url, { tenant_id: tenantId }, {
                headers: {
                    'Authorization': `Bearer ${process.env.SUPABASE_ANON_KEY?.trim()}`,
                    'Content-Type': 'application/json'
                }
            });
            return response.data.result || [];
        } catch (error) {
            console.error(`[SupabaseService] Erro ao buscar catálogo da loja ${tenantId}:`, error.message);
            return [];
        }
    }

    async buscarLojasAtivas() {
        try {
            console.log("🔍 Buscando Lojas...");
            
            // Monta a URL consumindo as variáveis do seu .env
            const baseUrl = process.env.SUPABASE_URL_FUNCTION;
            const url = `${baseUrl}/functions/v1/list-users`;
            
            // Dispara a requisição HTTP POST para a ponte no Supabase
            const response = await axios.post(url, {}, {
                headers: {
                    'Authorization': `Bearer ${process.env.SUPABASE_ANON_KEY?.trim()}`,
                    'Content-Type': 'application/json'
                }
            });

            const lojas = response.data.result || [];
            console.log(`✅ -> ${lojas.length} loja(s) ATIVAS para inicialização.`);
            
            return lojas;

        } catch (error) {
            // Tratamento de erro limpo para os logs do Docker
            const detalhe = error.response ? JSON.stringify(error.response.data) : error.message;
            console.error("🔥 Falha crítica ao conectar com a Edge Function de lojas:", detalhe);
            
            // Retorna um array vazio para não quebrar o loop do index.js em caso de falha de rede
            return []; 
        }
    }

    /**
     * Busca as configurações críticas da loja (Admin Number e Prompt)
     */
    async getTenantConfig(tenantId) {
        try {
            const baseUrl = process.env.SUPABASE_URL_FUNCTION;
            const url = `${baseUrl}/functions/v1/get-tenant-config`;
            
            const response = await axios.post(url, { tenant_id: tenantId }, {
                headers: {
                    'Authorization': `Bearer ${process.env.SUPABASE_ANON_KEY?.trim()}`,
                    'Content-Type': 'application/json'
                }
            });
            return response.data.result;
        } catch (error) {
            console.error(`[SupabaseService] Erro ao buscar config do tenant ${tenantId}:`, error.message);
            return null;
        }
    }
}

module.exports = new SupabaseService();
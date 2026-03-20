const { GoogleGenerativeAI } = require("@google/generative-ai");
const supabaseService = require("./SupabaseService");
const axios = require('axios');
const crypto = require('crypto'); // Para rastreabilidade de logs
require('dotenv').config();

class GeminiService {
    constructor() {
        this.genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        this.chatSessions = new Map();
        this.model = null; // O modelo começará nulo e será preenchido no initialize
        
        // Separação de responsabilidades no Prompt de Sistema
        this.instrucaoBase = ""; // Armazena a persona do bot (Padaria Caseira)
        this.catalogoTexto = ""; // Armazena o cache formatado dos produtos
    }

    /**
     * Inicializa a IA buscando a persona e carregando o catálogo inicial do banco
     */
    async initialize() {
        console.log('🔄 [Gemini] Iniciando configuração do modelo e cache...');
        const agentName = process.env.AGENT_NAME || "MeuAgente";
        
        // 1. Busca a instrução do banco (Persona)
        this.instrucaoBase = await supabaseService.fetchAgentInstruction(agentName);

        // 2. Busca o catálogo na Edge Function e monta o modelo pela primeira vez
        await this.atualizarCacheCatalogo();
    }

    /**
     * Busca os produtos no banco, formata em texto e recria a inteligência do modelo.
     * Atua como a "Invalidação de Cache" controlada.
     */
    async atualizarCacheCatalogo() {
        const requestId = crypto.randomUUID(); // ID único para auditoria nos logs
        console.info(`[${requestId}] 🔄 [Gemini] Atualizando cache do catálogo de produtos...`);
        
        try {
            // Monta a URL da Edge Function dinamicamente baseada na variável existente
            const baseUrl = process.env.SUPABASE_URL_FUNCTION;
            const url = `${baseUrl}/functions/v1/list-product-stock-user`;
            
            // Faz a requisição autenticada
            const response = await axios.post(url, {
                user_id: process.env.ADMIN_USER_ID 
            }, {
                headers: {
                    'Authorization': `Bearer ${process.env.SUPABASE_ANON_KEY?.trim()}`,
                    'Content-Type': 'application/json'
                }
            });

            const produtos = response.data.result;

            // Formata o catálogo para que a IA compreenda como uma tabela de referência
            if (!produtos || produtos.length === 0) {
                this.catalogoTexto = "\n\n[AVISO DO SISTEMA: Atualmente o estoque está vazio. Não ofereça produtos.]";
                console.warn(`[${requestId}] ⚠️ [Gemini] O catálogo retornou vazio.`);
            } else {
                let menuFormatado = "\n\n--- CATÁLOGO DE PRODUTOS E PREÇOS ATUALIZADOS ---\n";
                menuFormatado += "Utilize estritamente as informações abaixo para responder sobre disponibilidade e valores:\n";
                produtos.forEach(p => {
                    menuFormatado += `* ${p.nome_produto} (SKU: ${p.sku}) | Preço: R$ ${p.valor_un.toFixed(2)} | Estoque: ${p.qtd} un\n`;
                });
                menuFormatado += "--------------------------------------------------\n";
                
                this.catalogoTexto = menuFormatado;
                console.info(`[${requestId}] ✅ [Gemini] Cache atualizado com sucesso: ${produtos.length} itens injetados.`);
            }

            // 3. (Re)Configura o modelo de IA unindo a Persona com o Novo Catálogo
            this.model = this.genAI.getGenerativeModel({
                model: process.env.GEMINI_MODEL,
                systemInstruction: this.instrucaoBase + this.catalogoTexto, 
                generationConfig: {
                    temperature: parseFloat(process.env.GEMINI_TEMPERATURE) || 0.3,
                    topP: 0.95,
                    topK: 40,
                }
            });

            // 4. Limpa as sessões ativas (flush)
            // Isso garante que os usuários em atendimento não recebam preços antigos da memória do chat
            this.chatSessions.clear();
            console.log(`[${requestId}] 🧹 [Gemini] Histórico de sessões limpo para forçar adoção do novo catálogo.`);

        } catch (error) {
            console.error(`[${requestId}] ❌ [Gemini] Erro ao atualizar cache do catálogo: ${error.message}`);
            
            // Fallback de segurança: se o catálogo falhar, carrega a IA pelo menos com a instrução base
            if (!this.model) {
                this.model = this.genAI.getGenerativeModel({
                    model: process.env.GEMINI_MODEL,
                    systemInstruction: this.instrucaoBase,
                });
            }
        }
    }

    /**
     * Obtém ou cria uma sessão de chat persistente para o usuário
     */
    getChatSession(userId) {
        if (!this.model) {
            throw new Error("Modelo Gemini não foi inicializado. Chame initialize() primeiro.");
        }

        if (!this.chatSessions.has(userId)) {
            this.chatSessions.set(userId, this.model.startChat({ history: [] }));
        }
        return this.chatSessions.get(userId);
    }

    /**
     * Envia a pergunta do WhatsApp e retorna a resposta da IA
     */
    async generateResponse(userId, userMessage) {
        try {
            const chat = this.getChatSession(userId);
            const result = await chat.sendMessage(userMessage);
            const response = await result.response;
            
            return response.text();
        } catch (error) {
            console.error(`[GeminiService] Erro na geração para ${userId}: ${error.message}`);
            return "Peço desculpas, mas tive um problema ao processar sua consulta. Pode repetir?";
        }
    }
}

module.exports = new GeminiService();
const { GoogleGenerativeAI } = require("@google/generative-ai");
const supabaseService = require("./SupabaseService");
require('dotenv').config();

class GeminiService {
    constructor() {
        this.genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        this.chatSessions = new Map();
        this.model = null; // O modelo começará nulo e será preenchido no initialize
    }

    /**
     * Método assíncrono para inicializar o modelo com instruções dinâmicas
     */
    async initialize() {
        // 1. Busca a instrução do banco via Supabase Service
        const agentName = process.env.AGENT_NAME || "MeuAgente";
        const systemInstruction = await supabaseService.fetchAgentInstruction(agentName);

        // 2. Configura o modelo de IA com o texto retornado
        this.model = this.genAI.getGenerativeModel({
            model: process.env.GEMINI_MODEL,
            systemInstruction: systemInstruction, // Instrução dinâmica injetada aqui
            generationConfig: {
                temperature: parseFloat(process.env.GEMINI_TEMPERATURE) || 0.3,
                topP: 0.95,
                topK: 40,
            }
        });

        console.log('✅ [Gemini] Modelo inicializado com instruções dinâmicas.');
    }

    /**
     * Obtém ou cria uma sessão de chat persistente para o usuário
     */
    getChatSession(userId) {
        // Trava de segurança: garante que o modelo foi inicializado antes do uso
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
            
            // Retorna o texto limpo
            return response.text();
        } catch (error) {
            console.error(`[GeminiService] Erro na geração: ${error.message}`);
            return "Peço desculpas, mas tive um problema ao processar sua consulta. Pode repetir?";
        }
    }
}

module.exports = new GeminiService();
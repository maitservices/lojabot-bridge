const { GoogleGenerativeAI } = require("@google/generative-ai");
require('dotenv').config();

class GeminiService {
    constructor() {
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        
        // Configuração do modelo com as instruções de sistema (System Prompt)
        this.model = genAI.getGenerativeModel({ 
            model: process.env.GEMINI_MODEL,
            systemInstruction: process.env.AGENT_INSTRUCTIONS,
            generationConfig: {
                temperature: parseFloat(process.env.GEMINI_TEMPERATURE) || 0.3,
                topP: 0.95,
                topK: 40,
            }
        });

        // Mapa em memória para gerenciar o histórico de chat por usuário (Contexto)
        this.chatSessions = new Map();
    }

    /**
     * Obtém ou cria uma sessão de chat persistente para o usuário
     */
    getChatSession(userId) {
        if (!this.chatSessions.has(userId)) {
            // Inicia um novo chat histórico para manter o contexto da conversa
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
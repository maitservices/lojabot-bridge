const axios = require('axios');
const config = require('../config');

class TypebotService {
    /**
     * Envia mensagem para o Typebot
     * @param {string} sessionId - ID único do usuário (ex: telefone)
     * @param {string} message - Texto enviado pelo usuário
     */
    async sendMessage(sessionId, message) {
        try {
            // Requisição POST para o Typebot
            const response = await axios.post(config.typebotUrl, {
                message: message,
                sessionId: sessionId
            });

            const data = response.data;
            const botMessages = [];

            // O Typebot retorna uma lista de mensagens (texto, imagem, etc)
            // Aqui vamos filtrar apenas os TEXTOS para o MVP
            if (data.messages && Array.isArray(data.messages)) {
                for (const msg of data.messages) {
                    if (msg.type === 'text') {
                        // Extrai o texto simples ou rich text
                        const textContent = msg.content.richText 
                            ? msg.content.richText.map(t => t.children.map(c => c.text).join('')).join('')
                            : msg.content;
                        
                        botMessages.push(textContent);
                    }
                }
            }

            return botMessages; // Retorna array de strings (respostas)

        } catch (error) {
            console.error(`[TypebotService] Erro: ${error.message}`);
            // Retorna uma mensagem de fallback caso a API falhe
            return ["Desculpe, estou em manutenção no momento."];
        }
    }
}

// Singleton: Exportamos uma instância já criada da classe
module.exports = new TypebotService();
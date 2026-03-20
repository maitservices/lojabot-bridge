class MessageFilter {
    /**
     * Verifica se a mensagem deve ser enviada para a Inteligência Artificial
     * @param {Object} msg - Objeto da mensagem do whatsapp-web.js
     * @returns {boolean}
     */
    isValidForAI(msg) {
        // 1. Ignora mensagens enviadas pelo próprio bot (Loop Infinito)
        if (msg.fromMe) return false;

        // 2. Ignora Grupos, Status e Broadcasts
        if (msg.from.includes('@g.us')) return false;
        if (msg.from === 'status@broadcast'){ 
            console.log(`[Filtro] Mensagem ignorada status@broadcast (msg: ${msg.body})`);
            return false;
        }
        if (msg.from.includes('@lid') && (!msg.body || msg.body.trim() === '')){
            console.log(`[Filtro] Mensagem ignorada @lid (msg: ${msg.body})`);
                return false;
        } 

        // 3. Validação de Tempo (Ignora mensagens com mais de 10 minutos)
        if (!this.isMessageRecent(msg.timestamp)) {
            console.log(`[Filtro] Mensagem antiga ignorada (ID: ${msg.id.id})`);
            return false;
        }

        return true;
    }

    isMessageRecent(messageTimestamp) {
        const tenMinutesInSeconds = 10 * 60;
        const currentTimestamp = Math.floor(Date.now() / 1000);
        return (currentTimestamp - messageTimestamp) <= tenMinutesInSeconds;
    }
}

module.exports = new MessageFilter();
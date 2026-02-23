require('dotenv').config(); // Carrega o arquivo .env

const config = {
    typebotUrl: process.env.TYPEBOT_URL,
    messageDelay: parseInt(process.env.MESSAGE_DELAY) || 5000,
    
    // Método para validar se as configs existem (Fail Fast)
    validate() {
        if (!this.typebotUrl) {
            console.error("ERRO FATAL: TYPEBOT_URL não definida no .env");
            process.exit(1);
        }
    }
};

module.exports = config; // Exporta o objeto para ser usado em outros arquivos
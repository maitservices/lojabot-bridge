const axios = require('axios');

class GoogleDriveService {
    /**
     * Extrai o ID único do documento a partir de uma URL padrão do Google Sheets
     * @param {string} url - Ex: https://docs.google.com/spreadsheets/d/1A2B3C4D.../edit
     * @returns {string|null} O ID do documento ou null se inválido
     */
    extractFileId(url) {
        // Regex para capturar a string randômica entre "/d/" e a próxima barra
        const match = url.match(/\/d\/([a-zA-Z0-9-_]+)/);
        return match ? match[1] : null;
    }

    /**
     * Faz o download da planilha e retorna como um Buffer em memória
     * @param {string} url - A URL enviada no WhatsApp
     * @returns {Promise<Buffer>} O arquivo binário pronto para a biblioteca 'xlsx'
     */
    async downloadSheetAsBuffer(url) {
        console.info("[GoogleDrive] 🔍 Analisando URL recebida...");
        
        const fileId = this.extractFileId(url);
        if (!fileId) {
            throw new Error("Não foi possível identificar o ID da planilha na URL fornecida.");
        }

        // O 'Pulo do Gato': Converte a rota de '/edit' para '/export?format=xlsx'
        const exportUrl = `https://docs.google.com/spreadsheets/d/${fileId}/export?format=xlsx`;
        console.info(`[GoogleDrive] ⬇️ Baixando arquivo da URL de exportação: ${exportUrl}`);

        try {
            // responseType: 'arraybuffer' é crucial para arquivos binários (Excel, Imagens, etc)
            const response = await axios.get(exportUrl, { responseType: 'arraybuffer' });
            return response.data;
        } catch (error) {
            console.error(`[GoogleDrive] ❌ Falha no download: ${error.message}`);
            throw new Error("Erro ao baixar a planilha. Verifique se o link está configurado como 'Qualquer pessoa com o link pode ler'.");
        }
    }
}

module.exports = new GoogleDriveService();
const axios = require('axios');
require('dotenv').config();

class SessionControlService {
    constructor() {
        this.baseUrl = process.env.SUPABASE_URL_FUNCTION;
        this.token = process.env.SUPABASE_ANON_KEY?.trim();
        this.endpoint = `${this.baseUrl}/functions/v1/manage-customer-session`;
    }

    /**
     * Consulta o banco (via Edge Function) para saber se a IA deve responder este cliente
     */
    async getSessionStatus(tenantId, customerNumber) {
        try {
            const response = await axios.post(this.endpoint, {
                action: 'get',
                tenant_id: tenantId,
                customer_number: customerNumber
            }, {
                headers: { 'Authorization': `Bearer ${this.token}`, 'Content-Type': 'application/json' }
            });

            // Se for cliente novo, a EF retorna 'AI_ATTENDING' por padrão
            return response.data.status; 
        } catch (error) {
            console.error(`[SessionControl] Erro ao buscar sessão de ${customerNumber}:`, error.message);
            // Em caso de falha de rede, deixamos a IA atender para o cliente não ficar no vácuo
            return 'AI_ATTENDING'; 
        }
    }

    /**
     * Atualiza o estado da sessão (O botão de Mute/Desmute)
     */
    async updateSessionStatus(tenantId, customerNumber, status, attendantId = null) {
        try {
            await axios.post(this.endpoint, {
                action: 'update',
                tenant_id: tenantId,
                customer_number: customerNumber,
                status: status,
                attendant_id: attendantId
            }, {
                headers: { 'Authorization': `Bearer ${this.token}`, 'Content-Type': 'application/json' }
            });
            
            console.log(`[SessionControl] 🔒 Estado de ${customerNumber} alterado para ${status}`);
        } catch (error) {
            console.error(`[SessionControl] Erro ao atualizar sessão de ${customerNumber}:`, error.message);
        }
    }
}

module.exports = new SessionControlService();
const { GoogleGenerativeAI } = require("@google/generative-ai");
const supabaseService = require("./SupabaseService");
const axios = require('axios');
const crypto = require('crypto');
require('dotenv').config();

class GeminiService {
    constructor() {
        this.genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        // 🔥 ARQUITETURA SAAS: Guarda o estado de cada loja separadamente
        // A chave será o tenantId, e o valor será um objeto contendo o cérebro daquela loja
        this.tenants = new Map();
    }

    /**
     * Prepara a estrutura de memória para uma loja nova
     */
    async initializeTenant(tenantId) {
        console.log(`🔄 [Gemini] Iniciando configuração do modelo para a Loja: ${tenantId}...`);
        
        // Cria a "gaveta" desta loja zerada
        this.tenants.set(tenantId, {
            model: null,
            chatSessions: new Map(), // Conversas dos clientes desta loja
            instrucaoBase: "",       // Persona desta loja
            catalogoTexto: "",       // Cardápio desta loja
            dicionarioImagens: new Map() // Fotos desta loja
        });

        // 🔥 O PULO DO GATO: Busca dinamicamente a configuração!
        const config = await supabaseService.getTenantConfig(tenantId);
        
        if (config) {
            tenantData.instrucaoBase = config.agent_prompt;
        } else {
            tenantData.instrucaoBase = "Configuração indisponível no momento.";
        }
        // 2. Busca o catálogo e monta o modelo
        await this.atualizarCacheCatalogo(tenantId);
    }

    /**
     * Busca os produtos no banco EXCLUSIVOS da loja e atualiza APENAS a IA dela
     */
    async atualizarCacheCatalogo(tenantId) {
        const tenantData = this.tenants.get(tenantId);
        if (!tenantData) return;

        // Busca o array de produtos exclusivo DESTA loja no banco
        const produtos = await supabaseService.getTenantCatalog(tenantId);
        
        if (produtos.length === 0) {
            tenantData.catalogoBase = "\nA loja ainda não possui produtos cadastrados no sistema.";
            this._rebuildSystemPrompt(tenantId);
            return;
        }

        // Transforma o JSON do banco em um texto legível e estruturado para o cérebro da IA ler
        let catalogoTexto = "\n--- CATÁLOGO DE PRODUTOS DA LOJA ---\n";
        
        produtos.forEach(prod => {
            const preco = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(prod.valor_un);
            catalogoTexto += `\n- PRODUTO: ${prod.nome_produto} (SKU: ${prod.sku})\n`;
            catalogoTexto += `  Preço: ${preco} | Em Estoque: ${prod.qtd} unidades\n`;
            if (prod.descricao) catalogoTexto += `  Detalhes: ${prod.descricao}\n`;
            if (prod.imagens_urls) {
                catalogoTexto += `  [IMPORTANTE: Se o cliente pedir foto, use a instrução interna [ACORDO:ENVIAR_FOTO|${prod.sku}|${prod.nome_produto}]]\n`;
                // Guarda a URL real no dicionário de imagens para o envio nativo depois
                tenantData.imagensProduto[prod.sku] = prod.imagens_urls; 
            }
        });
        catalogoTexto += "\n--- FIM DO CATÁLOGO ---\n";

        tenantData.catalogoBase = catalogoTexto;
        this._rebuildSystemPrompt(tenantId); // Junta o Prompt (Instruções) com o Catálogo novo
    }

    getChatSession(tenantId, userId) {
        const tenantData = this.tenants.get(tenantId);
        if (!tenantData || !tenantData.model) throw new Error("Modelo não inicializado para esta loja.");

        if (!tenantData.chatSessions.has(userId)) {
            tenantData.chatSessions.set(userId, tenantData.model.startChat({ history: [] }));
        }
        return tenantData.chatSessions.get(userId);
    }

    /**
     * Obtém a URL secreta da imagem armazenada no dicionário da loja
     */
    getImagemUrl(tenantId, sku) {
        const tenantData = this.tenants.get(tenantId);
        if (tenantData && tenantData.dicionarioImagens) {
            return tenantData.dicionarioImagens.get(sku);
        }
        return null;
    }

    async generateResponse(tenantId, userId, userMessage, pacoteMidia = null) {
        try {
            const chat = this.getChatSession(tenantId, userId);
            let result = pacoteMidia ? await chat.sendMessage([userMessage, pacoteMidia]) : await chat.sendMessage(userMessage);
            const response = await result.response;
            return response.text();
        } catch (error) {
            if (error.message.includes('429') || error.message.includes('Quota exceeded')) {
                console.warn(`[Gemini | Loja ${tenantId}] ⚠️ Limite de API.`);
                return "Nossa loja está bem movimentada agora! 😅 Pode me reenviar sua mensagem em 1 minutinho?";
            }
            console.error(`[GeminiService] Erro na geração para ${userId}: ${error.message}`);
            return "Peço desculpas, mas tive um probleminha técnico. Pode repetir?";
        }
    }

    /**
     * Gera um resumo executivo da conversa atual para enviar ao atendente humano
     */
    async generateSummary(tenantId, userId) {
        try {
            const tenantData = this.tenants.get(tenantId);
            if (!tenantData) return "Resumo não disponível. Falha ao acessar dados da loja.";

            const chat = this.getChatSession(tenantId, userId);
            
            // 1. Extrai o histórico cru da conversa atual
            const history = await chat.getHistory();
            if (!history || history.length === 0) return "Conversa recém iniciada, sem dados suficientes.";

            // 2. Formata o histórico em um texto legível
            let historicoTexto = history.map(msg => {
                const autor = msg.role === 'user' ? 'Cliente' : 'IA';
                const texto = msg.parts[0].text;
                return `${autor}: ${texto}`;
            }).join('\n');

            // 3. Cria uma chamada ISOLADA para o Gemini resumir (não afeta a memória do cliente)
            const promptResumo = `Atue como um supervisor de atendimento. Leia o histórico de conversa abaixo e crie um resumo executivo direto ao ponto (máximo de 3 a 4 linhas) para o vendedor humano que vai assumir a venda agora. Destaque os itens de interesse e dúvidas pendentes.\n\nHistórico:\n${historicoTexto}`;

            // Usa o modelo limpo para gerar o resumo (evitando poluir a sessão do usuário)
            const result = await tenantData.model.generateContent(promptResumo);
            const response = await result.response;
            
            return response.text();

        } catch (error) {
            console.error(`[GeminiService] Falha ao gerar resumo para ${userId}:`, error.message);
            return "O cliente solicitou atendimento humano ou quer fechar um pedido complexo. Favor verificar o histórico.";
        }
    }
}

module.exports = new GeminiService();
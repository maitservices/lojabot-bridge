# Usamos a imagem oficial do Node baseada em Debian (suporta ARM64 da Oracle)
FROM node:18-bullseye-slim

# Instala o Chromium nativo do Linux e as fontes necessárias para o Puppeteer não dar erro de tela preta
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-ipafont-gothic fonts-wqy-zenhei fonts-thai-tlwg fonts-kacst fonts-freefont-ttf \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Variáveis de ambiente vitais: Dizem para o Node NÃO baixar o Chrome do Google, mas usar o do Linux que acabamos de instalar
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# Define a pasta de trabalho dentro do container
WORKDIR /usr/src/app

# Copia apenas os arquivos de dependência primeiro (Otimiza o cache do Docker)
COPY package*.json ./

# Instala as dependências do Node
RUN npm install --omit=dev

# Copia todo o resto do código para dentro do container
COPY . .

# Expõe a porta do nosso WebSocket
EXPOSE 3001

# Comando para iniciar o robô
CMD ["node", "index.js"]
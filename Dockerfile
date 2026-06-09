FROM node:18-bullseye-slim

# Instala o Chromium nativo e fontes essenciais para evitar telas pretas/quadrados no Puppeteer
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-ipafont-gothic fonts-wqy-zenhei fonts-thai-tlwg fonts-kacst fonts-freefont-ttf \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Força o Puppeteer a não baixar o Chrome e usar o que acabamos de instalar
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /usr/src/app

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

# Expõe apenas a porta interna (O Nginx cuidará do mundo externo)
EXPOSE 3001

CMD ["node", "src/index.js"]
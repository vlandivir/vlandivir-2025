# Используем официальный образ Node.js
FROM node:22

# Устанавливаем рабочую директорию
WORKDIR /usr/src/app

# Копируем package.json и package-lock.json корня проекта
COPY package*.json ./
# Копируем package.json и package-lock.json мини-приложения
COPY web/mini-app/package*.json web/mini-app/

# Системные зависимости для сборки нативных модулей (canvas, sharp и т.п.)
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       python3 \
       make \
       g++ \
       pkg-config \
       libcairo2-dev \
       libpango1.0-dev \
       libjpeg-dev \
       libgif-dev \
       librsvg2-dev \
    && rm -rf /var/lib/apt/lists/*

# Устанавливаем все зависимости (включая dev зависимости для сборки)
RUN npm ci && npm ci --prefix web/mini-app

# Копируем все файлы приложения
COPY . .

# Генерируем Prisma клиент
RUN npx prisma generate

# Собираем фронтенд мини-приложения
RUN npm run web:mini-app:build

# Компилируем TypeScript в JavaScript
RUN npm run build

# Удаляем dev dependencies после сборки для уменьшения размера образа
RUN npm prune --production && rm -rf web/mini-app/node_modules

# Declare build args that will be passed as environment variables
ARG TELEGRAM_BOT_TOKEN
ARG TAG_NAME
ARG ENVIRONMENT
ARG POSTGRES_CONNECTION_STRING
ARG DO_SPACES_ACCESS_KEY
ARG DO_SPACES_SECRET_KEY
ARG OPENAI_API_KEY
ARG VLANDIVIR_2025_WEBHOOK_URL

# Set environment variables from build args
ENV TELEGRAM_BOT_TOKEN=$TELEGRAM_BOT_TOKEN
ENV TAG_NAME=$TAG_NAME
ENV ENVIRONMENT=$ENVIRONMENT
ENV POSTGRES_CONNECTION_STRING=$POSTGRES_CONNECTION_STRING
ENV DO_SPACES_ACCESS_KEY=$DO_SPACES_ACCESS_KEY
ENV DO_SPACES_SECRET_KEY=$DO_SPACES_SECRET_KEY
ENV OPENAI_API_KEY=$OPENAI_API_KEY
ENV VLANDIVIR_2025_WEBHOOK_URL=$VLANDIVIR_2025_WEBHOOK_URL

# Копируем сгенерированный Prisma клиент в папку dist
RUN cp -r src/generated dist/

# Открываем порт 3000 для HTTP (development)
EXPOSE 443 3000

# Запускаем приложение
CMD ["node", "dist/main.js"]

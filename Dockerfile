# Используем официальный образ Node.js
FROM node:22

# Устанавливаем рабочую директорию
WORKDIR /usr/src/app

# Копируем package.json и package-lock.json
COPY package*.json ./

# Устанавливаем зависимости
RUN npm install --production

# Устанавливаем @nestjs/cli и @types/node
RUN npm install -g @nestjs/cli && npm install --save-dev @types/node

# Копируем все файлы приложения
COPY . .

# Генерируем Prisma клиент
RUN npx prisma generate

# Компилируем TypeScript в JavaScript
RUN npm run build

# Declare build args that will be passed as environment variables
ARG TELEGRAM_BOT_TOKEN
ARG TAG_NAME
ARG ENVIRONMENT
ARG POSTGRES_CONNECTION_STRING
ARG DO_SPACES_ACCESS_KEY
ARG DO_SPACES_SECRET_KEY
ARG OPENAI_API_KEY

# Set environment variables from build args
ENV TELEGRAM_BOT_TOKEN=$TELEGRAM_BOT_TOKEN
ENV TAG_NAME=$TAG_NAME
ENV ENVIRONMENT=$ENVIRONMENT
ENV POSTGRES_CONNECTION_STRING=$POSTGRES_CONNECTION_STRING
ENV DO_SPACES_ACCESS_KEY=$DO_SPACES_ACCESS_KEY
ENV DO_SPACES_SECRET_KEY=$DO_SPACES_SECRET_KEY
ENV OPENAI_API_KEY=$OPENAI_API_KEY

# Копируем сгенерированный Prisma клиент в папку dist
RUN cp -r src/generated dist/

# Открываем порт 3000 для HTTP (development)
EXPOSE 443 3000

# Запускаем приложение
CMD ["node", "dist/main.js"]

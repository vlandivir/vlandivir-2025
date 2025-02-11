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

# Устанавливаем правильные разрешения для сертификатов
# RUN chmod 600 .secret/private-key.pem .secret/certificate.pem

# Компилируем TypeScript в JavaScript
RUN npm run build

# Открываем только порт 443 для HTTPS
EXPOSE 443

# Запускаем приложение
CMD ["node", "dist/main.js"]

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

# Копируем сгенерированный Prisma клиент в папку dist
RUN cp -r src/generated dist/

# Открываем порт 3000 для HTTP (development)
EXPOSE 443 3000

# Запускаем приложение
CMD ["node", "dist/main.js"]

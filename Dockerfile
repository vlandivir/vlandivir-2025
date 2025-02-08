# Используем официальный образ Node.js
FROM node:16

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

# Компилируем TypeScript в JavaScript
RUN npm run build

# Указываем, что приложение будет слушать на порту 3000
EXPOSE 3000

# Запускаем приложение
CMD ["node", "dist/main.js"]

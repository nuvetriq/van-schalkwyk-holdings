FROM node:22-slim

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY . .
RUN mkdir -p /data/uploads

ENV NODE_ENV=production \
    PORT=80 \
    DATA_DIR=/data

EXPOSE 80

CMD ["node", "server.js"]

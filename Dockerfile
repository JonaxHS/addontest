FROM node:20-alpine

WORKDIR /app

COPY package.json ./
COPY server.js ./
COPY config-ui.html ./

ENV NODE_ENV=production
ENV PORT=8787

EXPOSE 8787

CMD ["node", "server.js"]

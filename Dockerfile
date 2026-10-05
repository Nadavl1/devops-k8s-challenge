FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev \
	&& rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx

COPY app.js ./

ENV PORT=8080
EXPOSE 8080

USER node
CMD ["node", "app.js"]
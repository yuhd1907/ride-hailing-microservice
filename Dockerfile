FROM node:22-alpine

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY db.js rabbitmq.js ./
COPY trip-service ./trip-service
COPY matching-service ./matching-service

ARG SERVICE_ENTRY=trip-service/server.js
ENV SERVICE_ENTRY=${SERVICE_ENTRY}
EXPOSE 8083 8084

CMD ["sh", "-c", "node \"$SERVICE_ENTRY\""]

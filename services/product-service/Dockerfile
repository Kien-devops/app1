FROM node:24-alpine

ENV NODE_ENV=production \
    PORT=8080
WORKDIR /app

COPY --chown=node:node services/common ./common
COPY --chown=node:node services/product-service/server.js ./product-service/server.js

USER node
EXPOSE 8080
CMD ["node", "product-service/server.js"]

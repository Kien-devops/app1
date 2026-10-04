FROM node:24-alpine

ENV NODE_ENV=production \
    PORT=8080
WORKDIR /app

COPY --chown=node:node services/common ./common
COPY --chown=node:node services/auth-service/server.js ./auth-service/server.js

USER 1000:1000
EXPOSE 8080
CMD ["node", "auth-service/server.js"]

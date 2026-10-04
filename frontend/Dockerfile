FROM nginxinc/nginx-unprivileged:1.29-alpine

COPY --chown=101:101 frontend/nginx.conf /etc/nginx/nginx.conf
COPY --chown=101:101 frontend/index.html frontend/styles.css frontend/app.js /usr/share/nginx/html/

USER 101
EXPOSE 8080

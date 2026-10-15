# Single-container image: the server has no runtime npm dependencies (node:sqlite + node:http).
# Everything that must survive an update lives in /app/runtime (volume): the database, the hourly backups and the
# editable map (copied from the image on first start, so map-editor changes are kept across new images).
FROM node:24-alpine
WORKDIR /app
COPY dist ./dist
COPY data ./data
COPY public ./public
COPY start.mjs docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh && mkdir -p /app/runtime && chown -R node:node /app/runtime
ENV PORT=8090 HOST=0.0.0.0 DB_PATH=/app/runtime/harderwold.sqlite MAP_DIR=/app/runtime/map BACKUP_DIR=/app/runtime/backups NODE_ENV=production
VOLUME ["/app/runtime"]
EXPOSE 8090
USER node
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 CMD wget -qO- http://127.0.0.1:${PORT}/api/v1/health >/dev/null || exit 1
ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["node", "start.mjs"]

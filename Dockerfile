FROM node:24-bookworm-slim
WORKDIR /app
ENV HOST=0.0.0.0 PORT=3000 DB_PATH=/app/data/novels.db
COPY --chown=node:node package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --chown=node:node src ./src
COPY --chown=node:node public ./public
COPY --chown=node:node scripts ./scripts
RUN mkdir -p /app/data && chown node:node /app/data
USER node
EXPOSE 3000
CMD ["node", "src/server.mjs"]

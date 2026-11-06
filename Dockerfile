# ---- 构建阶段 ----
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/engine/package.json packages/engine/
COPY packages/hub/package.json packages/hub/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN npm ci
COPY packages packages
COPY apps apps
RUN npm run build -w @anqi/web && npm run build -w @anqi/server

# ---- 运行阶段：只有一个 server.cjs 和静态文件，无需 node_modules ----
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=8080 WEB_DIR=/app/web
COPY --from=build /app/apps/server/dist/server.cjs ./server.cjs
COPY --from=build /app/apps/web/dist ./web
EXPOSE 8080
USER node
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1
CMD ["node", "server.cjs"]

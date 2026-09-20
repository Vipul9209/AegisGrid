# One container: builds the React UI, then serves UI + API from a single Node process on :8080.
FROM node:22-slim AS ui
WORKDIR /ui
COPY frontend/package*.json ./
RUN npm ci || npm install
COPY frontend/ ./
RUN npm run build

FROM node:22-slim
WORKDIR /app
COPY backend/package*.json ./
RUN npm install --omit=dev
COPY backend/ ./
COPY --from=ui /ui/dist /app/public
ENV STATIC_DIR=/app/public PORT=8080 NODE_ENV=production
EXPOSE 8080
USER node
CMD ["node", "src/server.js"]

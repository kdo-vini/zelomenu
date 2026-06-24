# ─── build stage: compile the Vite frontend ────────────────────────────────────
FROM node:20-alpine AS build

WORKDIR /app

RUN apk add --no-cache git

COPY package*.json ./
RUN npm ci

COPY . .

ARG PUBLIC_APP_VERSION
RUN case "$PUBLIC_APP_VERSION" in \
      ''|'${'*) PUBLIC_APP_VERSION=$(git rev-parse --short=12 HEAD 2>/dev/null || echo dev) ;; \
    esac; \
    echo "[build] PUBLIC_APP_VERSION=$PUBLIC_APP_VERSION"; \
    npm run build

# ─── runtime stage: Express server serving API + static frontend ──────────────
FROM node:20-alpine

WORKDIR /app

# Install deps (including devDeps so tsx is available)
COPY package*.json ./
RUN npm ci

# Copy server source + built frontend
COPY server ./server
COPY src/domain ./src/domain
COPY --from=build /app/dist ./dist

# Copy tsconfig so tsx can resolve path aliases
COPY tsconfig*.json ./

ARG PUBLIC_APP_VERSION
ENV PUBLIC_APP_VERSION=${PUBLIC_APP_VERSION}

ENV SERVER_PORT=${PORT:-3101}
EXPOSE ${PORT:-3101}

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:${PORT:-3101}/api/health >/dev/null 2>&1 || exit 1

CMD ["sh", "-c", "export PUBLIC_APP_VERSION=\"${PUBLIC_APP_VERSION:-$(cat /app/APP_VERSION 2>/dev/null)}\"; exec npx tsx server/index.ts"]

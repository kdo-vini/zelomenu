# ─── build stage: compile the Vite frontend ────────────────────────────────────
FROM node:20-alpine AS build

WORKDIR /app

RUN apk add --no-cache git

COPY package*.json ./
RUN npm ci

COPY . .

# Vite inlines VITE_* env vars at build time. Dokploy uses --build-arg for
# these (configured in "Build Args" section of the application settings).
# The Express server also injects runtime env via window.__ENV__ as fallback.
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
ENV VITE_SUPABASE_URL=${VITE_SUPABASE_URL}
ENV VITE_SUPABASE_ANON_KEY=${VITE_SUPABASE_ANON_KEY}

ARG PUBLIC_APP_VERSION
RUN case "$PUBLIC_APP_VERSION" in \
      ''|'${'*) PUBLIC_APP_VERSION=$(git rev-parse --short=12 HEAD 2>/dev/null || echo dev) ;; \
    esac; \
    echo "[build] PUBLIC_APP_VERSION=$PUBLIC_APP_VERSION"; \
    echo "[build] VITE_SUPABASE_URL=$VITE_SUPABASE_URL"; \
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

# Runtime env vars for the Express server (reads process.env, injects into SPA).
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
ENV VITE_SUPABASE_URL=${VITE_SUPABASE_URL}
ENV VITE_SUPABASE_ANON_KEY=${VITE_SUPABASE_ANON_KEY}

ENV SERVER_PORT=${PORT:-3101}
EXPOSE ${PORT:-3101}

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:${PORT:-3101}/api/health >/dev/null 2>&1 || exit 1

CMD ["sh", "-c", "export PUBLIC_APP_VERSION=\"${PUBLIC_APP_VERSION:-$(cat /app/APP_VERSION 2>/dev/null)}\"; exec npx tsx server/index.ts"]

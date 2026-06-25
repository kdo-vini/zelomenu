# ─── build stage: compile the Vite frontend ────────────────────────────────────
FROM node:20-alpine AS build

WORKDIR /app

RUN apk add --no-cache git

COPY package*.json ./
RUN npm ci

COPY . .

# Vite inlines VITE_* env vars at build time — they must be present here, not
# at runtime. Passed via --build-arg from the deploy step.
# Default values set for Dokploy auto-build (which doesn't pass --build-arg).
ARG VITE_SUPABASE_URL=https://xnnjyrblpvsqrtsshawa.supabase.co
ARG VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inhubmp5cmJscHZzcXJ0c3NoYXdhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjE4MTQ2NDksImV4cCI6MjA3NzM5MDY0OX0.ctfUWDadjnnC4AVZnaD8Z33kaErxr0HQHrNnSw9MEGA
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

# Runtime env vars (the Express server injects these into the SPA HTML).
# Also set in the build stage above — repeated here because Docker stages
# don't inherit ARG/ENV from previous stages.
ENV VITE_SUPABASE_URL=https://xnnjyrblpvsqrtsshawa.supabase.co
ENV VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inhubmp5cmJscHZzcXJ0c3NoYXdhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjE4MTQ2NDksImV4cCI6MjA3NzM5MDY0OX0.ctfUWDadjnnC4AVZnaD8Z33kaErxr0HQHrNnSw9MEGA

ENV SERVER_PORT=${PORT:-3101}
EXPOSE ${PORT:-3101}

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:${PORT:-3101}/api/health >/dev/null 2>&1 || exit 1

CMD ["sh", "-c", "export PUBLIC_APP_VERSION=\"${PUBLIC_APP_VERSION:-$(cat /app/APP_VERSION 2>/dev/null)}\"; exec npx tsx server/index.ts"]

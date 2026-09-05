# Build frontend and backend together from the checked-out Git commit.
FROM node:24-alpine AS build
WORKDIR /app
RUN apk add --no-cache git
COPY package*.json ./
RUN npm ci
COPY . .
ARG PUBLIC_APP_VERSION
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
RUN BUILD_REQUIRE_CLEAN=1 PUBLIC_APP_VERSION="$PUBLIC_APP_VERSION" VITE_SUPABASE_URL="$VITE_SUPABASE_URL" VITE_SUPABASE_ANON_KEY="$VITE_SUPABASE_ANON_KEY" npm run build

FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/server-build ./server-build
COPY --from=build --chown=node:node /app/BUILD_INFO.json ./BUILD_INFO.json
USER node
EXPOSE 3101
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD wget -qO- http://127.0.0.1:${PORT:-3101}/api/health >/dev/null 2>&1 || exit 1
CMD ["node", "server-build/index.js"]

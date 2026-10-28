# Multi-Stage Production Dockerfile for Amrutam Telemedicine Backend
# Stage 1: Build & Prune
FROM node:24-alpine AS builder

WORKDIR /usr/src/app

COPY package*.json tsconfig.json ./
RUN npm ci

COPY src ./src
COPY docs ./docs

RUN npm run build
RUN npm prune --omit=dev

# Stage 2: Minimal Distroless / Hardened Alpine Runtime
FROM node:24-alpine AS runner

WORKDIR /usr/src/app
ENV NODE_ENV=production
ENV PORT=3000

# Install dumb-init for proper PID 1 signal forwarding
RUN apk add --no-cache dumb-init

# Use non-root user
USER node

COPY --chown=node:node package*.json ./
COPY --chown=node:node --from=builder /usr/src/app/node_modules ./node_modules
COPY --chown=node:node --from=builder /usr/src/app/dist ./dist
COPY --chown=node:node --from=builder /usr/src/app/docs ./docs

EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health/live || exit 1

ENTRYPOINT ["/usr/bin/dumb-init", "--"]
CMD ["node", "dist/server.js"]

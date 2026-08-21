# =============================================================================
# ZOL web — container image for Google Cloud Run
#
# Build context is the `web/` directory:
#   gcloud run deploy zol-web --source web --region us-west1
#
# Vercel does not use this file. It exists so the same commit can run on Cloud
# Run, which is where the telephony side has to live (Vercel's serverless
# runtime will not hold a WebSocket open for the length of a phone call).
# =============================================================================

# ---- deps -------------------------------------------------------------------
FROM node:22-alpine AS deps
WORKDIR /app
# Copy only the manifests first so this layer caches until dependencies change.
COPY package.json package-lock.json ./
RUN npm ci

# ---- build ------------------------------------------------------------------
FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ---- run --------------------------------------------------------------------
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# Cloud Run routes to $PORT and requires binding on all interfaces.
ENV PORT=8080
ENV HOSTNAME=0.0.0.0

# Don't run the server as root.
RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 nextjs

# `output: "standalone"` emits a server plus only the modules it actually
# reaches; static assets and public/ are not included and must be copied.
COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=build --chown=nextjs:nodejs /app/public ./public

USER nextjs
EXPOSE 8080

# Cloud Run health checks hit this; see src/app/api/health/route.ts.
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8080/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]

# syntax=docker/dockerfile:1
FROM node:24.19.0-bookworm AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
# Optional session proxy CA for managed cloud builds. Ordinary builds need no secret.
RUN --mount=type=secret,id=proxy_ca \
    if [ -f /run/secrets/proxy_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/proxy_ca; fi; \
    npm ci --omit=dev --no-fund --no-audit

FROM node:24.19.0-bookworm-slim
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 DATA_DIR=/app/data
WORKDIR /app
COPY --from=dependencies --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package.json package-lock.json LICENSE THIRD_PARTY_NOTICES.md ./
COPY --chown=node:node src ./src
COPY --chown=node:node public ./public
COPY --chown=node:node fonts ./fonts
COPY --chown=node:node docs/third-party ./docs/third-party
COPY --chown=node:node scripts/healthcheck.js ./scripts/healthcheck.js
RUN mkdir -p /app/data && chown node:node /app/data
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s CMD ["node", "scripts/healthcheck.js"]
CMD ["node", "src/server.js"]

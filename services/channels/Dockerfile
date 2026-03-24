FROM node:22-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json* ./
COPY packages/db/package.json packages/db/
COPY packages/shared/package.json packages/shared/
COPY services/channels/package.json services/channels/

RUN npm ci --workspace=services/channels --include-workspace-root

COPY packages/ packages/
COPY services/channels/ services/channels/

USER node

CMD ["node", "services/channels/src/index.js"]

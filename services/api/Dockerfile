FROM node:22-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json* ./
COPY packages/db/package.json packages/db/
COPY packages/shared/package.json packages/shared/
COPY services/api/package.json services/api/

RUN npm ci --workspace=services/api --include-workspace-root

COPY packages/ packages/
COPY services/api/ services/api/

USER node

EXPOSE 3000

CMD ["node", "services/api/src/index.js"]

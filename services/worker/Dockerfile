FROM node:22-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install gws CLI globally for Google Workspace tools
RUN npm install -g @googleworkspace/cli

WORKDIR /app

# Copy workspace root and packages
COPY package.json package-lock.json* ./
COPY packages/db/package.json packages/db/
COPY packages/shared/package.json packages/shared/
COPY packages/core/package.json packages/core/
COPY services/worker/package.json services/worker/

RUN npm ci --workspace=services/worker --include-workspace-root

# Copy source
COPY packages/ packages/
COPY services/worker/ services/worker/

USER node

CMD ["node", "services/worker/src/index.js"]

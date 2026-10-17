# syntax=docker/dockerfile:1.7
# Build from the repository root:
#   docker build -f apps/server/Dockerfile -t storyquest-server .

FROM node:22-bookworm AS base
WORKDIR /app
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 HUSKY=0
RUN corepack enable
# Every workspace manifest is needed so the lockfile resolves, but only the
# server and its contracts are installed and copied in full.
COPY package.json yarn.lock .yarnrc.yml ./
COPY apps/server/package.json apps/server/
COPY apps/vega/package.json apps/vega/
COPY apps/expo-multi-tv/package.json apps/expo-multi-tv/
COPY packages/contracts/package.json packages/contracts/
COPY packages/shared-ui/package.json packages/shared-ui/

FROM base AS build
RUN yarn workspaces focus @storyquest/server
COPY packages/contracts packages/contracts
COPY apps/server apps/server
RUN yarn workspace @storyquest/server build

FROM base AS deps
RUN yarn workspaces focus --production @storyquest/server \
  && rm -rf apps/server/node_modules/@storyquest \
  && mkdir -p node_modules

FROM node:22-bookworm-slim AS runtime
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg fonts-dejavu-core \
  && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production \
    DATA_DIR=/data \
    PORT=8080 \
    HOST=0.0.0.0 \
    FONT_FILE=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf
WORKDIR /app/apps/server
COPY --from=deps /app/node_modules /app/node_modules
COPY --from=deps /app/apps/server/node_modules ./node_modules
COPY --from=build /app/apps/server/dist ./dist
COPY apps/server/package.json ./
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "dist/index.js"]

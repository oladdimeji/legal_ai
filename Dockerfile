# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS build

ARG VITE_GOOGLE_DRIVE_CLIENT_ID
ARG VITE_GOOGLE_DRIVE_API_KEY
ARG VITE_GOOGLE_DRIVE_APP_ID
ARG VITE_DROPBOX_APP_KEY

WORKDIR /app

COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci

COPY index.html metadata.json tsconfig.json vite.config.ts server.ts ./
COPY server ./server
COPY src ./src
COPY scripts ./scripts
RUN npm run build
RUN npm prune --omit=dev

FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production
ENV PORT=3004

WORKDIR /app

COPY package.json package-lock.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/scripts/start-production.mjs ./scripts/start-production.mjs

USER node

EXPOSE 3004

CMD ["npm", "start"]

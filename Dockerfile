FROM swr.cn-north-4.myhuaweicloud.com/ddn-k8s/docker.io/library/node:22-bookworm-slim AS builder

WORKDIR /app

ENV PORT=3001 \
    SERVE_STATIC=1 \
    STATIC_DIR=/app/dist

COPY package.json package-lock.json /app/
RUN npm ci --no-audit --no-fund

COPY . /app/

RUN npm run build

EXPOSE 3001

FROM swr.cn-north-4.myhuaweicloud.com/ddn-k8s/docker.io/library/node:22-bookworm-slim AS runner

WORKDIR /app

ENV PORT=3001 \
    SERVE_STATIC=1 \
    STATIC_DIR=/app/dist

COPY package.json package-lock.json /app/
RUN npm ci --omit=dev --no-audit --no-fund

COPY --from=builder /app/dist /app/dist
COPY --from=builder /app/server/dist /app/server/dist
COPY --from=builder /app/server/migrations /app/server/migrations

EXPOSE 3001

CMD ["node", "server/dist/server.js"]


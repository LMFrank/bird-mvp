FROM swr.cn-north-4.myhuaweicloud.com/ddn-k8s/docker.io/library/node:22-bookworm-slim

WORKDIR /app

ENV PORT=3001 \
    SERVE_STATIC=1 \
    STATIC_DIR=/app/dist

COPY package.json package-lock.json /app/
RUN npm ci --no-audit --no-fund

COPY . /app/

RUN npm run build

EXPOSE 3001

CMD ["node", "--import", "tsx", "server/server.ts"]


FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8080 DATA_DIR=/app/data

COPY package.json server.js index.html manifest.webmanifest service-worker.js health.json robots.txt ./
COPY README.md DEPLOYMENT.md SECURITY.md PRODUCTION_READINESS.md EMR_IMPLEMENTATION_PLAN.md ./
COPY scripts ./scripts

RUN addgroup -S emr && adduser -S emr -G emr && mkdir -p /app/data && chown -R emr:emr /app
USER emr

VOLUME ["/app/data"]
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/api/health >/dev/null || exit 1

CMD ["node", "server.js"]

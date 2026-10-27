# One-shot ops task: creates the databases and service roles on RDS (roles.sh), then seeds the demo accounts (seed.mjs).
# Build from the repository root: docker build -f deploy/aws/ops/Dockerfile .
FROM node:24.19.0-bookworm-slim@sha256:3638d9a6fe4030bd716be989438248074489337ba3275657f93595428be4fc03

RUN apt-get update \
  && apt-get install -y --no-install-recommends postgresql-client \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /ops
RUN npm install --omit=dev pg@8.23.0 && npm cache clean --force
COPY deploy/local/postgres/init/001-create-databases.sql deploy/local/postgres/roles.sh ./
COPY apps/identity-service/seed.mjs ./
USER node

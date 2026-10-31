# One-shot ops task: creates the databases and service roles on RDS (roles.sh), then runs the default seed (seed.mjs: the one admin) or, when asked, the demo accounts seed (seed-demo.mjs).
# Build from the repository root: docker build -f deploy/aws/ops/Dockerfile .
FROM node:24.19.0-alpine@sha256:d32cdf619f63fe0471182d08996dd516c6275bb5fd31ae06e55a570bd9e1ad43

RUN apk add --no-cache postgresql-client bash

WORKDIR /ops
RUN npm install --omit=dev pg@8.23.0 && npm cache clean --force
COPY deploy/local/postgres/init/001-create-databases.sql deploy/local/postgres/roles.sh ./
COPY apps/identity-service/seed.mjs apps/identity-service/seed-demo.mjs apps/identity-service/seed-support.mjs ./
USER node
ENTRYPOINT []

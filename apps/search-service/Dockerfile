FROM golang:1.26-alpine@sha256:27f2d3b83cfc5803c8078f8e730af0f7c431bf067afaec8f60a36fb763187cba AS build

WORKDIR /src
COPY apps/search-service/go.mod apps/search-service/go.sum ./
RUN --mount=type=cache,id=pharmacy-central-go-mod,target=/go/pkg/mod go mod download

COPY apps/search-service/ ./
RUN --mount=type=cache,id=pharmacy-central-go-mod,target=/go/pkg/mod \
    --mount=type=cache,id=pharmacy-central-go-build,target=/root/.cache/go-build \
    CGO_ENABLED=0 go build -trimpath -ldflags='-s -w' -o /out/search-service ./cmd/search-service

FROM alpine:3.22@sha256:d406446bc05b82480756ce8f1287964d28768c23955fa9480d2a74a2eae7a654 AS runtime
RUN apk add --no-cache ca-certificates
RUN adduser -S -D -H -h /nonexistent -s /sbin/nologin nonroot
COPY --from=build /out/search-service /search-service
USER nonroot
EXPOSE 3009
ENTRYPOINT ["/search-service"]

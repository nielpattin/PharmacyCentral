# syntax=docker/dockerfile:1

FROM node:24-bookworm-slim AS frontend-build
WORKDIR /src/src/Frontend
RUN corepack enable
COPY src/Frontend/package.json src/Frontend/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY src/Frontend/ ./
RUN pnpm run build

FROM mcr.microsoft.com/dotnet/sdk:10.0 AS api-build
WORKDIR /src
COPY Directory.Build.props ./
COPY PharmacyCentral.sln ./
COPY src/ ./src/
RUN dotnet restore src/Web.Api/Web.Api.csproj
COPY --from=frontend-build /src/src/Frontend/dist ./src/Web.Api/wwwroot
RUN dotnet publish src/Web.Api/Web.Api.csproj \
    --configuration Release \
    --no-restore \
    --output /app/publish

FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS runtime
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV ASPNETCORE_URLS=http://+:8080 \
    ASPNETCORE_ENVIRONMENT=Production
COPY --from=api-build /app/publish ./
EXPOSE 8080
ENTRYPOINT ["dotnet", "Web.Api.dll"]

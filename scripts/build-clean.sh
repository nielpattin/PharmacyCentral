#!/usr/bin/env bash
set -e

echo "==> Killing running Aspire AppHost and Web.Api processes..."
taskkill //F //IM "AppHost.exe" 2>/dev/null || true
taskkill //F //IM "Web.Api.exe" 2>/dev/null || true

# Wait for file handles to release
sleep 1

echo "==> Building..."
dotnet build --no-restore

echo "==> Done."

#!/usr/bin/env bash
#
# PharmacyCentral DB Reset
# Nukes the PostgreSQL container and volume used by Aspire AppHost.
# Next `aspire run` will create a fresh database.
#
# Usage:
#   ./scripts/reset-db.sh          # full reset
#   ./scripts/reset-db.sh --dry-run  # show what would be deleted

set -euo pipefail

CONTAINER_NAME="postgres-pharmacycentral"
VOLUME_NAME="apphost-d8211dd06d-postgres-data"
DRY_RUN=false

if [[ "${1:-}" == "--dry-run" ]]; then
    DRY_RUN=true
fi

echo "=== PharmacyCentral DB Reset ==="

# Find ALL containers using this volume and stop them
# Stop by volume reference (handles any container)
CONTAINERS=$(docker ps -aq --filter "volume=$VOLUME_NAME" 2>/dev/null || true)

# Also find by fixed name
NAMED=$(docker ps -aq --filter "name=$CONTAINER_NAME" 2>/dev/null || true)
if [[ -n "$NAMED" ]]; then
    CONTAINERS="$CONTAINERS $NAMED"
fi
CONTAINERS=$(echo "$CONTAINERS" | tr ' ' '\n' | sort -u | tr '\n' ' ')

if [[ -z "$CONTAINERS" ]]; then
    echo "No containers using volume '$VOLUME_NAME'."
else
    for c in $CONTAINERS; do
        NAME=$(docker inspect --format '{{.Name}}' "$c" 2>/dev/null | sed 's|^/||')
        echo "Stopping container: $NAME ($c)"
        if [[ "$DRY_RUN" == false ]]; then
            docker stop "$c" 2>/dev/null || true
            docker rm "$c" 2>/dev/null || true
        fi
    done
fi

# Remove volume
if docker volume ls --filter "name=$VOLUME_NAME" --format "{{.Name}}" 2>/dev/null | grep -q .; then
    echo "Removing volume: $VOLUME_NAME"
    if [[ "$DRY_RUN" == false ]]; then
        docker volume rm "$VOLUME_NAME"
    fi
else
    echo "Volume '$VOLUME_NAME' not found. Already clean."
fi

echo "=== Done. Run 'aspire run' in src/AppHost for fresh start. ==="

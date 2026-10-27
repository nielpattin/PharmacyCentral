#!/bin/sh
set -e

if [ -n "$API_BASE_URL" ]; then
  TARGET="${API_BASE_URL%/}"
  # API Gateway routes by Host and needs SNI, so send the host of API_BASE_URL (with its port, if it has one).
  API_HOST="${TARGET#*://}"
  API_HOST="${API_HOST%%/*}"
  cat << EOF > /etc/nginx/conf.d/default.conf
server {
    listen 8080;
    server_name localhost;

    root /usr/share/nginx/html;
    index index.html;

    location /api/ {
        client_max_body_size 25m;
        proxy_pass $TARGET/api/;
        proxy_http_version 1.1;
        proxy_ssl_server_name on;
        proxy_set_header Host $API_HOST;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    # Vite names these files by content hash, so they never change under the same URL.
    location /assets/ {
        add_header Cache-Control "public, max-age=31536000, immutable";
        try_files \$uri =404;
    }

    # index.html names the current hashed bundle, so a browser must revalidate it on every load.
    location / {
        add_header Cache-Control "no-cache";
        try_files \$uri \$uri/ /index.html;
    }
}
EOF
else
  cat << EOF > /etc/nginx/conf.d/default.conf
server {
    listen 8080;
    server_name localhost;

    root /usr/share/nginx/html;
    index index.html;

    location /api/ {
        default_type application/json;
        return 502 '{"title": "API_BASE_URL is not configured", "status": 502}';
    }

    # Vite names these files by content hash, so they never change under the same URL.
    location /assets/ {
        add_header Cache-Control "public, max-age=31536000, immutable";
        try_files \$uri =404;
    }

    # index.html names the current hashed bundle, so a browser must revalidate it on every load.
    location / {
        add_header Cache-Control "no-cache";
        try_files \$uri \$uri/ /index.html;
    }
}
EOF
fi

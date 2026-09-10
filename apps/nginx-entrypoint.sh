#!/bin/sh
set -e

if [ -n "$API_BASE_URL" ]; then
  TARGET="${API_BASE_URL%/}"
  cat << EOF > /etc/nginx/conf.d/default.conf
server {
    listen 8080;
    server_name localhost;

    root /usr/share/nginx/html;
    index index.html;

    location /api/ {
        proxy_pass $TARGET/api/;
        proxy_http_version 1.1;
        proxy_set_header Host \$proxy_host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    location / {
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

    location / {
        try_files \$uri \$uri/ /index.html;
    }
}
EOF
fi

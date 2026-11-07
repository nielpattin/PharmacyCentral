#!/bin/sh
set -e

# Response headers the browser enforces. nginx drops every inherited `add_header` in a location that has its own, so
# this block is expanded into each location instead of being set once on the server.
#   CSP: scripts only from this origin; the map (MapLibre) needs blob: workers and the Vietmap host; images may come
#   from any https origin because product photos are stored wherever the catalog points; inline styles are allowed
#   because the UI libraries set style attributes.
#   HSTS: sent only when the request reached the ALB over https (X-Forwarded-Proto), never over plain http.
#   Local Floci serves the photos over plain http (http://localhost:4566), which `https:` does not cover, so when
#   PUBLIC_MEDIA_URL is set its origin is allowed too. On AWS the variable is empty and S3 is https.
IMG_SRC="'self' data: blob: https:"
if [ -n "$PUBLIC_MEDIA_URL" ]; then
  MEDIA_ORIGIN=$(printf '%s' "$PUBLIC_MEDIA_URL" | sed -E 's|^([A-Za-z][A-Za-z0-9+.-]*://[^/]+).*|\1|')
  IMG_SRC="$IMG_SRC $MEDIA_ORIGIN"
fi
SECURITY_HEADERS="add_header Content-Security-Policy \"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src $IMG_SRC; font-src 'self' data:; connect-src 'self' https://*.vietmap.vn; worker-src 'self' blob:; child-src blob:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'\" always;
        add_header X-Content-Type-Options \"nosniff\" always;
        add_header X-Frame-Options \"DENY\" always;
        add_header Referrer-Policy \"strict-origin-when-cross-origin\" always;
        add_header Permissions-Policy \"camera=(self), geolocation=(self), microphone=()\" always;
        add_header Strict-Transport-Security \$hsts always;"

# Per client address. The ALB is the only peer, so the real address is the last untrusted entry of X-Forwarded-For
# (the one the ALB appended); the VPC range is the trusted proxy range. Only /api/ is limited, never the static files.
RATE_LIMIT_RPS="${API_RATE_LIMIT_RPS:-30}"
RATE_LIMIT_BURST="${API_RATE_LIMIT_BURST:-60}"

cat << EOF > /etc/nginx/conf.d/default.conf
map \$http_x_forwarded_proto \$hsts {
    https "max-age=31536000";
    default "";
}

limit_req_zone \$binary_remote_addr zone=api_per_client:10m rate=${RATE_LIMIT_RPS}r/s;

server {
    listen 8080;
    server_name localhost;
    server_tokens off;

    set_real_ip_from 10.20.0.0/16;
    real_ip_header X-Forwarded-For;
    real_ip_recursive on;

    root /usr/share/nginx/html;
    index index.html;

EOF

if [ -n "$API_BASE_URL" ]; then
  TARGET="${API_BASE_URL%/}"
  # API Gateway routes by Host and needs SNI, so send the host of API_BASE_URL (with its port, if it has one).
  API_HOST="${TARGET#*://}"
  API_HOST="${API_HOST%%/*}"
  cat << EOF >> /etc/nginx/conf.d/default.conf
    location /api/ {
        client_max_body_size 25m;
        limit_req zone=api_per_client burst=${RATE_LIMIT_BURST} nodelay;
        limit_req_status 429;
        error_page 429 = @rate_limited;
        $SECURITY_HEADERS
        proxy_pass $TARGET/api/;
        proxy_http_version 1.1;
        proxy_ssl_server_name on;
        proxy_set_header Host $API_HOST;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
EOF
else
  cat << EOF >> /etc/nginx/conf.d/default.conf
    location /api/ {
        default_type application/json;
        $SECURITY_HEADERS
        return 502 '{"title": "API_BASE_URL is not configured", "status": 502}';
    }
EOF
fi

cat << EOF >> /etc/nginx/conf.d/default.conf

    location @rate_limited {
        default_type application/json;
        $SECURITY_HEADERS
        add_header Retry-After "1" always;
        return 429 '{"title":"Too many requests","status":429,"code":"rate_limited","detail":"Bạn gửi yêu cầu quá nhanh. Vui lòng thử lại sau giây lát."}';
    }

    # Vite names these files by content hash, so they never change under the same URL.
    location /assets/ {
        add_header Cache-Control "public, max-age=31536000, immutable";
        $SECURITY_HEADERS
        try_files \$uri =404;
    }

    # index.html names the current hashed bundle, so a browser must revalidate it on every load.
    location / {
        add_header Cache-Control "no-cache";
        $SECURITY_HEADERS
        try_files \$uri \$uri/ /index.html;
    }
}
EOF

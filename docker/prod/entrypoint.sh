#!/bin/sh
set -e
# The healthcheck fails until the server listens, so a failed migration is never reported healthy.
php artisan migrate --force
# Not optimize: its view:cache fails, the app has no resources/views (git keeps no empty dir).
php artisan config:cache
php artisan route:cache
php artisan event:cache
exec frankenphp run --config /etc/frankenphp/Caddyfile

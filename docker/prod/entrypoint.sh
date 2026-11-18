#!/bin/sh
set -e
# The healthcheck fails until the server listens, so a failed migration is never reported healthy.
php artisan migrate --force
php artisan optimize
exec frankenphp run --config /etc/frankenphp/Caddyfile

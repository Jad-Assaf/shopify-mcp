#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

if [ ! -f .env ]; then
  echo "Missing .env. Create it first: cp .env.example .env" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1091
. ./.env
set +a

missing=()
for name in SHOPIFY_SHOP_DOMAIN SHOPIFY_ADMIN_ACCESS_TOKEN SHOPIFY_API_VERSION; do
  if [ -z "${!name:-}" ]; then
    missing+=("$name")
  fi
done

if [ "${#missing[@]}" -gt 0 ]; then
  echo "Missing required env vars: ${missing[*]}" >&2
  echo "Fill them in .env before starting local tunnel mode." >&2
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "Missing ./node_modules. Run: ./scripts/install-local-deps.sh" >&2
  exit 1
fi

export HOST="${HOST:-127.0.0.1}"
export PORT="${PORT:-8080}"
export MCP_LOCAL_NO_AUTH=true
export MCP_ALLOWED_ORIGINS="${MCP_ALLOWED_ORIGINS:-}"

if [ "$HOST" != "127.0.0.1" ] && [ "$HOST" != "localhost" ] && [ "$HOST" != "::1" ]; then
  echo "Refusing to run MCP_LOCAL_NO_AUTH on non-loopback HOST=$HOST" >&2
  exit 1
fi

if command -v lsof >/dev/null 2>&1 && lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Port $PORT is already in use. Stop that process or run with another local port:" >&2
  echo "  PORT=8082 ./scripts/run-local-tunnel.sh" >&2
  echo "Then initialize tunnel-client with --mcp-server-url http://localhost:8082/mcp" >&2
  exit 1
fi

echo "Starting Shopify MCP local tunnel mode at http://${HOST}:${PORT}/mcp"
echo "OAuth is disabled for this local process. Choose No Authentication in ChatGPT Tunnel connector settings."
echo "Keep this process running while tunnel-client is running."

npm start

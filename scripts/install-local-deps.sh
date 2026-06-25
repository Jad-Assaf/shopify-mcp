#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

if ! command -v node >/dev/null 2>&1; then
  echo "node is required. Install Node.js 20+ before running this script." >&2
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "npm is required. Install npm before running this script." >&2
  exit 1
fi

node_major="$(node -p "process.versions.node.split('.')[0]")"
if [ "$node_major" -lt 20 ]; then
  echo "Node.js 20+ is required. Current version: $(node --version)" >&2
  exit 1
fi

mkdir -p .local/bin .local/downloads

if [ -f package-lock.json ]; then
  npm ci
else
  npm install
fi

echo "Installed project-local dependencies in ./node_modules."
echo "Use ./.local/bin for local tunnel-client binaries; do not install them globally."

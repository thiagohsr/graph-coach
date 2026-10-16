#!/usr/bin/env bash
# Checks the local prerequisites (spec 008, T010). One line per check; exits 1 if any fails.
set -u
cd "$(dirname "$0")/.."

failed=0
ok()   { printf '  ok    %s\n' "$1"; }
bad()  { printf '  FAIL  %s\n' "$1"; failed=1; }
warn() { printf '  warn  %s\n' "$1"; }

major() { printf '%s' "$1" | sed -E 's/^v?([0-9]+).*/\1/'; }
minor() { printf '%s' "$1" | sed -E 's/^v?[0-9]+\.([0-9]+).*/\1/'; }

# Node 22.12 or later: the API (CommonJS) loads the ESM-only workspace packages through require(esm).
echo "Tools"
if command -v node >/dev/null 2>&1; then
  v=$(node -v); M=$(major "$v"); m=$(minor "$v")
  { [ "$M" -gt 22 ] || { [ "$M" -eq 22 ] && [ "$m" -ge 12 ]; }; } && ok "node $v" || bad "node $v is older than 22.12"
else bad "node is not installed (need 22.12 or later)"; fi

if command -v pnpm >/dev/null 2>&1; then
  v=$(pnpm -v); [ "$(major "$v")" -ge 9 ] && ok "pnpm $v" || bad "pnpm $v is older than 9"
else bad "pnpm is not installed (need 9 or later)"; fi

command -v docker >/dev/null 2>&1 && ok "docker $(docker --version | awk '{print $3}' | tr -d ,)" || bad "docker is not installed"
docker compose version >/dev/null 2>&1 && ok "docker compose $(docker compose version --short)" || bad "docker compose v2 is not available"
command -v make >/dev/null 2>&1 && ok "make" || bad "make is not installed"

echo "Ports"
project_ports=$(docker ps --filter label=com.docker.compose.project=graph-coach --format '{{.Ports}}' 2>/dev/null)
for port in 3000 3001 3002 5432 6379; do
  in_use=0
  if command -v ss >/dev/null 2>&1; then
    ss -ltn "sport = :$port" 2>/dev/null | grep -q LISTEN && in_use=1
  elif command -v lsof >/dev/null 2>&1; then
    lsof -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1 && in_use=1
  fi
  if [ "$in_use" -eq 0 ]; then ok "port $port is free"
  elif printf '%s' "$project_ports" | grep -q ":$port->"; then ok "port $port is held by this project's containers"
  else bad "port $port is in use by something else"; fi
done

echo "Environment"
if [ -f .env ]; then
  missing=$(comm -23 \
    <(grep -E '^[A-Z_][A-Z0-9_]*=' .env.example | cut -d= -f1 | sort -u) \
    <(grep -E '^[A-Z_][A-Z0-9_]*=' .env | cut -d= -f1 | sort -u))
  if [ -z "$missing" ]; then ok ".env has every key in .env.example"
  else for key in $missing; do bad ".env is missing $key"; done; fi
else
  warn ".env does not exist yet (make setup creates it from .env.example)"
fi

exit $failed

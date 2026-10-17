#!/bin/sh
# Container entrypoint of the API image (deployment.md section 3): migrate, set up the graph, start the API.
# Any failing step stops the script with a non-zero status, so the container is reported unhealthy and the
# deploy rolls back. Configuration comes from the container environment only.
set -eu

cd /app

echo "api-entrypoint: running migrations"
node dist/cli/main.js migrate

echo "api-entrypoint: setting up the graph"
node dist/cli/main.js setup-graph

echo "api-entrypoint: starting the API"
# exec: the API becomes PID 1 and receives the termination signal itself (it has shutdown hooks enabled).
exec node dist/main.js

# Graph Coach — developer commands (spec 008, contracts/workspace-scripts.md).
# Run `make` or `make help` for the list.

SHELL := /usr/bin/env bash
COMPOSE := docker compose --env-file .env -f infra/docker-compose.yml
DOTENV := pnpm exec dotenv -e .env --

.DEFAULT_GOAL := help
.PHONY: help doctor setup up down logs clean graph-shell graph-ui graph-stop graph-start \
	lint format format-check typecheck build migrate seed reset dev \
	test-unit test-agent test test-graph test-api test-e2e test-all \
	docs-check check-graph-removed

help: ## List the targets
	@grep -hE '^[a-zA-Z0-9_-]+:.*## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*## "}; {printf "  %-14s %s\n", $$1, $$2}'

# ─── Setup and local stores ─────────────────────────────────────────────────

doctor: ## Check tools, ports, and .env keys
	@infra/doctor.sh

setup: ## Check prerequisites, install dependencies, create .env if absent
	@infra/doctor.sh || true
	pnpm install
	@if [ ! -f .env ]; then cp .env.example .env && echo "Created .env from .env.example"; fi

.env:
	@echo "No .env yet: run 'make setup' first." && exit 1

up: .env ## Start FalkorDB and Postgres and wait until both are healthy
	$(COMPOSE) up -d --wait

down: .env ## Stop the stores (volumes are kept)
	$(COMPOSE) down

logs: .env ## Follow the stores' logs
	$(COMPOSE) logs -f

clean: .env ## Remove the stores and their data (asks first)
	@read -r -p "Delete the local graph and database volumes? Type yes: " answer; \
	if [ "$$answer" = "yes" ]; then $(COMPOSE) down -v; else echo "Cancelled."; fi

graph-shell: .env ## Open redis-cli inside the FalkorDB container
	$(COMPOSE) exec falkordb redis-cli

graph-ui: ## Print the FalkorDB browser address
	@echo "http://localhost:$${FALKORDB_UI_PORT:-3002}"

graph-stop: .env ## Stop only FalkorDB
	$(COMPOSE) stop falkordb

graph-start: .env ## Start only FalkorDB
	$(COMPOSE) up -d --wait falkordb

# ─── Code quality ───────────────────────────────────────────────────────────

lint: ## ESLint over the workspace
	pnpm run lint

format: ## Prettier, writing changes
	pnpm run format

format-check: ## Prettier, check only
	pnpm run format:check

typecheck: ## TypeScript in every package
	pnpm run typecheck

build: ## Build every package
	pnpm run build

# ─── Application (cli-and-config.md sections 1 and 3; workspace-scripts.md) ─
# reset runs the CLI without --yes: it asks the operator to type the graph name (exit 2 if refused, so the
# reminder is not printed). dev builds the packages once (ESM, shared by the API and web), then runs every
# package's `dev` script in parallel: tsup --watch in the packages, nest start --watch, vite dev.

migrate: .env ## Postgres migrations, then graph setup
	$(DOTENV) pnpm --filter @coach/api cli migrate
	$(DOTENV) pnpm --filter @coach/api cli setup-graph

seed: .env ## Load the synthetic seed content
	$(DOTENV) pnpm --filter @coach/api cli seed

reset: .env ## Empty the graph and accounts (the CLI asks first)
	$(DOTENV) pnpm --filter @coach/api cli reset
	@echo "Graph and accounts emptied: run make migrate seed"

dev: .env ## Build packages, then run the API and web in watch mode
	pnpm --filter "./packages/*" run build
	$(DOTENV) pnpm -r --parallel run dev

# ─── Tests (four layers) ────────────────────────────────────────────────────

test-unit: ## Layer 1: unit tests in every package except @coach/agents
	pnpm -r --filter '!@coach/agents' --if-present run test

test-agent: ## Layer 1: agent tests with stub providers
	pnpm --filter @coach/agents --if-present run test

test: test-unit test-agent ## Layer 1: unit, then agent

test-graph: .env ## Layer 2: named-query tests against FalkorDB
	$(COMPOSE) up -d --wait falkordb
	$(DOTENV) pnpm -r --if-present run test:graph

test-api: .env ## Layer 3: API tests against FalkorDB and Postgres
	$(COMPOSE) up -d --wait
	NODE_ENV=test LLM_PROVIDER=stub EMBEDDING_PROVIDER=stub AUTH_MODE=dev $(DOTENV) pnpm -r --if-present run test:api

# Own ports, so the smoke test never meets a running dev stack on 3000/3001. Override: make test-e2e E2E_WEB_PORT=...
E2E_WEB_PORT ?= 3100
E2E_API_PORT ?= 3101

test-e2e: ##Layer 4: the end-to-end smoke test
	@echo "Needs the stores up, migrated and seeded (make up migrate seed). The API and web start on E2E_API_PORT/E2E_WEB_PORT (default API_PORT/WEB_PORT)."
	pnpm exec playwright install chromium
	E2E_WEB_PORT=$(E2E_WEB_PORT) E2E_API_PORT=$(E2E_API_PORT) AUTH_MODE=dev LLM_PROVIDER=stub EMBEDDING_PROVIDER=stub $(DOTENV) pnpm exec playwright test -c apps/web/e2e/playwright.config.ts

test-all: lint typecheck test test-graph test-api test-e2e ## Everything, stopping at the first failure

# ─── Documentation checks (spec 008) ────────────────────────────────────────

docs-check: ## Every named query appears in the README or a graph-query test
	bash infra/check-docs.sh

check-graph-removed: .env ## Stop FalkorDB, probe the API, restart it (local only)
	bash infra/check-graph-removed.sh

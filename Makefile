# Graph Coach — developer commands (spec 008, contracts/workspace-scripts.md).
# Run `make` or `make help` for the list.

SHELL := /usr/bin/env bash
COMPOSE := docker compose --env-file .env -f infra/docker-compose.yml
DOTENV := pnpm exec dotenv -e .env --

.DEFAULT_GOAL := help
.PHONY: help doctor setup up down logs clean graph-shell graph-ui graph-stop graph-start \
	lint format format-check typecheck build migrate seed reset reset-onboarding dev \
	test-unit test-agent test test-graph test-api test-e2e test-all \
	docs-check check-graph-removed server-start server-stop server-status \
	tf-init tf-plan tf-apply tf-output tf-destroy secrets-put images deploy rollback smoke-live \
	seed-live demo-users backup-live restore-live logs-live live-cli

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

reset-onboarding: .env ## Show the onboarding carousel again (EMAIL=…, default Demo Learner)
	$(DOTENV) pnpm --filter @coach/api cli reset-onboarding $(or $(EMAIL),learner@example.test)

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

# ─── Live site on AWS (spec 008; runbook: docs/deploy.md) ───────────────────
# Every target passes AWS_PROFILE through (export it, or write AWS_PROFILE=<profile> make <target>).
# Terraform needs infra/terraform/backend.hcl and terraform.tfvars (copy the .example files; both are git-ignored).

TF := terraform -chdir=infra/terraform

tf-init: ## Terraform: connect to the remote state (infra/terraform/backend.hcl)
	$(TF) init -backend-config=backend.hcl

tf-plan: ## Terraform: show the changes, create nothing (writes tfplan)
	$(TF) plan -out=tfplan

tf-apply: ## Terraform: apply the last plan made by tf-plan
	$(TF) apply tfplan

tf-output: ## Terraform: print site_ip, ECR address, Cognito ids
	$(TF) output

tf-destroy: ## Terraform: remove ALL live infrastructure incl. data volume (asks first)
	@read -r -p "Destroy the live Graph Coach infrastructure, including the data volume? Type destroy: " answer; \
	if [ "$$answer" = "destroy" ]; then $(TF) destroy; else echo "Cancelled."; fi

secrets-put: ## Prompt for the live secrets and write /graph-coach/prod/* in Parameter Store (FORCE=1 to replace)
	infra/scripts/put-secrets.sh $(if $(FORCE),--force)

images: ## Build the arm64 images and push them to ECR
	infra/scripts/build-images.sh
	infra/scripts/push-images.sh

deploy: ## Build+push (unless SKIP_BUILD=1), deploy through SSM, then run the smoke check
	infra/scripts/deploy.sh $(if $(SKIP_BUILD),--skip-build)

rollback: ## Redeploy the previous image tag (TAG=… for a specific one)
	infra/scripts/rollback.sh $(TAG)

smoke-live: ## Smoke check of the live site (outside with curl, inside through SSM)
	infra/scripts/smoke.sh

seed-live: ## Load the synthetic seed into the live site (asks first)
	infra/scripts/seed-live.sh

demo-users: ## Create or reset the four demo accounts in Cognito
	infra/scripts/create-demo-users.sh

backup-live: ## Back up FalkorDB and Postgres to the backup bucket
	infra/scripts/backup.sh

restore-live: ## Restore the live data from a backup (BACKUP=<id>; asks first)
	@test -n "$(BACKUP)" || { echo 'Usage: make restore-live BACKUP=<id printed by backup-live>'; exit 1; }
	infra/scripts/restore.sh $(BACKUP)

server-start: ## Start the stopped live server and wait until the site answers (IP and data unchanged)
	infra/scripts/server-power.sh start

server-stop: ## Stop the live server to save money (site offline; disks and IP kept, about USD 5-6 a month)
	infra/scripts/server-power.sh stop

server-status: ## Show whether the live server is running and whether the site answers
	infra/scripts/server-power.sh status

logs-live: ## Last log lines of a live service: make logs-live SERVICE=api [LINES=100]
	infra/scripts/ssm-logs.sh $(or $(SERVICE),api) $(or $(LINES),100)

live-cli: ## Run one API cli command on the live site: make live-cli CMD="grant-role a@b.c reviewer"
	@test -n "$(CMD)" || { echo 'Usage: make live-cli CMD="grant-role someone@example.com reviewer"'; exit 1; }
	infra/scripts/live-cli.sh $(CMD)

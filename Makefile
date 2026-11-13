SHELL := /bin/bash
COMPOSE := docker compose

.PHONY: help env ip up up-all build down logs ps health clean

help: ## Show targets
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-10s\033[0m %s\n",$$1,$$2}'

env: ## Create/refresh .env (secrets + LAN IP)
	@./scripts/init-env.sh

ip: env ## Re-detect LAN IP and restart LiveKit (after a network change)
	@$(COMPOSE) up -d --force-recreate livekit

up: env ## Start the core stack
	@$(COMPOSE) up -d --build
	@$(MAKE) --no-print-directory ps

up-all: env ## Start core + every optional profile
	@$(COMPOSE) --profile '*' up -d --build

build: ## Rebuild images
	@$(COMPOSE) build

down: ## Stop everything (keeps data)
	@$(COMPOSE) --profile '*' down

logs: ## Tail logs (make logs s=agent)
	@$(COMPOSE) logs -f --tail=100 $(s)

ps: ## Show service status
	@$(COMPOSE) ps --format 'table {{.Service}}\t{{.State}}\t{{.Status}}'

health: ## Check API readiness (db, livekit, litellm)
	@curl -s localhost:4000/health | python3 -m json.tool

clean: ## Stop and DELETE all data volumes
	@$(COMPOSE) --profile '*' down -v

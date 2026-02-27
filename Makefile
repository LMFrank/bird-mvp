.PHONY: help up down build rebuild ps logs logs-app logs-ai restart restart-app restart-ai health ai-health app-sh ai-sh data-clean data-clean-all labels-cn labels-world

COMPOSE ?= docker compose
APP ?= app
AI ?= ai

help:
	@printf "%s\n" \
		"make up              docker compose up -d --build" \
		"make down            docker compose down" \
		"make build           docker compose build" \
		"make rebuild         docker compose build --no-cache" \
		"make ps              docker compose ps" \
		"make logs            docker compose logs -f --tail=200" \
		"make logs-app        docker compose logs -f --tail=200 app" \
		"make logs-ai         docker compose logs -f --tail=200 ai" \
		"make restart         restart app + ai" \
		"make restart-app     restart app only" \
		"make restart-ai      restart ai only" \
		"make health          curl backend health" \
		"make ai-health       curl backend -> ai health probe" \
		"make app-sh          exec into app container" \
		"make ai-sh           exec into ai container" \
		"make data-clean      remove data/cache (inside app container)" \
		"make data-clean-all  remove data/cache + data/models" \
		"make labels-cn       generate CN labels via eBird (inside app container)" \
		"make labels-world    generate world labels via eBird (inside app container)"

up:
	$(COMPOSE) up -d --build

down:
	$(COMPOSE) down

build:
	$(COMPOSE) build

rebuild:
	$(COMPOSE) build --no-cache

ps:
	$(COMPOSE) ps

logs:
	$(COMPOSE) logs -f --tail=200

logs-app:
	$(COMPOSE) logs -f --tail=200 $(APP)

logs-ai:
	$(COMPOSE) logs -f --tail=200 $(AI)

restart:
	$(COMPOSE) restart $(APP) $(AI)

restart-app:
	$(COMPOSE) restart $(APP)

restart-ai:
	$(COMPOSE) restart $(AI)

health:
	curl -fsS http://localhost:3001/api/health || true

ai-health:
	curl -fsS http://localhost:3001/api/ai/health || true

app-sh:
	$(COMPOSE) exec $(APP) sh

ai-sh:
	$(COMPOSE) exec $(AI) sh

data-clean:
	$(COMPOSE) exec -T $(APP) node scripts/clean_data.mjs --cache

data-clean-all:
	$(COMPOSE) exec -T $(APP) node scripts/clean_data.mjs --all

labels-cn:
	$(COMPOSE) exec -T $(APP) node scripts/ebird_labels.mjs --region CN --locale zh_CN --out data/models/labels.csv

labels-world:
	$(COMPOSE) exec -T $(APP) node scripts/ebird_labels.mjs --all --locale zh_CN --out data/models/labels.csv


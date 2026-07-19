DEPLOY_HOST ?= YOUR_DEPLOY_HOST
DEPLOY_USER ?= YOUR_DEPLOY_USER
DEPLOY_PATH ?= /opt/docker/fashion-monitor
DOCKER      ?= docker
PLATFORM     = linux/amd64

.PHONY: build push sync deploy typecheck

build:
	docker buildx build --ssh default --platform $(PLATFORM) -t fashion-monitor/cli -f Dockerfile . --load
	docker buildx build --ssh default --platform $(PLATFORM) -t fashion-monitor/mcp-server -f services/mcp-server/Dockerfile . --load

push: build
	@echo "Transferring images to deploy host..."
	docker save fashion-monitor/cli fashion-monitor/mcp-server \
		| ssh $(DEPLOY_USER)@$(DEPLOY_HOST) $(DOCKER) load

# Sync compose file, static config, and grafana provisioning to the deploy host.
# Does NOT sync .env or data/ (secrets stay local; data/ is deploy-host-owned).
# Run once before first deploy, then again if compose or grafana config changes.
sync:
	ssh $(DEPLOY_USER)@$(DEPLOY_HOST) "mkdir -p $(DEPLOY_PATH)/data $(DEPLOY_PATH)/grafana"
	tar czf - docker-compose.yml config.yaml grafana/ \
		| ssh $(DEPLOY_USER)@$(DEPLOY_HOST) "tar xzf - -C $(DEPLOY_PATH)/"
	@echo ""
	@echo "If this is first deploy, create $(DEPLOY_PATH)/data/.env on the deploy host with:"
	@echo "  TELEGRAM_BOT_TOKEN=..."
	@echo "  TELEGRAM_CHAT_ID=..."
	@echo "  ENCRYPTION_KEY=..."

deploy: sync push
	ssh $(DEPLOY_USER)@$(DEPLOY_HOST) "cd $(DEPLOY_PATH) && $(DOCKER) compose up -d"

typecheck:
	pnpm turbo run typecheck

NAS_HOST ?= YOUR_NAS_IP
NAS_USER ?= YOUR_NAS_USER
NAS_PATH ?= /volume1/docker/fashion-monitor
DOCKER   ?= /usr/local/bin/docker
PLATFORM  = linux/amd64

.PHONY: build push sync deploy typecheck

build:
	docker buildx build --platform $(PLATFORM) -t fashion-monitor/cli -f Dockerfile . --load
	docker buildx build --platform $(PLATFORM) -t fashion-monitor/mcp-server -f services/mcp-server/Dockerfile . --load

push: build
	@echo "Transferring images to NAS..."
	docker save fashion-monitor/cli fashion-monitor/mcp-server \
		| ssh $(NAS_USER)@$(NAS_HOST) $(DOCKER) load

# Sync compose file, static config, and grafana provisioning to NAS.
# Does NOT sync .env or data/ (secrets stay local; data/ is NAS-owned).
# Run once before first deploy, then again if compose or grafana config changes.
sync:
	ssh $(NAS_USER)@$(NAS_HOST) "mkdir -p $(NAS_PATH)/data $(NAS_PATH)/grafana"
	tar czf - docker-compose.yml Caddyfile config.yaml grafana/ \
		| ssh $(NAS_USER)@$(NAS_HOST) "tar xzf - -C $(NAS_PATH)/"
	@echo ""
	@echo "If this is first deploy, create $(NAS_PATH)/data/.env on the NAS with:"
	@echo "  NTFY_TOKEN=..."
	@echo "  SECRETS_KEY=..."

deploy: sync push
	ssh $(NAS_USER)@$(NAS_HOST) "cd $(NAS_PATH) && $(DOCKER) compose up -d"

typecheck:
	pnpm turbo run typecheck

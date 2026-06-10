NAS_HOST ?= YOUR_NAS_IP
NAS_USER ?= YOUR_NAS_USER
NAS_PATH ?= /volume1/docker/fashion-monitor
DOCKER   ?= /usr/local/bin/docker
PLATFORM  = linux/amd64

.PHONY: build push deploy typecheck

build:
	docker buildx build --platform $(PLATFORM) -t fashion-monitor/cli -f Dockerfile . --load
	docker buildx build --platform $(PLATFORM) -t fashion-monitor/mcp-server -f services/mcp-server/Dockerfile . --load

push: build
	@echo "Transferring images to NAS..."
	docker save fashion-monitor/cli fashion-monitor/mcp-server \
		| ssh $(NAS_USER)@$(NAS_HOST) $(DOCKER) load

deploy: push
	ssh $(NAS_USER)@$(NAS_HOST) "cd $(NAS_PATH) && $(DOCKER) compose up -d"

typecheck:
	pnpm turbo run typecheck

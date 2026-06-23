# ═══════════════════════════════════════════════════════════
# Hermes Squad — Makefile
# ═══════════════════════════════════════════════════════════

.DEFAULT_GOAL := help

# ─── Variables ────────────────────────────────────────────
NAME        := hermes-squad
VERSION     := $(shell cat package.json | grep '"version"' | head -1 | awk -F'"' '{print $$4}')
GIT_HASH    := $(shell git rev-parse --short HEAD 2>/dev/null || echo "unknown")
BUILD_TIME  := $(shell date -u +"%Y-%m-%dT%H:%M:%SZ")
GOFLAGS     := -ldflags "-X main.version=$(VERSION) -X main.commit=$(GIT_HASH) -X main.buildTime=$(BUILD_TIME)"

# Directories
SRC_DIR     := src
DIST_DIR    := dist
BIN_DIR     := bin
DOCS_DIR    := docs
TEST_DIR    := tests

# Tools
PNPM        := pnpm
TSC         := $(PNPM) tsc
ESLINT      := $(PNPM) eslint
VITEST      := $(PNPM) vitest
GO          := go

# Platform detection
UNAME_S     := $(shell uname -s)
UNAME_M     := $(shell uname -m)

ifeq ($(UNAME_S),Darwin)
	PLATFORM := darwin
else ifeq ($(UNAME_S),Linux)
	PLATFORM := linux
else
	PLATFORM := windows
endif

ifeq ($(UNAME_M),arm64)
	ARCH := arm64
else ifeq ($(UNAME_M),aarch64)
	ARCH := arm64
else
	ARCH := amd64
endif

# ─── Build ────────────────────────────────────────────────

.PHONY: build
build: build-ts build-go ## Build all components
	@echo "✅ Build complete ($(VERSION)-$(GIT_HASH))"

.PHONY: build-ts
build-ts: node_modules ## Build TypeScript
	@echo "📦 Building TypeScript..."
	@$(TSC) --build tsconfig.build.json
	@echo "   Done."

.PHONY: build-go
build-go: ## Build Go session manager
	@echo "📦 Building Go session manager..."
	@mkdir -p $(BIN_DIR)
	@$(GO) build $(GOFLAGS) -o $(BIN_DIR)/hermes-session ./cmd/session
	@echo "   Done."

# ─── Development ──────────────────────────────────────────

.PHONY: dev
dev: node_modules ## Start in development mode (watch)
	@echo "🔄 Starting development mode..."
	@$(PNPM) run dev

.PHONY: dev-setup
dev-setup: ## Initial development environment setup
	@echo "🔧 Setting up development environment..."
	@command -v pnpm >/dev/null 2>&1 || { echo "❌ pnpm required. Install: npm i -g pnpm"; exit 1; }
	@command -v go >/dev/null 2>&1 || { echo "❌ Go required. Install: https://go.dev/dl/"; exit 1; }
	@command -v tmux >/dev/null 2>&1 || { echo "❌ tmux required. Install: brew install tmux"; exit 1; }
	@$(PNPM) install
	@$(GO) mod download
	@cp -n .env.example .env 2>/dev/null || true
	@echo "✅ Development environment ready!"
	@echo "   Run 'make dev' to start."

.PHONY: dev-tui
dev-tui: node_modules ## Start TUI in development mode
	@$(PNPM) run dev:tui

# ─── Testing ─────────────────────────────────────────────

.PHONY: test
test: test-unit test-go ## Run all tests
	@echo "✅ All tests passed"

.PHONY: test-unit
test-unit: node_modules ## Run unit tests
	@echo "🧪 Running unit tests..."
	@$(VITEST) run

.PHONY: test-integration
test-integration: node_modules ## Run integration tests
	@echo "🧪 Running integration tests..."
	@$(VITEST) run --project integration

.PHONY: test-e2e
test-e2e: build ## Run end-to-end tests
	@echo "🧪 Running E2E tests..."
	@$(VITEST) run --project e2e

.PHONY: test-go
test-go: ## Run Go tests
	@echo "🧪 Running Go tests..."
	@$(GO) test ./... -v -race

.PHONY: test-watch
test-watch: node_modules ## Run tests in watch mode
	@$(VITEST) watch

.PHONY: test-coverage
test-coverage: node_modules ## Run tests with coverage report
	@echo "📊 Running tests with coverage..."
	@$(VITEST) run --coverage
	@echo "   Report: coverage/index.html"

# ─── Linting & Formatting ────────────────────────────────

.PHONY: lint
lint: lint-ts lint-go ## Run all linters
	@echo "✅ Linting passed"

.PHONY: lint-ts
lint-ts: node_modules ## Lint TypeScript
	@echo "🔍 Linting TypeScript..."
	@$(ESLINT) "$(SRC_DIR)/**/*.ts" "$(TEST_DIR)/**/*.ts"

.PHONY: lint-go
lint-go: ## Lint Go code
	@echo "🔍 Linting Go..."
	@golangci-lint run ./...

.PHONY: lint-fix
lint-fix: node_modules ## Auto-fix lint issues
	@echo "🔧 Fixing lint issues..."
	@$(ESLINT) "$(SRC_DIR)/**/*.ts" --fix
	@$(PNPM) prettier --write "$(SRC_DIR)/**/*.ts"

.PHONY: typecheck
typecheck: node_modules ## Run TypeScript type checking
	@echo "🔍 Type checking..."
	@$(TSC) --noEmit

.PHONY: format
format: node_modules ## Format all files
	@$(PNPM) prettier --write .

# ─── Packaging ────────────────────────────────────────────

.PHONY: package
package: build ## Package for distribution
	@echo "📦 Packaging for $(PLATFORM)/$(ARCH)..."
	@mkdir -p $(DIST_DIR)
	@tar -czf $(DIST_DIR)/$(NAME)-$(VERSION)-$(PLATFORM)-$(ARCH).tar.gz \
		-C $(BIN_DIR) hermes-session \
		-C ../$(DIST_DIR) . \
		LICENSE README.md
	@echo "   Created: $(DIST_DIR)/$(NAME)-$(VERSION)-$(PLATFORM)-$(ARCH).tar.gz"

.PHONY: package-all
package-all: build ## Package for all platforms
	@echo "📦 Packaging for all platforms..."
	@GOOS=darwin GOARCH=arm64 $(GO) build $(GOFLAGS) -o $(BIN_DIR)/hermes-session-darwin-arm64 ./cmd/session
	@GOOS=darwin GOARCH=amd64 $(GO) build $(GOFLAGS) -o $(BIN_DIR)/hermes-session-darwin-amd64 ./cmd/session
	@GOOS=linux GOARCH=amd64 $(GO) build $(GOFLAGS) -o $(BIN_DIR)/hermes-session-linux-amd64 ./cmd/session
	@GOOS=linux GOARCH=arm64 $(GO) build $(GOFLAGS) -o $(BIN_DIR)/hermes-session-linux-arm64 ./cmd/session
	@echo "✅ All platforms packaged"

# ─── Installation ─────────────────────────────────────────

.PHONY: install
install: build ## Install hermes-squad locally
	@echo "📥 Installing hermes-squad..."
	@mkdir -p $(HOME)/.local/bin
	@cp $(BIN_DIR)/hermes-session $(HOME)/.local/bin/
	@$(PNPM) link --global
	@echo "✅ Installed! Make sure ~/.local/bin is in your PATH"

.PHONY: uninstall
uninstall: ## Uninstall hermes-squad
	@echo "🗑️  Uninstalling hermes-squad..."
	@rm -f $(HOME)/.local/bin/hermes-session
	@$(PNPM) unlink --global
	@echo "✅ Uninstalled"

# ─── Clean ────────────────────────────────────────────────

.PHONY: clean
clean: ## Remove build artifacts
	@echo "🧹 Cleaning..."
	@rm -rf $(DIST_DIR) $(BIN_DIR) coverage .turbo .vitest
	@rm -rf $(SRC_DIR)/**/*.js $(SRC_DIR)/**/*.js.map $(SRC_DIR)/**/*.d.ts
	@echo "   Done."

.PHONY: clean-all
clean-all: clean ## Remove everything including node_modules
	@rm -rf node_modules
	@echo "   Removed node_modules"

# ─── CI ───────────────────────────────────────────────────

.PHONY: ci
ci: lint typecheck test build ## Full CI pipeline
	@echo ""
	@echo "═══════════════════════════════════════"
	@echo "  ✅ CI passed — ready to ship!"
	@echo "═══════════════════════════════════════"

# ─── Documentation ────────────────────────────────────────

.PHONY: docs
docs: ## Build documentation site
	@echo "📚 Building docs..."
	@$(PNPM) run docs:build

.PHONY: docs-dev
docs-dev: ## Serve docs in development mode
	@$(PNPM) run docs:dev

# ─── Utilities ────────────────────────────────────────────

.PHONY: version
version: ## Show current version
	@echo "$(NAME) v$(VERSION) ($(GIT_HASH))"

.PHONY: deps
deps: ## Show dependency tree
	@$(PNPM) list --depth 2

.PHONY: outdated
outdated: ## Check for outdated dependencies
	@$(PNPM) outdated

.PHONY: update-deps
update-deps: ## Update dependencies
	@$(PNPM) update --interactive

# ─── Node modules (internal) ─────────────────────────────

node_modules: package.json pnpm-lock.yaml
	@$(PNPM) install --frozen-lockfile
	@touch node_modules

# ─── Help ─────────────────────────────────────────────────

.PHONY: help
help: ## Show this help message
	@echo ""
	@echo "  $(NAME) v$(VERSION)"
	@echo "  ─────────────────────────────────────"
	@echo ""
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2}'
	@echo ""

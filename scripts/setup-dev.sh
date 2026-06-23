#!/usr/bin/env bash
# =============================================================================
# Hermes Squad — Developer Environment Setup
# =============================================================================
# Sets up everything needed for contributing to Hermes Squad.
# Run this after cloning the repository:
#
#   git clone https://github.com/hermes-squad/hermes-squad.git
#   cd hermes-squad
#   ./scripts/setup-dev.sh
#
# What this script does:
# 1. Verifies system prerequisites (Node.js, git, etc.)
# 2. Installs npm dependencies
# 3. Sets up git hooks (husky for pre-commit linting)
# 4. Builds the TypeScript project
# 5. Sets up test infrastructure
# 6. Creates local development configuration
# 7. Runs verification tests
# =============================================================================

set -euo pipefail

# --- Colors ---
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m'

# --- State ---
ERRORS=()
WARNINGS=()
START_TIME=$(date +%s)

# --- Helpers ---

step() {
    echo ""
    echo -e "${BOLD}${BLUE}▸ $1${NC}"
}

info() {
    echo -e "  ${DIM}$1${NC}"
}

success() {
    echo -e "  ${GREEN}✓${NC} $1"
}

warn() {
    echo -e "  ${YELLOW}⚠${NC} $1"
    WARNINGS+=("$1")
}

fail() {
    echo -e "  ${RED}✗${NC} $1"
    ERRORS+=("$1")
}

# --- Prerequisites Check ---

check_prerequisites() {
    step "Checking prerequisites"

    # Node.js 18+
    if command -v node &>/dev/null; then
        local node_ver
        node_ver=$(node --version | sed 's/v//')
        local major
        major=$(echo "$node_ver" | cut -d. -f1)
        if [ "$major" -ge 18 ]; then
            success "Node.js v$node_ver"
        else
            fail "Node.js 18+ required (found v$node_ver)"
        fi
    else
        fail "Node.js not found. Install from https://nodejs.org"
    fi

    # npm
    if command -v npm &>/dev/null; then
        success "npm $(npm --version)"
    else
        fail "npm not found"
    fi

    # git
    if command -v git &>/dev/null; then
        success "git $(git --version | awk '{print $3}')"
    else
        fail "git not found"
    fi

    # Check if we're in the project root
    if [ ! -f "package.json" ]; then
        fail "Not in project root (package.json not found)"
        echo -e "  ${DIM}Run this script from the hermes-squad repository root${NC}"
        exit 1
    fi

    # Optional: Rust (for native module compilation)
    if command -v rustc &>/dev/null; then
        success "Rust $(rustc --version | awk '{print $2}') (optional — for native builds)"
    else
        info "Rust not found (optional — needed only for native module development)"
    fi

    # Optional: Python (for aider integration tests)
    if command -v python3 &>/dev/null; then
        success "Python $(python3 --version | awk '{print $2}') (optional — for aider tests)"
    else
        info "Python3 not found (optional — needed for aider integration tests)"
    fi

    # Optional: Docker (for container tests)
    if command -v docker &>/dev/null; then
        success "Docker $(docker --version | awk '{print $3}' | tr -d ',') (optional)"
    else
        info "Docker not found (optional — for container-based tests)"
    fi

    # Fail if any required dependencies are missing
    if [ ${#ERRORS[@]} -gt 0 ]; then
        echo ""
        echo -e "${RED}${BOLD}Cannot continue — missing required dependencies:${NC}"
        for err in "${ERRORS[@]}"; do
            echo -e "  ${RED}• $err${NC}"
        done
        exit 1
    fi
}

# --- Install Dependencies ---

install_dependencies() {
    step "Installing npm dependencies"

    # Clean install to ensure reproducible builds
    info "Running npm ci (clean install from lock file)..."
    npm ci 2>&1 | tail -3

    # Verify installation
    local pkg_count
    pkg_count=$(ls node_modules | wc -l | tr -d ' ')
    success "Installed $pkg_count packages"

    # Rebuild native modules for current platform
    info "Rebuilding native modules..."
    npm rebuild 2>&1 | grep -E "(node-pty|better-sqlite3|keytar)" || true
    success "Native modules rebuilt"
}

# --- Git Hooks ---

setup_git_hooks() {
    step "Setting up git hooks (husky)"

    # Initialize husky
    npx husky install 2>/dev/null || npx husky 2>/dev/null || true

    # Create pre-commit hook (lint staged files)
    local hook_dir=".husky"
    mkdir -p "$hook_dir"

    cat > "$hook_dir/pre-commit" << 'EOF'
#!/usr/bin/env sh
. "$(dirname -- "$0")/_/husky.sh"

# Run lint-staged to check only changed files
npx lint-staged
EOF
    chmod +x "$hook_dir/pre-commit"

    # Create commit-msg hook (conventional commits)
    cat > "$hook_dir/commit-msg" << 'EOF'
#!/usr/bin/env sh
. "$(dirname -- "$0")/_/husky.sh"

# Enforce conventional commit messages
npx --no -- commitlint --edit ${1}
EOF
    chmod +x "$hook_dir/commit-msg"

    # Create pre-push hook (run tests)
    cat > "$hook_dir/pre-push" << 'EOF'
#!/usr/bin/env sh
. "$(dirname -- "$0")/_/husky.sh"

# Run type check and unit tests before pushing
npm run typecheck
npm run test:unit -- --bail
EOF
    chmod +x "$hook_dir/pre-push"

    success "Git hooks configured (pre-commit, commit-msg, pre-push)"
}

# --- Build Project ---

build_project() {
    step "Building TypeScript project"

    # Run the TypeScript compiler
    info "Compiling TypeScript..."
    npm run build 2>&1 | tail -5

    success "Build complete (output in dist/)"

    # Also build the TUI for quick testing
    info "Building TUI..."
    npm run build:tui 2>&1 | tail -3
    success "TUI build complete"
}

# --- Test Infrastructure ---

setup_tests() {
    step "Setting up test infrastructure"

    # Create test mock directories if they don't exist
    mkdir -p tests/__mocks__
    mkdir -p tests/setup
    mkdir -p tests/fixtures

    # Create global test setup if it doesn't exist
    if [ ! -f "tests/setup/env-setup.ts" ]; then
        cat > "tests/setup/env-setup.ts" << 'EOF'
/**
 * Test environment setup — runs before each test file
 */

// Set test environment variables
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'error'; // Suppress logs during tests
process.env.HERMES_DATA_DIR = '/tmp/hermes-test-data';
process.env.HERMES_MODE = 'test';

// Increase timeout for CI environments
if (process.env.CI) {
  jest.setTimeout(30_000);
}
EOF
        success "Created test env setup"
    fi

    # Create global setup/teardown if they don't exist
    if [ ! -f "tests/setup/global-setup.ts" ]; then
        cat > "tests/setup/global-setup.ts" << 'EOF'
/**
 * Global test setup — runs once before all test suites
 */
export default async function globalSetup(): Promise<void> {
  // Set up test database, temp directories, etc.
  console.log('\n🧪 Test suite starting...\n');
}
EOF
        success "Created global test setup"
    fi

    if [ ! -f "tests/setup/global-teardown.ts" ]; then
        cat > "tests/setup/global-teardown.ts" << 'EOF'
/**
 * Global test teardown — runs once after all test suites
 */
export default async function globalTeardown(): Promise<void> {
  // Clean up test database, temp files, etc.
  console.log('\n🧹 Test suite cleanup complete.\n');
}
EOF
        success "Created global test teardown"
    fi

    # Run a quick test to verify setup
    info "Running verification test..."
    if npm run test:unit -- --bail --silent 2>/dev/null; then
        success "Tests pass ✓"
    else
        warn "Some tests failed (this may be expected on first setup)"
    fi
}

# --- Local Configuration ---

setup_local_config() {
    step "Setting up local development configuration"

    # Create .env for local development
    if [ ! -f ".env" ]; then
        cp .env.example .env
        success "Created .env from .env.example"
        warn "Remember to add your API keys to .env"
    else
        info ".env already exists — skipping"
    fi

    # Create VS Code settings for the project
    mkdir -p .vscode
    if [ ! -f ".vscode/settings.json" ]; then
        cat > ".vscode/settings.json" << 'EOF'
{
  // TypeScript
  "typescript.tsdk": "node_modules/typescript/lib",
  "typescript.enablePromptUseWorkspaceTsdk": true,
  
  // ESLint
  "eslint.validate": ["typescript"],
  "editor.codeActionsOnSave": {
    "source.fixAll.eslint": "explicit"
  },
  
  // Prettier
  "editor.defaultFormatter": "esbenp.prettier-vscode",
  "editor.formatOnSave": true,
  
  // File associations
  "files.associations": {
    "*.json": "jsonc"
  },
  
  // Search exclusions
  "search.exclude": {
    "dist/": true,
    "coverage/": true,
    "node_modules/": true
  },

  // Jest
  "jest.jestCommandLine": "npx jest",
  "jest.autoRun": "off"
}
EOF
        success "Created VS Code settings"
    fi

    # Create VS Code launch configuration for debugging
    if [ ! -f ".vscode/launch.json" ]; then
        cat > ".vscode/launch.json" << 'EOF'
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Debug TUI",
      "type": "node",
      "request": "launch",
      "runtimeArgs": ["-r", "ts-node/register"],
      "args": ["src/tui/index.ts"],
      "env": { "NODE_ENV": "development" },
      "console": "integratedTerminal"
    },
    {
      "name": "Debug Electron Main",
      "type": "node",
      "request": "launch",
      "runtimeExecutable": "${workspaceFolder}/node_modules/.bin/electron",
      "args": ["dist/compiled/electron/main.js"],
      "env": { "NODE_ENV": "development" }
    },
    {
      "name": "Debug Tests",
      "type": "node",
      "request": "launch",
      "runtimeArgs": ["--inspect-brk", "node_modules/.bin/jest", "--runInBand"],
      "console": "integratedTerminal"
    }
  ]
}
EOF
        success "Created VS Code launch configs"
    fi
}

# --- Summary ---

print_summary() {
    local end_time
    end_time=$(date +%s)
    local duration=$((end_time - START_TIME))

    echo ""
    echo -e "${GREEN}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${GREEN}${BOLD}  ✓ Developer environment ready! (${duration}s)${NC}"
    echo -e "${GREEN}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

    if [ ${#WARNINGS[@]} -gt 0 ]; then
        echo ""
        echo -e "  ${YELLOW}Warnings:${NC}"
        for w in "${WARNINGS[@]}"; do
            echo -e "    ${YELLOW}•${NC} $w"
        done
    fi

    echo ""
    echo -e "  ${BOLD}Quick commands:${NC}"
    echo -e "    ${CYAN}npm run dev${NC}         Start development (watch mode)"
    echo -e "    ${CYAN}npm run dev:tui${NC}     Start TUI in development mode"
    echo -e "    ${CYAN}npm run test${NC}        Run all tests"
    echo -e "    ${CYAN}npm run test:watch${NC}  Run tests in watch mode"
    echo -e "    ${CYAN}npm run lint${NC}        Run linter"
    echo -e "    ${CYAN}npm run build${NC}       Build for production"
    echo ""
    echo -e "  ${BOLD}Project structure:${NC}"
    echo -e "    ${DIM}src/core/         Core session management${NC}"
    echo -e "    ${DIM}src/acp/          Agent Communication Protocol${NC}"
    echo -e "    ${DIM}src/mcp/          Model Context Protocol server${NC}"
    echo -e "    ${DIM}src/skills/       Extensible skills system${NC}"
    echo -e "    ${DIM}src/electron/     Electron GUI${NC}"
    echo -e "    ${DIM}src/tui/          Terminal UI (Ink/React)${NC}"
    echo -e "    ${DIM}tests/            Test suites${NC}"
    echo ""
    echo -e "  ${BOLD}Next steps:${NC}"
    echo -e "    1. Add your API keys to ${CYAN}.env${NC}"
    echo -e "    2. Run ${CYAN}npm run dev:tui${NC} to start developing"
    echo -e "    3. See ${CYAN}CONTRIBUTING.md${NC} for guidelines"
    echo ""
}

# --- Main ---

main() {
    echo ""
    echo -e "${BOLD}${CYAN}Hermes Squad — Developer Setup${NC}"
    echo -e "${DIM}Setting up your development environment...${NC}"

    check_prerequisites
    install_dependencies
    setup_git_hooks
    build_project
    setup_tests
    setup_local_config
    print_summary
}

main "$@"

#!/usr/bin/env bash
# =============================================================================
# Hermes Squad — Linux/macOS Install Script
# =============================================================================
# One-liner installation:
#   curl -fsSL https://raw.githubusercontent.com/hermes-squad/hermes-squad/main/scripts/install.sh | bash
#
# Or with options:
#   curl -fsSL ... | bash -s -- --version v0.1.0 --dir ~/.local/bin
#
# What this script does:
# 1. Detects your OS and architecture
# 2. Checks for required dependencies (Node.js, git)
# 3. Downloads the appropriate binary/package
# 4. Installs to ~/.local/bin (or specified directory)
# 5. Adds to PATH if needed
# 6. Runs initial setup
#
# Inspired by Hermes Agent's install script and Rust's rustup.
# =============================================================================

set -euo pipefail

# --- Configuration ---
REPO="hermes-squad/hermes-squad"
INSTALL_DIR="${HERMES_INSTALL_DIR:-$HOME/.local/bin}"
DATA_DIR="${HERMES_DATA_DIR:-$HOME/.hermes-squad}"
VERSION=""  # Empty = latest
FORCE=false
VERBOSE=false

# --- Colors & Formatting ---
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m' # No Color

# --- Helper Functions ---

info() {
    echo -e "${BLUE}ℹ${NC} $*"
}

success() {
    echo -e "${GREEN}✓${NC} $*"
}

warn() {
    echo -e "${YELLOW}⚠${NC} $*"
}

error() {
    echo -e "${RED}✗${NC} $*" >&2
}

fatal() {
    error "$@"
    exit 1
}

verbose() {
    if [ "$VERBOSE" = true ]; then
        echo -e "${CYAN}  → $*${NC}"
    fi
}

# Print the banner
banner() {
    echo -e "${BOLD}${CYAN}"
    echo "  ╦ ╦┌─┐┬─┐┌┬┐┌─┐┌─┐  ╔═╗┌─┐ ┬ ┬┌─┐┌┬┐"
    echo "  ╠═╣├┤ ├┬┘│││├┤ └─┐  ╚═╗│─┼┐│ │├─┤ ││"
    echo "  ╩ ╩└─┘┴└─┴ ┴└─┘└─┘  ╚═╝└─┘└└─┘┴ ┴─┴┘"
    echo -e "${NC}"
    echo -e "  ${BOLD}Multi-Agent Coding Session Orchestrator${NC}"
    echo ""
}

# --- Argument Parsing ---
parse_args() {
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --version|-v)
                VERSION="$2"
                shift 2
                ;;
            --dir|-d)
                INSTALL_DIR="$2"
                shift 2
                ;;
            --force|-f)
                FORCE=true
                shift
                ;;
            --verbose)
                VERBOSE=true
                shift
                ;;
            --help|-h)
                usage
                exit 0
                ;;
            *)
                fatal "Unknown option: $1\nRun with --help for usage."
                ;;
        esac
    done
}

usage() {
    echo "Usage: install.sh [OPTIONS]"
    echo ""
    echo "Options:"
    echo "  --version, -v VERSION   Install specific version (e.g., v0.1.0)"
    echo "  --dir, -d DIRECTORY     Install to this directory (default: ~/.local/bin)"
    echo "  --force, -f             Overwrite existing installation"
    echo "  --verbose               Show detailed output"
    echo "  --help, -h              Show this help message"
}

# --- System Detection ---

detect_os() {
    local os
    os="$(uname -s)"
    case "$os" in
        Linux)  echo "linux" ;;
        Darwin) echo "darwin" ;;
        *)      fatal "Unsupported operating system: $os" ;;
    esac
}

detect_arch() {
    local arch
    arch="$(uname -m)"
    case "$arch" in
        x86_64|amd64)  echo "x64" ;;
        aarch64|arm64) echo "arm64" ;;
        armv7l)        echo "armv7" ;;
        *)             fatal "Unsupported architecture: $arch" ;;
    esac
}

detect_package_manager() {
    if command -v brew &>/dev/null; then
        echo "brew"
    elif command -v apt-get &>/dev/null; then
        echo "apt"
    elif command -v dnf &>/dev/null; then
        echo "dnf"
    elif command -v pacman &>/dev/null; then
        echo "pacman"
    else
        echo "none"
    fi
}

# --- Dependency Checks ---

check_dependencies() {
    info "Checking dependencies..."

    # Required: git
    if ! command -v git &>/dev/null; then
        fatal "git is required but not installed.\n  Install it with your package manager (e.g., brew install git)"
    fi
    verbose "git: $(git --version)"

    # Required: Node.js 18+
    if ! command -v node &>/dev/null; then
        warn "Node.js not found. Installing..."
        install_nodejs
    else
        local node_version
        node_version=$(node --version | sed 's/v//' | cut -d. -f1)
        if [ "$node_version" -lt 18 ]; then
            fatal "Node.js 18+ required, but found v$(node --version).\n  Update with: nvm install 20"
        fi
        verbose "Node.js: $(node --version)"
    fi

    # Optional: npm (should come with Node)
    if ! command -v npm &>/dev/null; then
        fatal "npm not found. It should come with Node.js.\n  Try reinstalling Node.js."
    fi
    verbose "npm: $(npm --version)"

    # Optional: Check for AI CLI tools
    echo ""
    info "Checking for AI coding agents..."
    check_optional_tool "claude" "Claude Code" "npm install -g @anthropic-ai/claude-code"
    check_optional_tool "kiro" "Kiro" "See https://kiro.dev"
    check_optional_tool "codex" "OpenAI Codex CLI" "npm install -g @openai/codex"
    check_optional_tool "gemini" "Google Gemini CLI" "npm install -g @anthropic-ai/gemini-cli"
    check_optional_tool "aider" "Aider" "pip install aider-chat"

    success "Dependency check complete"
}

check_optional_tool() {
    local cmd="$1" name="$2" install_hint="$3"
    if command -v "$cmd" &>/dev/null; then
        success "  $name: installed ✓"
    else
        warn "  $name: not found (install: $install_hint)"
    fi
}

install_nodejs() {
    local pkg_mgr
    pkg_mgr=$(detect_package_manager)

    case "$pkg_mgr" in
        brew)
            info "Installing Node.js via Homebrew..."
            brew install node@20
            ;;
        apt)
            info "Installing Node.js via apt..."
            curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
            sudo apt-get install -y nodejs
            ;;
        dnf)
            info "Installing Node.js via dnf..."
            sudo dnf module install -y nodejs:20
            ;;
        pacman)
            info "Installing Node.js via pacman..."
            sudo pacman -S --noconfirm nodejs npm
            ;;
        *)
            fatal "Cannot auto-install Node.js. Please install Node.js 18+ manually:\n  https://nodejs.org/en/download/"
            ;;
    esac
}

# --- Download & Install ---

get_latest_version() {
    local latest
    latest=$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" | grep '"tag_name"' | sed -E 's/.*"([^"]+)".*/\1/')
    if [ -z "$latest" ]; then
        fatal "Could not determine latest version. Check your internet connection."
    fi
    echo "$latest"
}

download_and_install() {
    local os arch version download_url temp_dir

    os=$(detect_os)
    arch=$(detect_arch)

    # Determine version
    if [ -z "$VERSION" ]; then
        info "Fetching latest version..."
        version=$(get_latest_version)
    else
        version="$VERSION"
    fi

    info "Installing Hermes Squad ${BOLD}$version${NC} for $os/$arch..."

    # Construct download URL
    download_url="https://github.com/$REPO/releases/download/$version/hermes-squad-$version-$os-$arch.tar.gz"
    verbose "Download URL: $download_url"

    # Create temp directory for download
    temp_dir=$(mktemp -d)
    trap 'rm -rf "$temp_dir"' EXIT

    # Download the archive
    info "Downloading..."
    if ! curl -fsSL "$download_url" -o "$temp_dir/hermes-squad.tar.gz"; then
        fatal "Download failed. Check that version $version exists for $os/$arch."
    fi

    # Verify checksum (if available)
    local checksum_url="${download_url}.sha256"
    if curl -fsSL "$checksum_url" -o "$temp_dir/checksum.sha256" 2>/dev/null; then
        verbose "Verifying checksum..."
        (cd "$temp_dir" && sha256sum -c checksum.sha256 2>/dev/null) || \
            fatal "Checksum verification failed! The download may be corrupted."
        success "Checksum verified"
    else
        warn "No checksum available — skipping verification"
    fi

    # Extract
    info "Extracting..."
    tar -xzf "$temp_dir/hermes-squad.tar.gz" -C "$temp_dir"

    # Create install directory
    mkdir -p "$INSTALL_DIR"

    # Check for existing installation
    if [ -f "$INSTALL_DIR/hermes" ] && [ "$FORCE" = false ]; then
        local existing_version
        existing_version=$("$INSTALL_DIR/hermes" --version 2>/dev/null || echo "unknown")
        warn "Hermes Squad is already installed (version: $existing_version)"
        read -rp "  Overwrite? [y/N] " confirm
        if [[ ! "$confirm" =~ ^[Yy] ]]; then
            info "Installation cancelled."
            exit 0
        fi
    fi

    # Install binary
    cp "$temp_dir/hermes-squad/hermes" "$INSTALL_DIR/hermes"
    chmod +x "$INSTALL_DIR/hermes"

    # Also create 'hermes-squad' symlink
    ln -sf "$INSTALL_DIR/hermes" "$INSTALL_DIR/hermes-squad"

    success "Installed to $INSTALL_DIR/hermes"
}

# --- PATH Setup ---

setup_path() {
    # Check if install dir is already in PATH
    if echo "$PATH" | tr ':' '\n' | grep -q "^$INSTALL_DIR$"; then
        verbose "$INSTALL_DIR is already in PATH"
        return
    fi

    info "Adding $INSTALL_DIR to PATH..."

    local shell_config=""
    local current_shell
    current_shell=$(basename "$SHELL")

    case "$current_shell" in
        bash)
            shell_config="$HOME/.bashrc"
            ;;
        zsh)
            shell_config="$HOME/.zshrc"
            ;;
        fish)
            # Fish uses different syntax
            mkdir -p "$HOME/.config/fish"
            echo "set -gx PATH $INSTALL_DIR \$PATH" >> "$HOME/.config/fish/config.fish"
            success "Added to ~/.config/fish/config.fish"
            return
            ;;
        *)
            warn "Unknown shell: $current_shell. Add this to your shell config:"
            echo "  export PATH=\"$INSTALL_DIR:\$PATH\""
            return
            ;;
    esac

    # Add to shell config if not already there
    local path_line="export PATH=\"$INSTALL_DIR:\$PATH\""
    if ! grep -q "$INSTALL_DIR" "$shell_config" 2>/dev/null; then
        echo "" >> "$shell_config"
        echo "# Hermes Squad" >> "$shell_config"
        echo "$path_line" >> "$shell_config"
        success "Added to $shell_config"
        warn "Run 'source $shell_config' or restart your terminal to use 'hermes'"
    fi
}

# --- Initial Setup ---

initial_setup() {
    info "Running initial setup..."

    # Create data directory structure
    mkdir -p "$DATA_DIR"/{config,data,skills,logs}

    # Copy default config if it doesn't exist
    if [ ! -f "$DATA_DIR/config/config.json" ]; then
        verbose "Creating default configuration..."
        cat > "$DATA_DIR/config/config.json" << 'EOF'
{
  "version": "1.0.0",
  "defaultAgent": "claude",
  "maxSessions": 5,
  "enableWorktrees": true,
  "theme": "auto",
  "logLevel": "info"
}
EOF
    fi

    success "Data directory initialized at $DATA_DIR"
}

# --- Main ---

main() {
    banner
    parse_args "$@"

    info "Starting Hermes Squad installation..."
    echo ""

    # Step 1: Check system dependencies
    check_dependencies
    echo ""

    # Step 2: Download and install
    download_and_install
    echo ""

    # Step 3: Setup PATH
    setup_path
    echo ""

    # Step 4: Initial setup
    initial_setup
    echo ""

    # Done!
    echo -e "${GREEN}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${GREEN}${BOLD}  ✓ Hermes Squad installed successfully!${NC}"
    echo -e "${GREEN}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""
    echo "  Get started:"
    echo "    ${BOLD}hermes${NC}              Launch TUI mode"
    echo "    ${BOLD}hermes --electron${NC}   Launch GUI mode"
    echo "    ${BOLD}hermes --help${NC}       Show all options"
    echo ""
    echo "  Quick start:"
    echo "    ${BOLD}cd your-project && hermes${NC}"
    echo ""
    echo "  Documentation: https://github.com/$REPO#readme"
    echo ""
}

main "$@"

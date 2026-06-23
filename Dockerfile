# =============================================================================
# Hermes Squad — Dockerfile (Headless/Server Mode)
# =============================================================================
# Multi-stage build for the headless/TUI-only mode of Hermes Squad.
# This image is used for:
# - Running Hermes Squad as a server/daemon (no GUI)
# - CI/CD environments for automated agent orchestration
# - Docker Compose setups with persistent memory (PostgreSQL)
# - Kubernetes deployments for team-shared agent pools
#
# Build: docker build -t hermes-squad .
# Run:   docker run -it --rm -v $(pwd):/workspace hermes-squad
# =============================================================================

# ===========================================================================
# Stage 1: Dependencies (cached layer)
# ===========================================================================
FROM node:20-slim AS deps

WORKDIR /app

# Copy only package files for better layer caching
# (dependencies only rebuild when package.json/lock changes)
COPY package.json package-lock.json ./

# Install production dependencies only
# --omit=dev skips devDependencies (test frameworks, linters, etc.)
RUN npm ci --omit=dev \
    && npm cache clean --force

# ===========================================================================
# Stage 2: Build (TypeScript compilation)
# ===========================================================================
FROM node:20-slim AS build

WORKDIR /app

# Copy all package files (need devDeps for building)
COPY package.json package-lock.json tsconfig.json tsconfig.build.json ./

# Install ALL dependencies (including devDependencies for compilation)
RUN npm ci

# Copy source code
COPY src/ ./src/
COPY config/ ./config/
COPY scripts/ ./scripts/

# Compile TypeScript to JavaScript
# --project tsconfig.build.json excludes test files and unnecessary paths
RUN npm run build:tui \
    && echo "Build completed successfully"

# ===========================================================================
# Stage 3: Production Runtime
# ===========================================================================
FROM node:20-slim AS runtime

# Metadata labels for container registries
LABEL org.opencontainers.image.title="Hermes Squad"
LABEL org.opencontainers.image.description="AI multi-agent coding session orchestrator"
LABEL org.opencontainers.image.source="https://github.com/hermes-squad/hermes-squad"
LABEL org.opencontainers.image.licenses="MIT"
LABEL org.opencontainers.image.vendor="Hermes Squad"

# Install runtime system dependencies
# - git: Required for worktree management and agent operations
# - curl: Health checks and API interactions
# - openssh-client: SSH key-based git operations
# - python3: Some agents (aider) require Python
# - tmux: Terminal multiplexing for session management (fallback)
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    curl \
    openssh-client \
    python3 \
    python3-pip \
    tmux \
    procps \
    && rm -rf /var/lib/apt/lists/*

# Create non-root user for security
# Running as root in containers is a security risk
RUN groupadd --gid 1001 hermes \
    && useradd --uid 1001 --gid hermes --shell /bin/bash --create-home hermes

# Create application directories with correct permissions
RUN mkdir -p /app /workspace /data /home/hermes/.hermes-squad \
    && chown -R hermes:hermes /app /workspace /data /home/hermes

WORKDIR /app

# Copy production dependencies from deps stage
COPY --from=deps --chown=hermes:hermes /app/node_modules ./node_modules

# Copy compiled application from build stage
COPY --from=build --chown=hermes:hermes /app/dist ./dist
COPY --from=build --chown=hermes:hermes /app/config ./config

# Copy package.json for version info and npm scripts
COPY --chown=hermes:hermes package.json ./

# Copy runtime scripts
COPY --chown=hermes:hermes scripts/runtime/ ./scripts/

# Switch to non-root user
USER hermes

# ===========================================================================
# Environment Configuration
# ===========================================================================

# Application mode (tui, server, daemon)
ENV HERMES_MODE="server"

# Log level (debug, info, warn, error)
ENV LOG_LEVEL="info"

# Data directory for sessions, state, and memory
ENV HERMES_DATA_DIR="/data"

# Workspace mount point (user's project directory)
ENV HERMES_WORKSPACE="/workspace"

# Config directory
ENV HERMES_CONFIG_DIR="/app/config"

# Server port (for HTTP/WebSocket API in server mode)
ENV HERMES_PORT=3847

# ACP server port (for agent communication)
ENV ACP_PORT=3848

# MCP server mode (stdio or http)
ENV MCP_TRANSPORT="stdio"

# Database URL (optional — for persistent memory/history)
ENV DATABASE_URL=""

# Disable Electron (we're headless)
ENV ELECTRON_DISABLE=true

# Node.js optimizations for production
ENV NODE_ENV=production
ENV NODE_OPTIONS="--max-old-space-size=512"

# ===========================================================================
# Volumes & Ports
# ===========================================================================

# Workspace volume — mount your project here
VOLUME ["/workspace"]

# Data volume — persistent state, session history, memory
VOLUME ["/data"]

# Expose the HTTP API port and ACP port
EXPOSE 3847 3848

# ===========================================================================
# Health Check
# ===========================================================================

# Verify the server is responding
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:3847/health || exit 1

# ===========================================================================
# Entrypoint
# ===========================================================================

# Use tini or node directly as PID 1 for proper signal handling
# Node.js handles SIGTERM for graceful shutdown
ENTRYPOINT ["node"]

# Default command: start the server
# Override with: docker run hermes-squad node dist/tui/index.js (for TUI mode)
CMD ["dist/server/index.js"]

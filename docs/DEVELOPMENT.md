# Development Guide

> Building from source, testing, contributing, and code style guidelines for Hermes Squad.

---

## Table of Contents

- [Prerequisites](#prerequisites)
- [Building from Source](#building-from-source)
- [Project Structure](#project-structure)
- [Development Workflow](#development-workflow)
- [Testing](#testing)
- [Code Style](#code-style)
- [Contributing](#contributing)
- [Release Process](#release-process)
- [Debugging](#debugging)

---

## Prerequisites

### Required Tools

| Tool | Version | Purpose |
|------|---------|---------|
| Go | 1.22+ | TUI and session management |
| Python | 3.11+ | Skills engine, memory, gateway |
| tmux | 3.0+ | Session multiplexing |
| git | 2.30+ | Worktree support |
| Make | any | Build orchestration |
| Node.js | 20+ | TypeScript components (optional) |

### Optional Tools

| Tool | Purpose |
|------|---------|
| `golangci-lint` | Go linting |
| `ruff` | Python linting and formatting |
| `mypy` | Python type checking |
| `pytest` | Python testing |
| `goreleaser` | Release builds |
| `docker` | Container builds |

### Setup Development Environment

```bash
# Clone the repository
git clone https://github.com/hermes-squad/hermes-squad.git
cd hermes-squad

# Install Go dependencies
go mod download

# Set up Python environment
python -m venv .venv
source .venv/bin/activate  # or .venv\Scripts\activate on Windows
pip install -e "./agent[dev]"

# Install Node.js dependencies (optional)
cd ts && npm install && cd ..

# Install pre-commit hooks
make setup-hooks

# Verify everything works
make check
```

---

## Building from Source

### Quick Build

```bash
# Build everything
make build

# Build only the Go binary
make build-go

# Build only the Python package
make build-python

# Build the TypeScript MCP server
make build-ts
```

### Detailed Build Commands

```bash
# Go binary with version info
go build -ldflags "-X main.version=dev -X main.commit=$(git rev-parse --short HEAD)" \
  -o bin/hermes-squad ./cmd/hermes-squad/

# Python package in development mode
pip install -e ./agent

# TypeScript compilation
cd ts/mcp-server && npm run build && cd ../..
```

### Build Targets

```makefile
# Makefile reference

# Build all components
build: build-go build-python build-ts

# Go binary
build-go:
    go build -o bin/hermes-squad ./cmd/hermes-squad/

# Python agent
build-python:
    pip install -e ./agent

# TypeScript MCP server
build-ts:
    cd ts/mcp-server && npm run build

# Run all tests
test: test-go test-python test-ts

# Lint all code
lint: lint-go lint-python lint-ts

# Format all code
fmt: fmt-go fmt-python fmt-ts

# Clean build artifacts
clean:
    rm -rf bin/ dist/ agent/*.egg-info
    cd ts/mcp-server && npm run clean

# Install to system
install: build
    cp bin/hermes-squad /usr/local/bin/
    pip install ./agent

# Development install (with hot reload)
dev: build-go
    pip install -e "./agent[dev]"

# Docker build
docker:
    docker build -t hermes-squad:dev .

# Generate mocks and test fixtures
generate:
    go generate ./...
    python -m pytest --fixtures agent/tests/conftest.py
```

### Cross-Compilation

```bash
# Linux AMD64
GOOS=linux GOARCH=amd64 go build -o bin/hermes-squad-linux-amd64 ./cmd/hermes-squad/

# Linux ARM64
GOOS=linux GOARCH=arm64 go build -o bin/hermes-squad-linux-arm64 ./cmd/hermes-squad/

# macOS AMD64
GOOS=darwin GOARCH=amd64 go build -o bin/hermes-squad-darwin-amd64 ./cmd/hermes-squad/

# macOS ARM64 (Apple Silicon)
GOOS=darwin GOARCH=arm64 go build -o bin/hermes-squad-darwin-arm64 ./cmd/hermes-squad/

# Windows
GOOS=windows GOARCH=amd64 go build -o bin/hermes-squad-windows-amd64.exe ./cmd/hermes-squad/
```

---

## Project Structure

```
hermes-squad/
├── cmd/                          # Go entrypoints
│   ├── hermes-squad/             # Main binary
│   │   └── main.go
│   └── hs-agent/                # Agent subprocess helper
│       └── main.go
├── pkg/                          # Go packages (library code)
│   ├── session/                  # Session management
│   │   ├── session.go           # Session interface & types
│   │   ├── manager.go           # Session lifecycle management
│   │   ├── tmux.go              # Tmux integration
│   │   ├── worktree.go          # Git worktree operations
│   │   ├── agent.go             # Agent process management
│   │   ├── diff.go              # Diff generation and display
│   │   ├── autoaccept.go        # Auto-accept logic
│   │   └── coordinator.go       # Multi-agent coordination
│   ├── tui/                     # Terminal UI (Bubble Tea)
│   │   ├── app.go               # Main TUI application
│   │   ├── model.go             # Bubble Tea model
│   │   ├── views/               # View components
│   │   │   ├── sessions.go      # Session list view
│   │   │   ├── output.go        # Live output view
│   │   │   ├── diff.go          # Diff preview view
│   │   │   └── skills.go        # Skills browser view
│   │   └── components/          # Reusable UI components
│   │       ├── statusbar.go
│   │       ├── list.go
│   │       └── panel.go
│   ├── protocol/                # Protocol adapters
│   │   ├── acp/                 # Agent Client Protocol
│   │   │   ├── adapter.go       # ACP handler
│   │   │   ├── messages.go      # ACP message types
│   │   │   └── capabilities.go  # Capability negotiation
│   │   ├── mcp/                 # Model Context Protocol
│   │   │   ├── server.go        # MCP server
│   │   │   ├── tools.go         # Tool definitions
│   │   │   └── resources.go     # Resource definitions
│   │   └── gateway/             # HTTP/WebSocket
│   │       ├── server.go        # HTTP server
│   │       ├── routes.go        # API routes
│   │       └── websocket.go     # WebSocket handler
│   ├── config/                  # Configuration
│   │   ├── config.go            # Config loading & validation
│   │   ├── profiles.go          # Profile management
│   │   └── defaults.go          # Default values
│   └── ipc/                     # Inter-process communication
│       ├── socket.go            # Unix domain socket
│       └── events.go            # Event bus
├── agent/                        # Python agent/skills package
│   ├── pyproject.toml           # Python package config
│   ├── hermes_squad/            # Main Python package
│   │   ├── __init__.py
│   │   ├── skills/              # Skills engine
│   │   │   ├── __init__.py
│   │   │   ├── manager.py       # Skill CRUD & retrieval
│   │   │   ├── executor.py      # Skill execution sandbox
│   │   │   ├── improver.py      # Skill improvement logic
│   │   │   ├── extractor.py     # Skill extraction from executions
│   │   │   ├── store.py         # File-based persistence
│   │   │   └── cron.py          # Scheduled execution
│   │   ├── memory/              # Memory system
│   │   │   ├── __init__.py
│   │   │   ├── graph.py         # Knowledge graph
│   │   │   ├── episodic.py      # Episodic memory
│   │   │   ├── embeddings.py    # Vector embeddings
│   │   │   └── context.py       # Context assembly
│   │   ├── gateway/             # HTTP/WS gateway
│   │   │   ├── __init__.py
│   │   │   ├── app.py           # FastAPI application
│   │   │   └── websocket.py     # WebSocket handlers
│   │   └── ipc/                 # IPC client
│   │       ├── __init__.py
│   │       └── client.py        # UDS client for Go↔Python
│   └── tests/                   # Python tests
│       ├── conftest.py
│       ├── test_skills/
│       ├── test_memory/
│       └── test_gateway/
├── ts/                           # TypeScript components
│   └── mcp-server/             # MCP server (alternative impl)
│       ├── package.json
│       ├── tsconfig.json
│       ├── src/
│       │   ├── index.ts
│       │   ├── tools.ts
│       │   └── resources.ts
│       └── tests/
├── docs/                         # Documentation
├── configs/                      # Default config templates
├── scripts/                      # Build & utility scripts
│   ├── setup-hooks.sh
│   ├── release.sh
│   └── generate-mocks.sh
├── .github/                      # CI/CD
│   └── workflows/
│       ├── ci.yaml
│       ├── release.yaml
│       └── docs.yaml
├── Makefile
├── Dockerfile
├── docker-compose.yaml
├── go.mod
├── go.sum
├── .golangci.yaml
├── .goreleaser.yaml
└── LICENSE
```

---

## Development Workflow

### Daily Development

```bash
# 1. Create a feature branch
git checkout -b feature/my-feature

# 2. Make changes...

# 3. Run tests incrementally
make test-go     # Go tests
make test-python # Python tests

# 4. Lint before commit
make lint

# 5. Format code
make fmt

# 6. Commit with conventional commit message
git commit -m "feat(skills): add semantic search for skill retrieval"

# 7. Push and create PR
git push origin feature/my-feature
```

### Hot Reload During Development

```bash
# Go: use air for hot reload
go install github.com/cosmtrek/air@latest
air  # watches Go files and rebuilds

# Python: editable install already provides hot reload
pip install -e "./agent[dev]"
# Changes to Python files are immediately reflected

# TypeScript: watch mode
cd ts/mcp-server && npm run dev
```

### Running Locally

```bash
# Run the TUI in development mode
go run ./cmd/hermes-squad/ --log-level debug

# Run the skills engine standalone
python -m hermes_squad.skills.manager --debug

# Run the gateway standalone
python -m hermes_squad.gateway.app --port 8765 --debug

# Test ACP mode
echo '{"jsonrpc":"2.0","method":"initialize","id":1,"params":{}}' | go run ./cmd/hermes-squad/ serve --acp
```

---

## Testing

### Test Structure

```
Tests are co-located with source code (Go) or in a dedicated tests/ directory (Python).

Go Tests:
  pkg/session/session_test.go
  pkg/session/tmux_test.go
  pkg/protocol/acp/adapter_test.go
  ...

Python Tests:
  agent/tests/test_skills/test_manager.py
  agent/tests/test_skills/test_executor.py
  agent/tests/test_memory/test_graph.py
  ...

Integration Tests:
  tests/integration/test_acp_flow.go
  tests/integration/test_session_lifecycle.go
  tests/integration/test_skill_improvement.py
```

### Running Tests

```bash
# All tests
make test

# Go tests only
make test-go
# With coverage
go test -coverprofile=coverage.out ./...
go tool cover -html=coverage.out

# Python tests only
make test-python
# With coverage
pytest agent/tests/ --cov=hermes_squad --cov-report=html

# TypeScript tests
make test-ts
cd ts/mcp-server && npm test

# Integration tests (requires tmux)
make test-integration

# Specific test
go test -v -run TestSessionCreation ./pkg/session/
pytest agent/tests/test_skills/test_manager.py -k "test_skill_creation" -v
```

### Test Fixtures

```go
// Go: test fixtures in testdata/
func TestWorktreeCreation(t *testing.T) {
    // Setup: create a temporary git repo
    repo := testutil.NewTempRepo(t)
    defer repo.Cleanup()

    // Create session manager
    mgr := session.NewManager(session.Config{
        WorktreeDir: ".worktrees",
        Prefix:      "hs-test/",
    })

    // Test
    sess, err := mgr.Create(context.Background(), session.CreateOpts{
        Name:      "test-session",
        Workspace: repo.Path(),
        Task:      "test task",
    })

    assert.NoError(t, err)
    assert.Equal(t, "test-session", sess.Name)
    assert.DirExists(t, filepath.Join(repo.Path(), ".worktrees", "hs-test-session"))
}
```

```python
# Python: fixtures in conftest.py
@pytest.fixture
def skill_store(tmp_path):
    """Create a temporary skill store for testing."""
    store = SkillStore(base_path=tmp_path / "skills")
    store.initialize()
    return store

@pytest.fixture
def sample_skill():
    """Create a sample skill for testing."""
    return Skill(
        name="test-skill",
        version=1,
        description="A test skill",
        instructions="Do the thing",
        triggers=[Trigger(pattern="test.*skill")],
    )

async def test_skill_creation(skill_store, sample_skill):
    """Test that skills can be created and retrieved."""
    await skill_store.save(sample_skill)

    loaded = await skill_store.get("test-skill")
    assert loaded.name == "test-skill"
    assert loaded.version == 1
```

### Mocking

```go
// Go: interfaces enable easy mocking
type MockTmuxClient struct {
    mock.Mock
}

func (m *MockTmuxClient) CreateSession(name string) error {
    args := m.Called(name)
    return args.Error(0)
}

func TestSessionStartWithMockTmux(t *testing.T) {
    mockTmux := new(MockTmuxClient)
    mockTmux.On("CreateSession", "hs-test-abc12").Return(nil)

    mgr := session.NewManager(session.Config{}, session.WithTmux(mockTmux))
    err := mgr.Start(context.Background(), "test")

    assert.NoError(t, err)
    mockTmux.AssertExpectations(t)
}
```

```python
# Python: pytest-mock for mocking
async def test_skill_improvement(mocker, skill_store, sample_skill):
    """Test that skill improvement updates the version."""
    await skill_store.save(sample_skill)

    # Mock the LLM call
    mocker.patch(
        "hermes_squad.skills.improver.call_llm",
        return_value="Updated instructions with fix",
    )

    improver = SkillImprover(store=skill_store)
    improved = await improver.improve(
        "test-skill",
        feedback=Feedback(
            outcome="failure",
            issue="Missing error handling",
        ),
    )

    assert improved.version == 2
    assert "error handling" in improved.instructions.lower()
```

---

## Code Style

### Go Code Style

We follow standard Go conventions with some additions:

```go
// Package comment
// Package session manages agent sessions, including tmux, worktrees, and lifecycle.
package session

import (
    // Standard library first
    "context"
    "fmt"
    "time"

    // Third-party packages
    "github.com/charmbracelet/bubbletea"

    // Internal packages
    "github.com/hermes-squad/hermes-squad/pkg/config"
)

// Interface definitions at the top of the file
type SessionManager interface {
    Create(ctx context.Context, opts CreateOpts) (*Session, error)
    Get(id string) (*Session, error)
    List() ([]*Session, error)
    Terminate(id string) error
}

// Exported types with godoc comments
// Session represents a managed agent environment with isolated worktree and tmux pane.
type Session struct {
    ID        string        `json:"id"`
    Name      string        `json:"name"`
    Status    SessionStatus `json:"status"`
    CreatedAt time.Time     `json:"created_at"`
}

// Constructor pattern
func NewManager(cfg Config, opts ...ManagerOption) *Manager {
    m := &Manager{config: cfg}
    for _, opt := range opts {
        opt(m)
    }
    return m
}

// Error variables (not types, unless wrapping is needed)
var (
    ErrSessionNotFound = fmt.Errorf("session not found")
    ErrMaxSessions     = fmt.Errorf("maximum sessions reached")
)
```

**Linter configuration (`.golangci.yaml`):**

```yaml
linters:
  enable:
    - errcheck
    - gosimple
    - govet
    - ineffassign
    - staticcheck
    - unused
    - gofmt
    - goimports
    - misspell
    - unconvert
    - gocritic

linters-settings:
  gocritic:
    enabled-tags:
      - diagnostic
      - style
      - performance
```

### Python Code Style

We use `ruff` for formatting and linting, `mypy` for type checking:

```python
"""Skill manager module — handles CRUD and retrieval of skills."""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from collections.abc import Sequence

# Type hints everywhere
@dataclass
class Skill:
    """A reusable, versioned unit of knowledge for task execution."""

    name: str
    version: int = 1
    description: str = ""
    instructions: str = ""
    triggers: list[Trigger] = field(default_factory=list)
    metrics: SkillMetrics = field(default_factory=SkillMetrics)

    async def execute(self, context: ExecutionContext) -> SkillResult:
        """Execute this skill within the given context."""
        ...

# Explicit return types
async def find_relevant_skills(
    task: str,
    context: Context,
    *,
    max_results: int = 3,
    min_similarity: float = 0.75,
) -> list[Skill]:
    """Find skills relevant to the given task.

    Args:
        task: The task description to match against.
        context: Execution context including files and workspace.
        max_results: Maximum number of skills to return.
        min_similarity: Minimum semantic similarity threshold.

    Returns:
        List of matching skills, ordered by relevance.
    """
    ...
```

**Ruff configuration (`pyproject.toml`):**

```toml
[tool.ruff]
target-version = "py311"
line-length = 100

[tool.ruff.lint]
select = [
    "E",    # pycodestyle errors
    "W",    # pycodestyle warnings
    "F",    # pyflakes
    "I",    # isort
    "N",    # pep8-naming
    "UP",   # pyupgrade
    "B",    # flake8-bugbear
    "A",    # flake8-builtins
    "C4",   # flake8-comprehensions
    "RUF",  # ruff-specific rules
]

[tool.mypy]
python_version = "3.11"
strict = true
warn_return_any = true
warn_unused_configs = true
```

### Commit Messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat(skills): add semantic search for skill retrieval
fix(session): handle tmux socket conflict on startup
docs(integration): add Kiro IDE setup instructions
refactor(tui): extract session list into separate component
test(memory): add embeddings retrieval test
chore(deps): bump bubble tea to v0.25.0
```

**Scopes**: `skills`, `session`, `tui`, `acp`, `mcp`, `gateway`, `config`, `memory`, `docs`, `deps`, `ci`

---

## Contributing

### Getting Started

1. Fork the repository
2. Clone your fork: `git clone https://github.com/YOUR_USER/hermes-squad.git`
3. Create a branch: `git checkout -b feature/amazing-feature`
4. Make changes and add tests
5. Ensure CI passes: `make check` (runs lint + test)
6. Submit a Pull Request

### PR Requirements

- [ ] All tests pass (`make test`)
- [ ] Linting passes (`make lint`)
- [ ] New code has tests (>80% coverage for new code)
- [ ] Documentation updated (if applicable)
- [ ] Conventional commit messages used
- [ ] No breaking changes without RFC discussion

### Issue Labels

| Label | Description |
|-------|-------------|
| `bug` | Something isn't working |
| `enhancement` | New feature request |
| `good first issue` | Suitable for newcomers |
| `help wanted` | Extra attention needed |
| `skills` | Related to skills engine |
| `session` | Related to session management |
| `integration` | Related to ACP/MCP/Gateway |
| `tui` | Related to terminal UI |
| `docs` | Documentation improvement |

### Architecture Decision Records (ADRs)

Major architectural decisions are documented in `docs/adr/`:

```bash
# Create a new ADR
make adr title="Use Bubble Tea for TUI framework"
```

---

## Release Process

### Versioning

We follow [Semantic Versioning](https://semver.org/):

- **MAJOR**: Breaking changes to CLI, config format, or protocol
- **MINOR**: New features, backward-compatible
- **PATCH**: Bug fixes, documentation

### Release Steps

```bash
# 1. Update version
make version VERSION=0.2.0

# 2. Update CHANGELOG.md
# (automated from conventional commits)
make changelog

# 3. Create release commit
git add -A
git commit -m "chore(release): v0.2.0"

# 4. Tag
git tag -a v0.2.0 -m "Release v0.2.0"

# 5. Push
git push origin main --tags

# 6. CI builds and publishes releases
# (goreleaser handles binaries, PyPI handles Python package)
```

### Release Artifacts

| Artifact | Distribution |
|----------|-------------|
| Go binaries | GitHub Releases (Linux, macOS, Windows) |
| Python package | PyPI (`pip install hermes-squad`) |
| Docker image | GitHub Container Registry |
| Homebrew formula | `brew install hermes-squad` |

---

## Debugging

### Debug Logging

```bash
# Maximum verbosity
HERMES_SQUAD_LOG_LEVEL=trace hermes-squad --verbose

# Component-specific debugging
HERMES_SQUAD_TRACE_RPC=true hermes-squad serve --acp 2>rpc.log
HERMES_SQUAD_TRACE_SKILLS=true hermes-squad --verbose
```

### Common Debug Commands

```bash
# Check system requirements
hermes-squad doctor

# Inspect session state
hermes-squad session inspect auth-refactor

# Dump effective configuration
hermes-squad config show --resolved

# Check IPC connection
hermes-squad debug ipc-status

# Inspect skill store integrity
hermes-squad debug skill-store --verify

# Profile performance
HERMES_SQUAD_PPROF=true hermes-squad
# Then: go tool pprof http://localhost:6060/debug/pprof/profile
```

### Debugging Go Components

```bash
# Run with delve debugger
dlv debug ./cmd/hermes-squad/ -- serve --acp

# Attach to running process
dlv attach $(pidof hermes-squad)
```

### Debugging Python Components

```bash
# Run skills engine with debugger
python -m debugpy --listen 5678 --wait-for-client -m hermes_squad.skills.manager

# Or use breakpoint()
# Add `breakpoint()` in code, then run normally — drops into pdb
```

---

## See Also

- [Architecture](ARCHITECTURE.md) — System design and component relationships
- [Configuration](CONFIGURATION.md) — All config options
- [Changelog](CHANGELOG.md) — Release history

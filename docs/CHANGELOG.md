# Changelog

All notable changes to Hermes Squad are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [0.1.0] — 2024-06-23

### 🎉 Initial Release

The first public release of Hermes Squad — merging Claude Squad's multi-agent terminal management with Hermes Agent's self-improving AI capabilities.

---

### Added

#### Core Platform
- **Unified architecture** combining Go TUI (from Claude Squad) with Python skills engine (from Hermes Agent)
- **Inter-process communication** via Unix Domain Sockets between Go and Python components
- **Event bus** for cross-component notifications and real-time updates
- **Layered configuration system** with config files, profiles, environment variables, and CLI flags

#### Session Management (from Claude Squad)
- **Multi-agent TUI** — Manage multiple AI agents from a single terminal interface using Bubble Tea
- **Git worktree isolation** — Each agent operates in its own worktree, preventing conflicts
- **Tmux session management** — Persistent sessions that survive terminal disconnects
- **Auto-accept mode** — Configurable guardrails for autonomous agent operation
  - File pattern allowlists and blocklists
  - Command execution rules (allowed/blocked)
  - Limits on files per action, lines per file
  - Protected file patterns that always require manual review
- **Diff preview** — Full diff visualization before merging changes
  - Approve, reject, edit, or partial merge options
  - Conflict detection and resolution strategies
- **Session lifecycle management** — Create, pause, resume, terminate with proper cleanup
- **Multi-agent coordination** — Configurable conflict resolution and inter-session messaging

#### Skills System (from Hermes Agent)
- **Skill CRUD** — Create, read, update, delete skills via CLI, TUI, or API
- **Automatic extraction** — Skills automatically created from successful task completions
- **Self-improvement loops** — Skills refined based on execution feedback
  - Failure analysis and patching
  - Deviation incorporation
  - Success rate tracking
- **Skill retrieval** — Multi-strategy matching (pattern, semantic, file-pattern)
- **Skill versioning** — Auto-incrementing versions with full change history
- **Cross-session sharing** — Skills available to all active sessions immediately
- **Skill metrics** — Execution count, success rate, average duration tracking
- **Cron scheduling** — Automated recurring skill execution

#### Memory System (from Hermes Agent)
- **Knowledge graph** — Entity relationships and structured facts
- **Episodic memory** — Past interactions and execution outcomes
- **Embedding store** — Semantic search over memories (FAISS + sentence-transformers)
- **Context builder** — Intelligent context assembly for agent prompts
- **Configurable retention** — Auto-pruning of low-relevance memories

#### Integrations
- **ACP adapter** — Full Agent Client Protocol support (JSON-RPC 2.0 over stdio)
  - Register as "Coding Agent" in Amazon Quick Desktop
  - Native support in Kiro IDE/CLI
  - Capabilities: tasks, sessions, skills, streaming
- **MCP server mode** — Model Context Protocol for tool exposure
  - 11 tools: session CRUD, skill execution, memory queries, diff operations
  - Resource exposure: skills, sessions, memory
  - Prompt templates
- **HTTP/WebSocket gateway** — REST API + real-time streaming
  - Token-based authentication
  - CORS configuration
  - Rate limiting
  - WebSocket for live session output
- **Remote SSH support** — Manage agents on remote machines
  - `-T` flag documentation for proper stdio operation
  - SSH config examples
  - Port forwarding for gateway access

#### Configuration
- **Profile system** — Quick, Kiro, Remote, and custom profiles
- **Full config.yaml reference** — All options documented with defaults
- **Environment variable overrides** — `HERMES_SQUAD_*` pattern
- **Config validation** — `hermes-squad config validate` command
- **Config introspection** — `hermes-squad config show --resolved`

#### Developer Experience
- **`hermes-squad doctor`** — System requirement checker
- **Debug logging** — Component-specific trace output
- **RPC tracing** — Full JSON-RPC message logging
- **Hot reload** — Development mode with file watching

#### Documentation
- Complete documentation suite:
  - [README](README.md) — Project overview and quick start
  - [Architecture](ARCHITECTURE.md) — System design with ASCII and Mermaid diagrams
  - [Integration Guide](INTEGRATION-GUIDE.md) — Step-by-step ACP/MCP/SSH setup
  - [Skills System](SKILLS-SYSTEM.md) — Self-improving skills deep dive
  - [Session Management](SESSION-MANAGEMENT.md) — Multi-agent orchestration
  - [Configuration](CONFIGURATION.md) — Complete config reference
  - [Development](DEVELOPMENT.md) — Build, test, contribute guide

---

### Architecture Decisions

| Decision | Rationale |
|----------|-----------|
| Go for TUI + Session Mgmt | Inherited from Claude Squad; excellent for system programming, tmux/git integration, single binary distribution |
| Python for Skills + Memory | Inherited from Hermes Agent; rich ML ecosystem (embeddings, NLP), rapid iteration |
| JSON-RPC over stdio for ACP/MCP | Standard protocol, no network exposure, compatible with Quick and Kiro |
| Unix Domain Sockets for IPC | Low-latency, secure, no port conflicts between Go↔Python |
| YAML for skills storage | Human-readable, easy to version control, supports complex structures |
| SQLite + FAISS for memory | Zero-configuration, embedded, performant for single-machine use |

---

### Known Limitations

- **Windows support**: Partial — tmux requires WSL or alternative (work in progress)
- **Multi-machine sync**: Skill sharing is local-only (remote sync planned for v0.2.0)
- **Concurrent skill improvement**: Two sessions improving the same skill simultaneously may cause version conflicts
- **MCP streaming**: Streaming responses not yet supported in MCP mode (works in ACP mode)
- **Memory encryption**: Available but key management is manual (KMS integration planned)

---

### Dependencies

#### Go
| Package | Version | Purpose |
|---------|---------|---------|
| `github.com/charmbracelet/bubbletea` | 0.25+ | TUI framework |
| `github.com/charmbracelet/lipgloss` | 0.9+ | TUI styling |
| `github.com/spf13/cobra` | 1.8+ | CLI framework |
| `github.com/spf13/viper` | 1.18+ | Configuration |
| `github.com/fsnotify/fsnotify` | 1.7+ | File watching |
| `github.com/stretchr/testify` | 1.8+ | Testing |

#### Python
| Package | Version | Purpose |
|---------|---------|---------|
| `pyyaml` | 6.0+ | YAML parsing |
| `fastapi` | 0.109+ | HTTP gateway |
| `websockets` | 12.0+ | WebSocket support |
| `sentence-transformers` | 2.3+ | Embeddings |
| `faiss-cpu` | 1.7+ | Vector search |
| `pydantic` | 2.5+ | Data validation |
| `pytest` | 8.0+ | Testing |
| `ruff` | 0.2+ | Linting/formatting |

---

### Migration Notes

#### From Claude Squad

If you're migrating from Claude Squad:

1. Configuration format has changed — run `hermes-squad migrate --from claude-squad`
2. Tmux session naming convention updated: `cs-*` → `hs-*`
3. Worktree prefix updated: `cs/` → `hs/`
4. Existing worktrees are auto-detected and adopted

#### From Hermes Agent

If you're migrating from Hermes Agent:

1. Skills are compatible — copy `~/.hermes/skills/` to `~/.hermes-squad/skills/`
2. Memory database format unchanged — copy `~/.hermes/memory/` to `~/.hermes-squad/memory/`
3. Cron format slightly different — run `hermes-squad migrate --from hermes-agent`
4. Gateway port changed from 8080 to 8765 (configurable)

---

### Contributors

- Initial development combining Claude Squad (AGPL-3.0, smtg-ai) and Hermes Agent (MIT, NousResearch)
- See [CONTRIBUTING.md](../CONTRIBUTING.md) for how to contribute

---

## [Unreleased]

### Planned for v0.2.0
- Multi-machine skill synchronization
- Windows native support (without WSL)
- MCP streaming responses
- Skill marketplace with ratings and reviews
- IDE extension for VS Code
- Memory KMS integration
- Agent-to-agent skill teaching
- Performance dashboard in TUI

---

[0.1.0]: https://github.com/hermes-squad/hermes-squad/releases/tag/v0.1.0
[Unreleased]: https://github.com/hermes-squad/hermes-squad/compare/v0.1.0...HEAD

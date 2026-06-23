# Hermes Squad

> A unified multi-agent terminal manager with self-improving AI capabilities.

[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](LICENSE)
[![Go Version](https://img.shields.io/badge/Go-1.22+-00ADD8.svg)](https://go.dev)
[![Python Version](https://img.shields.io/badge/Python-3.11+-3776AB.svg)](https://python.org)

---

## What is Hermes Squad?

**Hermes Squad** merges two powerful open-source projects into a single cohesive platform:

| Component | Origin | Stars | License |
|-----------|--------|-------|---------|
| **Multi-Agent Terminal Manager** | [Claude Squad](https://github.com/smtg-ai/claude-squad) (Go TUI) | 7.9k ⭐ | AGPL-3.0 |
| **Self-Improving AI Agent** | [Hermes Desktop/Agent](https://github.com/NousResearch/hermes) (Python/TS) | 201k ⭐ | MIT |

### Why Merge?

Claude Squad excels at **orchestrating multiple AI agents** in parallel terminal sessions with git worktree isolation. Hermes Agent excels at **learning from interactions**, building persistent skills, and self-improvement. Together, they create:

- 🧠 **Agents that learn** — Each agent session builds skills that persist and improve
- 🔀 **Parallel execution** — Run multiple learning agents simultaneously in isolated environments
- 🔄 **Self-improving workflows** — Skills created in one session are available to all future sessions
- 🖥️ **Terminal-native** — Beautiful TUI for managing everything from your terminal
- 🔌 **Deep integrations** — Native ACP support for Amazon Quick Desktop and Kiro IDE

---

## Key Features

### From Claude Squad
- **Multi-agent TUI** — Manage multiple AI coding agents from a single terminal interface
- **Git worktree isolation** — Each agent works in its own worktree, preventing conflicts
- **Tmux session management** — Persistent sessions that survive disconnects
- **Auto-accept mode** — Let agents run autonomously with configurable guardrails
- **Diff preview** — Review all changes before merging back to main

### From Hermes Agent
- **Skills system** — Agents learn reusable skills from successful task completions
- **Persistent memory** — Cross-session knowledge graph and episodic memory
- **Cron scheduling** — Automated recurring tasks with skill execution
- **Gateway API** — HTTP/WebSocket interface for external integrations
- **Self-improvement loops** — Skills are refined based on execution feedback

### New in Hermes Squad
- **ACP integration** — Register as a Coding Agent in Amazon Quick Desktop and Kiro IDE
- **MCP server mode** — Expose tools via Model Context Protocol
- **Unified config** — Single configuration system for all components
- **Cross-agent skill sharing** — Skills learned by one agent are available to all
- **Remote SSH support** — Manage agents on remote machines

---

## Quick Start

### Prerequisites

- Go 1.22+ (for TUI and session management)
- Python 3.11+ (for skills engine and Hermes agent)
- tmux 3.0+ (for session multiplexing)
- git 2.30+ (for worktree support)
- Node.js 20+ (optional, for TypeScript components)

### Installation

```bash
# Clone the repository
git clone https://github.com/hermes-squad/hermes-squad.git
cd hermes-squad

# Build the Go TUI
make build

# Install Python dependencies
pip install -e ./agent

# Verify installation
hermes-squad --version
```

### First Run

```bash
# Launch the TUI
hermes-squad

# Or start with a specific profile
hermes-squad --profile coding

# Start in ACP mode (for Quick Desktop integration)
hermes-squad serve --acp

# Start as MCP server
hermes-squad serve --mcp
```

### Quick Integration with Amazon Quick Desktop

1. Open Amazon Quick Desktop → Settings → Capabilities → MCP
2. Under **Coding Agents**, click "Add Agent"
3. Configure:
   ```json
   {
     "name": "Hermes Squad",
     "command": "hermes-squad",
     "args": ["serve", "--acp"],
     "transport": "stdio"
   }
   ```
4. Hermes Squad is now available as a coding agent in Quick!

> ⚠️ **Important**: Register under "Coding Agents" (ACP), NOT "MCP Servers". See [Integration Guide](INTEGRATION-GUIDE.md) for details.

---

## Documentation

| Document | Description |
|----------|-------------|
| [Architecture](ARCHITECTURE.md) | System architecture, components, data flow |
| [Integration Guide](INTEGRATION-GUIDE.md) | Connecting to Quick, Kiro, MCP setup |
| [Skills System](SKILLS-SYSTEM.md) | Self-improving skills, creation, persistence |
| [Session Management](SESSION-MANAGEMENT.md) | Multi-agent sessions, worktrees, tmux |
| [Configuration](CONFIGURATION.md) | All config options, profiles, env vars |
| [Development](DEVELOPMENT.md) | Building, testing, contributing |
| [Changelog](CHANGELOG.md) | Release history |

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        Hermes Squad                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  ┌─────────────────┐    ┌─────────────────┐    ┌─────────────┐ │
│  │   Go TUI Layer  │    │  Skills Engine   │    │  Integrations│ │
│  │  (Claude Squad) │◄──►│ (Hermes Agent)   │◄──►│  (ACP/MCP)  │ │
│  └────────┬────────┘    └────────┬────────┘    └──────┬──────┘ │
│           │                      │                     │         │
│  ┌────────▼────────────────────────────────────────────▼──────┐ │
│  │              Session & Resource Manager                      │ │
│  │    (tmux sessions, git worktrees, memory, cron)            │ │
│  └─────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

For the full architecture diagram, see [ARCHITECTURE.md](ARCHITECTURE.md).

---

## License

This project is licensed under **AGPL-3.0** (inheriting from Claude Squad's license). The Hermes Agent components retain their MIT license where applicable. See [LICENSE](../LICENSE) for details.

---

## Acknowledgments

- [smtg-ai/claude-squad](https://github.com/smtg-ai/claude-squad) — The foundation for multi-agent terminal management
- [NousResearch/hermes](https://github.com/NousResearch/hermes) — The self-improving AI agent framework
- [Amazon Quick](https://quick.amazon.dev) — ACP protocol and desktop integration
- [Kiro IDE](https://kiro.dev) — Native ACP support for IDE integration

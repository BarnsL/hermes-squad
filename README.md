<p align="center">
  <img src="docs/assets/hermes-squad-logo.png" alt="Hermes Squad" width="200" />
</p>

<h1 align="center">Hermes Squad</h1>

<p align="center">
  <strong>Multi-agent AI orchestrator combining Claude Squad's session management with Hermes Agent's self-improving intelligence.</strong>
</p>

<p align="center">
  <a href="https://github.com/barnsl/hermes-squad/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/barnsl/hermes-squad/ci.yml?branch=main&style=flat-square&logo=github&label=build" alt="Build Status" /></a>
  <a href="https://github.com/barnsl/hermes-squad/releases/latest"><img src="https://img.shields.io/github/v/release/barnsl/hermes-squad?style=flat-square&logo=semanticrelease&color=blue&label=version" alt="Version" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-green?style=flat-square" alt="License: MIT" /></a>
  <a href="https://github.com/barnsl/hermes-squad/stargazers"><img src="https://img.shields.io/github/stars/barnsl/hermes-squad?style=flat-square&logo=github" alt="Stars" /></a>
  <a href="https://github.com/barnsl/hermes-squad/issues"><img src="https://img.shields.io/github/issues/barnsl/hermes-squad?style=flat-square" alt="Issues" /></a>
  <a href="https://discord.gg/hermes-squad"><img src="https://img.shields.io/discord/1234567890?style=flat-square&logo=discord&label=discord" alt="Discord" /></a>
</p>

<p align="center">
  <a href="#-quick-start">Quick Start</a> •
  <a href="#-features">Features</a> •
  <a href="#-supported-agents">Agents</a> •
  <a href="#-integrations">Integrations</a> •
  <a href="docs/README.md">Documentation</a> •
  <a href="CONTRIBUTING.md">Contributing</a>
</p>

---

## 🧬 What is Hermes Squad?

**Hermes Squad** is a multi-agent AI orchestrator combining [Claude Squad](https://github.com/smtg-ai/claude-squad)'s session management with [Hermes Agent](https://github.com/NousResearch/hermes-agent)'s self-improving intelligence. It integrates natively with **Amazon Quick** and **Kiro** via ACP/MCP.

Run multiple AI coding agents in parallel, each in isolated tmux sessions with full git worktree support, while a meta-orchestration layer learns from outcomes, routes tasks intelligently, and continuously improves agent performance.

```
┌─────────────────────────────────────────────────────────┐
│                    HERMES SQUAD                          │
├─────────────┬─────────────┬─────────────┬──────────────┤
│  Claude Code│   Kiro CLI  │  Gemini CLI │ Hermes Agent │
│  ┌───────┐  │  ┌───────┐  │  ┌───────┐  │  ┌───────┐   │
│  │ tmux  │  │  │ tmux  │  │  │ tmux  │  │  │ tmux  │   │
│  │session│  │  │session│  │  │session│  │  │session│   │
│  └───┬───┘  │  └───┬───┘  │  └───┬───┘  │  └───┬───┘   │
│      │      │      │      │      │      │      │       │
│  ┌───┴───┐  │  ┌───┴───┐  │  ┌───┴───┐  │  ┌───┴───┐   │
│  │  git  │  │  │  git  │  │  │  git  │  │  │  git  │   │
│  │worktree│ │  │worktree│ │  │worktree│ │  │worktree│  │
│  └───────┘  │  └───────┘  │  └───────┘  │  └───────┘   │
├─────────────┴─────────────┴─────────────┴──────────────┤
│           🧠 Self-Improving Intelligence Layer          │
│         (outcome tracking · skill graphs · routing)     │
├─────────────────────────────────────────────────────────┤
│        🔌 ACP/MCP Integration (Quick · Kiro · IDE)      │
└─────────────────────────────────────────────────────────┘
```

---

## ✨ Features

| | Feature | Description |
|---|---|---|
| 🧠 | **Self-Improving Intelligence** | Learns from task outcomes, builds skill graphs, improves routing over time |
| 🪟 | **Tmux Session Management** | Each agent runs in an isolated tmux session with full terminal access |
| 🌳 | **Git Worktree Isolation** | Parallel agents work on separate branches without conflicts |
| 🎯 | **Intelligent Task Routing** | Automatically assigns tasks to the best-suited agent based on history |
| 🔄 | **Hot-Swap Agents** | Switch between agents mid-task without losing context |
| 📡 | **ACP/MCP Native** | First-class integration with Amazon Quick Desktop, Kiro IDE, and MCP servers |
| 🎨 | **Rich TUI** | Beautiful terminal interface with real-time agent status and output |
| 📊 | **Performance Analytics** | Track agent success rates, completion times, and cost metrics |
| 🔒 | **Sandboxed Execution** | Agents run in isolated environments with configurable permissions |
| 🧩 | **Plugin Architecture** | Extend with custom agents, routers, and integrations |
| ⚡ | **Parallel Execution** | Run multiple agents simultaneously on different tasks |
| 🔁 | **Auto-Recovery** | Detects failures and automatically retries or re-routes to another agent |

---

## 🚀 Quick Start

### One-Line Install

```bash
curl -fsSL https://hermes-squad.dev/install.sh | bash
```

### Homebrew

```bash
brew tap barnsl/hermes-squad
brew install hermes-squad
```

### Manual Install

```bash
git clone https://github.com/barnsl/hermes-squad.git
cd hermes-squad
make install
```

### Verify Installation

```bash
hermes-squad --version
# Hermes Squad v0.1.0
```

### First Run

```bash
# Start the TUI
hermes-squad

# Or launch with a specific task
hermes-squad run "Refactor the auth module to use JWT tokens"

# Launch multiple agents in parallel
hermes-squad parallel \
  --agent claude-code "Write unit tests for auth" \
  --agent kiro "Update API documentation" \
  --agent gemini "Optimize database queries"
```

---

## 📸 Demo

<p align="center">
  <img src="docs/assets/demo.gif" alt="Hermes Squad Demo" width="800" />
</p>

> _Screenshot: Three agents working in parallel — Claude Code writing tests, Kiro updating docs, and Gemini optimizing queries._

<details>
<summary>📹 More Screenshots</summary>

| TUI Overview | Agent Detail | Performance Dashboard |
|:---:|:---:|:---:|
| ![TUI](docs/assets/tui-overview.png) | ![Agent](docs/assets/agent-detail.png) | ![Dashboard](docs/assets/dashboard.png) |

</details>

---

## ⚙️ Configuration

Hermes Squad uses a layered configuration system:

```
~/.config/hermes-squad/config.toml    # Global config
.hermes-squad/config.toml             # Project-level config
.hermes-squad/agents.toml             # Agent definitions
.hermes-squad/skills.toml             # Learned skill graphs
```

### Minimal Configuration

```toml
# ~/.config/hermes-squad/config.toml

[general]
default_agent = "claude-code"
parallel_limit = 4
auto_commit = true

[intelligence]
learning_enabled = true
skill_graph_path = "~/.config/hermes-squad/skills.db"
routing_strategy = "performance"  # "performance" | "cost" | "round-robin" | "manual"

[integrations.quick]
enabled = true
acp_endpoint = "localhost:7862"

[integrations.kiro]
enabled = true
acp_endpoint = "localhost:7863"

[tui]
theme = "dark"
show_metrics = true
split_view = "horizontal"
```

### Agent Configuration

```toml
# .hermes-squad/agents.toml

[[agent]]
name = "claude-code"
binary = "claude"
args = ["--dangerously-skip-permissions"]
max_concurrent = 2
cost_weight = 0.8
specialties = ["refactoring", "testing", "architecture"]

[[agent]]
name = "kiro"
binary = "kiro-cli"
args = ["--agent-mode"]
max_concurrent = 1
cost_weight = 0.3
specialties = ["documentation", "specs", "planning"]

[[agent]]
name = "hermes"
binary = "hermes-agent"
args = ["--self-improve"]
max_concurrent = 1
cost_weight = 0.5
specialties = ["reasoning", "multi-step", "research"]
```

---

## 🤖 Supported Agents

| Agent | Status | Specialties | Notes |
|:------|:------:|:------------|:------|
| [Claude Code](https://github.com/anthropics/claude-code) | ✅ Stable | Refactoring, Testing, Architecture | Primary agent, best all-rounder |
| [Kiro CLI](https://kiro.dev) | ✅ Stable | Documentation, Specs, Planning | Spec-driven development |
| [Codex](https://github.com/openai/codex) | ✅ Stable | Code generation, Completion | Fast for targeted edits |
| [Gemini CLI](https://github.com/google/gemini-cli) | ✅ Stable | Analysis, Optimization, Research | Strong on large codebases |
| [Hermes Agent](https://github.com/NousResearch/hermes-agent) | ✅ Stable | Reasoning, Multi-step, Self-improvement | Meta-cognition layer |
| [Aider](https://github.com/paul-gauthier/aider) | ✅ Stable | Pair programming, Git integration | Great for iterative changes |
| [OpenCode](https://github.com/opencode-ai/opencode) | 🧪 Beta | Terminal-native coding | Lightweight alternative |
| [Amp](https://github.com/sourcegraph/amp) | 🧪 Beta | Codebase search, Navigation | Excellent for exploration |

### Adding Custom Agents

```toml
[[agent]]
name = "my-custom-agent"
binary = "/path/to/agent"
args = ["--flag"]
prompt_file = ".hermes-squad/prompts/custom.md"
specialties = ["domain-specific"]
```

---

## 🔌 Integrations

### Amazon Quick Desktop (ACP)

Hermes Squad exposes an ACP server that Amazon Quick can connect to directly:

```toml
[integrations.quick]
enabled = true
acp_endpoint = "localhost:7862"
expose_tools = ["run_agent", "list_sessions", "get_status", "parallel_run"]
```

```bash
# Register with Quick Desktop
hermes-squad register --quick
```

### Kiro IDE (ACP)

Native integration with Kiro's agent protocol for IDE-embedded orchestration:

```toml
[integrations.kiro]
enabled = true
acp_endpoint = "localhost:7863"
workspace_sync = true
```

```bash
# Register with Kiro
hermes-squad register --kiro
```

### MCP Server

Expose Hermes Squad capabilities as an MCP server for any compatible client:

```bash
# Start MCP server
hermes-squad mcp serve --port 8080

# Or add to MCP config
```

```json
{
  "mcpServers": {
    "hermes-squad": {
      "command": "hermes-squad",
      "args": ["mcp", "serve"],
      "env": {
        "HERMES_SQUAD_CONFIG": "~/.config/hermes-squad/config.toml"
      }
    }
  }
}
```

### MCP Tools Exposed

| Tool | Description |
|:-----|:------------|
| `hermes_run` | Execute a task with intelligent agent routing |
| `hermes_parallel` | Run multiple tasks in parallel across agents |
| `hermes_status` | Get status of all active sessions |
| `hermes_history` | Query task history and outcomes |
| `hermes_learn` | Trigger learning from recent outcomes |
| `hermes_config` | View/update configuration |

---

## 📚 Documentation

| Document | Description |
|:---------|:------------|
| [Getting Started](docs/getting-started.md) | Installation and first steps |
| [Architecture](docs/architecture.md) | System design and internals |
| [Agent Guide](docs/agents.md) | Configuring and extending agents |
| [Intelligence Layer](docs/intelligence.md) | How self-improvement works |
| [ACP Integration](docs/acp.md) | Quick & Kiro integration guide |
| [MCP Server](docs/mcp.md) | MCP server reference |
| [CLI Reference](docs/cli.md) | Complete CLI documentation |
| [FAQ](docs/faq.md) | Frequently asked questions |
| [Troubleshooting](docs/troubleshooting.md) | Common issues and fixes |

---

## 🏗️ Project Structure

```
hermes-squad/
├── src/
│   ├── core/           # Core orchestration engine
│   ├── agents/         # Agent adapters and lifecycle
│   ├── intelligence/   # Self-improving ML layer
│   ├── session/        # Tmux session management
│   ├── git/            # Git worktree operations
│   ├── tui/            # Terminal UI (Ink/React)
│   ├── integrations/   # ACP/MCP connectors
│   └── cli/            # CLI entry point
├── tests/              # Test suites
├── docs/               # Documentation
├── scripts/            # Build and release scripts
├── .hermes-squad/      # Default project config
└── config/             # Default configuration templates
```

---

## 🤝 Contributing

We love contributions! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

```bash
# Development setup
git clone https://github.com/barnsl/hermes-squad.git
cd hermes-squad
make dev-setup
make dev       # Start in development mode
make test      # Run tests
make lint      # Check code style
```

---

## 📄 License

[MIT](LICENSE) © 2026 BarnsL

---

## 🙏 Credits

Hermes Squad stands on the shoulders of giants:

- **[Claude Squad](https://github.com/smtg-ai/claude-squad)** — Session management architecture and TUI inspiration
- **[Hermes Agent](https://github.com/NousResearch/hermes-agent)** — Self-improving intelligence and skill graph concepts
- **[Amazon Quick](https://quick.amazon.dev)** — ACP protocol and desktop integration
- **[Kiro](https://kiro.dev)** — IDE-native agent protocol and spec-driven development

---

<p align="center">
  <sub>Built with 🧠 by <a href="https://github.com/barnsl">BarnsL</a> — orchestrating the future of AI-assisted development</sub>
</p>

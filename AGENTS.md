# AGENTS.md — Agent Configuration Reference

This file serves as the primary context document for Hermes Squad's agent system. It defines how agents are configured, managed, and orchestrated.

---

## Agent Lifecycle

```
┌──────────┐     ┌──────────┐     ┌──────────┐     ┌──────────┐
│  IDLE    │────▶│ STARTING │────▶│  ACTIVE  │────▶│ COMPLETE │
└──────────┘     └──────────┘     └──────────┘     └──────────┘
                       │                │                 │
                       ▼                ▼                 ▼
                 ┌──────────┐     ┌──────────┐     ┌──────────┐
                 │  FAILED  │     │  PAUSED  │     │ ARCHIVED │
                 └──────────┘     └──────────┘     └──────────┘
```

### States

| State | Description |
|:------|:------------|
| `idle` | Agent adapter loaded, waiting for task assignment |
| `starting` | Tmux session being created, worktree being set up |
| `active` | Agent is executing, processing input/output |
| `paused` | Agent suspended, session preserved |
| `complete` | Task finished successfully, awaiting cleanup |
| `failed` | Agent encountered an unrecoverable error |
| `archived` | Session cleaned up, logs preserved |

---

## Built-in Agent Adapters

### Claude Code

```toml
[agent.claude-code]
binary = "claude"
args = ["--dangerously-skip-permissions"]
health_check = "claude --version"
prompt_prefix = ""
supports_streaming = true
supports_tool_use = true
max_context_tokens = 200000
cost_per_1k_input = 0.003
cost_per_1k_output = 0.015
specialties = [
  "refactoring",
  "testing",
  "architecture",
  "debugging",
  "code-review"
]
```

### Kiro CLI

```toml
[agent.kiro]
binary = "kiro-cli"
args = ["--agent-mode", "--no-telemetry"]
health_check = "kiro-cli --version"
prompt_prefix = ""
supports_streaming = true
supports_tool_use = true
max_context_tokens = 128000
cost_per_1k_input = 0.002
cost_per_1k_output = 0.010
specialties = [
  "documentation",
  "specifications",
  "planning",
  "design-docs",
  "requirements"
]
```

### Codex

```toml
[agent.codex]
binary = "codex"
args = ["--approval-mode", "auto"]
health_check = "codex --version"
prompt_prefix = ""
supports_streaming = true
supports_tool_use = true
max_context_tokens = 192000
cost_per_1k_input = 0.003
cost_per_1k_output = 0.012
specialties = [
  "code-generation",
  "completion",
  "quick-edits",
  "scripting"
]
```

### Gemini CLI

```toml
[agent.gemini-cli]
binary = "gemini"
args = []
health_check = "gemini --version"
prompt_prefix = ""
supports_streaming = true
supports_tool_use = true
max_context_tokens = 1000000
cost_per_1k_input = 0.001
cost_per_1k_output = 0.004
specialties = [
  "analysis",
  "optimization",
  "research",
  "large-codebase",
  "summarization"
]
```

### Hermes Agent

```toml
[agent.hermes]
binary = "hermes-agent"
args = ["--self-improve", "--skill-graph"]
health_check = "hermes-agent --version"
prompt_prefix = "You are a self-improving agent. Learn from outcomes."
supports_streaming = true
supports_tool_use = true
max_context_tokens = 128000
cost_per_1k_input = 0.002
cost_per_1k_output = 0.008
specialties = [
  "reasoning",
  "multi-step",
  "self-improvement",
  "meta-cognition",
  "research"
]
```

### Aider

```toml
[agent.aider]
binary = "aider"
args = ["--yes-always", "--no-auto-commits"]
health_check = "aider --version"
prompt_prefix = ""
supports_streaming = true
supports_tool_use = false
max_context_tokens = 128000
cost_per_1k_input = 0.003
cost_per_1k_output = 0.015
specialties = [
  "pair-programming",
  "iterative-changes",
  "git-integration",
  "file-editing"
]
```

### OpenCode

```toml
[agent.opencode]
binary = "opencode"
args = []
health_check = "opencode --version"
prompt_prefix = ""
supports_streaming = true
supports_tool_use = true
max_context_tokens = 128000
cost_per_1k_input = 0.002
cost_per_1k_output = 0.010
specialties = [
  "terminal-native",
  "lightweight",
  "quick-tasks"
]
```

### Amp

```toml
[agent.amp]
binary = "amp"
args = ["--non-interactive"]
health_check = "amp --version"
prompt_prefix = ""
supports_streaming = true
supports_tool_use = true
max_context_tokens = 128000
cost_per_1k_input = 0.003
cost_per_1k_output = 0.015
specialties = [
  "codebase-search",
  "navigation",
  "exploration",
  "understanding"
]
```

---

## Custom Agent Definition

To add a custom agent, create a TOML block in `.hermes-squad/agents.toml`:

```toml
[[agent]]
name = "my-agent"                    # Unique identifier
binary = "/path/to/binary"           # Executable path
args = ["--flag1", "--flag2"]        # CLI arguments
health_check = "my-agent --ping"    # Command to verify agent is available
prompt_prefix = "Custom system prompt prefix"
env = { MY_VAR = "value" }          # Additional environment variables

# Capabilities
supports_streaming = true
supports_tool_use = false
max_context_tokens = 64000

# Cost tracking
cost_per_1k_input = 0.001
cost_per_1k_output = 0.005

# Routing hints
specialties = ["domain-a", "domain-b"]
avoid = ["domain-c"]                 # Tasks to avoid routing here

# Resource limits
max_concurrent = 2                   # Max parallel instances
timeout_seconds = 3600               # Max execution time
max_retries = 2                      # Retry on failure

# Session configuration
[agent.session]
shell = "/bin/bash"
working_dir = "."                    # Relative to project root
env_file = ".env.agent"             # Load env vars from file
```

---

## Intelligence Layer Integration

The intelligence layer uses agent metadata for routing decisions:

### Skill Graph

Each agent builds a skill graph over time:

```
Agent: claude-code
├── refactoring (score: 0.94, n=127)
│   ├── extract-method (0.97, n=34)
│   ├── rename-symbol (0.99, n=45)
│   └── restructure-module (0.88, n=48)
├── testing (score: 0.91, n=89)
│   ├── unit-tests (0.95, n=56)
│   └── integration-tests (0.85, n=33)
└── debugging (score: 0.87, n=64)
    ├── null-reference (0.92, n=28)
    └── async-issues (0.81, n=36)
```

### Routing Strategy

```toml
[intelligence.routing]
strategy = "performance"     # Use skill scores
fallback = "round-robin"     # When no history exists
exploration_rate = 0.1       # 10% random assignment for learning
min_samples = 5              # Minimum tasks before trusting scores
```

---

## Session Management

### Tmux Configuration

Each agent session is created with:

```bash
tmux new-session -d -s "hermes-{agent}-{task-id}" -x 200 -y 50
```

### Worktree Setup

```bash
git worktree add .hermes-squad/worktrees/{task-id} -b hermes/{task-id}
```

### Cleanup

```bash
# On task completion
git worktree remove .hermes-squad/worktrees/{task-id}
tmux kill-session -t "hermes-{agent}-{task-id}"
```

---

## Environment Variables

| Variable | Description | Default |
|:---------|:------------|:--------|
| `HERMES_SQUAD_HOME` | Config directory | `~/.config/hermes-squad` |
| `HERMES_SQUAD_LOG_LEVEL` | Logging verbosity | `info` |
| `HERMES_SQUAD_PARALLEL_LIMIT` | Max concurrent agents | `4` |
| `HERMES_SQUAD_LEARNING` | Enable intelligence layer | `true` |
| `HERMES_SQUAD_TELEMETRY` | Anonymous usage stats | `false` |

---

## Conventions

- Agent names use kebab-case: `claude-code`, `gemini-cli`
- Task IDs are ULIDs: `01J5K3M7N9P2Q4R6S8T0V1W2X3`
- Branch names: `hermes/{task-id}` or `hermes/{agent}/{description}`
- Log files: `~/.config/hermes-squad/logs/{agent}/{task-id}.log`
- Skill DB: `~/.config/hermes-squad/skills.db` (SQLite)

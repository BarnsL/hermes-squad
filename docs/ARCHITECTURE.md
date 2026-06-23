# Architecture

> Complete system architecture for Hermes Squad — the unified multi-agent terminal manager with self-improving AI capabilities.

---

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              External Integrations                                │
│                                                                                   │
│  ┌──────────────────┐   ┌──────────────────┐   ┌──────────────────────────────┐ │
│  │  Amazon Quick    │   │    Kiro IDE/CLI   │   │   Other MCP Clients          │ │
│  │  Desktop         │   │                   │   │   (VS Code, custom)          │ │
│  │  ┌────────────┐  │   │  ┌────────────┐  │   │  ┌────────────┐             │ │
│  │  │ ACP Client │  │   │  │ ACP Client │  │   │  │ MCP Client │             │ │
│  │  └─────┬──────┘  │   │  └─────┬──────┘  │   │  └─────┬──────┘             │ │
│  └────────┼──────────┘   └────────┼──────────┘   └────────┼──────────────────┘ │
│           │ JSON-RPC/stdio        │ JSON-RPC/stdio         │ JSON-RPC/stdio      │
└───────────┼───────────────────────┼───────────────────────┼─────────────────────┘
            │                       │                       │
            ▼                       ▼                       ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           Hermes Squad Core                                       │
│                                                                                   │
│  ┌─────────────────────────────────────────────────────────────────────────────┐ │
│  │                        Protocol Adapters Layer                               │ │
│  │                                                                              │ │
│  │  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────────────┐ │ │
│  │  │  ACP Adapter    │  │  MCP Adapter    │  │  Gateway (HTTP/WS)          │ │ │
│  │  │  (JSON-RPC      │  │  (JSON-RPC      │  │  (REST API + WebSocket)     │ │ │
│  │  │   over stdio)   │  │   over stdio)   │  │                             │ │ │
│  │  └────────┬────────┘  └────────┬────────┘  └─────────────┬───────────────┘ │ │
│  └───────────┼─────────────────────┼─────────────────────────┼─────────────────┘ │
│              │                     │                         │                    │
│              ▼                     ▼                         ▼                    │
│  ┌─────────────────────────────────────────────────────────────────────────────┐ │
│  │                         Command Router                                       │ │
│  │         (dispatches requests to appropriate subsystem)                       │ │
│  └────────────┬──────────────────┬──────────────────────┬──────────────────────┘ │
│               │                  │                      │                        │
│    ┌──────────▼────────┐  ┌──────▼──────────┐  ┌───────▼──────────┐            │
│    │  Session Manager  │  │  Skills Engine  │  │  Memory System   │            │
│    │  (Go)             │  │  (Python)       │  │  (Python)        │            │
│    │                   │  │                 │  │                  │            │
│    │ • tmux sessions   │  │ • Skill CRUD   │  │ • Knowledge graph│            │
│    │ • git worktrees   │  │ • Improvement  │  │ • Episodic memory│            │
│    │ • agent lifecycle │  │ • Skill store  │  │ • Context window │            │
│    │ • diff management │  │ • Execution    │  │ • Embeddings     │            │
│    │ • auto-accept     │  │ • Cron jobs    │  │                  │            │
│    └──────────┬────────┘  └────────┬────────┘  └────────┬─────────┘            │
│               │                    │                     │                       │
│    ┌──────────▼────────────────────▼─────────────────────▼──────────────────┐   │
│    │                     Shared Infrastructure                                │   │
│    │                                                                          │   │
│    │  ┌─────────────┐  ┌─────────────┐  ┌──────────────┐  ┌──────────────┐ │   │
│    │  │   Config    │  │   Logger    │  │   Event Bus  │  │  File System │ │   │
│    │  │   Manager   │  │             │  │   (pub/sub)  │  │   Watcher    │ │   │
│    │  └─────────────┘  └─────────────┘  └──────────────┘  └──────────────┘ │   │
│    └──────────────────────────────────────────────────────────────────────────┘   │
│                                                                                   │
│  ┌─────────────────────────────────────────────────────────────────────────────┐ │
│  │                              TUI Layer (Go)                                  │ │
│  │                                                                              │ │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────┐│ │
│  │  │  Status  │  │  Session │  │   Diff   │  │   Skill  │  │    Config    ││ │
│  │  │  Panel   │  │  List    │  │  Preview │  │  Browser │  │    Editor   ││ │
│  │  └──────────┘  └──────────┘  └──────────┘  └──────────┘  └──────────────┘│ │
│  └─────────────────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## Component Architecture (Mermaid)

```mermaid
graph TB
    subgraph External["External Clients"]
        Quick["Amazon Quick Desktop"]
        Kiro["Kiro IDE/CLI"]
        MCPClient["MCP Clients"]
        SSH["Remote SSH"]
    end

    subgraph Adapters["Protocol Adapters"]
        ACP["ACP Adapter<br/>(JSON-RPC/stdio)"]
        MCP["MCP Server Adapter<br/>(JSON-RPC/stdio)"]
        GW["Gateway<br/>(HTTP/WebSocket)"]
        SSHSrv["SSH Server<br/>(-T no pty)"]
    end

    subgraph Core["Core Engine"]
        Router["Command Router"]
        SM["Session Manager<br/>(Go)"]
        SE["Skills Engine<br/>(Python)"]
        Mem["Memory System<br/>(Python)"]
        Cron["Cron Scheduler"]
    end

    subgraph Sessions["Session Layer"]
        Tmux["tmux Sessions"]
        Git["Git Worktrees"]
        Agent["Agent Processes"]
    end

    subgraph Storage["Persistence"]
        SkillStore["Skill Store<br/>(~/.hermes-squad/skills/)"]
        MemDB["Memory DB<br/>(SQLite + Embeddings)"]
        Config["Config Files<br/>(~/.hermes-squad/config.yaml)"]
        WorkDir["Work Directory<br/>(git worktrees)"]
    end

    Quick --> ACP
    Kiro --> ACP
    MCPClient --> MCP
    SSH --> SSHSrv

    ACP --> Router
    MCP --> Router
    GW --> Router
    SSHSrv --> Router

    Router --> SM
    Router --> SE
    Router --> Mem

    SM --> Tmux
    SM --> Git
    SM --> Agent

    SE --> SkillStore
    SE --> Cron
    Mem --> MemDB

    SM --> Config
    SE --> Config
```

---

## Data Flow

### 1. ACP Request Flow (Amazon Quick / Kiro)

```mermaid
sequenceDiagram
    participant Client as Quick Desktop / Kiro
    participant ACP as ACP Adapter
    participant Router as Command Router
    participant SM as Session Manager
    participant SE as Skills Engine
    participant Agent as Agent Process

    Client->>ACP: JSON-RPC Request (stdio)
    ACP->>ACP: Validate & parse message
    ACP->>Router: Dispatch command

    alt Session Command (new agent, list, status)
        Router->>SM: Create/query session
        SM->>SM: Allocate tmux + worktree
        SM->>Agent: Spawn agent process
        SM-->>Router: Session handle
    else Skill Command (execute, create, improve)
        Router->>SE: Execute skill
        SE->>SE: Load skill definition
        SE->>Agent: Execute in session context
        Agent-->>SE: Execution result
        SE->>SE: Update skill metrics
        SE-->>Router: Skill result
    end

    Router-->>ACP: JSON-RPC Response
    ACP-->>Client: Result (stdio)
```

### 2. Skill Improvement Loop

```mermaid
sequenceDiagram
    participant User as User/Client
    participant SE as Skills Engine
    participant Agent as Agent Process
    participant Store as Skill Store
    participant Mem as Memory System

    User->>SE: Execute task
    SE->>Store: Load relevant skills
    Store-->>SE: Skill definitions

    SE->>Agent: Execute with skills
    Agent-->>SE: Execution result + feedback

    alt Success
        SE->>SE: Evaluate improvement opportunity
        SE->>Store: Update skill (version++)
        SE->>Mem: Store execution context
    else Failure
        SE->>SE: Analyze failure
        SE->>Store: Create/improve skill
        SE->>Mem: Store failure context
    end

    SE-->>User: Result + skill status
```

### 3. Session Lifecycle

```mermaid
stateDiagram-v2
    [*] --> Created: hermes-squad new
    Created --> Running: Agent spawned
    Running --> Paused: User switches away
    Paused --> Running: User switches back
    Running --> Reviewing: Agent completes task
    Reviewing --> Merged: User approves diff
    Reviewing --> Running: User requests changes
    Merged --> [*]: Worktree cleaned up
    Running --> Terminated: User kills session
    Terminated --> [*]: Cleanup
```

---

## Component Details

### Session Manager (Go)

The Session Manager is the core orchestrator inherited from Claude Squad. It manages:

| Responsibility | Implementation |
|---------------|---------------|
| tmux sessions | `pkg/session/tmux.go` — Create, attach, detach, kill |
| Git worktrees | `pkg/session/worktree.go` — Create, switch, merge, cleanup |
| Agent lifecycle | `pkg/session/agent.go` — Spawn, monitor, restart |
| Auto-accept | `pkg/session/autoaccept.go` — File watcher + approval logic |
| Diff management | `pkg/session/diff.go` — Generate, display, apply |

```go
// Core session interface
type Session interface {
    ID() string
    Status() SessionStatus
    Agent() AgentProcess
    Worktree() *git.Worktree
    TmuxPane() *tmux.Pane
    Skills() []Skill
    Start(ctx context.Context) error
    Pause() error
    Resume() error
    Terminate() error
}
```

### Skills Engine (Python)

The Skills Engine is inherited from Hermes Agent. It provides:

| Responsibility | Implementation |
|---------------|---------------|
| Skill CRUD | `agent/skills/manager.py` — Create, read, update, delete |
| Execution | `agent/skills/executor.py` — Run skills in sandboxed context |
| Improvement | `agent/skills/improver.py` — Analyze and refine skills |
| Persistence | `agent/skills/store.py` — File-based skill storage |
| Cron | `agent/skills/cron.py` — Scheduled skill execution |

```python
# Core skill interface
class Skill:
    name: str
    version: int
    description: str
    instructions: str
    triggers: list[Trigger]
    metrics: SkillMetrics

    async def execute(self, context: ExecutionContext) -> SkillResult:
        ...

    async def improve(self, feedback: Feedback) -> 'Skill':
        ...
```

### Memory System (Python)

The Memory System provides cross-session persistence:

| Component | Purpose |
|-----------|---------|
| Knowledge Graph | Entity relationships, facts, structured knowledge |
| Episodic Memory | Past interactions, outcomes, context |
| Embedding Store | Semantic search over memories |
| Context Builder | Assembles relevant context for agent prompts |

### Protocol Adapters

#### ACP Adapter (Agent Client Protocol)

- **Transport**: JSON-RPC 2.0 over stdio
- **Registration**: "Coding Agents" in Quick Settings > Capabilities > MCP
- **Capabilities**: Task execution, session management, skill invocation
- **Auth**: Inherited from parent process (Quick/Kiro manages auth)

#### MCP Adapter (Model Context Protocol)

- **Transport**: JSON-RPC 2.0 over stdio
- **Tools exposed**: Session management, skill execution, memory queries
- **Resources**: Skill definitions, session states, diffs
- **Prompts**: Pre-built prompt templates for common tasks

#### Gateway (HTTP/WebSocket)

- **REST API**: Full CRUD for sessions, skills, config
- **WebSocket**: Real-time session output streaming
- **Auth**: Token-based (configurable)
- **Port**: Default 8765 (configurable)

---

## Directory Structure

```
hermes-squad/
├── cmd/                        # Go entrypoints
│   ├── hermes-squad/           # Main binary
│   └── hs-agent/              # Agent subprocess
├── pkg/                        # Go packages
│   ├── session/               # Session management
│   │   ├── tmux.go
│   │   ├── worktree.go
│   │   ├── agent.go
│   │   └── diff.go
│   ├── tui/                   # Terminal UI (Bubble Tea)
│   │   ├── app.go
│   │   ├── views/
│   │   └── components/
│   ├── protocol/              # Protocol adapters
│   │   ├── acp/
│   │   ├── mcp/
│   │   └── gateway/
│   └── config/                # Configuration
├── agent/                      # Python agent/skills
│   ├── skills/                # Skills engine
│   │   ├── manager.py
│   │   ├── executor.py
│   │   ├── improver.py
│   │   ├── store.py
│   │   └── cron.py
│   ├── memory/                # Memory system
│   │   ├── graph.py
│   │   ├── episodic.py
│   │   └── embeddings.py
│   └── gateway/               # HTTP/WS gateway
├── ts/                         # TypeScript components
│   └── mcp-server/           # MCP server implementation
├── docs/                       # Documentation (you are here)
├── configs/                    # Default configurations
├── scripts/                    # Build & utility scripts
├── Makefile
├── go.mod
├── pyproject.toml
└── package.json
```

---

## Technology Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| TUI | Go + Bubble Tea | Terminal user interface |
| Session Mgmt | Go + tmux + git | Process orchestration |
| Skills Engine | Python 3.11+ | Skill execution & improvement |
| Memory | Python + SQLite + FAISS | Persistent knowledge |
| Protocol | Go + Python | ACP/MCP/Gateway adapters |
| TypeScript | Node.js 20+ | MCP server, optional components |
| Build | Make + Go + pip | Build orchestration |

---

## Inter-Process Communication

The Go and Python components communicate via:

1. **Unix Domain Sockets** — Primary IPC for session ↔ skills engine
2. **Shared filesystem** — Skill definitions, memory DB, config
3. **Event bus** — Internal pub/sub for cross-component notifications

```
┌────────────────┐         UDS          ┌────────────────┐
│   Go Process   │◄────────────────────►│ Python Process │
│  (TUI + Sess.) │                      │ (Skills + Mem) │
└───────┬────────┘                      └───────┬────────┘
        │                                       │
        │         Shared Filesystem             │
        └──────────────┐    ┌───────────────────┘
                       │    │
                       ▼    ▼
              ~/.hermes-squad/
              ├── skills/
              ├── memory/
              ├── config.yaml
              └── sessions/
```

---

## Security Model

| Boundary | Protection |
|----------|-----------|
| Agent sandboxing | Each agent runs in isolated worktree with limited filesystem access |
| Auto-accept | Configurable file patterns, command allowlists |
| ACP/MCP | Stdio isolation — no network exposure by default |
| Gateway | Token auth, configurable CORS, rate limiting |
| Skills | Skill execution sandboxed, no arbitrary code unless explicitly allowed |
| Memory | Local-only by default, encrypted at rest option |

---

## See Also

- [Integration Guide](INTEGRATION-GUIDE.md) — How to connect to Quick/Kiro
- [Skills System](SKILLS-SYSTEM.md) — Deep dive into the skills engine
- [Session Management](SESSION-MANAGEMENT.md) — Session lifecycle details
- [Configuration](CONFIGURATION.md) — All configuration options

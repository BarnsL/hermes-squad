/**
 * ============================================================================
 * HERMES SQUAD — Session Manager
 * ============================================================================
 *
 * The SessionManager is the heart of Hermes Squad's multi-agent orchestration.
 * It manages the lifecycle of multiple concurrent AI agent sessions, each
 * running in an isolated pseudo-terminal with its own workspace.
 *
 * LINEAGE FROM CLAUDE SQUAD:
 * -------------------------
 * Claude Squad managed sessions via tmux — each agent ran in a tmux pane.
 * Hermes Squad replaces tmux with node-pty for cross-platform support and
 * tighter integration. The core concepts remain:
 *
 * 1. Each session = one AI agent in one isolated workspace
 * 2. Sessions can be attached/detached (view live output or background)
 * 3. Sessions track state: running, paused, completed, errored
 * 4. Multiple sessions can run concurrently (the "squad" pattern)
 *
 * HERMES DESKTOP ADDITIONS:
 * -------------------------
 * - Sessions emit structured events for the skills system to learn from
 * - Cross-session memory allows agents to share discoveries
 * - Sessions can be spawned programmatically via ACP/MCP (not just UI)
 * - Auto-pause when system resources are low
 *
 * INTEGRATION POINTS:
 * ------------------
 * - ACP Server: `spawn_session` RPC creates a new session and returns its ID
 * - MCP Server: `hermes_squad_spawn` tool wraps session creation
 * - Skills: After session completes, SkillManager analyzes output for learnings
 * - Memory: Session transcripts are indexed for future retrieval
 *
 * CONFIGURATION:
 * -------------
 * - maxConcurrentSessions: Limit parallel sessions (default: 5)
 * - defaultShell: Shell for agent execution (default: user's $SHELL)
 * - outputBufferSize: Lines of output to retain per session (default: 10000)
 * - autoCleanup: Remove completed session data after N hours (default: 24)
 */

import { EventEmitter } from 'eventemitter3';
import * as pty from 'node-pty';
import { nanoid } from 'nanoid';
import type { Logger } from 'pino';

import type { AgentRegistry, AgentConfig } from './agent-registry.js';
import type { WorkspaceIsolator, IsolatedWorkspace } from './workspace-isolator.js';
import type { HermesSquadEvents } from '../main.js';

// ─── Types ──────────────────────────────────────────────────────────────────

/** Status lifecycle of a session */
export type SessionStatus = 'initializing' | 'running' | 'paused' | 'completed' | 'errored';

/**
 * Complete information about a session, as returned by list/get operations.
 */
export interface SessionInfo {
  /** Unique session identifier */
  id: string;
  /** Human-readable session name */
  name: string;
  /** Which agent is running in this session */
  agentId: string;
  /** Current lifecycle status */
  status: SessionStatus;
  /** The task/prompt that initiated this session */
  task?: string;
  /** Git branch associated with this session's workspace */
  branch?: string;
  /** Creation timestamp */
  createdAt: Date;
  /** Last activity timestamp */
  lastActivityAt: Date;
  /** Working directory for this session */
  workingDir: string;
  /** Exit code if completed/errored */
  exitCode?: number;
}

/**
 * Options for creating a new session.
 */
export interface CreateSessionOptions {
  /** Agent to use (must be registered in AgentRegistry) */
  agentId: string;
  /** Session display name (auto-generated if omitted) */
  name?: string;
  /** Initial task/prompt to send to the agent */
  task?: string;
  /** Repository to clone/worktree into the isolated workspace */
  repoPath?: string;
  /** Specific branch name for the workspace */
  branch?: string;
  /** Environment variables to inject into the session */
  env?: Record<string, string>;
  /** Working directory override (defaults to isolated workspace) */
  cwd?: string;
}

/**
 * Internal session state — tracks the pty process and output buffer.
 */
interface SessionState {
  info: SessionInfo;
  pty: pty.IPty | null;
  workspace: IsolatedWorkspace | null;
  outputBuffer: string[];
  outputBufferSize: number;
}

// ─── Session Manager ────────────────────────────────────────────────────────

/**
 * Manages the lifecycle of multiple concurrent AI agent sessions.
 *
 * @example
 * ```typescript
 * const session = await sessionManager.createSession({
 *   agentId: 'claude-code',
 *   task: 'Refactor the auth module to use JWT',
 *   repoPath: '/path/to/project',
 * });
 * console.log(session.id); // 'sess_abc123'
 * ```
 */
export class SessionManager {
  private readonly sessions: Map<string, SessionState> = new Map();
  private readonly agentRegistry: AgentRegistry;
  private readonly workspaceIsolator: WorkspaceIsolator;
  private readonly bus: EventEmitter<HermesSquadEvents>;
  private readonly logger: Logger;

  /** Maximum concurrent sessions (resource protection) */
  private readonly maxConcurrentSessions: number;

  /** Default shell for spawning agent processes */
  private readonly defaultShell: string;

  /** Lines of output to retain per session */
  private readonly outputBufferSize: number;

  constructor(
    agentRegistry: AgentRegistry,
    workspaceIsolator: WorkspaceIsolator,
    bus: EventEmitter<HermesSquadEvents>,
    logger: Logger,
    options?: {
      maxConcurrentSessions?: number;
      defaultShell?: string;
      outputBufferSize?: number;
    }
  ) {
    this.agentRegistry = agentRegistry;
    this.workspaceIsolator = workspaceIsolator;
    this.bus = bus;
    this.logger = logger.child({ module: 'SessionManager' });

    this.maxConcurrentSessions = options?.maxConcurrentSessions ?? 5;
    this.defaultShell = options?.defaultShell ?? process.env.SHELL ?? '/bin/bash';
    this.outputBufferSize = options?.outputBufferSize ?? 10000;
  }

  // ─── Public API ───────────────────────────────────────────────────────────

  /**
   * Create a new agent session with an isolated workspace.
   *
   * This performs the following steps:
   * 1. Validate the agent exists in the registry
   * 2. Create an isolated workspace (git worktree or temp dir)
   * 3. Spawn a pseudo-terminal with the agent's launch command
   * 4. Begin capturing output
   * 5. Emit 'session:created' event
   *
   * @param options - Session creation options
   * @returns The created session info
   * @throws If max concurrent sessions reached or agent not found
   *
   * @example
   * ```typescript
   * const session = await manager.createSession({
   *   agentId: 'kiro',
   *   task: 'Add unit tests for the payment service',
   *   repoPath: '/home/user/my-project',
   *   branch: 'feat/payment-tests',
   * });
   * ```
   */
  async createSession(options: CreateSessionOptions): Promise<SessionInfo> {
    // Guard: max concurrent sessions
    const activeSessions = this.getActiveSessions();
    if (activeSessions.length >= this.maxConcurrentSessions) {
      throw new Error(
        `Maximum concurrent sessions (${this.maxConcurrentSessions}) reached. ` +
        `Terminate a session before creating a new one.`
      );
    }

    // Resolve agent configuration
    const agent = this.agentRegistry.getAgent(options.agentId);
    if (!agent) {
      throw new Error(`Agent '${options.agentId}' not found in registry. Available: ${
        this.agentRegistry.listAgents().map(a => a.id).join(', ')
      }`);
    }

    const sessionId = `sess_${nanoid(12)}`;
    const sessionName = options.name ?? `${agent.name}-${sessionId.slice(5, 11)}`;

    this.logger.info({ sessionId, agentId: options.agentId, task: options.task }, 'Creating session');

    // Create isolated workspace
    let workspace: IsolatedWorkspace | null = null;
    let workingDir = options.cwd ?? process.cwd();

    if (options.repoPath) {
      workspace = await this.workspaceIsolator.createWorkspace({
        sessionId,
        repoPath: options.repoPath,
        branch: options.branch ?? `hermes-squad/${sessionName}`,
      });
      workingDir = workspace.path;
    }

    // Build session info
    const info: SessionInfo = {
      id: sessionId,
      name: sessionName,
      agentId: options.agentId,
      status: 'initializing',
      task: options.task,
      branch: options.branch,
      createdAt: new Date(),
      lastActivityAt: new Date(),
      workingDir,
    };

    // Spawn the agent process in a pseudo-terminal
    const agentCommand = this.buildAgentCommand(agent, options);
    const ptyProcess = pty.spawn(this.defaultShell, ['-c', agentCommand], {
      name: 'xterm-256color',
      cols: 120,
      rows: 40,
      cwd: workingDir,
      env: {
        ...process.env,
        ...agent.env,
        ...options.env,
        HERMES_SQUAD_SESSION_ID: sessionId,
        HERMES_SQUAD_AGENT: options.agentId,
      } as Record<string, string>,
    });

    // Create internal state
    const state: SessionState = {
      info,
      pty: ptyProcess,
      workspace,
      outputBuffer: [],
      outputBufferSize: this.outputBufferSize,
    };

    // Wire up output capture
    ptyProcess.onData((data: string) => {
      state.info.lastActivityAt = new Date();
      this.appendOutput(state, data);
      this.bus.emit('session:output', sessionId, data);
    });

    // Handle process exit
    ptyProcess.onExit(({ exitCode }) => {
      state.info.status = exitCode === 0 ? 'completed' : 'errored';
      state.info.exitCode = exitCode;
      this.logger.info({ sessionId, exitCode }, 'Session process exited');
    });

    // Transition to running
    state.info.status = 'running';
    this.sessions.set(sessionId, state);

    // If there's an initial task, send it to the agent
    if (options.task) {
      // Small delay to let the agent initialize
      setTimeout(() => {
        this.sendInput(sessionId, options.task! + '\n');
      }, 1000);
    }

    this.bus.emit('session:created', sessionId);
    this.logger.info({ sessionId, name: sessionName }, 'Session created and running');

    return info;
  }

  /**
   * List all sessions (active and completed).
   */
  listSessions(): SessionInfo[] {
    return Array.from(this.sessions.values()).map((s) => ({ ...s.info }));
  }

  /**
   * Get detailed info for a specific session.
   */
  getSession(sessionId: string): SessionInfo | null {
    return this.sessions.get(sessionId)?.info ?? null;
  }

  /**
   * Get the buffered output for a session (for preview display).
   */
  getSessionOutput(sessionId: string): string {
    const state = this.sessions.get(sessionId);
    if (!state) return '';
    return state.outputBuffer.join('');
  }

  /**
   * Send input (keystrokes) to a session's terminal.
   * Used when the user "attaches" to a session and types.
   */
  sendInput(sessionId: string, data: string): void {
    const state = this.sessions.get(sessionId);
    if (!state?.pty) {
      this.logger.warn({ sessionId }, 'Cannot send input — session not running');
      return;
    }
    state.pty.write(data);
  }

  /**
   * Attach to a session — makes it the active foreground session.
   * In TUI mode, this means fullscreen terminal view.
   * In Electron mode, this focuses the session's terminal panel.
   */
  async attachSession(sessionId: string): Promise<void> {
    const state = this.sessions.get(sessionId);
    if (!state) throw new Error(`Session '${sessionId}' not found`);
    this.logger.debug({ sessionId }, 'Attached to session');
    // The actual UI attachment is handled by the TUI/Electron layer
    // This method exists for the protocol interface
  }

  /**
   * Pause a running session (send SIGSTOP to the process group).
   * The session remains in memory but stops executing.
   *
   * This maps to Claude Squad's "background" behavior where sessions
   * could be paused to free system resources.
   */
  async pauseSession(sessionId: string): Promise<void> {
    const state = this.sessions.get(sessionId);
    if (!state || state.info.status !== 'running') return;

    state.info.status = 'paused';
    // Send Ctrl+Z equivalent to pause the foreground process
    state.pty?.write('\x1a');
    this.logger.info({ sessionId }, 'Session paused');
  }

  /**
   * Resume a paused session (send SIGCONT).
   */
  async resumeSession(sessionId: string): Promise<void> {
    const state = this.sessions.get(sessionId);
    if (!state || state.info.status !== 'paused') return;

    state.info.status = 'running';
    // Send 'fg' command to resume
    state.pty?.write('fg\n');
    this.logger.info({ sessionId }, 'Session resumed');
  }

  /**
   * Terminate a session — kills the process and cleans up workspace.
   */
  async terminateSession(sessionId: string): Promise<void> {
    const state = this.sessions.get(sessionId);
    if (!state) return;

    this.logger.info({ sessionId }, 'Terminating session');

    // Kill the pty process
    if (state.pty) {
      state.pty.kill();
      state.pty = null;
    }

    // Clean up workspace
    if (state.workspace) {
      await this.workspaceIsolator.cleanupWorkspace(state.workspace);
    }

    state.info.status = 'completed';
    this.bus.emit('session:terminated', sessionId);
  }

  /**
   * Terminate all active sessions — used during shutdown.
   */
  async terminateAll(): Promise<void> {
    const activeSessions = this.getActiveSessions();
    await Promise.all(activeSessions.map((s) => this.terminateSession(s.id)));
    this.logger.info({ count: activeSessions.length }, 'All sessions terminated');
  }

  /**
   * Resize terminal dimensions for a session (e.g., when window resizes).
   */
  resizeSession(sessionId: string, cols: number, rows: number): void {
    const state = this.sessions.get(sessionId);
    if (state?.pty) {
      state.pty.resize(cols, rows);
    }
  }

  // ─── Private Helpers ──────────────────────────────────────────────────────

  /**
   * Build the shell command to launch an agent.
   *
   * Each agent type has its own CLI invocation:
   * - Claude Code: `claude --task "..." --workspace /path`
   * - Kiro: `kiro agent --task "..."`
   * - Codex: `codex --task "..."`
   * - Hermes: `hermes-agent run --skill "..."`
   * - Gemini: `gemini-cli --task "..."`
   * - Aider: `aider --message "..."`
   */
  private buildAgentCommand(agent: AgentConfig, options: CreateSessionOptions): string {
    const task = options.task ? `"${options.task.replace(/"/g, '\\"')}"` : '';

    // Use the agent's command template, substituting placeholders
    let command = agent.command;
    command = command.replace('{{TASK}}', task);
    command = command.replace('{{WORKSPACE}}', options.cwd ?? '.');
    command = command.replace('{{BRANCH}}', options.branch ?? 'main');

    return command;
  }

  /**
   * Append output to the ring buffer, respecting the max size.
   */
  private appendOutput(state: SessionState, data: string): void {
    state.outputBuffer.push(data);

    // Trim buffer if it exceeds max size (ring buffer behavior)
    while (state.outputBuffer.length > state.outputBufferSize) {
      state.outputBuffer.shift();
    }
  }

  /**
   * Get only active (running or paused) sessions.
   */
  private getActiveSessions(): SessionInfo[] {
    return Array.from(this.sessions.values())
      .filter((s) => s.info.status === 'running' || s.info.status === 'paused')
      .map((s) => s.info);
  }
}

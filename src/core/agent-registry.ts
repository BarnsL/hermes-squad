/**
 * ============================================================================
 * HERMES SQUAD — Agent Registry
 * ============================================================================
 *
 * The AgentRegistry maintains the catalog of all supported AI coding agents
 * that Hermes Squad can orchestrate. Each agent has a defined interface for
 * how to launch it, what capabilities it has, and how to communicate with it.
 *
 * SUPPORTED AGENTS:
 * ----------------
 * Built-in agents (ship with Hermes Squad):
 * - Claude Code   — Anthropic's terminal coding agent
 * - Kiro          — Amazon's AI IDE agent (via ACP or CLI)
 * - Codex         — OpenAI's coding agent (CLI mode)
 * - Gemini CLI    — Google's Gemini coding agent
 * - Hermes Agent  — Hermes Squad's own self-improving agent
 * - Aider         — Open-source AI pair programming tool
 *
 * Custom agents can be registered via:
 * - Config file (~/.hermes-squad/agents.yaml)
 * - ACP discovery (agents announce themselves on the network)
 * - Runtime registration API
 *
 * LINEAGE:
 * --------
 * Claude Squad supported only Claude Code (it was in the name!).
 * Hermes Squad generalizes this to any agent with a CLI or ACP interface.
 * The registry pattern is inspired by Hermes Desktop's plugin system.
 *
 * INTEGRATION POINTS:
 * ------------------
 * - ACP Client: Can discover agents that expose ACP endpoints
 * - SessionManager: Queries the registry to build launch commands
 * - MCP Server: Exposes `list_agents` as a tool for Quick
 * - Skill System: Different agents excel at different tasks — skills
 *   can specify preferred agents
 *
 * CONFIGURATION:
 * -------------
 * Agents are defined in ~/.hermes-squad/agents.yaml:
 * ```yaml
 * agents:
 *   - id: my-custom-agent
 *     name: My Custom Agent
 *     command: my-agent --task "{{TASK}}"
 *     capabilities: [code, test, refactor]
 * ```
 */

import type { Logger } from 'pino';

// ─── Types ──────────────────────────────────────────────────────────────────

/**
 * Capabilities that an agent may support.
 * Used for intelligent routing — skills can specify required capabilities.
 */
export type AgentCapability =
  | 'code'           // Can write/edit code
  | 'test'           // Can write and run tests
  | 'refactor'       // Can restructure existing code
  | 'review'         // Can review code and provide feedback
  | 'debug'          // Can debug issues
  | 'document'       // Can write documentation
  | 'architect'      // Can design system architecture
  | 'deploy'         // Can handle deployment tasks
  | 'research'       // Can research and synthesize information
  | 'multi-file'     // Can work across multiple files
  | 'terminal'       // Can execute terminal commands
  | 'web-browse'     // Can browse the web for information
  | 'self-improve'   // Can learn from interactions (Hermes-specific)
  | 'acp-native';    // Supports ACP protocol natively

/**
 * Communication protocol for interacting with the agent.
 */
export type AgentProtocol =
  | 'cli'      // Launched as a CLI process with stdin/stdout
  | 'acp'      // Communicates via Agent Client Protocol (JSON-RPC)
  | 'http'     // REST API-based agent
  | 'stdio';   // Direct stdio pipe (MCP-style)

/**
 * Full configuration for a registered agent.
 */
export interface AgentConfig {
  /** Unique identifier for this agent */
  id: string;
  /** Display name */
  name: string;
  /** Emoji icon for UI display */
  icon: string;
  /** Short description */
  description: string;
  /** Shell command template to launch the agent.
   *  Supports placeholders: {{TASK}}, {{WORKSPACE}}, {{BRANCH}}
   */
  command: string;
  /** Communication protocol */
  protocol: AgentProtocol;
  /** ACP endpoint URL (if protocol is 'acp') */
  acpEndpoint?: string;
  /** Agent capabilities for intelligent routing */
  capabilities: AgentCapability[];
  /** Environment variables to set when launching */
  env?: Record<string, string>;
  /** Maximum concurrent sessions for this agent type */
  maxConcurrency?: number;
  /** Whether this agent is currently available (installed, reachable) */
  available: boolean;
  /** How to check if the agent is installed/available */
  healthCheck?: string;
  /** Cost tier (for resource-aware scheduling) */
  costTier?: 'free' | 'low' | 'medium' | 'high';
  /** Model being used (for display/tracking) */
  model?: string;
}

/**
 * Options for registering a custom agent.
 */
export interface RegisterAgentOptions {
  id: string;
  name: string;
  icon?: string;
  description?: string;
  command: string;
  protocol?: AgentProtocol;
  acpEndpoint?: string;
  capabilities?: AgentCapability[];
  env?: Record<string, string>;
  healthCheck?: string;
  costTier?: AgentConfig['costTier'];
  model?: string;
}

// ─── Agent Registry ─────────────────────────────────────────────────────────

/**
 * Registry of available AI coding agents.
 *
 * Provides discovery, validation, and routing capabilities for the
 * session manager and skill system.
 *
 * @example
 * ```typescript
 * const registry = new AgentRegistry(logger);
 * const agents = registry.listAgents();
 * const bestAgent = registry.findAgentForCapabilities(['code', 'test']);
 * ```
 */
export class AgentRegistry {
  private readonly agents: Map<string, AgentConfig> = new Map();
  private readonly logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger.child({ module: 'AgentRegistry' });
    this.registerBuiltinAgents();
  }

  // ─── Public API ───────────────────────────────────────────────────────────

  /**
   * Get all registered agents.
   */
  listAgents(): AgentConfig[] {
    return Array.from(this.agents.values());
  }

  /**
   * Get only agents that are currently available (installed/reachable).
   */
  listAvailableAgents(): AgentConfig[] {
    return this.listAgents().filter((a) => a.available);
  }

  /**
   * Get a specific agent by ID.
   */
  getAgent(id: string): AgentConfig | null {
    return this.agents.get(id) ?? null;
  }

  /**
   * Register a custom agent at runtime.
   *
   * @example
   * ```typescript
   * registry.registerAgent({
   *   id: 'cursor-agent',
   *   name: 'Cursor',
   *   command: 'cursor-cli --task "{{TASK}}"',
   *   capabilities: ['code', 'multi-file'],
   * });
   * ```
   */
  registerAgent(options: RegisterAgentOptions): AgentConfig {
    const config: AgentConfig = {
      id: options.id,
      name: options.name,
      icon: options.icon ?? '🤖',
      description: options.description ?? `Custom agent: ${options.name}`,
      command: options.command,
      protocol: options.protocol ?? 'cli',
      acpEndpoint: options.acpEndpoint,
      capabilities: options.capabilities ?? ['code'],
      env: options.env,
      maxConcurrency: 3,
      available: true, // Assume available until health check fails
      healthCheck: options.healthCheck,
      costTier: options.costTier ?? 'medium',
      model: options.model,
    };

    this.agents.set(config.id, config);
    this.logger.info({ agentId: config.id, name: config.name }, 'Agent registered');
    return config;
  }

  /**
   * Unregister an agent (e.g., when it becomes unavailable).
   */
  unregisterAgent(id: string): boolean {
    const deleted = this.agents.delete(id);
    if (deleted) {
      this.logger.info({ agentId: id }, 'Agent unregistered');
    }
    return deleted;
  }

  /**
   * Find the best agent for a given set of required capabilities.
   *
   * Scoring algorithm:
   * 1. Filter to agents that have ALL required capabilities
   * 2. Prefer agents with more matching capabilities (versatility)
   * 3. Prefer lower cost tier
   * 4. Prefer currently available agents
   *
   * This is used by the skill system to auto-select agents for tasks.
   *
   * @param requiredCapabilities - Capabilities the agent must have
   * @param preferredAgent - If set, prefer this agent (user preference)
   * @returns Best matching agent, or null if none qualify
   */
  findAgentForCapabilities(
    requiredCapabilities: AgentCapability[],
    preferredAgent?: string
  ): AgentConfig | null {
    // If a specific agent is preferred and it qualifies, use it
    if (preferredAgent) {
      const preferred = this.agents.get(preferredAgent);
      if (preferred?.available && this.hasAllCapabilities(preferred, requiredCapabilities)) {
        return preferred;
      }
    }

    // Score all available agents
    const candidates = this.listAvailableAgents()
      .filter((agent) => this.hasAllCapabilities(agent, requiredCapabilities))
      .map((agent) => ({
        agent,
        score: this.scoreAgent(agent, requiredCapabilities),
      }))
      .sort((a, b) => b.score - a.score);

    return candidates[0]?.agent ?? null;
  }

  /**
   * Check health/availability of all registered agents.
   * Runs each agent's healthCheck command and updates availability.
   */
  async checkHealth(): Promise<Map<string, boolean>> {
    const results = new Map<string, boolean>();

    for (const [id, agent] of this.agents) {
      if (!agent.healthCheck) {
        results.set(id, true); // No health check = assume available
        continue;
      }

      try {
        // Execute health check command (e.g., "which claude" or "kiro --version")
        const { execSync } = await import('child_process');
        execSync(agent.healthCheck, { timeout: 5000, stdio: 'ignore' });
        agent.available = true;
        results.set(id, true);
      } catch {
        agent.available = false;
        results.set(id, false);
        this.logger.debug({ agentId: id }, 'Agent health check failed');
      }
    }

    return results;
  }

  // ─── Private Helpers ──────────────────────────────────────────────────────

  /**
   * Register all built-in agents that ship with Hermes Squad.
   */
  private registerBuiltinAgents(): void {
    // ─── Claude Code ────────────────────────────────────────────────────
    this.agents.set('claude-code', {
      id: 'claude-code',
      name: 'Claude Code',
      icon: '🟣',
      description: 'Anthropic Claude Code — terminal-native AI coding agent with deep reasoning',
      command: 'claude --print --task {{TASK}}',
      protocol: 'cli',
      capabilities: ['code', 'test', 'refactor', 'review', 'debug', 'document', 'architect', 'multi-file', 'terminal'],
      env: {},
      maxConcurrency: 3,
      available: true,
      healthCheck: 'which claude',
      costTier: 'high',
      model: 'claude-sonnet-4-20250514',
    });

    // ─── Kiro ───────────────────────────────────────────────────────────
    // Kiro supports both CLI and ACP. When available via ACP (e.g., running
    // in Kiro IDE), we prefer ACP for richer communication. CLI fallback
    // for standalone terminal usage.
    this.agents.set('kiro', {
      id: 'kiro',
      name: 'Kiro',
      icon: '🔵',
      description: 'Amazon Kiro — spec-driven AI development agent with hooks and steering',
      command: 'kiro agent --task {{TASK}} --workspace {{WORKSPACE}}',
      protocol: 'acp',
      acpEndpoint: 'http://localhost:7436/acp', // Default Kiro ACP port
      capabilities: ['code', 'test', 'refactor', 'architect', 'multi-file', 'terminal', 'acp-native'],
      env: {},
      maxConcurrency: 2,
      available: true,
      healthCheck: 'which kiro',
      costTier: 'medium',
      model: 'claude-sonnet-4-20250514',
    });

    // ─── OpenAI Codex ───────────────────────────────────────────────────
    this.agents.set('codex', {
      id: 'codex',
      name: 'Codex',
      icon: '🟢',
      description: 'OpenAI Codex — fast coding agent optimized for code generation',
      command: 'codex --task {{TASK}} --cwd {{WORKSPACE}}',
      protocol: 'cli',
      capabilities: ['code', 'test', 'refactor', 'multi-file', 'terminal'],
      env: {},
      maxConcurrency: 3,
      available: true,
      healthCheck: 'which codex',
      costTier: 'medium',
      model: 'codex-mini-latest',
    });

    // ─── Gemini CLI ─────────────────────────────────────────────────────
    this.agents.set('gemini', {
      id: 'gemini',
      name: 'Gemini CLI',
      icon: '🔴',
      description: 'Google Gemini CLI — multimodal coding with large context window',
      command: 'gemini --task {{TASK}}',
      protocol: 'cli',
      capabilities: ['code', 'test', 'refactor', 'review', 'research', 'multi-file', 'web-browse'],
      env: {},
      maxConcurrency: 3,
      available: true,
      healthCheck: 'which gemini',
      costTier: 'medium',
      model: 'gemini-2.5-pro',
    });

    // ─── Hermes Agent ───────────────────────────────────────────────────
    // This is Hermes Squad's own internal agent — it uses the skills system
    // and memory engine directly, providing self-improving capabilities.
    this.agents.set('hermes', {
      id: 'hermes',
      name: 'Hermes Agent',
      icon: '⚡',
      description: 'Hermes Squad native agent — self-improving with skills and memory',
      command: 'hermes-squad agent --task {{TASK}} --workspace {{WORKSPACE}}',
      protocol: 'stdio',
      capabilities: ['code', 'test', 'refactor', 'review', 'debug', 'document', 'architect',
                     'multi-file', 'terminal', 'research', 'self-improve'],
      env: {},
      maxConcurrency: 5,
      available: true,
      healthCheck: 'hermes-squad --version',
      costTier: 'low', // Uses local skills when possible
      model: 'multi-model',
    });

    // ─── Aider ──────────────────────────────────────────────────────────
    this.agents.set('aider', {
      id: 'aider',
      name: 'Aider',
      icon: '🟡',
      description: 'Aider — open-source AI pair programming in your terminal',
      command: 'aider --message {{TASK}} --yes',
      protocol: 'cli',
      capabilities: ['code', 'test', 'refactor', 'multi-file', 'terminal'],
      env: {},
      maxConcurrency: 3,
      available: true,
      healthCheck: 'which aider',
      costTier: 'medium',
      model: 'configurable',
    });

    this.logger.info(
      { count: this.agents.size },
      'Built-in agents registered'
    );
  }

  /**
   * Check if an agent has all the required capabilities.
   */
  private hasAllCapabilities(agent: AgentConfig, required: AgentCapability[]): boolean {
    return required.every((cap) => agent.capabilities.includes(cap));
  }

  /**
   * Score an agent for capability matching.
   * Higher score = better match.
   */
  private scoreAgent(agent: AgentConfig, required: AgentCapability[]): number {
    let score = 0;

    // Base score: number of matching capabilities
    score += agent.capabilities.filter((c) => required.includes(c)).length * 10;

    // Bonus for versatility (more total capabilities)
    score += agent.capabilities.length;

    // Cost preference (lower cost = higher score)
    const costScores: Record<string, number> = { free: 20, low: 15, medium: 10, high: 5 };
    score += costScores[agent.costTier ?? 'medium'] ?? 10;

    // Availability is critical
    if (!agent.available) score = -1000;

    return score;
  }
}

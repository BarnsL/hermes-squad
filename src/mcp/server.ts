/**
 * ============================================================================
 * HERMES SQUAD — MCP Server (Model Context Protocol)
 * ============================================================================
 *
 * The MCP Server exposes Hermes Squad's capabilities as tools that can be
 * invoked by any MCP-compatible host — primarily Amazon Quick Desktop.
 *
 * WHAT IS MCP?
 * -----------
 * Model Context Protocol (MCP) is a standard for AI applications to expose
 * tools, resources, and prompts to LLM hosts. Unlike ACP (agent-to-agent),
 * MCP is tool-oriented: the host LLM decides WHEN to call tools, and the
 * MCP server provides the tool implementations.
 *
 * HOW QUICK USES THIS:
 * -------------------
 * When Hermes Squad is registered as an MCP server in Quick Desktop's
 * configuration, Quick's agent can invoke Hermes Squad tools directly:
 *
 * - "Spawn a Claude Code session to fix this bug" → calls `hermes_spawn_agent`
 * - "What did my last coding session accomplish?" → calls `hermes_query_memory`
 * - "Run the test-generation skill" → calls `hermes_run_skill`
 * - "List running agent sessions" → calls `hermes_list_sessions`
 *
 * This means Quick doesn't need to use ACP for simple operations — it can
 * call Hermes Squad tools the same way it calls any MCP tool.
 *
 * MCP vs ACP:
 * ----------
 * - MCP: Tool-level integration. Quick calls individual tools.
 *   Best for: discrete operations, queries, simple spawns.
 * - ACP: Agent-level integration. Quick delegates an entire task.
 *   Best for: complex multi-step workflows, long-running tasks.
 *
 * Both can be active simultaneously. The user experience is seamless.
 *
 * TRANSPORT:
 * ---------
 * MCP supports two transports:
 * - stdio: Process launched by the host, communicates via stdin/stdout
 * - SSE: HTTP Server-Sent Events for remote/persistent connections
 *
 * Hermes Squad supports both. stdio is the default for local Quick Desktop
 * integration. SSE is used for remote/multi-machine setups.
 *
 * TOOLS EXPOSED:
 * -------------
 * - hermes_spawn_agent: Spawn a new agent session
 * - hermes_list_sessions: List all active/recent sessions
 * - hermes_get_session_output: Get output from a session
 * - hermes_terminate_session: Stop a running session
 * - hermes_run_skill: Execute a learned skill
 * - hermes_list_skills: List available skills
 * - hermes_query_memory: Search cross-session memory
 * - hermes_store_memory: Store a new memory entry
 * - hermes_list_agents: List available AI agents
 *
 * CONFIGURATION:
 * -------------
 * In Quick Desktop's MCP settings (or claude_desktop_config.json):
 * ```json
 * {
 *   "mcpServers": {
 *     "hermes-squad": {
 *       "command": "hermes-squad",
 *       "args": ["--mcp"],
 *       "env": {}
 *     }
 *   }
 * }
 * ```
 *
 * Or for SSE transport:
 * ```json
 * {
 *   "mcpServers": {
 *     "hermes-squad": {
 *       "transport": "sse",
 *       "url": "http://localhost:7437/mcp/sse"
 *     }
 *   }
 * }
 * ```
 */

import { z } from 'zod';
import type { Logger } from 'pino';

import type { SessionManager, CreateSessionOptions } from '../core/session-manager.js';
import type { SkillManager } from '../skills/skill-manager.js';
import type { MemoryEngine, MemoryEntry } from '../memory/memory-engine.js';

// ─── Types ──────────────────────────────────────────────────────────────────

/**
 * MCP Tool definition following the MCP specification.
 */
interface MCPTool {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

/**
 * MCP Tool call result.
 */
interface MCPToolResult {
  content: Array<{
    type: 'text' | 'image' | 'resource';
    text?: string;
    data?: string;
    mimeType?: string;
  }>;
  isError?: boolean;
}

/**
 * MCP JSON-RPC message types.
 */
interface MCPRequest {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params?: Record<string, unknown>;
}

interface MCPResponse {
  jsonrpc: '2.0';
  id: string | number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

// ─── Input Schemas (Zod) ────────────────────────────────────────────────────

const SpawnAgentSchema = z.object({
  task: z.string().describe('The task or prompt to give the agent'),
  agent: z.string().optional().describe('Agent to use: claude-code, kiro, codex, gemini, hermes, aider'),
  workspace: z.string().optional().describe('Working directory for the session'),
  repoPath: z.string().optional().describe('Git repository path for workspace isolation'),
  branch: z.string().optional().describe('Git branch name for the session'),
});

const GetSessionOutputSchema = z.object({
  sessionId: z.string().describe('Session ID to get output from'),
});

const TerminateSessionSchema = z.object({
  sessionId: z.string().describe('Session ID to terminate'),
});

const RunSkillSchema = z.object({
  skillId: z.string().describe('ID of the skill to execute'),
  task: z.string().optional().describe('Task context for skill execution'),
  sessionId: z.string().optional().describe('Session ID to execute skill in'),
});

const QueryMemorySchema = z.object({
  query: z.string().describe('Search query for memory'),
  limit: z.number().optional().describe('Maximum results to return (default: 10)'),
  category: z.string().optional().describe('Filter by memory category'),
});

const StoreMemorySchema = z.object({
  content: z.string().describe('Memory content to store'),
  category: z.string().optional().describe('Category for the memory entry'),
  tags: z.array(z.string()).optional().describe('Tags for retrieval'),
  source: z.string().optional().describe('Source of the memory (e.g., session ID)'),
});

// ─── MCP Server ─────────────────────────────────────────────────────────────

/**
 * MCP server exposing Hermes Squad capabilities as tools for Quick Desktop.
 *
 * Implements the Model Context Protocol specification with stdio transport.
 * When launched with `hermes-squad --mcp`, communicates via stdin/stdout
 * for seamless integration with Quick Desktop's MCP infrastructure.
 *
 * @example
 * ```typescript
 * const mcpServer = new MCPServer(sessionManager, skillManager, memoryEngine, logger);
 * await mcpServer.start(); // Begins listening on stdio
 * ```
 */
export class MCPServer {
  private readonly sessionManager: SessionManager;
  private readonly skillManager: SkillManager;
  private readonly memoryEngine: MemoryEngine;
  private readonly logger: Logger;
  private running = false;

  /** Buffer for incoming stdio data (messages may span multiple chunks) */
  private inputBuffer = '';

  constructor(
    sessionManager: SessionManager,
    skillManager: SkillManager,
    memoryEngine: MemoryEngine,
    logger: Logger
  ) {
    this.sessionManager = sessionManager;
    this.skillManager = skillManager;
    this.memoryEngine = memoryEngine;
    this.logger = logger.child({ module: 'MCPServer' });
  }

  // ─── Lifecycle ────────────────────────────────────────────────────────────

  /**
   * Start the MCP server in stdio mode.
   * Reads JSON-RPC messages from stdin, writes responses to stdout.
   */
  async start(): Promise<void> {
    this.running = true;
    this.logger.info('MCP server starting (stdio transport)');

    // Listen for incoming messages on stdin
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', (chunk: string) => {
      this.inputBuffer += chunk;
      this.processInputBuffer();
    });

    process.stdin.on('end', () => {
      this.logger.info('MCP stdin closed');
      this.running = false;
    });

    // Send initialization notification
    // (MCP protocol requires server to advertise capabilities on start)
  }

  /**
   * Stop the MCP server.
   */
  async stop(): Promise<void> {
    this.running = false;
    this.logger.info('MCP server stopped');
  }

  // ─── Message Processing ───────────────────────────────────────────────────

  /**
   * Process buffered input, extracting complete JSON-RPC messages.
   * MCP uses Content-Length headers (like LSP) to delimit messages.
   */
  private processInputBuffer(): void {
    // MCP stdio uses newline-delimited JSON (one message per line)
    const lines = this.inputBuffer.split('\n');
    this.inputBuffer = lines.pop() ?? ''; // Keep incomplete last line in buffer

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      try {
        const request = JSON.parse(trimmed) as MCPRequest;
        this.handleRequest(request).then((response) => {
          if (response) {
            this.sendResponse(response);
          }
        });
      } catch (error) {
        this.logger.warn({ line: trimmed.slice(0, 100) }, 'Failed to parse MCP message');
      }
    }
  }

  /**
   * Route an MCP request to the appropriate handler.
   */
  private async handleRequest(request: MCPRequest): Promise<MCPResponse | null> {
    this.logger.debug({ method: request.method }, 'MCP request received');

    switch (request.method) {
      // ─── MCP Protocol Methods ─────────────────────────────────────
      case 'initialize':
        return this.handleInitialize(request);
      case 'tools/list':
        return this.handleToolsList(request);
      case 'tools/call':
        return this.handleToolCall(request);
      case 'resources/list':
        return this.handleResourcesList(request);
      case 'prompts/list':
        return this.handlePromptsList(request);
      case 'ping':
        return { jsonrpc: '2.0', id: request.id, result: {} };
      default:
        return {
          jsonrpc: '2.0',
          id: request.id,
          error: { code: -32601, message: `Method not found: ${request.method}` },
        };
    }
  }

  // ─── Protocol Handlers ────────────────────────────────────────────────────

  /**
   * Handle MCP initialize — return server info and capabilities.
   */
  private handleInitialize(request: MCPRequest): MCPResponse {
    return {
      jsonrpc: '2.0',
      id: request.id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: {
          tools: {},       // We expose tools
          resources: {},   // We expose resources (session outputs)
          prompts: {},     // We expose prompt templates
        },
        serverInfo: {
          name: 'hermes-squad',
          version: '0.1.0',
        },
      },
    };
  }

  /**
   * Handle tools/list — return all available tools.
   * This is called by Quick Desktop to discover what Hermes Squad can do.
   */
  private handleToolsList(request: MCPRequest): MCPResponse {
    const tools: MCPTool[] = [
      {
        name: 'hermes_spawn_agent',
        description:
          'Spawn a new AI coding agent session in an isolated workspace. ' +
          'Supports Claude Code, Kiro, Codex, Gemini, Hermes Agent, and Aider. ' +
          'Each session gets its own git worktree for safe parallel development.',
        inputSchema: {
          type: 'object',
          properties: {
            task: { type: 'string', description: 'The coding task or prompt for the agent' },
            agent: {
              type: 'string',
              description: 'Agent to use (claude-code, kiro, codex, gemini, hermes, aider). Default: hermes',
              enum: ['claude-code', 'kiro', 'codex', 'gemini', 'hermes', 'aider'],
            },
            workspace: { type: 'string', description: 'Working directory for the session' },
            repoPath: { type: 'string', description: 'Git repo path for workspace isolation' },
            branch: { type: 'string', description: 'Git branch name for the session' },
          },
          required: ['task'],
        },
      },
      {
        name: 'hermes_list_sessions',
        description:
          'List all active and recent agent sessions in Hermes Squad. ' +
          'Shows session status, agent type, task, and workspace info.',
        inputSchema: { type: 'object', properties: {} },
      },
      {
        name: 'hermes_get_session_output',
        description:
          'Get the terminal output from a specific agent session. ' +
          'Useful for checking progress or reviewing what an agent produced.',
        inputSchema: {
          type: 'object',
          properties: {
            sessionId: { type: 'string', description: 'Session ID to get output from' },
          },
          required: ['sessionId'],
        },
      },
      {
        name: 'hermes_terminate_session',
        description: 'Terminate a running agent session.',
        inputSchema: {
          type: 'object',
          properties: {
            sessionId: { type: 'string', description: 'Session ID to terminate' },
          },
          required: ['sessionId'],
        },
      },
      {
        name: 'hermes_run_skill',
        description:
          'Execute a learned skill from Hermes Squad\'s skill library. ' +
          'Skills are self-improving procedures learned from past interactions.',
        inputSchema: {
          type: 'object',
          properties: {
            skillId: { type: 'string', description: 'ID of the skill to execute' },
            task: { type: 'string', description: 'Task context for skill execution' },
            sessionId: { type: 'string', description: 'Session ID to execute skill in' },
          },
          required: ['skillId'],
        },
      },
      {
        name: 'hermes_list_skills',
        description:
          'List all available skills in the Hermes Squad skill library. ' +
          'Skills are organized by category and include descriptions.',
        inputSchema: { type: 'object', properties: {} },
      },
      {
        name: 'hermes_query_memory',
        description:
          'Search Hermes Squad\'s cross-session memory. Contains learned patterns, ' +
          'code snippets, architectural decisions, and past task outcomes.',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search query for memory' },
            limit: { type: 'number', description: 'Max results (default: 10)' },
            category: { type: 'string', description: 'Filter by category' },
          },
          required: ['query'],
        },
      },
      {
        name: 'hermes_store_memory',
        description:
          'Store a new entry in Hermes Squad\'s cross-session memory. ' +
          'Use for important patterns, decisions, or learnings.',
        inputSchema: {
          type: 'object',
          properties: {
            content: { type: 'string', description: 'Memory content to store' },
            category: { type: 'string', description: 'Category for the memory' },
            tags: { type: 'array', items: { type: 'string' }, description: 'Tags for retrieval' },
            source: { type: 'string', description: 'Source of the memory' },
          },
          required: ['content'],
        },
      },
      {
        name: 'hermes_list_agents',
        description:
          'List all AI coding agents available in Hermes Squad. ' +
          'Shows agent capabilities, availability status, and cost tier.',
        inputSchema: { type: 'object', properties: {} },
      },
    ];

    return { jsonrpc: '2.0', id: request.id, result: { tools } };
  }

  /**
   * Handle tools/call — execute a tool invocation.
   */
  private async handleToolCall(request: MCPRequest): Promise<MCPResponse> {
    const { name, arguments: args } = request.params as {
      name: string;
      arguments: Record<string, unknown>;
    };

    this.logger.info({ tool: name }, 'MCP tool call');

    try {
      const result = await this.executeTool(name, args);
      return { jsonrpc: '2.0', id: request.id, result };
    } catch (error) {
      return {
        jsonrpc: '2.0',
        id: request.id,
        result: {
          content: [{ type: 'text', text: `Error: ${(error as Error).message}` }],
          isError: true,
        },
      };
    }
  }

  /**
   * Handle resources/list — expose session outputs as MCP resources.
   */
  private handleResourcesList(request: MCPRequest): MCPResponse {
    const sessions = this.sessionManager.listSessions();
    const resources = sessions.map((s) => ({
      uri: `hermes-squad://session/${s.id}/output`,
      name: `Session: ${s.name}`,
      description: `Output from ${s.agentId} session — ${s.task ?? 'no task'}`,
      mimeType: 'text/plain',
    }));

    return { jsonrpc: '2.0', id: request.id, result: { resources } };
  }

  /**
   * Handle prompts/list — expose useful prompt templates.
   */
  private handlePromptsList(request: MCPRequest): MCPResponse {
    const prompts = [
      {
        name: 'hermes_multi_agent_task',
        description: 'Break a complex task into sub-tasks for multiple agents',
        arguments: [
          { name: 'task', description: 'The complex task to decompose', required: true },
          { name: 'agents', description: 'Comma-separated list of preferred agents', required: false },
        ],
      },
      {
        name: 'hermes_skill_from_session',
        description: 'Extract a reusable skill from a completed session',
        arguments: [
          { name: 'sessionId', description: 'The session to extract from', required: true },
        ],
      },
    ];

    return { jsonrpc: '2.0', id: request.id, result: { prompts } };
  }

  // ─── Tool Execution ───────────────────────────────────────────────────────

  /**
   * Execute an MCP tool and return the result.
   */
  private async executeTool(name: string, args: Record<string, unknown>): Promise<MCPToolResult> {
    switch (name) {
      case 'hermes_spawn_agent': {
        const parsed = SpawnAgentSchema.parse(args);
        const session = await this.sessionManager.createSession({
          agentId: parsed.agent ?? 'hermes',
          task: parsed.task,
          repoPath: parsed.repoPath,
          cwd: parsed.workspace,
          branch: parsed.branch,
        });
        return {
          content: [{
            type: 'text',
            text: `✅ Agent session spawned:\n` +
              `- Session ID: ${session.id}\n` +
              `- Agent: ${session.agentId}\n` +
              `- Status: ${session.status}\n` +
              `- Workspace: ${session.workingDir}\n` +
              `- Task: ${session.task ?? 'none'}`,
          }],
        };
      }

      case 'hermes_list_sessions': {
        const sessions = this.sessionManager.listSessions();
        const text = sessions.length === 0
          ? 'No active sessions.'
          : sessions.map((s) =>
            `[${s.status}] ${s.name} (${s.agentId}) — ${s.task?.slice(0, 60) ?? 'no task'}`
          ).join('\n');
        return { content: [{ type: 'text', text }] };
      }

      case 'hermes_get_session_output': {
        const { sessionId } = GetSessionOutputSchema.parse(args);
        const output = this.sessionManager.getSessionOutput(sessionId);
        return {
          content: [{ type: 'text', text: output || '(no output yet)' }],
        };
      }

      case 'hermes_terminate_session': {
        const { sessionId } = TerminateSessionSchema.parse(args);
        await this.sessionManager.terminateSession(sessionId);
        return { content: [{ type: 'text', text: `Session ${sessionId} terminated.` }] };
      }

      case 'hermes_run_skill': {
        const parsed = RunSkillSchema.parse(args);
        const result = await this.skillManager.executeSkill(parsed.skillId, {
          task: parsed.task,
          sessionId: parsed.sessionId,
        });
        return {
          content: [{ type: 'text', text: `Skill '${parsed.skillId}' executed: ${JSON.stringify(result)}` }],
        };
      }

      case 'hermes_list_skills': {
        const skills = this.skillManager.listSkills();
        const text = skills.length === 0
          ? 'No skills learned yet.'
          : skills.map((s) => `• ${s.name} (${s.id}) — ${s.description}`).join('\n');
        return { content: [{ type: 'text', text }] };
      }

      case 'hermes_query_memory': {
        const parsed = QueryMemorySchema.parse(args);
        const results = await this.memoryEngine.search(parsed.query, {
          limit: parsed.limit,
          category: parsed.category,
        });
        const text = results.length === 0
          ? 'No matching memories found.'
          : results.map((r) => `[${r.category}] ${r.content.slice(0, 200)}`).join('\n\n');
        return { content: [{ type: 'text', text }] };
      }

      case 'hermes_store_memory': {
        const parsed = StoreMemorySchema.parse(args);
        await this.memoryEngine.store({
          content: parsed.content,
          category: parsed.category ?? 'general',
          tags: parsed.tags ?? [],
          source: parsed.source ?? 'mcp',
        });
        return { content: [{ type: 'text', text: 'Memory stored successfully.' }] };
      }

      case 'hermes_list_agents': {
        // Accessed via session manager's agent list
        const sessions = this.sessionManager.listSessions();
        return {
          content: [{
            type: 'text',
            text: `Active sessions: ${sessions.length}\n` +
              sessions.map((s) => `  ${s.agentId}: ${s.name} [${s.status}]`).join('\n'),
          }],
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  }

  // ─── Transport ────────────────────────────────────────────────────────────

  /**
   * Send a JSON-RPC response via stdout (MCP stdio transport).
   */
  private sendResponse(response: MCPResponse): void {
    const json = JSON.stringify(response);
    process.stdout.write(json + '\n');
  }
}

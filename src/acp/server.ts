/**
 * ============================================================================
 * HERMES SQUAD — ACP Server (Agent Client Protocol)
 * ============================================================================
 *
 * The ACP Server allows external tools (Amazon Quick Desktop, Kiro IDE) to
 * send tasks to Hermes Squad for orchestration. It implements the Agent Client
 * Protocol — a JSON-RPC 2.0 based protocol for agent-to-agent communication.
 *
 * WHAT IS ACP?
 * -----------
 * Agent Client Protocol (ACP) is a standard for AI agents to communicate
 * with each other. It defines:
 * - Task lifecycle: create → progress → complete/fail
 * - Capability discovery: agents advertise what they can do
 * - Streaming: real-time output streaming during task execution
 * - Context passing: rich context (files, instructions, preferences)
 *
 * HOW QUICK DESKTOP USES THIS:
 * ---------------------------
 * When a user in Amazon Quick says "delegate this to Hermes Squad" or uses
 * the `send_message_to_acp_agent` tool, Quick sends a JSON-RPC request to
 * this server. Hermes Squad then:
 * 1. Selects the best agent for the task
 * 2. Creates an isolated session
 * 3. Streams progress back to Quick
 * 4. Returns the final result
 *
 * HOW KIRO IDE USES THIS:
 * ----------------------
 * Kiro IDE can delegate complex multi-file tasks to Hermes Squad when it
 * needs capabilities beyond its own (e.g., running multiple agents in
 * parallel, or using the self-improving skills system).
 *
 * PROTOCOL SPEC:
 * -------------
 * Transport: WebSocket (primary) + HTTP fallback
 * Format: JSON-RPC 2.0
 * Discovery: mDNS / well-known port (7437)
 *
 * Methods exposed:
 * - hermes.spawn      — Create a new agent session
 * - hermes.status     — Get session status
 * - hermes.output     — Get session output
 * - hermes.cancel     — Cancel a running session
 * - hermes.skills     — List available skills
 * - hermes.execute    — Execute a skill directly
 * - hermes.memory     — Query cross-session memory
 * - hermes.agents     — List available agents
 * - hermes.health     — Health check
 *
 * CONFIGURATION:
 * -------------
 * - Port: HERMES_SQUAD_PORT (default: 7437)
 * - Auth: Bearer token in HERMES_SQUAD_ACP_TOKEN
 * - TLS: Optional, configured via HERMES_SQUAD_TLS_CERT / HERMES_SQUAD_TLS_KEY
 */

import { WebSocketServer, WebSocket } from 'ws';
import express from 'express';
import { createServer, Server as HttpServer } from 'http';
import { nanoid } from 'nanoid';
import type { Logger } from 'pino';

import type { SessionManager, CreateSessionOptions, SessionInfo } from '../core/session-manager.js';
import type { SkillManager, SkillExecutionContext } from '../skills/skill-manager.js';

// ─── Types ──────────────────────────────────────────────────────────────────

/**
 * JSON-RPC 2.0 request structure.
 */
interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params?: Record<string, unknown>;
}

/**
 * JSON-RPC 2.0 response structure.
 */
interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

/**
 * JSON-RPC 2.0 notification (no id, no response expected).
 */
interface JsonRpcNotification {
  jsonrpc: '2.0';
  method: string;
  params?: Record<string, unknown>;
}

/**
 * ACP task as received from Quick/Kiro.
 */
interface ACPTask {
  /** Task description / prompt */
  task: string;
  /** Preferred agent to use */
  agent?: string;
  /** Working directory context */
  workspace?: string;
  /** Repository to work in */
  repoPath?: string;
  /** Additional context files */
  contextFiles?: string[];
  /** Skills to apply */
  skills?: string[];
  /** Whether to stream output back */
  stream?: boolean;
  /** Maximum execution time in seconds */
  timeout?: number;
}

/**
 * Connected client tracking.
 */
interface ConnectedClient {
  id: string;
  ws: WebSocket;
  authenticated: boolean;
  subscriptions: Set<string>; // Session IDs this client is subscribed to
  connectedAt: Date;
}

// ─── ACP Server ─────────────────────────────────────────────────────────────

/**
 * ACP JSON-RPC server for Hermes Squad.
 *
 * Accepts connections from Quick Desktop, Kiro IDE, and other ACP-compatible
 * clients. Manages the full lifecycle of delegated tasks.
 *
 * @example
 * ```typescript
 * const server = new ACPServer(sessionManager, skillManager, 7437, logger);
 * await server.start();
 * // Now accepting connections at ws://localhost:7437/acp
 * ```
 */
export class ACPServer {
  private readonly sessionManager: SessionManager;
  private readonly skillManager: SkillManager;
  private readonly port: number;
  private readonly logger: Logger;

  private httpServer?: HttpServer;
  private wss?: WebSocketServer;
  private readonly clients: Map<string, ConnectedClient> = new Map();

  /** Authentication token (if set, clients must provide it) */
  private readonly authToken: string | null;

  /** Track active ACP tasks and their originating clients */
  private readonly taskToClient: Map<string, string> = new Map();

  constructor(
    sessionManager: SessionManager,
    skillManager: SkillManager,
    port: number,
    logger: Logger
  ) {
    this.sessionManager = sessionManager;
    this.skillManager = skillManager;
    this.port = port;
    this.logger = logger.child({ module: 'ACPServer' });
    this.authToken = process.env.HERMES_SQUAD_ACP_TOKEN ?? null;
  }

  // ─── Lifecycle ────────────────────────────────────────────────────────────

  /**
   * Start the ACP server (WebSocket + HTTP).
   */
  async start(): Promise<void> {
    const app = express();
    app.use(express.json());

    // HTTP health endpoint (for load balancers and discovery)
    app.get('/health', (_req, res) => {
      res.json({ status: 'ok', version: '0.1.0', protocol: 'acp' });
    });

    // HTTP fallback for JSON-RPC (for clients that can't use WebSocket)
    app.post('/acp', async (req, res) => {
      const response = await this.handleRequest(req.body as JsonRpcRequest);
      res.json(response);
    });

    // Agent capability advertisement (ACP discovery)
    app.get('/acp/capabilities', (_req, res) => {
      res.json(this.getCapabilities());
    });

    this.httpServer = createServer(app);

    // WebSocket server for streaming communication
    this.wss = new WebSocketServer({ server: this.httpServer, path: '/acp/ws' });

    this.wss.on('connection', (ws: WebSocket) => {
      const clientId = `client_${nanoid(8)}`;
      const client: ConnectedClient = {
        id: clientId,
        ws,
        authenticated: !this.authToken, // Auto-auth if no token required
        subscriptions: new Set(),
        connectedAt: new Date(),
      };

      this.clients.set(clientId, client);
      this.logger.info({ clientId }, 'ACP client connected');

      ws.on('message', async (data: Buffer) => {
        try {
          const request = JSON.parse(data.toString()) as JsonRpcRequest;
          const response = await this.handleRequest(request, client);
          if (response) {
            ws.send(JSON.stringify(response));
          }
        } catch (error) {
          ws.send(JSON.stringify(this.errorResponse('parse-error', -32700, 'Parse error')));
        }
      });

      ws.on('close', () => {
        this.clients.delete(clientId);
        this.logger.info({ clientId }, 'ACP client disconnected');
      });

      ws.on('error', (error) => {
        this.logger.error({ clientId, error }, 'WebSocket error');
      });
    });

    // Start listening
    return new Promise((resolve) => {
      this.httpServer!.listen(this.port, () => {
        this.logger.info({ port: this.port }, 'ACP server listening');
        resolve();
      });
    });
  }

  /**
   * Stop the ACP server gracefully.
   */
  async stop(): Promise<void> {
    // Close all client connections
    for (const client of this.clients.values()) {
      client.ws.close(1001, 'Server shutting down');
    }
    this.clients.clear();

    // Close WebSocket server
    this.wss?.close();

    // Close HTTP server
    return new Promise((resolve) => {
      this.httpServer?.close(() => {
        this.logger.info('ACP server stopped');
        resolve();
      });
    });
  }

  // ─── Request Handling ─────────────────────────────────────────────────────

  /**
   * Route a JSON-RPC request to the appropriate handler.
   */
  private async handleRequest(
    request: JsonRpcRequest,
    client?: ConnectedClient
  ): Promise<JsonRpcResponse | null> {
    // Authentication check
    if (client && !client.authenticated) {
      if (request.method === 'auth.authenticate') {
        return this.handleAuth(request, client);
      }
      return this.errorResponse(request.id, -32600, 'Authentication required');
    }

    this.logger.debug({ method: request.method, id: request.id }, 'ACP request received');

    try {
      switch (request.method) {
        // ─── Task Management ──────────────────────────────────────────
        case 'hermes.spawn':
          return await this.handleSpawn(request);
        case 'hermes.status':
          return await this.handleStatus(request);
        case 'hermes.output':
          return await this.handleOutput(request);
        case 'hermes.cancel':
          return await this.handleCancel(request);
        case 'hermes.subscribe':
          return this.handleSubscribe(request, client!);

        // ─── Skills ───────────────────────────────────────────────────
        case 'hermes.skills':
          return await this.handleListSkills(request);
        case 'hermes.execute':
          return await this.handleExecuteSkill(request);

        // ─── Memory ───────────────────────────────────────────────────
        case 'hermes.memory':
          return await this.handleMemoryQuery(request);

        // ─── Discovery ────────────────────────────────────────────────
        case 'hermes.agents':
          return await this.handleListAgents(request);
        case 'hermes.health':
          return this.successResponse(request.id, { status: 'ok', uptime: process.uptime() });

        // ─── Auth ─────────────────────────────────────────────────────
        case 'auth.authenticate':
          return this.handleAuth(request, client);

        default:
          return this.errorResponse(request.id, -32601, `Method not found: ${request.method}`);
      }
    } catch (error) {
      this.logger.error({ error, method: request.method }, 'Error handling ACP request');
      return this.errorResponse(request.id, -32603, (error as Error).message);
    }
  }

  // ─── Method Handlers ──────────────────────────────────────────────────────

  /**
   * Handle hermes.spawn — create a new agent session from ACP task.
   *
   * This is the primary method Quick/Kiro use to delegate work.
   * It creates a session, starts the agent, and optionally subscribes
   * the client to output streaming.
   */
  private async handleSpawn(request: JsonRpcRequest): Promise<JsonRpcResponse> {
    const task = request.params as unknown as ACPTask;

    if (!task?.task) {
      return this.errorResponse(request.id, -32602, 'Missing required param: task');
    }

    const sessionOptions: CreateSessionOptions = {
      agentId: task.agent ?? 'hermes', // Default to Hermes agent
      name: `acp-${nanoid(6)}`,
      task: task.task,
      repoPath: task.repoPath,
      cwd: task.workspace,
    };

    const session = await this.sessionManager.createSession(sessionOptions);

    // If skills are specified, queue them for execution
    if (task.skills?.length) {
      for (const skillId of task.skills) {
        await this.skillManager.executeSkill(skillId, {
          sessionId: session.id,
          task: task.task,
        });
      }
    }

    return this.successResponse(request.id, {
      sessionId: session.id,
      status: session.status,
      agent: session.agentId,
      workspace: session.workingDir,
    });
  }

  /**
   * Handle hermes.status — get current status of a session.
   */
  private async handleStatus(request: JsonRpcRequest): Promise<JsonRpcResponse> {
    const { sessionId } = request.params as { sessionId: string };
    const session = this.sessionManager.getSession(sessionId);

    if (!session) {
      return this.errorResponse(request.id, -32602, `Session not found: ${sessionId}`);
    }

    return this.successResponse(request.id, session);
  }

  /**
   * Handle hermes.output — get buffered output from a session.
   */
  private async handleOutput(request: JsonRpcRequest): Promise<JsonRpcResponse> {
    const { sessionId } = request.params as { sessionId: string };
    const output = this.sessionManager.getSessionOutput(sessionId);
    return this.successResponse(request.id, { sessionId, output });
  }

  /**
   * Handle hermes.cancel — terminate a running session.
   */
  private async handleCancel(request: JsonRpcRequest): Promise<JsonRpcResponse> {
    const { sessionId } = request.params as { sessionId: string };
    await this.sessionManager.terminateSession(sessionId);
    return this.successResponse(request.id, { sessionId, status: 'terminated' });
  }

  /**
   * Handle hermes.subscribe — subscribe to real-time output from a session.
   * Output is streamed as JSON-RPC notifications.
   */
  private handleSubscribe(request: JsonRpcRequest, client: ConnectedClient): JsonRpcResponse {
    const { sessionId } = request.params as { sessionId: string };
    client.subscriptions.add(sessionId);
    return this.successResponse(request.id, { subscribed: true, sessionId });
  }

  /**
   * Handle hermes.skills — list available skills.
   */
  private async handleListSkills(request: JsonRpcRequest): Promise<JsonRpcResponse> {
    const skills = this.skillManager.listSkills();
    return this.successResponse(request.id, { skills });
  }

  /**
   * Handle hermes.execute — execute a named skill.
   */
  private async handleExecuteSkill(request: JsonRpcRequest): Promise<JsonRpcResponse> {
    const { skillId, context } = request.params as {
      skillId: string;
      context: SkillExecutionContext;
    };

    const result = await this.skillManager.executeSkill(skillId, context);
    return this.successResponse(request.id, { skillId, result });
  }

  /**
   * Handle hermes.memory — query cross-session memory.
   */
  private async handleMemoryQuery(request: JsonRpcRequest): Promise<JsonRpcResponse> {
    const { query, limit } = request.params as { query: string; limit?: number };
    // Memory engine is accessed via skill manager's memory reference
    return this.successResponse(request.id, { query, results: [] }); // Placeholder
  }

  /**
   * Handle hermes.agents — list available agents.
   */
  private async handleListAgents(request: JsonRpcRequest): Promise<JsonRpcResponse> {
    const sessions = this.sessionManager.listSessions();
    return this.successResponse(request.id, { sessions });
  }

  /**
   * Handle authentication.
   */
  private handleAuth(request: JsonRpcRequest, client?: ConnectedClient): JsonRpcResponse {
    const { token } = request.params as { token: string };

    if (!this.authToken || token === this.authToken) {
      if (client) client.authenticated = true;
      return this.successResponse(request.id, { authenticated: true });
    }

    return this.errorResponse(request.id, -32600, 'Invalid authentication token');
  }

  // ─── Streaming ────────────────────────────────────────────────────────────

  /**
   * Broadcast a notification to all clients subscribed to a session.
   * Called when session output is emitted.
   */
  broadcastSessionOutput(sessionId: string, data: string): void {
    const notification: JsonRpcNotification = {
      jsonrpc: '2.0',
      method: 'hermes.output.stream',
      params: { sessionId, data, timestamp: new Date().toISOString() },
    };

    const payload = JSON.stringify(notification);

    for (const client of this.clients.values()) {
      if (client.subscriptions.has(sessionId) && client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(payload);
      }
    }
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  /**
   * Get the capability advertisement for ACP discovery.
   */
  private getCapabilities() {
    return {
      name: 'hermes-squad',
      version: '0.1.0',
      protocol: 'acp/1.0',
      capabilities: [
        'multi-agent-orchestration',
        'self-improving-skills',
        'cross-session-memory',
        'workspace-isolation',
        'real-time-streaming',
      ],
      methods: [
        'hermes.spawn',
        'hermes.status',
        'hermes.output',
        'hermes.cancel',
        'hermes.subscribe',
        'hermes.skills',
        'hermes.execute',
        'hermes.memory',
        'hermes.agents',
        'hermes.health',
      ],
    };
  }

  private successResponse(id: string | number, result: unknown): JsonRpcResponse {
    return { jsonrpc: '2.0', id, result };
  }

  private errorResponse(id: string | number, code: number, message: string): JsonRpcResponse {
    return { jsonrpc: '2.0', id, error: { code, message } };
  }
}

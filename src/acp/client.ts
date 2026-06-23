/**
 * ============================================================================
 * HERMES SQUAD — ACP Client (Agent Client Protocol)
 * ============================================================================
 *
 * The ACP Client allows Hermes Squad to delegate tasks TO other ACP-compatible
 * agents — primarily Kiro IDE and Claude Code when they expose ACP endpoints.
 *
 * USE CASES:
 * ---------
 * 1. Hermes Squad → Kiro IDE:
 *    "Kiro, please apply this spec to the workspace using your hooks system"
 *    Hermes Squad sends a task to Kiro's ACP server, Kiro executes with its
 *    native tools (steering, hooks, specs), and returns the result.
 *
 * 2. Hermes Squad → Claude Code (ACP mode):
 *    "Claude, analyze this codebase and generate a refactoring plan"
 *    Useful when Claude Code runs as a service with ACP interface.
 *
 * 3. Hermes Squad → Other Hermes Squad instances:
 *    Distributed squad deployment — multiple machines working together.
 *
 * PROTOCOL FLOW:
 * -------------
 * 1. Client connects to agent's ACP endpoint (WebSocket)
 * 2. Client sends `agent.spawn` with task details
 * 3. Agent sends progress notifications
 * 4. Agent sends final result
 * 5. Client processes result (store in memory, update skills, etc.)
 *
 * DISCOVERY:
 * ---------
 * Agents are discovered via:
 * - Well-known ports (Kiro: 7436, Hermes: 7437)
 * - Configuration file (~/.hermes-squad/agents.yaml with acpEndpoint)
 * - mDNS/DNS-SD broadcast (future)
 * - Manual endpoint configuration
 *
 * INTEGRATION POINTS:
 * ------------------
 * - AgentRegistry: Agents with protocol='acp' are delegated via this client
 * - SessionManager: May create ACP sessions instead of PTY sessions
 * - Skills: Skills can specify "delegate to Kiro via ACP" as an action
 * - Memory: Results from ACP tasks are stored in cross-session memory
 *
 * CONFIGURATION:
 * -------------
 * - HERMES_SQUAD_ACP_TIMEOUT: Default task timeout in ms (default: 300000 = 5min)
 * - HERMES_SQUAD_ACP_RETRY: Number of connection retries (default: 3)
 */

import WebSocket from 'ws';
import { nanoid } from 'nanoid';
import { EventEmitter } from 'eventemitter3';
import type { Logger } from 'pino';

// ─── Types ──────────────────────────────────────────────────────────────────

/**
 * ACP task to send to a remote agent.
 */
export interface ACPTaskRequest {
  /** Task description/prompt */
  task: string;
  /** Additional context */
  context?: {
    /** Files relevant to the task */
    files?: string[];
    /** Workspace directory */
    workspace?: string;
    /** Additional instructions */
    instructions?: string;
    /** Skill context from Hermes Squad */
    skillContext?: Record<string, unknown>;
  };
  /** Whether to request streaming output */
  stream?: boolean;
  /** Timeout in milliseconds */
  timeout?: number;
}

/**
 * Result from a completed ACP task.
 */
export interface ACPTaskResult {
  /** Whether the task succeeded */
  success: boolean;
  /** Task output/result text */
  output: string;
  /** Files modified by the agent */
  modifiedFiles?: string[];
  /** Structured data returned by the agent */
  data?: Record<string, unknown>;
  /** Error message if failed */
  error?: string;
  /** Execution time in milliseconds */
  executionTimeMs: number;
}

/**
 * Connection state for a remote ACP agent.
 */
interface ACPConnection {
  /** Agent identifier */
  agentId: string;
  /** WebSocket connection */
  ws: WebSocket | null;
  /** Connection endpoint URL */
  endpoint: string;
  /** Whether currently connected */
  connected: boolean;
  /** Pending requests awaiting responses */
  pendingRequests: Map<string | number, {
    resolve: (value: ACPTaskResult) => void;
    reject: (error: Error) => void;
    timeout: NodeJS.Timeout;
  }>;
  /** Reconnection attempts */
  reconnectAttempts: number;
}

/**
 * Events emitted by the ACP client.
 */
interface ACPClientEvents {
  'connected': (agentId: string) => void;
  'disconnected': (agentId: string) => void;
  'task:progress': (agentId: string, taskId: string, data: string) => void;
  'task:complete': (agentId: string, taskId: string, result: ACPTaskResult) => void;
  'error': (agentId: string, error: Error) => void;
}

// ─── ACP Client ─────────────────────────────────────────────────────────────

/**
 * ACP client for delegating tasks to remote agents.
 *
 * Manages connections to multiple ACP agents (Kiro, Claude Code, etc.)
 * with automatic reconnection and request correlation.
 *
 * @example
 * ```typescript
 * const client = new ACPClient(logger);
 *
 * // Connect to Kiro's ACP server
 * await client.connect('kiro', 'ws://localhost:7436/acp/ws');
 *
 * // Delegate a task
 * const result = await client.sendTask('kiro', {
 *   task: 'Apply the auth spec to the workspace',
 *   context: { workspace: '/path/to/project' },
 * });
 *
 * console.log(result.output); // Kiro's response
 * ```
 */
export class ACPClient extends EventEmitter<ACPClientEvents> {
  private readonly logger: Logger;
  private readonly connections: Map<string, ACPConnection> = new Map();

  /** Default timeout for ACP tasks */
  private readonly defaultTimeout: number;

  /** Maximum reconnection attempts */
  private readonly maxReconnectAttempts: number;

  /** Delay between reconnection attempts (ms) */
  private readonly reconnectDelay: number;

  constructor(
    logger: Logger,
    options?: {
      defaultTimeout?: number;
      maxReconnectAttempts?: number;
      reconnectDelay?: number;
    }
  ) {
    super();
    this.logger = logger.child({ module: 'ACPClient' });
    this.defaultTimeout = options?.defaultTimeout
      ?? parseInt(process.env.HERMES_SQUAD_ACP_TIMEOUT ?? '300000', 10);
    this.maxReconnectAttempts = options?.maxReconnectAttempts ?? 3;
    this.reconnectDelay = options?.reconnectDelay ?? 2000;
  }

  // ─── Connection Management ────────────────────────────────────────────────

  /**
   * Establish a WebSocket connection to a remote ACP agent.
   *
   * @param agentId - Identifier for the agent (used for routing)
   * @param endpoint - WebSocket URL of the agent's ACP server
   * @returns Promise that resolves when connected
   *
   * @example
   * ```typescript
   * await client.connect('kiro', 'ws://localhost:7436/acp/ws');
   * await client.connect('claude-remote', 'wss://claude.example.com/acp/ws');
   * ```
   */
  async connect(agentId: string, endpoint: string): Promise<void> {
    if (this.connections.has(agentId)) {
      const existing = this.connections.get(agentId)!;
      if (existing.connected) {
        this.logger.debug({ agentId }, 'Already connected to agent');
        return;
      }
    }

    const connection: ACPConnection = {
      agentId,
      ws: null,
      endpoint,
      connected: false,
      pendingRequests: new Map(),
      reconnectAttempts: 0,
    };

    this.connections.set(agentId, connection);
    await this.establishConnection(connection);
  }

  /**
   * Disconnect from a remote ACP agent.
   */
  async disconnect(agentId: string): Promise<void> {
    const connection = this.connections.get(agentId);
    if (!connection) return;

    // Reject all pending requests
    for (const [id, pending] of connection.pendingRequests) {
      clearTimeout(pending.timeout);
      pending.reject(new Error('Connection closed'));
    }
    connection.pendingRequests.clear();

    // Close WebSocket
    connection.ws?.close(1000, 'Client disconnecting');
    connection.connected = false;
    this.connections.delete(agentId);

    this.emit('disconnected', agentId);
    this.logger.info({ agentId }, 'Disconnected from ACP agent');
  }

  /**
   * Disconnect from all connected agents.
   */
  async disconnectAll(): Promise<void> {
    const agentIds = Array.from(this.connections.keys());
    await Promise.all(agentIds.map((id) => this.disconnect(id)));
  }

  /**
   * Check if connected to a specific agent.
   */
  isConnected(agentId: string): boolean {
    return this.connections.get(agentId)?.connected ?? false;
  }

  // ─── Task Delegation ──────────────────────────────────────────────────────

  /**
   * Send a task to a remote ACP agent and wait for the result.
   *
   * This is the primary method for task delegation. It:
   * 1. Sends a JSON-RPC request with the task details
   * 2. Waits for the agent to complete (or timeout)
   * 3. Returns the structured result
   *
   * Progress notifications are emitted as 'task:progress' events.
   *
   * @param agentId - Which connected agent to send to
   * @param task - Task request details
   * @returns Promise that resolves with the task result
   * @throws If not connected, timeout, or agent returns error
   *
   * @example
   * ```typescript
   * const result = await client.sendTask('kiro', {
   *   task: 'Generate TypeScript interfaces from this OpenAPI spec',
   *   context: {
   *     files: ['/path/to/openapi.yaml'],
   *     workspace: '/path/to/project',
   *   },
   *   timeout: 60000,
   * });
   *
   * if (result.success) {
   *   console.log('Files modified:', result.modifiedFiles);
   * }
   * ```
   */
  async sendTask(agentId: string, task: ACPTaskRequest): Promise<ACPTaskResult> {
    const connection = this.connections.get(agentId);
    if (!connection?.connected) {
      throw new Error(`Not connected to agent '${agentId}'. Call connect() first.`);
    }

    const requestId = `req_${nanoid(10)}`;
    const timeout = task.timeout ?? this.defaultTimeout;
    const startTime = Date.now();

    // Build JSON-RPC request
    const request = {
      jsonrpc: '2.0',
      id: requestId,
      method: 'agent.spawn',
      params: {
        task: task.task,
        context: task.context,
        stream: task.stream ?? true,
      },
    };

    this.logger.info({ agentId, requestId, task: task.task.slice(0, 100) }, 'Sending ACP task');

    return new Promise<ACPTaskResult>((resolve, reject) => {
      // Set up timeout
      const timeoutHandle = setTimeout(() => {
        connection.pendingRequests.delete(requestId);
        reject(new Error(`ACP task timed out after ${timeout}ms (agent: ${agentId})`));
      }, timeout);

      // Register pending request
      connection.pendingRequests.set(requestId, {
        resolve: (result: ACPTaskResult) => {
          result.executionTimeMs = Date.now() - startTime;
          resolve(result);
        },
        reject,
        timeout: timeoutHandle,
      });

      // Send the request
      connection.ws!.send(JSON.stringify(request));
    });
  }

  /**
   * Send a fire-and-forget notification to an agent (no response expected).
   * Useful for sending context updates or hints.
   */
  notify(agentId: string, method: string, params?: Record<string, unknown>): void {
    const connection = this.connections.get(agentId);
    if (!connection?.connected) return;

    const notification = {
      jsonrpc: '2.0',
      method,
      params,
    };

    connection.ws!.send(JSON.stringify(notification));
  }

  /**
   * Discover available ACP agents on the network.
   * Currently checks well-known ports; future: mDNS discovery.
   */
  async discoverAgents(): Promise<Array<{ agentId: string; endpoint: string; name: string }>> {
    const discovered: Array<{ agentId: string; endpoint: string; name: string }> = [];

    // Check well-known ports for ACP agents
    const knownEndpoints = [
      { agentId: 'kiro', port: 7436, name: 'Kiro IDE' },
      { agentId: 'quick', port: 7435, name: 'Amazon Quick' },
    ];

    for (const endpoint of knownEndpoints) {
      try {
        const url = `http://localhost:${endpoint.port}/health`;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 2000);

        const response = await fetch(url, { signal: controller.signal });
        clearTimeout(timeout);

        if (response.ok) {
          discovered.push({
            agentId: endpoint.agentId,
            endpoint: `ws://localhost:${endpoint.port}/acp/ws`,
            name: endpoint.name,
          });
        }
      } catch {
        // Agent not available at this endpoint — skip
      }
    }

    this.logger.info({ discovered: discovered.length }, 'ACP agent discovery complete');
    return discovered;
  }

  // ─── Private ──────────────────────────────────────────────────────────────

  /**
   * Establish the WebSocket connection with reconnection logic.
   */
  private async establishConnection(connection: ACPConnection): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(connection.endpoint);

      ws.on('open', () => {
        connection.ws = ws;
        connection.connected = true;
        connection.reconnectAttempts = 0;
        this.emit('connected', connection.agentId);
        this.logger.info({ agentId: connection.agentId, endpoint: connection.endpoint }, 'Connected to ACP agent');
        resolve();
      });

      ws.on('message', (data: Buffer) => {
        this.handleMessage(connection, data);
      });

      ws.on('close', () => {
        connection.connected = false;
        this.emit('disconnected', connection.agentId);
        this.attemptReconnect(connection);
      });

      ws.on('error', (error) => {
        this.logger.error({ agentId: connection.agentId, error }, 'ACP connection error');
        this.emit('error', connection.agentId, error);
        if (!connection.connected) {
          reject(error);
        }
      });
    });
  }

  /**
   * Handle incoming WebSocket messages from a remote agent.
   */
  private handleMessage(connection: ACPConnection, data: Buffer): void {
    try {
      const message = JSON.parse(data.toString());

      // Check if this is a response to a pending request
      if (message.id && connection.pendingRequests.has(message.id)) {
        const pending = connection.pendingRequests.get(message.id)!;
        clearTimeout(pending.timeout);
        connection.pendingRequests.delete(message.id);

        if (message.error) {
          pending.reject(new Error(message.error.message));
        } else {
          pending.resolve({
            success: true,
            output: message.result?.output ?? '',
            modifiedFiles: message.result?.modifiedFiles,
            data: message.result?.data,
            executionTimeMs: 0, // Filled by sendTask
          });
        }
        return;
      }

      // Check if this is a progress notification
      if (message.method === 'task.progress') {
        this.emit(
          'task:progress',
          connection.agentId,
          message.params?.taskId ?? '',
          message.params?.data ?? ''
        );
        return;
      }

      this.logger.debug({ agentId: connection.agentId, method: message.method }, 'Unhandled ACP message');
    } catch (error) {
      this.logger.warn({ error }, 'Failed to parse ACP message');
    }
  }

  /**
   * Attempt to reconnect to a disconnected agent.
   */
  private async attemptReconnect(connection: ACPConnection): Promise<void> {
    if (connection.reconnectAttempts >= this.maxReconnectAttempts) {
      this.logger.warn(
        { agentId: connection.agentId, attempts: connection.reconnectAttempts },
        'Max reconnection attempts reached'
      );
      return;
    }

    connection.reconnectAttempts++;
    const delay = this.reconnectDelay * connection.reconnectAttempts;

    this.logger.debug(
      { agentId: connection.agentId, attempt: connection.reconnectAttempts, delay },
      'Scheduling reconnection attempt'
    );

    await new Promise((resolve) => setTimeout(resolve, delay));

    try {
      await this.establishConnection(connection);
    } catch {
      // Will retry via the close handler
    }
  }
}

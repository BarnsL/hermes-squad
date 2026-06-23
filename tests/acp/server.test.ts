/**
 * =============================================================================
 * Hermes Squad — ACP (Agent Communication Protocol) Server Unit Tests
 * =============================================================================
 * Tests for the ACP server which enables inter-agent communication:
 * - Agent registration and discovery
 * - Message routing between agents
 * - Task delegation and result collection
 * - Protocol compliance (JSON-RPC 2.0 over stdio/HTTP)
 * - Connection lifecycle management
 * =============================================================================
 */

import { EventEmitter } from 'events';
import { Readable, Writable } from 'stream';

import type { ACPMessage, ACPAgent, TaskRequest, TaskResult } from '@acp/types';

// --- Mocks ---

// Mock the transport layer (stdio/HTTP abstraction)
jest.mock('@acp/transport', () => ({
  StdioTransport: jest.fn().mockImplementation(() => ({
    start: jest.fn().mockResolvedValue(undefined),
    stop: jest.fn().mockResolvedValue(undefined),
    send: jest.fn().mockResolvedValue(undefined),
    onMessage: jest.fn(),
    isConnected: jest.fn().mockReturnValue(true),
  })),
  HttpTransport: jest.fn().mockImplementation(() => ({
    start: jest.fn().mockResolvedValue(undefined),
    stop: jest.fn().mockResolvedValue(undefined),
    send: jest.fn().mockResolvedValue(undefined),
    onMessage: jest.fn(),
    isConnected: jest.fn().mockReturnValue(true),
  })),
}));

// Mock the session manager for agent process management
jest.mock('@core/session-manager', () => ({
  SessionManager: jest.fn().mockImplementation(() => ({
    getSession: jest.fn(),
    getAllSessions: jest.fn().mockReturnValue([]),
    sendToSession: jest.fn().mockResolvedValue(undefined),
  })),
}));

// Mock logger
jest.mock('@shared/logger', () => ({
  createLogger: jest.fn().mockReturnValue({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }),
}));

// --- Test Helpers ---

/**
 * Creates a mock ACP message conforming to JSON-RPC 2.0 spec
 */
function createACPMessage(overrides?: Partial<ACPMessage>): ACPMessage {
  return {
    jsonrpc: '2.0',
    id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    method: 'agent/sendMessage',
    params: {
      from: 'agent-claude',
      to: 'agent-kiro',
      content: 'Please review the authentication module',
      metadata: { priority: 'normal', timestamp: Date.now() },
    },
    ...overrides,
  };
}

/**
 * Creates a mock registered agent
 */
function createMockAgent(overrides?: Partial<ACPAgent>): ACPAgent {
  return {
    id: 'agent-claude',
    name: 'Claude Code',
    capabilities: ['code-review', 'implementation', 'debugging'],
    status: 'active',
    registeredAt: Date.now(),
    sessionId: 'session_abc123',
    protocol: 'acp/1.0',
    ...overrides,
  };
}

// --- Import the module under test ---
import { ACPServer } from '@acp/server';
import { ACPError, ACPErrorCode } from '@acp/errors';

describe('ACPServer', () => {
  let server: ACPServer;

  beforeEach(() => {
    server = new ACPServer({
      // Use stdio transport for tests (simpler than HTTP)
      transport: 'stdio',
      // Max agents that can register simultaneously
      maxAgents: 10,
      // Message queue size per agent
      messageQueueSize: 100,
      // Timeout for task delegation responses
      taskTimeoutMs: 30_000,
    });
  });

  afterEach(async () => {
    await server.shutdown();
  });

  // ===========================================================================
  // Server Lifecycle
  // ===========================================================================

  describe('server lifecycle', () => {
    it('should start the server and accept connections', async () => {
      await server.start();

      expect(server.isRunning()).toBe(true);
    });

    it('should stop gracefully and notify connected agents', async () => {
      await server.start();
      await server.registerAgent(createMockAgent());

      await server.shutdown();

      expect(server.isRunning()).toBe(false);
    });

    it('should reject operations when server is not running', async () => {
      // Don't call start()
      await expect(server.registerAgent(createMockAgent())).rejects.toThrow(
        'ACP server is not running',
      );
    });

    it('should handle multiple start/stop cycles', async () => {
      await server.start();
      await server.shutdown();
      await server.start();
      await server.shutdown();

      expect(server.isRunning()).toBe(false);
    });
  });

  // ===========================================================================
  // Agent Registration
  // ===========================================================================

  describe('registerAgent', () => {
    beforeEach(async () => {
      await server.start();
    });

    it('should register an agent and return confirmation', async () => {
      const agent = createMockAgent();
      const result = await server.registerAgent(agent);

      expect(result.success).toBe(true);
      expect(result.agentId).toBe('agent-claude');
    });

    it('should assign a unique ID if none provided', async () => {
      const agent = createMockAgent({ id: undefined as any });
      const result = await server.registerAgent(agent);

      expect(result.agentId).toMatch(/^agent_[a-z0-9]+$/);
    });

    it('should reject duplicate agent registrations', async () => {
      const agent = createMockAgent({ id: 'agent-claude' });
      await server.registerAgent(agent);

      await expect(server.registerAgent(agent)).rejects.toThrow(
        'Agent already registered: agent-claude',
      );
    });

    it('should reject registration when max agents reached', async () => {
      // Register max agents
      for (let i = 0; i < 10; i++) {
        await server.registerAgent(createMockAgent({ id: `agent-${i}` }));
      }

      await expect(
        server.registerAgent(createMockAgent({ id: 'agent-overflow' })),
      ).rejects.toThrow('Maximum agents (10) reached');
    });

    it('should validate agent capabilities format', async () => {
      const agent = createMockAgent({ capabilities: [] });

      await expect(server.registerAgent(agent)).rejects.toThrow(
        'Agent must declare at least one capability',
      );
    });

    it('should emit AgentRegistered event', async () => {
      const handler = jest.fn();
      server.on('agent:registered', handler);

      const agent = createMockAgent();
      await server.registerAgent(agent);

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ agentId: 'agent-claude' }),
      );
    });
  });

  describe('unregisterAgent', () => {
    beforeEach(async () => {
      await server.start();
    });

    it('should remove an agent from the registry', async () => {
      await server.registerAgent(createMockAgent({ id: 'agent-claude' }));

      await server.unregisterAgent('agent-claude');

      const agents = server.getRegisteredAgents();
      expect(agents).not.toContainEqual(expect.objectContaining({ id: 'agent-claude' }));
    });

    it('should deliver pending messages before unregistering', async () => {
      await server.registerAgent(createMockAgent({ id: 'agent-claude' }));
      await server.registerAgent(createMockAgent({ id: 'agent-kiro' }));

      // Queue a message TO claude
      await server.routeMessage(createACPMessage({
        params: { from: 'agent-kiro', to: 'agent-claude', content: 'pending msg' },
      }));

      // Unregister with drain
      const result = await server.unregisterAgent('agent-claude', { drain: true });
      expect(result.pendingMessagesDelivered).toBe(1);
    });

    it('should throw for non-existent agent', async () => {
      await expect(server.unregisterAgent('nonexistent')).rejects.toThrow(
        'Agent not found: nonexistent',
      );
    });
  });

  // ===========================================================================
  // Message Routing
  // ===========================================================================

  describe('routeMessage', () => {
    beforeEach(async () => {
      await server.start();
      await server.registerAgent(createMockAgent({ id: 'agent-claude' }));
      await server.registerAgent(createMockAgent({ id: 'agent-kiro' }));
    });

    it('should route a message from one agent to another', async () => {
      const message = createACPMessage({
        params: {
          from: 'agent-claude',
          to: 'agent-kiro',
          content: 'Please review auth.ts',
          metadata: { priority: 'normal', timestamp: Date.now() },
        },
      });

      const result = await server.routeMessage(message);

      expect(result.delivered).toBe(true);
      expect(result.recipientId).toBe('agent-kiro');
    });

    it('should validate sender is registered', async () => {
      const message = createACPMessage({
        params: {
          from: 'unregistered-agent',
          to: 'agent-kiro',
          content: 'Hello',
          metadata: { priority: 'normal', timestamp: Date.now() },
        },
      });

      await expect(server.routeMessage(message)).rejects.toThrow(
        'Sender not registered: unregistered-agent',
      );
    });

    it('should queue messages for offline recipients', async () => {
      // Unregister kiro to simulate offline
      await server.unregisterAgent('agent-kiro');
      await server.registerAgent(createMockAgent({ id: 'agent-kiro', status: 'offline' }));

      const message = createACPMessage({
        params: {
          from: 'agent-claude',
          to: 'agent-kiro',
          content: 'When you are back...',
          metadata: { priority: 'normal', timestamp: Date.now() },
        },
      });

      const result = await server.routeMessage(message);
      expect(result.delivered).toBe(false);
      expect(result.queued).toBe(true);
    });

    it('should support broadcast messages (to all agents)', async () => {
      const message = createACPMessage({
        method: 'agent/broadcast',
        params: {
          from: 'agent-claude',
          to: '*',
          content: 'Build complete, all tests passing',
          metadata: { priority: 'normal', timestamp: Date.now() },
        },
      });

      const result = await server.routeMessage(message);

      // Should be delivered to all agents except sender
      expect(result.deliveredTo).toHaveLength(1);  // kiro only, not back to claude
      expect(result.deliveredTo).toContain('agent-kiro');
    });

    it('should enforce message size limits', async () => {
      const largeContent = 'x'.repeat(1_000_001);  // 1MB+ message
      const message = createACPMessage({
        params: {
          from: 'agent-claude',
          to: 'agent-kiro',
          content: largeContent,
          metadata: { priority: 'normal', timestamp: Date.now() },
        },
      });

      await expect(server.routeMessage(message)).rejects.toThrow(
        'Message exceeds maximum size',
      );
    });

    it('should track message delivery metrics', async () => {
      await server.routeMessage(createACPMessage());
      await server.routeMessage(createACPMessage());

      const metrics = server.getMetrics();
      expect(metrics.messagesRouted).toBe(2);
      expect(metrics.messagesDelivered).toBe(2);
      expect(metrics.messagesFailed).toBe(0);
    });
  });

  // ===========================================================================
  // Task Delegation
  // ===========================================================================

  describe('delegateTask', () => {
    beforeEach(async () => {
      await server.start();
      await server.registerAgent(
        createMockAgent({ id: 'agent-claude', capabilities: ['orchestration'] }),
      );
      await server.registerAgent(
        createMockAgent({ id: 'agent-kiro', capabilities: ['code-review', 'testing'] }),
      );
      await server.registerAgent(
        createMockAgent({ id: 'agent-codex', capabilities: ['implementation'] }),
      );
    });

    it('should delegate a task to a specific agent', async () => {
      const task: TaskRequest = {
        id: 'task_001',
        from: 'agent-claude',
        to: 'agent-kiro',
        type: 'code-review',
        description: 'Review the authentication module',
        context: { files: ['src/auth/login.ts', 'src/auth/session.ts'] },
        timeout: 30_000,
      };

      const result = await server.delegateTask(task);

      expect(result.taskId).toBe('task_001');
      expect(result.status).toBe('delegated');
      expect(result.assignedTo).toBe('agent-kiro');
    });

    it('should auto-route tasks based on capabilities', async () => {
      const task: TaskRequest = {
        id: 'task_002',
        from: 'agent-claude',
        to: undefined,  // No specific target — route by capability
        type: 'implementation',
        description: 'Implement the user profile endpoint',
        context: {},
        timeout: 60_000,
        requiredCapabilities: ['implementation'],
      };

      const result = await server.delegateTask(task);

      // Should be routed to codex (has 'implementation' capability)
      expect(result.assignedTo).toBe('agent-codex');
    });

    it('should reject tasks when no capable agent is available', async () => {
      const task: TaskRequest = {
        id: 'task_003',
        from: 'agent-claude',
        to: undefined,
        type: 'deploy',
        description: 'Deploy to production',
        context: {},
        timeout: 30_000,
        requiredCapabilities: ['deployment'],
      };

      await expect(server.delegateTask(task)).rejects.toThrow(
        'No agent with required capabilities: deployment',
      );
    });

    it('should handle task completion results', async () => {
      const task: TaskRequest = {
        id: 'task_004',
        from: 'agent-claude',
        to: 'agent-kiro',
        type: 'code-review',
        description: 'Review auth module',
        context: {},
        timeout: 30_000,
      };

      await server.delegateTask(task);

      // Simulate task completion from kiro
      const taskResult: TaskResult = {
        taskId: 'task_004',
        agentId: 'agent-kiro',
        status: 'completed',
        result: {
          approved: true,
          comments: ['LGTM - clean implementation'],
          suggestedChanges: [],
        },
        completedAt: Date.now(),
      };

      await server.handleTaskResult(taskResult);

      const completedTask = server.getTask('task_004');
      expect(completedTask?.status).toBe('completed');
      expect(completedTask?.result?.approved).toBe(true);
    });

    it('should handle task timeout', async () => {
      jest.useFakeTimers();

      const task: TaskRequest = {
        id: 'task_005',
        from: 'agent-claude',
        to: 'agent-kiro',
        type: 'code-review',
        description: 'Review',
        context: {},
        timeout: 5_000,  // 5 second timeout
      };

      await server.delegateTask(task);

      // Advance time past the timeout
      jest.advanceTimersByTime(6_000);

      const timedOutTask = server.getTask('task_005');
      expect(timedOutTask?.status).toBe('timeout');

      jest.useRealTimers();
    });
  });

  // ===========================================================================
  // Protocol Compliance
  // ===========================================================================

  describe('protocol compliance', () => {
    beforeEach(async () => {
      await server.start();
    });

    it('should reject messages with invalid JSON-RPC version', async () => {
      const invalidMessage = {
        jsonrpc: '1.0',  // Invalid — must be "2.0"
        id: 'test',
        method: 'agent/sendMessage',
        params: {},
      } as ACPMessage;

      await expect(server.handleIncomingMessage(invalidMessage)).rejects.toThrow(
        ACPError,
      );
    });

    it('should return proper error response for unknown methods', async () => {
      const message = createACPMessage({ method: 'unknown/method' });

      const response = await server.handleIncomingMessage(message);

      expect(response.error).toBeDefined();
      expect(response.error?.code).toBe(ACPErrorCode.MethodNotFound);
    });

    it('should handle notifications (messages without id)', async () => {
      const notification: ACPMessage = {
        jsonrpc: '2.0',
        id: undefined,  // Notification — no response expected
        method: 'agent/heartbeat',
        params: { agentId: 'agent-claude', timestamp: Date.now() },
      };

      // Should not throw and should not return a response
      const result = await server.handleIncomingMessage(notification);
      expect(result).toBeNull();
    });

    it('should validate required params for each method', async () => {
      const message = createACPMessage({
        method: 'agent/sendMessage',
        params: { from: 'agent-claude' },  // Missing 'to' and 'content'
      });

      const response = await server.handleIncomingMessage(message);
      expect(response.error?.code).toBe(ACPErrorCode.InvalidParams);
    });
  });

  // ===========================================================================
  // Agent Discovery
  // ===========================================================================

  describe('agent discovery', () => {
    beforeEach(async () => {
      await server.start();
      await server.registerAgent(
        createMockAgent({ id: 'agent-claude', capabilities: ['orchestration', 'coding'] }),
      );
      await server.registerAgent(
        createMockAgent({ id: 'agent-kiro', capabilities: ['code-review', 'testing'] }),
      );
    });

    it('should list all registered agents', () => {
      const agents = server.getRegisteredAgents();
      expect(agents).toHaveLength(2);
    });

    it('should find agents by capability', () => {
      const reviewers = server.findAgentsByCapability('code-review');
      expect(reviewers).toHaveLength(1);
      expect(reviewers[0].id).toBe('agent-kiro');
    });

    it('should return agent details by ID', () => {
      const agent = server.getAgent('agent-claude');
      expect(agent?.name).toBe('Claude Code');
      expect(agent?.capabilities).toContain('orchestration');
    });

    it('should return null for non-existent agent', () => {
      const agent = server.getAgent('nonexistent');
      expect(agent).toBeNull();
    });
  });
});

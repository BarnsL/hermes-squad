/**
 * =============================================================================
 * Hermes Squad — MCP (Model Context Protocol) Server Unit Tests
 * =============================================================================
 * Tests for the MCP server implementation which exposes Hermes Squad's
 * capabilities to external AI tools:
 * - Tool registration and invocation
 * - Resource listing and reading
 * - Prompt templates
 * - Protocol compliance (JSON-RPC 2.0 over stdio)
 * - Context window management
 *
 * Reference: https://modelcontextprotocol.io/specification
 * =============================================================================
 */

import { Readable, Writable, PassThrough } from 'stream';

import type {
  MCPRequest,
  MCPResponse,
  MCPTool,
  MCPResource,
  MCPPrompt,
  ServerCapabilities,
} from '@mcp/types';

// --- Mocks ---

// Mock the session manager (provides session data to MCP tools)
jest.mock('@core/session-manager', () => ({
  SessionManager: jest.fn().mockImplementation(() => ({
    getAllSessions: jest.fn().mockReturnValue([
      { id: 'session_1', agentName: 'claude', state: 'running' },
      { id: 'session_2', agentName: 'kiro', state: 'paused' },
    ]),
    getSession: jest.fn().mockImplementation((id: string) => {
      if (id === 'session_1') return { id: 'session_1', agentName: 'claude', state: 'running' };
      return null;
    }),
    createSession: jest.fn().mockResolvedValue({ id: 'session_new', agentName: 'test' }),
    startSession: jest.fn().mockResolvedValue(undefined),
    stopSession: jest.fn().mockResolvedValue(undefined),
    sendToSession: jest.fn().mockResolvedValue(undefined),
  })),
}));

// Mock the skill registry
jest.mock('@skills/skill-manager', () => ({
  SkillManager: jest.fn().mockImplementation(() => ({
    listSkills: jest.fn().mockReturnValue([
      { name: 'git-operations', version: '1.0.0' },
      { name: 'file-management', version: '1.0.0' },
    ]),
    executeSkill: jest.fn().mockResolvedValue({ success: true, output: 'Done' }),
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
 * Creates a mock MCP JSON-RPC request
 */
function createMCPRequest(method: string, params?: Record<string, unknown>): MCPRequest {
  return {
    jsonrpc: '2.0',
    id: Math.floor(Math.random() * 10000),
    method,
    params: params ?? {},
  };
}

/**
 * Helper to simulate MCP communication via stdio streams
 */
class MockMCPTransport {
  public readonly input: PassThrough;
  public readonly output: PassThrough;
  private responses: MCPResponse[] = [];

  constructor() {
    this.input = new PassThrough();
    this.output = new PassThrough();

    // Collect responses from the server
    this.output.on('data', (chunk: Buffer) => {
      const lines = chunk.toString().split('\n').filter(Boolean);
      for (const line of lines) {
        try {
          this.responses.push(JSON.parse(line));
        } catch {
          // Skip non-JSON lines (headers, etc.)
        }
      }
    });
  }

  public sendRequest(request: MCPRequest): void {
    const message = JSON.stringify(request) + '\n';
    this.input.push(message);
  }

  public getLatestResponse(): MCPResponse | undefined {
    return this.responses[this.responses.length - 1];
  }

  public getAllResponses(): MCPResponse[] {
    return [...this.responses];
  }

  public clearResponses(): void {
    this.responses = [];
  }
}

// --- Import the module under test ---
import { MCPServer } from '@mcp/server';
import { MCPErrorCode } from '@mcp/errors';

describe('MCPServer', () => {
  let server: MCPServer;
  let transport: MockMCPTransport;

  beforeEach(() => {
    transport = new MockMCPTransport();
    server = new MCPServer({
      name: 'hermes-squad',
      version: '0.1.0',
      transport: {
        input: transport.input,
        output: transport.output,
      },
    });
  });

  afterEach(async () => {
    await server.close();
  });

  // ===========================================================================
  // Initialization & Handshake
  // ===========================================================================

  describe('initialization', () => {
    it('should respond to initialize request with server capabilities', async () => {
      await server.start();

      transport.sendRequest(createMCPRequest('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'test-client', version: '1.0.0' },
      }));

      // Wait for response processing
      await new Promise((resolve) => setTimeout(resolve, 50));

      const response = transport.getLatestResponse();
      expect(response?.result).toBeDefined();
      expect(response?.result?.protocolVersion).toBe('2024-11-05');
      expect(response?.result?.capabilities).toMatchObject({
        tools: { listChanged: true },
        resources: { subscribe: true, listChanged: true },
        prompts: { listChanged: true },
      });
      expect(response?.result?.serverInfo).toMatchObject({
        name: 'hermes-squad',
        version: '0.1.0',
      });
    });

    it('should reject unsupported protocol versions', async () => {
      await server.start();

      transport.sendRequest(createMCPRequest('initialize', {
        protocolVersion: '2020-01-01',  // Too old
        capabilities: {},
        clientInfo: { name: 'old-client', version: '0.1.0' },
      }));

      await new Promise((resolve) => setTimeout(resolve, 50));

      const response = transport.getLatestResponse();
      expect(response?.error).toBeDefined();
      expect(response?.error?.code).toBe(MCPErrorCode.InvalidRequest);
    });

    it('should handle initialized notification', async () => {
      await server.start();

      // Initialize first
      transport.sendRequest(createMCPRequest('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'test-client', version: '1.0.0' },
      }));

      await new Promise((resolve) => setTimeout(resolve, 50));

      // Then send initialized notification (no id = notification)
      transport.input.push(JSON.stringify({
        jsonrpc: '2.0',
        method: 'notifications/initialized',
      }) + '\n');

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(server.isInitialized()).toBe(true);
    });
  });

  // ===========================================================================
  // Tool Registration & Invocation
  // ===========================================================================

  describe('tools/list', () => {
    beforeEach(async () => {
      await server.start();
      // Complete initialization handshake
      transport.sendRequest(createMCPRequest('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'test', version: '1.0' },
      }));
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    it('should list all registered tools', async () => {
      transport.sendRequest(createMCPRequest('tools/list'));
      await new Promise((resolve) => setTimeout(resolve, 50));

      const response = transport.getLatestResponse();
      expect(response?.result?.tools).toBeDefined();
      expect(Array.isArray(response?.result?.tools)).toBe(true);

      const tools: MCPTool[] = response?.result?.tools;
      // Hermes Squad should expose session management tools
      const toolNames = tools.map((t) => t.name);
      expect(toolNames).toContain('session_create');
      expect(toolNames).toContain('session_list');
      expect(toolNames).toContain('session_send_message');
      expect(toolNames).toContain('session_stop');
      expect(toolNames).toContain('agent_status');
    });

    it('should include proper input schemas for each tool', async () => {
      transport.sendRequest(createMCPRequest('tools/list'));
      await new Promise((resolve) => setTimeout(resolve, 50));

      const response = transport.getLatestResponse();
      const tools: MCPTool[] = response?.result?.tools;

      const sessionCreate = tools.find((t) => t.name === 'session_create');
      expect(sessionCreate?.inputSchema).toBeDefined();
      expect(sessionCreate?.inputSchema.type).toBe('object');
      expect(sessionCreate?.inputSchema.properties).toHaveProperty('agentName');
      expect(sessionCreate?.inputSchema.properties).toHaveProperty('prompt');
      expect(sessionCreate?.inputSchema.required).toContain('agentName');
    });
  });

  describe('tools/call', () => {
    beforeEach(async () => {
      await server.start();
      transport.sendRequest(createMCPRequest('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'test', version: '1.0' },
      }));
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    it('should execute session_list tool and return active sessions', async () => {
      transport.sendRequest(createMCPRequest('tools/call', {
        name: 'session_list',
        arguments: {},
      }));
      await new Promise((resolve) => setTimeout(resolve, 50));

      const response = transport.getLatestResponse();
      expect(response?.result?.content).toBeDefined();
      expect(response?.result?.content[0]?.type).toBe('text');

      const sessions = JSON.parse(response?.result?.content[0]?.text);
      expect(sessions).toHaveLength(2);
      expect(sessions[0].agentName).toBe('claude');
    });

    it('should execute session_create tool', async () => {
      transport.sendRequest(createMCPRequest('tools/call', {
        name: 'session_create',
        arguments: {
          agentName: 'codex',
          prompt: 'Implement the user API',
          worktree: true,
        },
      }));
      await new Promise((resolve) => setTimeout(resolve, 50));

      const response = transport.getLatestResponse();
      expect(response?.result?.content[0]?.type).toBe('text');
      expect(response?.result?.isError).toBeFalsy();
    });

    it('should execute session_send_message tool', async () => {
      transport.sendRequest(createMCPRequest('tools/call', {
        name: 'session_send_message',
        arguments: {
          sessionId: 'session_1',
          message: 'Add error handling to the login function',
        },
      }));
      await new Promise((resolve) => setTimeout(resolve, 50));

      const response = transport.getLatestResponse();
      expect(response?.result?.isError).toBeFalsy();
    });

    it('should return error for unknown tool', async () => {
      transport.sendRequest(createMCPRequest('tools/call', {
        name: 'nonexistent_tool',
        arguments: {},
      }));
      await new Promise((resolve) => setTimeout(resolve, 50));

      const response = transport.getLatestResponse();
      expect(response?.result?.isError).toBe(true);
      expect(response?.result?.content[0]?.text).toContain('Unknown tool');
    });

    it('should validate tool arguments against schema', async () => {
      transport.sendRequest(createMCPRequest('tools/call', {
        name: 'session_create',
        arguments: {
          // Missing required 'agentName' parameter
          prompt: 'Do something',
        },
      }));
      await new Promise((resolve) => setTimeout(resolve, 50));

      const response = transport.getLatestResponse();
      expect(response?.result?.isError).toBe(true);
      expect(response?.result?.content[0]?.text).toContain('agentName');
    });
  });

  // ===========================================================================
  // Resources
  // ===========================================================================

  describe('resources/list', () => {
    beforeEach(async () => {
      await server.start();
      transport.sendRequest(createMCPRequest('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'test', version: '1.0' },
      }));
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    it('should list available resources', async () => {
      transport.sendRequest(createMCPRequest('resources/list'));
      await new Promise((resolve) => setTimeout(resolve, 50));

      const response = transport.getLatestResponse();
      const resources: MCPResource[] = response?.result?.resources;

      expect(resources).toBeDefined();
      expect(Array.isArray(resources)).toBe(true);

      // Should expose session outputs as resources
      const uris = resources.map((r) => r.uri);
      expect(uris).toContain('hermes://sessions/session_1/output');
      expect(uris).toContain('hermes://sessions/session_2/output');
    });

    it('should include resource metadata', async () => {
      transport.sendRequest(createMCPRequest('resources/list'));
      await new Promise((resolve) => setTimeout(resolve, 50));

      const response = transport.getLatestResponse();
      const resources: MCPResource[] = response?.result?.resources;

      const sessionResource = resources.find((r) => r.uri.includes('session_1'));
      expect(sessionResource?.name).toContain('claude');
      expect(sessionResource?.mimeType).toBe('text/plain');
    });
  });

  describe('resources/read', () => {
    beforeEach(async () => {
      await server.start();
      transport.sendRequest(createMCPRequest('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'test', version: '1.0' },
      }));
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    it('should read session output resource', async () => {
      transport.sendRequest(createMCPRequest('resources/read', {
        uri: 'hermes://sessions/session_1/output',
      }));
      await new Promise((resolve) => setTimeout(resolve, 50));

      const response = transport.getLatestResponse();
      expect(response?.result?.contents).toBeDefined();
      expect(response?.result?.contents[0]?.uri).toBe('hermes://sessions/session_1/output');
    });

    it('should return error for non-existent resource', async () => {
      transport.sendRequest(createMCPRequest('resources/read', {
        uri: 'hermes://sessions/nonexistent/output',
      }));
      await new Promise((resolve) => setTimeout(resolve, 50));

      const response = transport.getLatestResponse();
      expect(response?.error).toBeDefined();
      expect(response?.error?.code).toBe(MCPErrorCode.ResourceNotFound);
    });
  });

  // ===========================================================================
  // Prompts
  // ===========================================================================

  describe('prompts/list', () => {
    beforeEach(async () => {
      await server.start();
      transport.sendRequest(createMCPRequest('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'test', version: '1.0' },
      }));
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    it('should list available prompt templates', async () => {
      transport.sendRequest(createMCPRequest('prompts/list'));
      await new Promise((resolve) => setTimeout(resolve, 50));

      const response = transport.getLatestResponse();
      const prompts: MCPPrompt[] = response?.result?.prompts;

      expect(prompts).toBeDefined();
      const promptNames = prompts.map((p) => p.name);
      expect(promptNames).toContain('delegate_task');
      expect(promptNames).toContain('review_session_output');
      expect(promptNames).toContain('orchestrate_multi_agent');
    });

    it('should include argument definitions for prompts', async () => {
      transport.sendRequest(createMCPRequest('prompts/list'));
      await new Promise((resolve) => setTimeout(resolve, 50));

      const response = transport.getLatestResponse();
      const prompts: MCPPrompt[] = response?.result?.prompts;

      const delegatePrompt = prompts.find((p) => p.name === 'delegate_task');
      expect(delegatePrompt?.arguments).toBeDefined();
      expect(delegatePrompt?.arguments).toContainEqual(
        expect.objectContaining({ name: 'task_description', required: true }),
      );
    });
  });

  describe('prompts/get', () => {
    beforeEach(async () => {
      await server.start();
      transport.sendRequest(createMCPRequest('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'test', version: '1.0' },
      }));
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    it('should return rendered prompt with arguments', async () => {
      transport.sendRequest(createMCPRequest('prompts/get', {
        name: 'delegate_task',
        arguments: {
          task_description: 'Implement user authentication',
          target_agent: 'kiro',
        },
      }));
      await new Promise((resolve) => setTimeout(resolve, 50));

      const response = transport.getLatestResponse();
      expect(response?.result?.messages).toBeDefined();
      expect(response?.result?.messages[0]?.content?.text).toContain(
        'Implement user authentication',
      );
    });
  });

  // ===========================================================================
  // Error Handling
  // ===========================================================================

  describe('error handling', () => {
    beforeEach(async () => {
      await server.start();
    });

    it('should return parse error for malformed JSON', async () => {
      transport.input.push('{ invalid json }\n');
      await new Promise((resolve) => setTimeout(resolve, 50));

      const response = transport.getLatestResponse();
      expect(response?.error?.code).toBe(MCPErrorCode.ParseError);
    });

    it('should return method not found for unknown methods', async () => {
      transport.sendRequest(createMCPRequest('unknown/method'));
      await new Promise((resolve) => setTimeout(resolve, 50));

      const response = transport.getLatestResponse();
      expect(response?.error?.code).toBe(MCPErrorCode.MethodNotFound);
    });

    it('should handle internal errors gracefully', async () => {
      // Force an internal error by making session manager throw
      const { SessionManager } = jest.requireMock('@core/session-manager');
      SessionManager.mock.results[0].value.getAllSessions.mockImplementation(() => {
        throw new Error('Database connection failed');
      });

      transport.sendRequest(createMCPRequest('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'test', version: '1.0' },
      }));
      await new Promise((resolve) => setTimeout(resolve, 50));

      transport.sendRequest(createMCPRequest('tools/call', {
        name: 'session_list',
        arguments: {},
      }));
      await new Promise((resolve) => setTimeout(resolve, 50));

      const response = transport.getLatestResponse();
      expect(response?.result?.isError).toBe(true);
      expect(response?.result?.content[0]?.text).toContain('Internal error');
    });
  });
});

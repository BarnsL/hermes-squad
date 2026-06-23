/**
 * =============================================================================
 * Hermes Squad — Session Manager Unit Tests
 * =============================================================================
 * Tests for the core SessionManager class which handles:
 * - Creating and destroying coding agent sessions
 * - Managing session lifecycle (start, pause, resume, stop)
 * - Session state persistence and recovery
 * - Multi-session orchestration (parallel agent management)
 * - Resource cleanup and graceful shutdown
 * =============================================================================
 */

import { EventEmitter } from 'events';

import type { AgentConfig } from '@core/types';
import type { PTYProcess } from '@core/pty-manager';

// --- Mocks ---

// Mock the PTY manager (spawns terminal processes for agents)
jest.mock('@core/pty-manager', () => ({
  PTYManager: jest.fn().mockImplementation(() => ({
    spawn: jest.fn().mockResolvedValue(mockPTYProcess),
    kill: jest.fn().mockResolvedValue(undefined),
    resize: jest.fn(),
    write: jest.fn(),
    getActivePTYs: jest.fn().mockReturnValue([]),
  })),
}));

// Mock the git worktree manager
jest.mock('@core/git-worktree', () => ({
  GitWorktreeManager: jest.fn().mockImplementation(() => ({
    create: jest.fn().mockResolvedValue('/tmp/worktree-abc123'),
    remove: jest.fn().mockResolvedValue(undefined),
    list: jest.fn().mockResolvedValue([]),
    merge: jest.fn().mockResolvedValue({ success: true, conflicts: [] }),
  })),
}));

// Mock the state persistence layer
jest.mock('@core/state-store', () => ({
  StateStore: jest.fn().mockImplementation(() => ({
    save: jest.fn().mockResolvedValue(undefined),
    load: jest.fn().mockResolvedValue(null),
    delete: jest.fn().mockResolvedValue(undefined),
    list: jest.fn().mockResolvedValue([]),
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

// --- Mock Data ---

const mockPTYProcess: PTYProcess = {
  pid: 12345,
  onData: jest.fn(),
  onExit: jest.fn(),
  write: jest.fn(),
  resize: jest.fn(),
  kill: jest.fn(),
};

const createMockAgentConfig = (overrides?: Partial<AgentConfig>): AgentConfig => ({
  name: 'claude',
  displayName: 'Claude Code',
  command: 'claude',
  args: ['--chat'],
  cwd: '/home/user/project',
  env: { ANTHROPIC_API_KEY: 'test-key' },
  color: '#FF6B35',
  shortcut: 'c',
  worktreeEnabled: true,
  ...overrides,
});

// --- Import the module under test (after mocks are set up) ---
import { SessionManager } from '@core/session-manager';
import { SessionState, SessionEvent } from '@core/types';

describe('SessionManager', () => {
  let sessionManager: SessionManager;

  beforeEach(() => {
    // Create a fresh SessionManager for each test
    sessionManager = new SessionManager({
      projectRoot: '/home/user/project',
      maxConcurrentSessions: 5,
      enableWorktrees: true,
      stateDir: '/tmp/hermes-state',
    });
  });

  afterEach(async () => {
    // Ensure all sessions are cleaned up after each test
    await sessionManager.destroyAll();
  });

  // ===========================================================================
  // Session Creation
  // ===========================================================================

  describe('createSession', () => {
    it('should create a new session with a unique ID', async () => {
      const config = createMockAgentConfig();
      const session = await sessionManager.createSession(config);

      expect(session).toBeDefined();
      expect(session.id).toMatch(/^session_[a-z0-9]{8}$/);
      expect(session.agentName).toBe('claude');
      expect(session.state).toBe(SessionState.Created);
    });

    it('should assign sequential display indices', async () => {
      const session1 = await sessionManager.createSession(createMockAgentConfig({ name: 'claude' }));
      const session2 = await sessionManager.createSession(createMockAgentConfig({ name: 'kiro' }));
      const session3 = await sessionManager.createSession(createMockAgentConfig({ name: 'codex' }));

      expect(session1.displayIndex).toBe(0);
      expect(session2.displayIndex).toBe(1);
      expect(session3.displayIndex).toBe(2);
    });

    it('should reject creation when max concurrent sessions is reached', async () => {
      // Create max sessions
      const maxSessions = 5;
      for (let i = 0; i < maxSessions; i++) {
        await sessionManager.createSession(createMockAgentConfig({ name: `agent-${i}` }));
      }

      // Attempt to create one more
      await expect(
        sessionManager.createSession(createMockAgentConfig({ name: 'one-too-many' })),
      ).rejects.toThrow('Maximum concurrent sessions (5) reached');
    });

    it('should create a git worktree when worktreeEnabled is true', async () => {
      const config = createMockAgentConfig({ worktreeEnabled: true });
      const session = await sessionManager.createSession(config);

      expect(session.worktreePath).toBe('/tmp/worktree-abc123');
    });

    it('should skip worktree creation when worktreeEnabled is false', async () => {
      const config = createMockAgentConfig({ worktreeEnabled: false });
      const session = await sessionManager.createSession(config);

      expect(session.worktreePath).toBeNull();
    });

    it('should emit a SessionCreated event', async () => {
      const eventHandler = jest.fn();
      sessionManager.on(SessionEvent.Created, eventHandler);

      const config = createMockAgentConfig();
      const session = await sessionManager.createSession(config);

      expect(eventHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: session.id,
          agentName: 'claude',
        }),
      );
    });
  });

  // ===========================================================================
  // Session Lifecycle
  // ===========================================================================

  describe('startSession', () => {
    it('should transition session from Created to Running', async () => {
      const config = createMockAgentConfig();
      const session = await sessionManager.createSession(config);

      await sessionManager.startSession(session.id);

      const updated = sessionManager.getSession(session.id);
      expect(updated?.state).toBe(SessionState.Running);
    });

    it('should spawn a PTY process for the agent', async () => {
      const config = createMockAgentConfig();
      const session = await sessionManager.createSession(config);

      await sessionManager.startSession(session.id);

      const updated = sessionManager.getSession(session.id);
      expect(updated?.ptyPid).toBe(12345);
    });

    it('should throw if session does not exist', async () => {
      await expect(sessionManager.startSession('nonexistent_id')).rejects.toThrow(
        'Session not found: nonexistent_id',
      );
    });

    it('should throw if session is already running', async () => {
      const session = await sessionManager.createSession(createMockAgentConfig());
      await sessionManager.startSession(session.id);

      await expect(sessionManager.startSession(session.id)).rejects.toThrow(
        'Session is already running',
      );
    });

    it('should pass initial prompt to the agent if provided', async () => {
      const config = createMockAgentConfig();
      const session = await sessionManager.createSession(config);

      await sessionManager.startSession(session.id, {
        initialPrompt: 'Implement the login feature',
      });

      expect(mockPTYProcess.write).toHaveBeenCalledWith(
        expect.stringContaining('Implement the login feature'),
      );
    });
  });

  describe('pauseSession', () => {
    it('should transition session from Running to Paused', async () => {
      const session = await sessionManager.createSession(createMockAgentConfig());
      await sessionManager.startSession(session.id);

      await sessionManager.pauseSession(session.id);

      const updated = sessionManager.getSession(session.id);
      expect(updated?.state).toBe(SessionState.Paused);
    });

    it('should send SIGTSTP to the PTY process', async () => {
      const session = await sessionManager.createSession(createMockAgentConfig());
      await sessionManager.startSession(session.id);

      await sessionManager.pauseSession(session.id);

      // Verify signal was sent to pause the process
      expect(mockPTYProcess.kill).toHaveBeenCalledWith('SIGTSTP');
    });

    it('should record pause timestamp', async () => {
      const session = await sessionManager.createSession(createMockAgentConfig());
      await sessionManager.startSession(session.id);

      const beforePause = Date.now();
      await sessionManager.pauseSession(session.id);

      const updated = sessionManager.getSession(session.id);
      expect(updated?.pausedAt).toBeGreaterThanOrEqual(beforePause);
    });
  });

  describe('resumeSession', () => {
    it('should transition session from Paused back to Running', async () => {
      const session = await sessionManager.createSession(createMockAgentConfig());
      await sessionManager.startSession(session.id);
      await sessionManager.pauseSession(session.id);

      await sessionManager.resumeSession(session.id);

      const updated = sessionManager.getSession(session.id);
      expect(updated?.state).toBe(SessionState.Running);
    });

    it('should send SIGCONT to resume the PTY process', async () => {
      const session = await sessionManager.createSession(createMockAgentConfig());
      await sessionManager.startSession(session.id);
      await sessionManager.pauseSession(session.id);

      await sessionManager.resumeSession(session.id);

      expect(mockPTYProcess.kill).toHaveBeenCalledWith('SIGCONT');
    });
  });

  describe('stopSession', () => {
    it('should transition session to Stopped state', async () => {
      const session = await sessionManager.createSession(createMockAgentConfig());
      await sessionManager.startSession(session.id);

      await sessionManager.stopSession(session.id);

      const updated = sessionManager.getSession(session.id);
      expect(updated?.state).toBe(SessionState.Stopped);
    });

    it('should gracefully terminate the PTY process', async () => {
      const session = await sessionManager.createSession(createMockAgentConfig());
      await sessionManager.startSession(session.id);

      await sessionManager.stopSession(session.id);

      // Should first try SIGTERM, then SIGKILL after timeout
      expect(mockPTYProcess.kill).toHaveBeenCalledWith('SIGTERM');
    });

    it('should clean up worktree on stop', async () => {
      const config = createMockAgentConfig({ worktreeEnabled: true });
      const session = await sessionManager.createSession(config);
      await sessionManager.startSession(session.id);

      await sessionManager.stopSession(session.id, { cleanupWorktree: true });

      // GitWorktreeManager.remove should have been called
      const { GitWorktreeManager } = jest.requireMock('@core/git-worktree');
      const mockInstance = GitWorktreeManager.mock.results[0].value;
      expect(mockInstance.remove).toHaveBeenCalled();
    });

    it('should persist session output before stopping', async () => {
      const session = await sessionManager.createSession(createMockAgentConfig());
      await sessionManager.startSession(session.id);

      await sessionManager.stopSession(session.id);

      const { StateStore } = jest.requireMock('@core/state-store');
      const storeInstance = StateStore.mock.results[0].value;
      expect(storeInstance.save).toHaveBeenCalledWith(
        expect.stringContaining(session.id),
        expect.objectContaining({ state: SessionState.Stopped }),
      );
    });
  });

  // ===========================================================================
  // Multi-Session Management
  // ===========================================================================

  describe('getAllSessions', () => {
    it('should return all active sessions', async () => {
      await sessionManager.createSession(createMockAgentConfig({ name: 'claude' }));
      await sessionManager.createSession(createMockAgentConfig({ name: 'kiro' }));
      await sessionManager.createSession(createMockAgentConfig({ name: 'codex' }));

      const sessions = sessionManager.getAllSessions();
      expect(sessions).toHaveLength(3);
      expect(sessions.map((s) => s.agentName)).toEqual(['claude', 'kiro', 'codex']);
    });

    it('should return empty array when no sessions exist', () => {
      const sessions = sessionManager.getAllSessions();
      expect(sessions).toEqual([]);
    });
  });

  describe('getSessionsByState', () => {
    it('should filter sessions by state', async () => {
      const s1 = await sessionManager.createSession(createMockAgentConfig({ name: 'claude' }));
      const s2 = await sessionManager.createSession(createMockAgentConfig({ name: 'kiro' }));
      await sessionManager.startSession(s1.id);

      const running = sessionManager.getSessionsByState(SessionState.Running);
      const created = sessionManager.getSessionsByState(SessionState.Created);

      expect(running).toHaveLength(1);
      expect(running[0].agentName).toBe('claude');
      expect(created).toHaveLength(1);
      expect(created[0].agentName).toBe('kiro');
    });
  });

  describe('destroyAll', () => {
    it('should stop and clean up all sessions', async () => {
      const s1 = await sessionManager.createSession(createMockAgentConfig({ name: 'claude' }));
      const s2 = await sessionManager.createSession(createMockAgentConfig({ name: 'kiro' }));
      await sessionManager.startSession(s1.id);
      await sessionManager.startSession(s2.id);

      await sessionManager.destroyAll();

      expect(sessionManager.getAllSessions()).toHaveLength(0);
    });

    it('should emit Destroyed event for each session', async () => {
      const eventHandler = jest.fn();
      sessionManager.on(SessionEvent.Destroyed, eventHandler);

      await sessionManager.createSession(createMockAgentConfig({ name: 'claude' }));
      await sessionManager.createSession(createMockAgentConfig({ name: 'kiro' }));

      await sessionManager.destroyAll();

      expect(eventHandler).toHaveBeenCalledTimes(2);
    });
  });

  // ===========================================================================
  // Session Recovery
  // ===========================================================================

  describe('recoverSessions', () => {
    it('should restore sessions from persisted state', async () => {
      // Mock the state store to return previously saved sessions
      const { StateStore } = jest.requireMock('@core/state-store');
      const storeInstance = StateStore.mock.results[0]?.value;
      if (storeInstance) {
        storeInstance.list.mockResolvedValue([
          {
            id: 'session_recovered1',
            agentName: 'claude',
            state: SessionState.Running,
            config: createMockAgentConfig({ name: 'claude' }),
            createdAt: Date.now() - 60000,
          },
        ]);
      }

      const recovered = await sessionManager.recoverSessions();

      expect(recovered).toHaveLength(1);
      expect(recovered[0].agentName).toBe('claude');
    });

    it('should mark recovered sessions as NeedsRestart', async () => {
      const { StateStore } = jest.requireMock('@core/state-store');
      const storeInstance = StateStore.mock.results[0]?.value;
      if (storeInstance) {
        storeInstance.list.mockResolvedValue([
          {
            id: 'session_recovered2',
            agentName: 'kiro',
            state: SessionState.Running,
            config: createMockAgentConfig({ name: 'kiro' }),
            createdAt: Date.now() - 60000,
          },
        ]);
      }

      const recovered = await sessionManager.recoverSessions();

      // Running sessions should be marked as needing restart since the PTY is gone
      expect(recovered[0].state).toBe(SessionState.NeedsRestart);
    });
  });

  // ===========================================================================
  // Resource Management
  // ===========================================================================

  describe('resource limits', () => {
    it('should track total memory usage across sessions', async () => {
      await sessionManager.createSession(createMockAgentConfig({ name: 'claude' }));
      await sessionManager.createSession(createMockAgentConfig({ name: 'kiro' }));

      const stats = sessionManager.getResourceStats();
      expect(stats.totalSessions).toBe(2);
      expect(stats.memoryUsageMB).toBeGreaterThanOrEqual(0);
    });

    it('should emit warning when approaching resource limits', async () => {
      const warningHandler = jest.fn();
      sessionManager.on(SessionEvent.ResourceWarning, warningHandler);

      // Create sessions up to the warning threshold (80% of max)
      for (let i = 0; i < 4; i++) {
        await sessionManager.createSession(createMockAgentConfig({ name: `agent-${i}` }));
      }

      expect(warningHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          currentSessions: 4,
          maxSessions: 5,
          utilizationPercent: 80,
        }),
      );
    });
  });

  // ===========================================================================
  // Error Handling
  // ===========================================================================

  describe('error handling', () => {
    it('should handle PTY spawn failures gracefully', async () => {
      // Make PTY spawn fail
      const { PTYManager } = jest.requireMock('@core/pty-manager');
      PTYManager.mock.results[0].value.spawn.mockRejectedValueOnce(
        new Error('Failed to spawn PTY: command not found'),
      );

      const session = await sessionManager.createSession(createMockAgentConfig());

      await expect(sessionManager.startSession(session.id)).rejects.toThrow(
        'Failed to spawn PTY',
      );

      // Session should be in Error state, not Running
      const updated = sessionManager.getSession(session.id);
      expect(updated?.state).toBe(SessionState.Error);
    });

    it('should handle unexpected PTY exit', async () => {
      const exitHandler = jest.fn();
      sessionManager.on(SessionEvent.UnexpectedExit, exitHandler);

      const session = await sessionManager.createSession(createMockAgentConfig());
      await sessionManager.startSession(session.id);

      // Simulate PTY process exiting unexpectedly
      const onExitCallback = (mockPTYProcess.onExit as jest.Mock).mock.calls[0]?.[0];
      if (onExitCallback) {
        onExitCallback({ exitCode: 1, signal: 'SIGKILL' });
      }

      expect(exitHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: session.id,
          exitCode: 1,
          signal: 'SIGKILL',
        }),
      );
    });
  });
});

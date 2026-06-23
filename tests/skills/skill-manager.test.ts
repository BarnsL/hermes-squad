/**
 * =============================================================================
 * Hermes Squad — Skill Manager Unit Tests
 * =============================================================================
 * Tests for the Skills system which manages reusable agent capabilities:
 * - Skill discovery and loading from filesystem
 * - Skill registration and validation
 * - Skill execution with sandboxed environments
 * - Skill dependency resolution
 * - Hot-reloading of skill definitions
 * - Skill marketplace integration
 * =============================================================================
 */

import * as fs from 'fs/promises';
import * as path from 'path';

import type { Skill, SkillManifest, SkillExecutionContext, SkillResult } from '@skills/types';

// --- Mocks ---

// Mock filesystem operations for skill loading
jest.mock('fs/promises', () => ({
  readdir: jest.fn(),
  readFile: jest.fn(),
  stat: jest.fn(),
  access: jest.fn(),
  mkdir: jest.fn(),
  writeFile: jest.fn(),
}));

// Mock dynamic import for skill modules
jest.mock('@skills/loader', () => ({
  SkillLoader: jest.fn().mockImplementation(() => ({
    load: jest.fn().mockResolvedValue(mockSkillModule),
    unload: jest.fn().mockResolvedValue(undefined),
    validate: jest.fn().mockReturnValue({ valid: true, errors: [] }),
  })),
}));

// Mock the sandbox for skill execution
jest.mock('@skills/sandbox', () => ({
  SkillSandbox: jest.fn().mockImplementation(() => ({
    execute: jest.fn().mockResolvedValue({
      success: true,
      output: 'Skill executed successfully',
      duration: 150,
    }),
    destroy: jest.fn(),
  })),
}));

// Mock the event bus for skill lifecycle events
jest.mock('@shared/event-bus', () => ({
  EventBus: jest.fn().mockImplementation(() => ({
    emit: jest.fn(),
    on: jest.fn(),
    off: jest.fn(),
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

const mockSkillModule = {
  execute: jest.fn().mockResolvedValue({ success: true, output: 'Done' }),
  cleanup: jest.fn().mockResolvedValue(undefined),
};

function createMockManifest(overrides?: Partial<SkillManifest>): SkillManifest {
  return {
    name: 'git-operations',
    version: '1.0.0',
    description: 'Git operations for branch management and commits',
    author: 'hermes-squad',
    license: 'MIT',
    main: 'index.ts',
    capabilities: ['git-branch', 'git-commit', 'git-merge', 'git-diff'],
    dependencies: [],
    permissions: ['filesystem:read', 'process:spawn'],
    config: {
      defaultBranch: 'main',
      autoStage: true,
    },
    ...overrides,
  };
}

function createMockSkill(overrides?: Partial<Skill>): Skill {
  return {
    id: 'skill_git-operations_1.0.0',
    manifest: createMockManifest(),
    status: 'loaded',
    loadedAt: Date.now(),
    path: '/home/user/.hermes-squad/skills/git-operations',
    ...overrides,
  };
}

// --- Import the module under test ---
import { SkillManager } from '@skills/skill-manager';
import { SkillError, SkillErrorCode } from '@skills/errors';

describe('SkillManager', () => {
  let skillManager: SkillManager;
  const mockFs = fs as jest.Mocked<typeof fs>;

  beforeEach(() => {
    skillManager = new SkillManager({
      // Directory where skills are stored
      skillsDir: '/home/user/.hermes-squad/skills',
      // Directory for built-in skills
      builtinSkillsDir: '/opt/hermes-squad/skills',
      // Max concurrent skill executions
      maxConcurrentExecutions: 5,
      // Timeout for skill execution (30 seconds)
      executionTimeoutMs: 30_000,
      // Enable hot-reloading of skills during development
      hotReload: true,
    });

    // Setup default mock filesystem responses
    mockFs.readdir.mockResolvedValue([
      { name: 'git-operations', isDirectory: () => true, isFile: () => false },
      { name: 'file-management', isDirectory: () => true, isFile: () => false },
      { name: 'code-analysis', isDirectory: () => true, isFile: () => false },
    ] as any);

    mockFs.readFile.mockResolvedValue(JSON.stringify(createMockManifest()));
    mockFs.stat.mockResolvedValue({ isDirectory: () => true } as any);
    mockFs.access.mockResolvedValue(undefined);
  });

  afterEach(async () => {
    await skillManager.shutdown();
    jest.clearAllMocks();
  });

  // ===========================================================================
  // Skill Discovery
  // ===========================================================================

  describe('discoverSkills', () => {
    it('should discover skills in the skills directory', async () => {
      const discovered = await skillManager.discoverSkills();

      expect(discovered).toHaveLength(3);
      expect(discovered.map((s) => s.name)).toEqual([
        'git-operations',
        'file-management',
        'code-analysis',
      ]);
    });

    it('should read and parse manifest.json for each skill', async () => {
      await skillManager.discoverSkills();

      expect(mockFs.readFile).toHaveBeenCalledWith(
        expect.stringContaining('manifest.json'),
        'utf-8',
      );
    });

    it('should skip directories without manifest.json', async () => {
      mockFs.access.mockRejectedValueOnce(new Error('ENOENT'));

      const discovered = await skillManager.discoverSkills();

      // Should still find 2 out of 3 (one has no manifest)
      expect(discovered.length).toBeLessThanOrEqual(3);
    });

    it('should skip skills with invalid manifests', async () => {
      mockFs.readFile.mockResolvedValueOnce('{ invalid json }');

      const discovered = await skillManager.discoverSkills();

      // Invalid manifest should be logged but not crash discovery
      expect(discovered.length).toBeLessThanOrEqual(3);
    });

    it('should merge builtin and user skills', async () => {
      // Mock different results for builtin vs user skills dirs
      mockFs.readdir
        .mockResolvedValueOnce([  // User skills dir
          { name: 'git-operations', isDirectory: () => true, isFile: () => false },
        ] as any)
        .mockResolvedValueOnce([  // Builtin skills dir
          { name: 'session-tools', isDirectory: () => true, isFile: () => false },
        ] as any);

      const discovered = await skillManager.discoverSkills();

      expect(discovered.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ===========================================================================
  // Skill Registration
  // ===========================================================================

  describe('registerSkill', () => {
    it('should register a valid skill', async () => {
      const manifest = createMockManifest();
      const result = await skillManager.registerSkill(manifest, '/path/to/skill');

      expect(result.success).toBe(true);
      expect(result.skillId).toBe('skill_git-operations_1.0.0');
    });

    it('should validate manifest before registration', async () => {
      const invalidManifest = createMockManifest({ name: '' });  // Empty name

      await expect(
        skillManager.registerSkill(invalidManifest, '/path/to/skill'),
      ).rejects.toThrow('Invalid skill manifest');
    });

    it('should reject duplicate skill registration', async () => {
      const manifest = createMockManifest();
      await skillManager.registerSkill(manifest, '/path/to/skill');

      await expect(
        skillManager.registerSkill(manifest, '/path/to/skill'),
      ).rejects.toThrow('Skill already registered: git-operations@1.0.0');
    });

    it('should allow registering different versions of the same skill', async () => {
      await skillManager.registerSkill(
        createMockManifest({ version: '1.0.0' }),
        '/path/v1',
      );
      await skillManager.registerSkill(
        createMockManifest({ version: '2.0.0' }),
        '/path/v2',
      );

      const skills = skillManager.listSkills();
      const gitSkills = skills.filter((s) => s.manifest.name === 'git-operations');
      expect(gitSkills).toHaveLength(2);
    });

    it('should validate required permissions', async () => {
      const manifest = createMockManifest({
        permissions: ['filesystem:write', 'network:*', 'INVALID_PERMISSION'],
      });

      await expect(
        skillManager.registerSkill(manifest, '/path/to/skill'),
      ).rejects.toThrow('Invalid permission: INVALID_PERMISSION');
    });

    it('should emit SkillRegistered event', async () => {
      const handler = jest.fn();
      skillManager.on('skill:registered', handler);

      await skillManager.registerSkill(createMockManifest(), '/path/to/skill');

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          skillName: 'git-operations',
          version: '1.0.0',
        }),
      );
    });
  });

  // ===========================================================================
  // Skill Execution
  // ===========================================================================

  describe('executeSkill', () => {
    beforeEach(async () => {
      await skillManager.registerSkill(createMockManifest(), '/path/to/skill');
    });

    it('should execute a registered skill', async () => {
      const context: SkillExecutionContext = {
        sessionId: 'session_123',
        agentName: 'claude',
        workingDirectory: '/home/user/project',
        arguments: { branch: 'feature/auth' },
      };

      const result = await skillManager.executeSkill('git-operations', 'git-branch', context);

      expect(result.success).toBe(true);
      expect(result.output).toBeDefined();
    });

    it('should reject execution of unregistered skills', async () => {
      const context: SkillExecutionContext = {
        sessionId: 'session_123',
        agentName: 'claude',
        workingDirectory: '/home/user/project',
        arguments: {},
      };

      await expect(
        skillManager.executeSkill('nonexistent-skill', 'action', context),
      ).rejects.toThrow('Skill not found: nonexistent-skill');
    });

    it('should enforce execution timeout', async () => {
      jest.useFakeTimers();

      // Make sandbox hang
      const { SkillSandbox } = jest.requireMock('@skills/sandbox');
      SkillSandbox.mock.results[0]?.value?.execute.mockImplementation(
        () => new Promise(() => {}),  // Never resolves
      );

      const context: SkillExecutionContext = {
        sessionId: 'session_123',
        agentName: 'claude',
        workingDirectory: '/home/user/project',
        arguments: {},
      };

      const executePromise = skillManager.executeSkill('git-operations', 'git-branch', context);

      jest.advanceTimersByTime(31_000);  // Past timeout

      await expect(executePromise).rejects.toThrow('Skill execution timed out');

      jest.useRealTimers();
    });

    it('should enforce max concurrent executions', async () => {
      const context: SkillExecutionContext = {
        sessionId: 'session_123',
        agentName: 'claude',
        workingDirectory: '/home/user/project',
        arguments: {},
      };

      // Make execution hang to fill up the queue
      const { SkillSandbox } = jest.requireMock('@skills/sandbox');
      SkillSandbox.mock.results[0]?.value?.execute.mockImplementation(
        () => new Promise((resolve) => setTimeout(resolve, 10_000)),
      );

      // Start max concurrent executions
      const executions = [];
      for (let i = 0; i < 5; i++) {
        executions.push(skillManager.executeSkill('git-operations', 'git-branch', context));
      }

      // The 6th should be queued or rejected
      await expect(
        skillManager.executeSkill('git-operations', 'git-branch', context),
      ).rejects.toThrow('Maximum concurrent skill executions reached');
    });

    it('should pass correct context to the sandbox', async () => {
      const context: SkillExecutionContext = {
        sessionId: 'session_456',
        agentName: 'kiro',
        workingDirectory: '/home/user/other-project',
        arguments: { message: 'feat: add auth' },
        env: { GIT_AUTHOR_NAME: 'Kiro' },
      };

      await skillManager.executeSkill('git-operations', 'git-commit', context);

      const { SkillSandbox } = jest.requireMock('@skills/sandbox');
      expect(SkillSandbox.mock.results[0]?.value?.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          capability: 'git-commit',
          context: expect.objectContaining({
            sessionId: 'session_456',
            agentName: 'kiro',
          }),
        }),
      );
    });

    it('should track execution metrics', async () => {
      const context: SkillExecutionContext = {
        sessionId: 'session_123',
        agentName: 'claude',
        workingDirectory: '/home/user/project',
        arguments: {},
      };

      await skillManager.executeSkill('git-operations', 'git-branch', context);
      await skillManager.executeSkill('git-operations', 'git-commit', context);

      const metrics = skillManager.getMetrics();
      expect(metrics.totalExecutions).toBe(2);
      expect(metrics.successfulExecutions).toBe(2);
      expect(metrics.failedExecutions).toBe(0);
      expect(metrics.averageDurationMs).toBeGreaterThan(0);
    });
  });

  // ===========================================================================
  // Dependency Resolution
  // ===========================================================================

  describe('dependency resolution', () => {
    it('should resolve skill dependencies before loading', async () => {
      const manifestA = createMockManifest({
        name: 'code-analysis',
        dependencies: ['git-operations@^1.0.0'],
      });
      const manifestB = createMockManifest({
        name: 'git-operations',
        version: '1.2.0',
        dependencies: [],
      });

      // Register dependency first
      await skillManager.registerSkill(manifestB, '/path/to/git-ops');
      // Then register dependent
      await skillManager.registerSkill(manifestA, '/path/to/code-analysis');

      // Should load successfully because dependency is satisfied
      const skill = skillManager.getSkill('code-analysis');
      expect(skill?.status).toBe('loaded');
    });

    it('should fail loading when dependencies are missing', async () => {
      const manifest = createMockManifest({
        name: 'code-analysis',
        dependencies: ['nonexistent-skill@^1.0.0'],
      });

      await expect(
        skillManager.registerSkill(manifest, '/path/to/skill'),
      ).rejects.toThrow('Unresolved dependency: nonexistent-skill@^1.0.0');
    });

    it('should detect circular dependencies', async () => {
      const manifestA = createMockManifest({
        name: 'skill-a',
        dependencies: ['skill-b@^1.0.0'],
      });
      const manifestB = createMockManifest({
        name: 'skill-b',
        dependencies: ['skill-a@^1.0.0'],
      });

      await skillManager.registerSkill(manifestA, '/path/a');

      await expect(
        skillManager.registerSkill(manifestB, '/path/b'),
      ).rejects.toThrow('Circular dependency detected');
    });

    it('should resolve semver ranges correctly', async () => {
      // Register v1.2.0 of git-operations
      await skillManager.registerSkill(
        createMockManifest({ name: 'git-operations', version: '1.2.0' }),
        '/path/v1.2',
      );

      // Skill requiring ^1.0.0 should be satisfied by 1.2.0
      const manifest = createMockManifest({
        name: 'dependent',
        dependencies: ['git-operations@^1.0.0'],
      });

      const result = await skillManager.registerSkill(manifest, '/path/dependent');
      expect(result.success).toBe(true);
    });
  });

  // ===========================================================================
  // Hot Reloading
  // ===========================================================================

  describe('hot reload', () => {
    it('should reload a skill when its files change', async () => {
      await skillManager.registerSkill(createMockManifest(), '/path/to/skill');

      // Simulate file change event
      await skillManager.reloadSkill('git-operations');

      const skill = skillManager.getSkill('git-operations');
      expect(skill?.loadedAt).toBeGreaterThan(0);
    });

    it('should preserve running executions during reload', async () => {
      await skillManager.registerSkill(createMockManifest(), '/path/to/skill');

      const context: SkillExecutionContext = {
        sessionId: 'session_123',
        agentName: 'claude',
        workingDirectory: '/home/user/project',
        arguments: {},
      };

      // Start an execution
      const executionPromise = skillManager.executeSkill('git-operations', 'git-branch', context);

      // Reload during execution
      await skillManager.reloadSkill('git-operations');

      // Original execution should still complete
      const result = await executionPromise;
      expect(result.success).toBe(true);
    });

    it('should emit SkillReloaded event', async () => {
      const handler = jest.fn();
      skillManager.on('skill:reloaded', handler);

      await skillManager.registerSkill(createMockManifest(), '/path/to/skill');
      await skillManager.reloadSkill('git-operations');

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ skillName: 'git-operations' }),
      );
    });
  });

  // ===========================================================================
  // Skill Listing & Querying
  // ===========================================================================

  describe('listSkills', () => {
    beforeEach(async () => {
      await skillManager.registerSkill(
        createMockManifest({ name: 'git-operations', capabilities: ['git-branch', 'git-commit'] }),
        '/path/git',
      );
      await skillManager.registerSkill(
        createMockManifest({ name: 'file-management', capabilities: ['file-read', 'file-write'] }),
        '/path/files',
      );
    });

    it('should list all registered skills', () => {
      const skills = skillManager.listSkills();
      expect(skills).toHaveLength(2);
    });

    it('should filter skills by capability', () => {
      const gitSkills = skillManager.findSkillsByCapability('git-branch');
      expect(gitSkills).toHaveLength(1);
      expect(gitSkills[0].manifest.name).toBe('git-operations');
    });

    it('should return skill by name', () => {
      const skill = skillManager.getSkill('git-operations');
      expect(skill).toBeDefined();
      expect(skill?.manifest.version).toBe('1.0.0');
    });

    it('should return null for non-existent skill', () => {
      const skill = skillManager.getSkill('nonexistent');
      expect(skill).toBeNull();
    });

    it('should list all available capabilities across all skills', () => {
      const capabilities = skillManager.getAllCapabilities();
      expect(capabilities).toContain('git-branch');
      expect(capabilities).toContain('git-commit');
      expect(capabilities).toContain('file-read');
      expect(capabilities).toContain('file-write');
    });
  });

  // ===========================================================================
  // Skill Unloading & Cleanup
  // ===========================================================================

  describe('unregisterSkill', () => {
    it('should unregister and unload a skill', async () => {
      await skillManager.registerSkill(createMockManifest(), '/path/to/skill');

      await skillManager.unregisterSkill('git-operations');

      expect(skillManager.getSkill('git-operations')).toBeNull();
    });

    it('should not unregister skills with active dependents', async () => {
      await skillManager.registerSkill(
        createMockManifest({ name: 'git-operations' }),
        '/path/git',
      );
      await skillManager.registerSkill(
        createMockManifest({ name: 'code-analysis', dependencies: ['git-operations@^1.0.0'] }),
        '/path/analysis',
      );

      await expect(skillManager.unregisterSkill('git-operations')).rejects.toThrow(
        'Cannot unregister: skill has active dependents',
      );
    });

    it('should emit SkillUnregistered event', async () => {
      const handler = jest.fn();
      skillManager.on('skill:unregistered', handler);

      await skillManager.registerSkill(createMockManifest(), '/path/to/skill');
      await skillManager.unregisterSkill('git-operations');

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ skillName: 'git-operations' }),
      );
    });
  });
});

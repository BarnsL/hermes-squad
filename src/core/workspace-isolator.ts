/**
 * ============================================================================
 * HERMES SQUAD — Workspace Isolator
 * ============================================================================
 *
 * The WorkspaceIsolator provides git-worktree-based workspace isolation for
 * each agent session. This ensures multiple agents can work on the same
 * repository simultaneously without conflicts.
 *
 * LINEAGE FROM CLAUDE SQUAD:
 * -------------------------
 * Claude Squad's key innovation was git worktree isolation — each AI session
 * got its own working copy of the repo, allowing parallel development on
 * different features. When work was done, changes could be merged back.
 *
 * Hermes Squad preserves this pattern exactly:
 * 1. User has a main repo at /path/to/project
 * 2. Session A gets a worktree at ~/.hermes-squad/workspaces/sess_abc/
 * 3. Session B gets a worktree at ~/.hermes-squad/workspaces/sess_xyz/
 * 4. Both can commit independently on their branches
 * 5. Merging is manual (user reviews and merges when ready)
 *
 * HERMES ADDITIONS:
 * ----------------
 * - Workspace snapshots: save/restore workspace state for skill replay
 * - Auto-stash: stash uncommitted changes when pausing a session
 * - Workspace metrics: track files changed, LOC added/removed per session
 * - Diff summary: generate human-readable diff for memory storage
 *
 * INTEGRATION POINTS:
 * ------------------
 * - SessionManager: Creates workspace on session spawn, cleans up on terminate
 * - Skills: Skills can specify workspace requirements (e.g., "needs fresh clone")
 * - Memory: Workspace diffs are summarized and stored in memory
 * - MCP: `get_workspace_diff` tool exposes session changes to Quick
 *
 * CONFIGURATION:
 * -------------
 * - workspacesDir: Base directory for worktrees (default: ~/.hermes-squad/workspaces/)
 * - autoCleanup: Remove worktrees after N hours (default: 24)
 * - preserveOnError: Keep worktree if session errored (default: true)
 */

import { simpleGit, SimpleGit } from 'simple-git';
import { nanoid } from 'nanoid';
import * as fs from 'fs/promises';
import * as path from 'path';
import type { Logger } from 'pino';

// ─── Types ──────────────────────────────────────────────────────────────────

/**
 * Represents an isolated workspace created for a session.
 */
export interface IsolatedWorkspace {
  /** Unique workspace ID (matches session ID for easy correlation) */
  id: string;
  /** Absolute path to the worktree directory */
  path: string;
  /** The git branch this worktree is on */
  branch: string;
  /** The source repository path */
  sourceRepo: string;
  /** When this workspace was created */
  createdAt: Date;
  /** Whether this is a git worktree (vs. a simple copy) */
  isWorktree: boolean;
}

/**
 * Options for creating a new workspace.
 */
export interface CreateWorkspaceOptions {
  /** Session ID (used as workspace identifier) */
  sessionId: string;
  /** Path to the source git repository */
  repoPath: string;
  /** Branch name for the worktree (created if doesn't exist) */
  branch?: string;
  /** Base commit/ref to branch from (default: HEAD) */
  baseRef?: string;
  /** If true, creates a shallow copy instead of worktree (for non-git dirs) */
  forceShallowCopy?: boolean;
}

/**
 * Workspace diff summary — human-readable changes made in a session.
 */
export interface WorkspaceDiff {
  /** Files that were modified */
  modified: string[];
  /** Files that were added */
  added: string[];
  /** Files that were deleted */
  deleted: string[];
  /** Total lines added */
  linesAdded: number;
  /** Total lines removed */
  linesRemoved: number;
  /** Unified diff output (truncated for memory storage) */
  diffText: string;
  /** Human-readable summary */
  summary: string;
}

// ─── Workspace Isolator ─────────────────────────────────────────────────────

/**
 * Creates and manages isolated git worktree workspaces for agent sessions.
 *
 * @example
 * ```typescript
 * const isolator = new WorkspaceIsolator('~/.hermes-squad', logger);
 * const workspace = await isolator.createWorkspace({
 *   sessionId: 'sess_abc123',
 *   repoPath: '/home/user/my-project',
 *   branch: 'feat/add-auth',
 * });
 * // Agent works in workspace.path
 * // Later:
 * const diff = await isolator.getWorkspaceDiff(workspace);
 * await isolator.cleanupWorkspace(workspace);
 * ```
 */
export class WorkspaceIsolator {
  private readonly workspacesDir: string;
  private readonly logger: Logger;
  private readonly activeWorkspaces: Map<string, IsolatedWorkspace> = new Map();

  /** Whether to preserve workspaces on session error for debugging */
  private readonly preserveOnError: boolean;

  /** Auto-cleanup timeout in hours */
  private readonly autoCleanupHours: number;

  constructor(
    dataDir: string,
    logger: Logger,
    options?: {
      preserveOnError?: boolean;
      autoCleanupHours?: number;
    }
  ) {
    this.workspacesDir = path.join(dataDir, 'workspaces');
    this.logger = logger.child({ module: 'WorkspaceIsolator' });
    this.preserveOnError = options?.preserveOnError ?? true;
    this.autoCleanupHours = options?.autoCleanupHours ?? 24;
  }

  // ─── Public API ───────────────────────────────────────────────────────────

  /**
   * Create an isolated workspace for a session.
   *
   * Strategy:
   * 1. If the source path is a git repo → use git worktree
   * 2. If not a git repo → create a shallow directory copy
   *
   * Git worktrees are preferred because they:
   * - Share the .git object store (space efficient)
   * - Allow independent commits per session
   * - Enable clean merging back to main
   *
   * @param options - Workspace creation options
   * @returns The created workspace descriptor
   */
  async createWorkspace(options: CreateWorkspaceOptions): Promise<IsolatedWorkspace> {
    const workspaceId = options.sessionId;
    const workspacePath = path.join(this.workspacesDir, workspaceId);

    this.logger.info(
      { workspaceId, repoPath: options.repoPath, branch: options.branch },
      'Creating isolated workspace'
    );

    // Ensure workspaces directory exists
    await fs.mkdir(this.workspacesDir, { recursive: true });

    const isGitRepo = await this.isGitRepository(options.repoPath);

    let workspace: IsolatedWorkspace;

    if (isGitRepo && !options.forceShallowCopy) {
      workspace = await this.createWorktree(workspaceId, workspacePath, options);
    } else {
      workspace = await this.createShallowCopy(workspaceId, workspacePath, options);
    }

    this.activeWorkspaces.set(workspaceId, workspace);
    this.logger.info({ workspaceId, path: workspacePath }, 'Workspace created');

    return workspace;
  }

  /**
   * Get the diff of changes made in a workspace since creation.
   * This is used by the memory engine to store what an agent accomplished.
   *
   * @param workspace - The workspace to diff
   * @returns Structured diff summary
   */
  async getWorkspaceDiff(workspace: IsolatedWorkspace): Promise<WorkspaceDiff> {
    if (!workspace.isWorktree) {
      // For non-git workspaces, we can't easily diff
      return {
        modified: [],
        added: [],
        deleted: [],
        linesAdded: 0,
        linesRemoved: 0,
        diffText: '',
        summary: 'Non-git workspace — diff unavailable',
      };
    }

    const git: SimpleGit = simpleGit(workspace.path);

    try {
      // Get status
      const status = await git.status();
      const diffResult = await git.diff(['--stat']);
      const fullDiff = await git.diff();

      // Parse diff stats
      const linesAdded = (fullDiff.match(/^\+[^+]/gm) || []).length;
      const linesRemoved = (fullDiff.match(/^-[^-]/gm) || []).length;

      // Truncate full diff for storage (keep first 5000 chars)
      const truncatedDiff = fullDiff.length > 5000
        ? fullDiff.slice(0, 5000) + '\n... (truncated)'
        : fullDiff;

      const summary = [
        `Modified ${status.modified.length} files`,
        `Added ${status.created.length} files`,
        `Deleted ${status.deleted.length} files`,
        `(+${linesAdded} / -${linesRemoved} lines)`,
      ].join(', ');

      return {
        modified: status.modified,
        added: status.created,
        deleted: status.deleted,
        linesAdded,
        linesRemoved,
        diffText: truncatedDiff,
        summary,
      };
    } catch (error) {
      this.logger.warn({ error, workspaceId: workspace.id }, 'Failed to compute workspace diff');
      return {
        modified: [],
        added: [],
        deleted: [],
        linesAdded: 0,
        linesRemoved: 0,
        diffText: '',
        summary: 'Diff computation failed',
      };
    }
  }

  /**
   * Create a snapshot (stash) of the current workspace state.
   * Used when pausing a session to preserve work-in-progress.
   */
  async snapshotWorkspace(workspace: IsolatedWorkspace): Promise<string> {
    if (!workspace.isWorktree) return '';

    const git: SimpleGit = simpleGit(workspace.path);
    const stashMessage = `hermes-squad-snapshot-${Date.now()}`;

    try {
      await git.stash(['push', '-m', stashMessage, '--include-untracked']);
      this.logger.debug({ workspaceId: workspace.id }, 'Workspace snapshot created');
      return stashMessage;
    } catch (error) {
      this.logger.warn({ error }, 'Failed to snapshot workspace');
      return '';
    }
  }

  /**
   * Restore a workspace from a snapshot (stash pop).
   */
  async restoreSnapshot(workspace: IsolatedWorkspace, _snapshotId: string): Promise<void> {
    if (!workspace.isWorktree) return;

    const git: SimpleGit = simpleGit(workspace.path);
    try {
      await git.stash(['pop']);
      this.logger.debug({ workspaceId: workspace.id }, 'Workspace snapshot restored');
    } catch (error) {
      this.logger.warn({ error }, 'Failed to restore workspace snapshot');
    }
  }

  /**
   * Clean up a workspace — remove the worktree and associated branch.
   * Called when a session is terminated.
   *
   * @param workspace - The workspace to clean up
   * @param force - If true, remove even if there are uncommitted changes
   */
  async cleanupWorkspace(workspace: IsolatedWorkspace, force = false): Promise<void> {
    this.logger.info({ workspaceId: workspace.id, path: workspace.path }, 'Cleaning up workspace');

    try {
      if (workspace.isWorktree) {
        // Remove the git worktree
        const git: SimpleGit = simpleGit(workspace.sourceRepo);
        await git.raw(['worktree', 'remove', workspace.path, ...(force ? ['--force'] : [])]);

        // Optionally clean up the branch (only if not merged)
        // We don't auto-delete branches — user should review and merge
      } else {
        // Simple directory removal for non-git workspaces
        await fs.rm(workspace.path, { recursive: true, force: true });
      }

      this.activeWorkspaces.delete(workspace.id);
      this.logger.info({ workspaceId: workspace.id }, 'Workspace cleaned up');
    } catch (error) {
      this.logger.error({ error, workspaceId: workspace.id }, 'Failed to cleanup workspace');
      // If forced, just nuke the directory
      if (force) {
        await fs.rm(workspace.path, { recursive: true, force: true });
        this.activeWorkspaces.delete(workspace.id);
      }
    }
  }

  /**
   * List all active workspaces.
   */
  listWorkspaces(): IsolatedWorkspace[] {
    return Array.from(this.activeWorkspaces.values());
  }

  /**
   * Run periodic cleanup of stale workspaces.
   * Called by the scheduler to prevent disk space bloat.
   */
  async cleanupStaleWorkspaces(): Promise<number> {
    const now = Date.now();
    const maxAge = this.autoCleanupHours * 60 * 60 * 1000;
    let cleaned = 0;

    for (const [id, workspace] of this.activeWorkspaces) {
      const age = now - workspace.createdAt.getTime();
      if (age > maxAge) {
        await this.cleanupWorkspace(workspace, true);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      this.logger.info({ cleaned }, 'Stale workspaces cleaned up');
    }
    return cleaned;
  }

  // ─── Private Helpers ──────────────────────────────────────────────────────

  /**
   * Check if a path is a git repository.
   */
  private async isGitRepository(repoPath: string): Promise<boolean> {
    try {
      const git: SimpleGit = simpleGit(repoPath);
      await git.revparse(['--git-dir']);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Create a git worktree for the workspace.
   * This is the preferred isolation method for git repositories.
   */
  private async createWorktree(
    workspaceId: string,
    workspacePath: string,
    options: CreateWorkspaceOptions
  ): Promise<IsolatedWorkspace> {
    const git: SimpleGit = simpleGit(options.repoPath);
    const branch = options.branch ?? `hermes-squad/${workspaceId}`;
    const baseRef = options.baseRef ?? 'HEAD';

    // Create new branch from base ref
    try {
      await git.checkout(['-b', branch, baseRef]);
      // Switch back to previous branch
      await git.checkout(['-']);
    } catch {
      // Branch might already exist, that's OK
      this.logger.debug({ branch }, 'Branch already exists, reusing');
    }

    // Create worktree
    await git.raw(['worktree', 'add', workspacePath, branch]);

    return {
      id: workspaceId,
      path: workspacePath,
      branch,
      sourceRepo: options.repoPath,
      createdAt: new Date(),
      isWorktree: true,
    };
  }

  /**
   * Create a shallow directory copy for non-git workspaces.
   * Used when the source isn't a git repo or when explicitly requested.
   */
  private async createShallowCopy(
    workspaceId: string,
    workspacePath: string,
    options: CreateWorkspaceOptions
  ): Promise<IsolatedWorkspace> {
    // Copy directory tree (excluding node_modules and common large dirs)
    await fs.cp(options.repoPath, workspacePath, {
      recursive: true,
      filter: (src: string) => {
        const basename = path.basename(src);
        // Skip common large directories that aren't needed for agent work
        const skipDirs = ['node_modules', '.git', 'dist', 'build', '__pycache__', '.next'];
        return !skipDirs.includes(basename);
      },
    });

    // Initialize a fresh git repo in the copy for tracking changes
    const git: SimpleGit = simpleGit(workspacePath);
    await git.init();
    await git.add('.');
    await git.commit('Initial workspace state (Hermes Squad snapshot)');

    return {
      id: workspaceId,
      path: workspacePath,
      branch: 'main',
      sourceRepo: options.repoPath,
      createdAt: new Date(),
      isWorktree: false,
    };
  }
}

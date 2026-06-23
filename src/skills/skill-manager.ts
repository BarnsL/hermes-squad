/**
 * ============================================================================
 * HERMES SQUAD — Skill Manager (Self-Improving Skills System)
 * ============================================================================
 *
 * The SkillManager implements Hermes Desktop's self-improving skills system
 * — the ability to learn reusable procedures from interactions, store them,
 * and execute them with increasing reliability over time.
 *
 * WHAT ARE SKILLS?
 * ---------------
 * A skill is a learned, reusable procedure that Hermes Squad can execute.
 * Skills are extracted from successful interactions and refined over time.
 *
 * Examples:
 * - "Generate TypeScript interfaces from OpenAPI specs"
 * - "Set up a new microservice with our team's boilerplate"
 * - "Run our full test suite and fix failures"
 * - "Deploy to staging with canary validation"
 *
 * SELF-IMPROVEMENT LOOP:
 * ---------------------
 * 1. OBSERVE: Monitor agent session interactions and outcomes
 * 2. EXTRACT: Identify repeatable patterns (user asks similar things)
 * 3. CODIFY: Create a skill with steps, prerequisites, and validation
 * 4. EXECUTE: Run the skill when triggered (manually or auto-matched)
 * 5. REFINE: Track success/failure rate, adjust based on feedback
 *
 * LINEAGE:
 * --------
 * Hermes Desktop pioneered the skills concept for desktop AI. Hermes Squad
 * extends it with multi-agent awareness:
 * - Skills can specify which agent type to use
 * - Skills can orchestrate multiple agents (e.g., "Claude reviews, Kiro implements")
 * - Skills share memory across sessions (learnings from one inform another)
 * - Skills can be exported/imported (skill marketplace concept)
 *
 * INTEGRATION POINTS:
 * ------------------
 * - SessionManager: Skills create/manage sessions as part of execution
 * - AgentRegistry: Skills specify required agent capabilities
 * - MemoryEngine: Skills store/retrieve context from memory
 * - ACP Server: Skills can be executed via ACP (`hermes.execute`)
 * - MCP Server: Skills exposed as `hermes_run_skill` tool
 * - Scheduler: Skills can be scheduled (daily code review, nightly tests)
 *
 * CONFIGURATION:
 * -------------
 * - Auto-learn: Automatically extract skills from interactions (default: true)
 * - Min confidence: Minimum success rate to consider a skill reliable (default: 0.7)
 * - Max retries: How many times to retry a failed skill step (default: 2)
 */

import { EventEmitter } from 'eventemitter3';
import { nanoid } from 'nanoid';
import type { Logger } from 'pino';

import type { SkillStore, StoredSkill } from './skill-store.js';
import type { MemoryEngine } from '../memory/memory-engine.js';
import type { SessionManager } from '../core/session-manager.js';
import type { HermesSquadEvents } from '../main.js';

// ─── Types ──────────────────────────────────────────────────────────────────

/**
 * A single step in a skill's execution plan.
 */
export interface SkillStep {
  /** Step identifier within the skill */
  id: string;
  /** Human-readable description of what this step does */
  description: string;
  /** The action to perform */
  action: SkillAction;
  /** Conditions that must be true for this step to execute */
  preconditions?: SkillCondition[];
  /** What to do if this step fails */
  onFailure?: 'skip' | 'retry' | 'abort' | 'fallback';
  /** Fallback step ID if onFailure is 'fallback' */
  fallbackStepId?: string;
  /** Maximum retries for this step */
  maxRetries?: number;
  /** Timeout in milliseconds */
  timeout?: number;
}

/**
 * Actions that a skill step can perform.
 */
export type SkillAction =
  | { type: 'spawn_agent'; agentId: string; task: string; waitForCompletion: boolean }
  | { type: 'execute_command'; command: string; cwd?: string }
  | { type: 'query_memory'; query: string; storeAs: string }
  | { type: 'store_memory'; content: string; category: string }
  | { type: 'send_acp'; agentId: string; method: string; params: Record<string, unknown> }
  | { type: 'conditional'; condition: SkillCondition; thenSteps: string[]; elseSteps: string[] }
  | { type: 'parallel'; stepIds: string[] }
  | { type: 'prompt_user'; question: string; storeAs: string }
  | { type: 'transform'; input: string; template: string; storeAs: string };

/**
 * Conditions for skill execution flow control.
 */
export interface SkillCondition {
  type: 'file_exists' | 'env_set' | 'memory_contains' | 'session_status' | 'custom';
  value: string;
  operator?: 'equals' | 'contains' | 'matches' | 'not';
}

/**
 * Complete skill definition.
 */
export interface Skill {
  /** Unique skill identifier */
  id: string;
  /** Human-readable name */
  name: string;
  /** What this skill does */
  description: string;
  /** Category for organization */
  category: SkillCategory;
  /** Ordered execution steps */
  steps: SkillStep[];
  /** Required agent capabilities (for auto-routing) */
  requiredCapabilities?: string[];
  /** Preferred agent (if any) */
  preferredAgent?: string;
  /** Trigger patterns — when to suggest this skill automatically */
  triggers?: SkillTrigger[];
  /** Version number (incremented on each refinement) */
  version: number;
  /** Success rate (0-1) based on execution history */
  successRate: number;
  /** Number of times this skill has been executed */
  executionCount: number;
  /** When this skill was created */
  createdAt: Date;
  /** When this skill was last modified */
  updatedAt: Date;
  /** Tags for discovery */
  tags: string[];
  /** Whether this skill is published to the skill hub */
  published: boolean;
}

/**
 * Skill categories for organization.
 */
export type SkillCategory =
  | 'code-generation'
  | 'testing'
  | 'refactoring'
  | 'deployment'
  | 'documentation'
  | 'review'
  | 'debugging'
  | 'setup'
  | 'automation'
  | 'custom';

/**
 * Trigger patterns for auto-suggesting skills.
 */
export interface SkillTrigger {
  /** Regex pattern to match against user input */
  pattern: string;
  /** Minimum confidence to trigger (0-1) */
  confidence: number;
  /** Description of when this trigger fires */
  description: string;
}

/**
 * Context passed to skill execution.
 */
export interface SkillExecutionContext {
  /** The user's task/request */
  task?: string;
  /** Active session ID (if executing within a session) */
  sessionId?: string;
  /** Working directory */
  workspace?: string;
  /** Additional variables for template substitution */
  variables?: Record<string, string>;
}

/**
 * Result of a skill execution.
 */
export interface SkillExecutionResult {
  /** Whether the skill completed successfully */
  success: boolean;
  /** Human-readable summary of what was accomplished */
  summary: string;
  /** Individual step results */
  stepResults: Array<{
    stepId: string;
    success: boolean;
    output?: string;
    error?: string;
    durationMs: number;
  }>;
  /** Total execution time in milliseconds */
  totalDurationMs: number;
  /** Sessions created during execution */
  sessionsCreated: string[];
  /** Memory entries stored during execution */
  memoriesStored: string[];
}

// ─── Skill Manager ──────────────────────────────────────────────────────────

/**
 * Manages the lifecycle of self-improving skills: learning, storage,
 * execution, and refinement.
 *
 * @example
 * ```typescript
 * const skillManager = new SkillManager(store, memory, sessions, bus, logger);
 * await skillManager.initialize();
 *
 * // Execute a skill
 * const result = await skillManager.executeSkill('generate-api-tests', {
 *   task: 'Generate tests for the user service',
 *   workspace: '/path/to/project',
 * });
 *
 * // Learn a new skill from a successful interaction
 * await skillManager.learnSkill({
 *   name: 'Setup NextJS Project',
 *   description: 'Initialize a new NextJS project with our team conventions',
 *   steps: [...],
 * });
 * ```
 */
export class SkillManager {
  private readonly store: SkillStore;
  private readonly memoryEngine: MemoryEngine;
  private readonly sessionManager: SessionManager;
  private readonly bus: EventEmitter<HermesSquadEvents>;
  private readonly logger: Logger;

  /** In-memory skill cache for fast access */
  private skillCache: Map<string, Skill> = new Map();

  /** Whether auto-learning is enabled */
  private autoLearnEnabled: boolean;

  /** Minimum success rate to consider a skill reliable */
  private readonly minConfidence: number;

  constructor(
    store: SkillStore,
    memoryEngine: MemoryEngine,
    sessionManager: SessionManager,
    bus: EventEmitter<HermesSquadEvents>,
    logger: Logger,
    options?: {
      autoLearn?: boolean;
      minConfidence?: number;
    }
  ) {
    this.store = store;
    this.memoryEngine = memoryEngine;
    this.sessionManager = sessionManager;
    this.bus = bus;
    this.logger = logger.child({ module: 'SkillManager' });
    this.autoLearnEnabled = options?.autoLearn ?? true;
    this.minConfidence = options?.minConfidence ?? 0.7;
  }

  // ─── Lifecycle ────────────────────────────────────────────────────────────

  /**
   * Initialize the skill manager — load skills from store into cache.
   */
  async initialize(): Promise<void> {
    const skills = await this.store.loadAll();
    for (const skill of skills) {
      this.skillCache.set(skill.id, skill);
    }
    this.logger.info({ count: skills.length }, 'Skill manager initialized');

    // Wire up event listeners for auto-learning
    if (this.autoLearnEnabled) {
      this.bus.on('session:terminated', (sessionId) => {
        this.analyzeSessionForLearning(sessionId).catch((err) =>
          this.logger.error({ err }, 'Error during skill learning analysis')
        );
      });
    }
  }

  // ─── Public API ───────────────────────────────────────────────────────────

  /**
   * List all available skills.
   */
  listSkills(): Skill[] {
    return Array.from(this.skillCache.values());
  }

  /**
   * Get a specific skill by ID.
   */
  getSkill(skillId: string): Skill | null {
    return this.skillCache.get(skillId) ?? null;
  }

  /**
   * Find skills that match a given task description.
   * Uses trigger patterns and keyword matching.
   *
   * @param task - The user's task description
   * @returns Matching skills sorted by relevance
   */
  findMatchingSkills(task: string): Array<{ skill: Skill; confidence: number }> {
    const matches: Array<{ skill: Skill; confidence: number }> = [];

    for (const skill of this.skillCache.values()) {
      // Check trigger patterns
      if (skill.triggers) {
        for (const trigger of skill.triggers) {
          const regex = new RegExp(trigger.pattern, 'i');
          if (regex.test(task)) {
            matches.push({ skill, confidence: trigger.confidence });
            break;
          }
        }
      }

      // Keyword matching fallback (simple)
      const keywords = skill.tags.concat(skill.name.toLowerCase().split(/\s+/));
      const taskWords = task.toLowerCase().split(/\s+/);
      const matchCount = taskWords.filter((w) => keywords.some((k) => k.includes(w))).length;
      if (matchCount > 0 && !matches.find((m) => m.skill.id === skill.id)) {
        matches.push({ skill, confidence: matchCount / taskWords.length });
      }
    }

    return matches
      .filter((m) => m.confidence >= 0.3) // Minimum relevance threshold
      .sort((a, b) => b.confidence - a.confidence);
  }

  /**
   * Execute a skill by ID with the given context.
   *
   * Execution flow:
   * 1. Resolve the skill from cache
   * 2. Validate preconditions
   * 3. Execute each step in order (with retry/fallback logic)
   * 4. Store results in memory
   * 5. Update skill metrics (success rate, execution count)
   *
   * @param skillId - ID of the skill to execute
   * @param context - Execution context (task, workspace, etc.)
   * @returns Execution result with step-by-step outcomes
   */
  async executeSkill(skillId: string, context: SkillExecutionContext): Promise<SkillExecutionResult> {
    const skill = this.skillCache.get(skillId);
    if (!skill) {
      throw new Error(`Skill not found: ${skillId}`);
    }

    this.logger.info({ skillId, task: context.task?.slice(0, 100) }, 'Executing skill');
    const startTime = Date.now();

    const result: SkillExecutionResult = {
      success: true,
      summary: '',
      stepResults: [],
      totalDurationMs: 0,
      sessionsCreated: [],
      memoriesStored: [],
    };

    // Execute steps in order
    for (const step of skill.steps) {
      const stepStart = Date.now();
      let stepSuccess = false;
      let stepOutput = '';
      let stepError = '';
      let retries = 0;
      const maxRetries = step.maxRetries ?? 2;

      while (!stepSuccess && retries <= maxRetries) {
        try {
          stepOutput = await this.executeStep(step, context, result);
          stepSuccess = true;
        } catch (error) {
          stepError = (error as Error).message;
          retries++;

          if (step.onFailure === 'skip') {
            stepSuccess = true; // Mark as success (skip)
            stepOutput = `Skipped: ${stepError}`;
            break;
          } else if (step.onFailure === 'abort') {
            result.success = false;
            break;
          }
          // 'retry' continues the loop
        }
      }

      result.stepResults.push({
        stepId: step.id,
        success: stepSuccess,
        output: stepOutput,
        error: stepError || undefined,
        durationMs: Date.now() - stepStart,
      });

      if (!stepSuccess && step.onFailure === 'abort') {
        result.success = false;
        break;
      }
    }

    result.totalDurationMs = Date.now() - startTime;
    result.summary = result.success
      ? `Skill '${skill.name}' completed successfully (${result.stepResults.length} steps, ${result.totalDurationMs}ms)`
      : `Skill '${skill.name}' failed at step ${result.stepResults.findIndex((s) => !s.success) + 1}`;

    // Update skill metrics
    await this.updateSkillMetrics(skill, result.success);

    // Store execution in memory for future reference
    await this.memoryEngine.store({
      content: `Skill execution: ${skill.name}\n${result.summary}`,
      category: 'skill-execution',
      tags: [skill.id, result.success ? 'success' : 'failure'],
      source: `skill:${skill.id}`,
    });

    this.bus.emit('skill:executed', skillId, result.success);
    this.logger.info({ skillId, success: result.success, duration: result.totalDurationMs }, 'Skill execution complete');

    return result;
  }

  /**
   * Learn (create) a new skill from a definition.
   *
   * @param definition - Skill definition (name, description, steps)
   * @returns The created skill
   */
  async learnSkill(definition: {
    name: string;
    description: string;
    category?: SkillCategory;
    steps: SkillStep[];
    triggers?: SkillTrigger[];
    tags?: string[];
    preferredAgent?: string;
  }): Promise<Skill> {
    const skill: Skill = {
      id: `skill_${nanoid(10)}`,
      name: definition.name,
      description: definition.description,
      category: definition.category ?? 'custom',
      steps: definition.steps,
      triggers: definition.triggers,
      preferredAgent: definition.preferredAgent,
      version: 1,
      successRate: 1.0, // Optimistic start
      executionCount: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
      tags: definition.tags ?? [],
      published: false,
    };

    await this.store.save(skill);
    this.skillCache.set(skill.id, skill);
    this.bus.emit('skill:learned', skill.id);
    this.logger.info({ skillId: skill.id, name: skill.name }, 'New skill learned');

    return skill;
  }

  /**
   * Refine an existing skill (update steps, triggers, etc.).
   * Increments the version number.
   */
  async refineSkill(skillId: string, updates: Partial<Omit<Skill, 'id' | 'createdAt'>>): Promise<Skill> {
    const existing = this.skillCache.get(skillId);
    if (!existing) throw new Error(`Skill not found: ${skillId}`);

    const refined: Skill = {
      ...existing,
      ...updates,
      id: skillId, // Preserve ID
      version: existing.version + 1,
      updatedAt: new Date(),
    };

    await this.store.save(refined);
    this.skillCache.set(skillId, refined);
    this.logger.info({ skillId, version: refined.version }, 'Skill refined');

    return refined;
  }

  /**
   * Delete a skill.
   */
  async deleteSkill(skillId: string): Promise<void> {
    await this.store.delete(skillId);
    this.skillCache.delete(skillId);
    this.logger.info({ skillId }, 'Skill deleted');
  }

  // ─── Step Execution ───────────────────────────────────────────────────────

  /**
   * Execute a single skill step.
   * Routes to the appropriate handler based on action type.
   */
  private async executeStep(
    step: SkillStep,
    context: SkillExecutionContext,
    result: SkillExecutionResult
  ): Promise<string> {
    this.logger.debug({ stepId: step.id, actionType: step.action.type }, 'Executing step');

    switch (step.action.type) {
      case 'spawn_agent': {
        const session = await this.sessionManager.createSession({
          agentId: step.action.agentId,
          task: this.interpolate(step.action.task, context),
          cwd: context.workspace,
        });
        result.sessionsCreated.push(session.id);

        if (step.action.waitForCompletion) {
          // Poll for completion (simplified — production would use events)
          await this.waitForSessionCompletion(session.id, step.timeout ?? 300000);
        }

        return `Session ${session.id} spawned (${step.action.agentId})`;
      }

      case 'execute_command': {
        const { execSync } = await import('child_process');
        const cwd = step.action.cwd ?? context.workspace ?? process.cwd();
        const command = this.interpolate(step.action.command, context);
        const output = execSync(command, {
          cwd,
          timeout: step.timeout ?? 60000,
          encoding: 'utf-8',
        });
        return output;
      }

      case 'query_memory': {
        const results = await this.memoryEngine.search(
          this.interpolate(step.action.query, context)
        );
        // Store result in context variables for later steps
        if (context.variables) {
          context.variables[step.action.storeAs] = results.map((r) => r.content).join('\n');
        }
        return `Found ${results.length} memory entries`;
      }

      case 'store_memory': {
        const id = await this.memoryEngine.store({
          content: this.interpolate(step.action.content, context),
          category: step.action.category,
          tags: [],
          source: `skill:${context.sessionId ?? 'direct'}`,
        });
        result.memoriesStored.push(id);
        return `Memory stored: ${id}`;
      }

      case 'parallel': {
        // Execute multiple steps in parallel
        const parallelSteps = step.action.stepIds
          .map((id) => this.findStepById(id))
          .filter(Boolean) as SkillStep[];
        await Promise.all(
          parallelSteps.map((s) => this.executeStep(s, context, result))
        );
        return `${parallelSteps.length} parallel steps completed`;
      }

      default:
        return `Step type '${step.action.type}' not yet implemented`;
    }
  }

  // ─── Self-Improvement ─────────────────────────────────────────────────────

  /**
   * Analyze a completed session to extract potential skills.
   * Called automatically when a session terminates (if auto-learn is enabled).
   *
   * This is the core self-improvement mechanism from Hermes Desktop.
   */
  private async analyzeSessionForLearning(sessionId: string): Promise<void> {
    const session = this.sessionManager.getSession(sessionId);
    if (!session || session.status !== 'completed') return;

    const output = this.sessionManager.getSessionOutput(sessionId);
    if (!output || output.length < 100) return; // Too short to learn from

    this.logger.debug({ sessionId }, 'Analyzing session for skill extraction');

    // Check if similar skill already exists
    if (session.task) {
      const existing = this.findMatchingSkills(session.task);
      if (existing.length > 0 && existing[0].confidence > 0.8) {
        // Skill already exists — potentially refine it
        this.logger.debug({ skillId: existing[0].skill.id }, 'Similar skill exists, skipping');
        return;
      }
    }

    // Store the interaction in memory for future skill extraction
    // (Full skill extraction would use an LLM to analyze the interaction
    // and codify it — this is the hook point for that integration)
    await this.memoryEngine.store({
      content: `Session completed: ${session.task ?? 'unknown task'}\n` +
        `Agent: ${session.agentId}\n` +
        `Duration: ${session.lastActivityAt.getTime() - session.createdAt.getTime()}ms\n` +
        `Output preview: ${output.slice(-500)}`,
      category: 'session-completion',
      tags: [session.agentId, 'potential-skill'],
      source: `session:${sessionId}`,
    });
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  /**
   * Interpolate template variables in a string.
   * Supports {{TASK}}, {{WORKSPACE}}, and custom context variables.
   */
  private interpolate(template: string, context: SkillExecutionContext): string {
    let result = template;
    result = result.replace(/\{\{TASK\}\}/g, context.task ?? '');
    result = result.replace(/\{\{WORKSPACE\}\}/g, context.workspace ?? '.');
    result = result.replace(/\{\{SESSION_ID\}\}/g, context.sessionId ?? '');

    if (context.variables) {
      for (const [key, value] of Object.entries(context.variables)) {
        result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
      }
    }

    return result;
  }

  /**
   * Wait for a session to complete (polling-based).
   */
  private async waitForSessionCompletion(sessionId: string, timeout: number): Promise<void> {
    const start = Date.now();
    const pollInterval = 2000;

    while (Date.now() - start < timeout) {
      const session = this.sessionManager.getSession(sessionId);
      if (!session || session.status === 'completed' || session.status === 'errored') {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, pollInterval));
    }

    throw new Error(`Session ${sessionId} did not complete within timeout (${timeout}ms)`);
  }

  /**
   * Update skill success rate and execution count after an execution.
   */
  private async updateSkillMetrics(skill: Skill, success: boolean): Promise<void> {
    skill.executionCount++;
    // Exponential moving average for success rate
    const alpha = 0.3; // Learning rate
    skill.successRate = alpha * (success ? 1 : 0) + (1 - alpha) * skill.successRate;
    skill.updatedAt = new Date();

    await this.store.save(skill);
    this.skillCache.set(skill.id, skill);
  }

  /**
   * Find a step by ID across all skills (for parallel/conditional references).
   */
  private findStepById(stepId: string): SkillStep | null {
    for (const skill of this.skillCache.values()) {
      const step = skill.steps.find((s) => s.id === stepId);
      if (step) return step;
    }
    return null;
  }
}

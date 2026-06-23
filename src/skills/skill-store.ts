/**
 * ============================================================================
 * HERMES SQUAD — Skill Store (Persistence + Hub Integration)
 * ============================================================================
 *
 * The SkillStore handles persistent storage of learned skills using SQLite
 * and provides integration with a remote skill hub for sharing/discovering
 * community skills.
 *
 * LOCAL STORAGE:
 * -------------
 * Skills are stored in a SQLite database at ~/.hermes-squad/skills.db.
 * Using SQLite provides:
 * - ACID transactions (no corrupt skills)
 * - Full-text search over skill descriptions and tags
 * - Efficient querying by category, success rate, etc.
 * - Single-file backup/restore
 *
 * SKILL HUB (FUTURE):
 * ------------------
 * The skill hub is a community registry where users can:
 * - Publish skills they've created
 * - Discover skills others have shared
 * - Rate and review skills
 * - Fork and customize community skills
 *
 * This is inspired by npm/crates.io but for AI agent skills.
 *
 * LINEAGE:
 * --------
 * Hermes Desktop stored skills as JSON files. Hermes Squad upgrades to
 * SQLite for better querying, FTS5 search, and atomic updates.
 *
 * INTEGRATION POINTS:
 * ------------------
 * - SkillManager: CRUD operations on skills
 * - MCP Server: `hermes_list_skills` queries this store
 * - Memory Engine: Shares the same SQLite infrastructure pattern
 * - Export/Import: Skills can be exported as YAML for version control
 *
 * CONFIGURATION:
 * -------------
 * - Database path: ~/.hermes-squad/skills.db
 * - Hub URL: HERMES_SQUAD_HUB_URL (default: none — local only)
 * - Sync interval: How often to sync with hub (default: 1 hour)
 */

import Database from 'better-sqlite3';
import * as fs from 'fs/promises';
import * as path from 'path';
import type { Logger } from 'pino';
import type { Skill } from './skill-manager.js';

// ─── Types ──────────────────────────────────────────────────────────────────

/**
 * Skill as stored in the database (serialized form).
 */
export interface StoredSkill {
  id: string;
  name: string;
  description: string;
  category: string;
  steps_json: string;
  triggers_json: string | null;
  preferred_agent: string | null;
  required_capabilities_json: string | null;
  version: number;
  success_rate: number;
  execution_count: number;
  tags_json: string;
  published: number; // SQLite boolean (0/1)
  created_at: string; // ISO string
  updated_at: string; // ISO string
}

/**
 * Search/filter options for querying skills.
 */
export interface SkillQuery {
  /** Full-text search query */
  search?: string;
  /** Filter by category */
  category?: string;
  /** Minimum success rate */
  minSuccessRate?: number;
  /** Filter by tag */
  tag?: string;
  /** Only published skills */
  publishedOnly?: boolean;
  /** Maximum results */
  limit?: number;
  /** Sort order */
  sortBy?: 'name' | 'success_rate' | 'execution_count' | 'updated_at';
  /** Sort direction */
  sortDir?: 'asc' | 'desc';
}

/**
 * Hub skill metadata (from remote skill registry).
 */
export interface HubSkill {
  id: string;
  name: string;
  description: string;
  author: string;
  downloads: number;
  rating: number;
  version: string;
  hubUrl: string;
}

// ─── Skill Store ────────────────────────────────────────────────────────────

/**
 * SQLite-backed persistent storage for skills with FTS5 full-text search
 * and remote skill hub integration.
 *
 * @example
 * ```typescript
 * const store = new SkillStore('~/.hermes-squad', logger);
 * await store.initialize();
 *
 * // Save a skill
 * await store.save(mySkill);
 *
 * // Search skills
 * const results = await store.query({ search: 'test generation', category: 'testing' });
 *
 * // Export for sharing
 * const yaml = await store.exportAsYaml('skill_abc123');
 * ```
 */
export class SkillStore {
  private db!: Database.Database;
  private readonly dbPath: string;
  private readonly logger: Logger;

  /** Remote skill hub URL (if configured) */
  private readonly hubUrl: string | null;

  constructor(dataDir: string, logger: Logger) {
    this.dbPath = path.join(dataDir, 'skills.db');
    this.logger = logger.child({ module: 'SkillStore' });
    this.hubUrl = process.env.HERMES_SQUAD_HUB_URL ?? null;
  }

  // ─── Lifecycle ────────────────────────────────────────────────────────────

  /**
   * Initialize the database — create tables and FTS5 index if needed.
   */
  async initialize(): Promise<void> {
    // Ensure directory exists
    await fs.mkdir(path.dirname(this.dbPath), { recursive: true });

    this.db = new Database(this.dbPath);

    // Enable WAL mode for better concurrent read performance
    this.db.pragma('journal_mode = WAL');

    // Create main skills table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS skills (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL,
        category TEXT NOT NULL DEFAULT 'custom',
        steps_json TEXT NOT NULL,
        triggers_json TEXT,
        preferred_agent TEXT,
        required_capabilities_json TEXT,
        version INTEGER NOT NULL DEFAULT 1,
        success_rate REAL NOT NULL DEFAULT 1.0,
        execution_count INTEGER NOT NULL DEFAULT 0,
        tags_json TEXT NOT NULL DEFAULT '[]',
        published INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      -- Full-text search index over skill metadata
      CREATE VIRTUAL TABLE IF NOT EXISTS skills_fts USING fts5(
        name,
        description,
        tags_text,
        category,
        content='skills',
        content_rowid='rowid',
        tokenize='porter unicode61'
      );

      -- Trigger to keep FTS in sync with main table
      CREATE TRIGGER IF NOT EXISTS skills_ai AFTER INSERT ON skills BEGIN
        INSERT INTO skills_fts(rowid, name, description, tags_text, category)
        VALUES (new.rowid, new.name, new.description, new.tags_json, new.category);
      END;

      CREATE TRIGGER IF NOT EXISTS skills_ad AFTER DELETE ON skills BEGIN
        INSERT INTO skills_fts(skills_fts, rowid, name, description, tags_text, category)
        VALUES ('delete', old.rowid, old.name, old.description, old.tags_json, old.category);
      END;

      CREATE TRIGGER IF NOT EXISTS skills_au AFTER UPDATE ON skills BEGIN
        INSERT INTO skills_fts(skills_fts, rowid, name, description, tags_text, category)
        VALUES ('delete', old.rowid, old.name, old.description, old.tags_json, old.category);
        INSERT INTO skills_fts(rowid, name, description, tags_text, category)
        VALUES (new.rowid, new.name, new.description, new.tags_json, new.category);
      END;

      -- Execution history for analytics
      CREATE TABLE IF NOT EXISTS skill_executions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        skill_id TEXT NOT NULL,
        success INTEGER NOT NULL,
        duration_ms INTEGER NOT NULL,
        context_json TEXT,
        error_message TEXT,
        executed_at TEXT NOT NULL,
        FOREIGN KEY (skill_id) REFERENCES skills(id) ON DELETE CASCADE
      );

      -- Index for querying execution history
      CREATE INDEX IF NOT EXISTS idx_skill_executions_skill_id
        ON skill_executions(skill_id, executed_at DESC);
    `);

    const count = this.db.prepare('SELECT COUNT(*) as count FROM skills').get() as { count: number };
    this.logger.info({ dbPath: this.dbPath, skillCount: count.count }, 'Skill store initialized');
  }

  // ─── CRUD Operations ──────────────────────────────────────────────────────

  /**
   * Save (upsert) a skill to the database.
   */
  async save(skill: Skill): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO skills (
        id, name, description, category, steps_json, triggers_json,
        preferred_agent, required_capabilities_json, version,
        success_rate, execution_count, tags_json, published,
        created_at, updated_at
      ) VALUES (
        @id, @name, @description, @category, @steps_json, @triggers_json,
        @preferred_agent, @required_capabilities_json, @version,
        @success_rate, @execution_count, @tags_json, @published,
        @created_at, @updated_at
      )
    `);

    stmt.run({
      id: skill.id,
      name: skill.name,
      description: skill.description,
      category: skill.category,
      steps_json: JSON.stringify(skill.steps),
      triggers_json: skill.triggers ? JSON.stringify(skill.triggers) : null,
      preferred_agent: skill.preferredAgent ?? null,
      required_capabilities_json: skill.requiredCapabilities
        ? JSON.stringify(skill.requiredCapabilities) : null,
      version: skill.version,
      success_rate: skill.successRate,
      execution_count: skill.executionCount,
      tags_json: JSON.stringify(skill.tags),
      published: skill.published ? 1 : 0,
      created_at: skill.createdAt.toISOString(),
      updated_at: skill.updatedAt.toISOString(),
    });
  }

  /**
   * Load all skills from the database.
   */
  async loadAll(): Promise<Skill[]> {
    const rows = this.db.prepare('SELECT * FROM skills ORDER BY updated_at DESC').all() as StoredSkill[];
    return rows.map((row) => this.deserializeSkill(row));
  }

  /**
   * Load a single skill by ID.
   */
  async loadById(id: string): Promise<Skill | null> {
    const row = this.db.prepare('SELECT * FROM skills WHERE id = ?').get(id) as StoredSkill | undefined;
    return row ? this.deserializeSkill(row) : null;
  }

  /**
   * Delete a skill by ID.
   */
  async delete(id: string): Promise<void> {
    this.db.prepare('DELETE FROM skills WHERE id = ?').run(id);
    this.logger.info({ skillId: id }, 'Skill deleted from store');
  }

  /**
   * Query skills with filters and full-text search.
   */
  async query(options: SkillQuery): Promise<Skill[]> {
    let sql = 'SELECT s.* FROM skills s';
    const params: unknown[] = [];
    const conditions: string[] = [];

    // Full-text search
    if (options.search) {
      sql = 'SELECT s.* FROM skills s INNER JOIN skills_fts f ON s.rowid = f.rowid';
      conditions.push('skills_fts MATCH ?');
      params.push(options.search);
    }

    // Category filter
    if (options.category) {
      conditions.push('s.category = ?');
      params.push(options.category);
    }

    // Success rate filter
    if (options.minSuccessRate !== undefined) {
      conditions.push('s.success_rate >= ?');
      params.push(options.minSuccessRate);
    }

    // Published filter
    if (options.publishedOnly) {
      conditions.push('s.published = 1');
    }

    // Tag filter (JSON array search)
    if (options.tag) {
      conditions.push("s.tags_json LIKE ?");
      params.push(`%"${options.tag}"%`);
    }

    // Build WHERE clause
    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }

    // Sort
    const sortCol = options.sortBy ?? 'updated_at';
    const sortDir = options.sortDir ?? 'desc';
    sql += ` ORDER BY s.${sortCol} ${sortDir}`;

    // Limit
    sql += ` LIMIT ?`;
    params.push(options.limit ?? 50);

    const rows = this.db.prepare(sql).all(...params) as StoredSkill[];
    return rows.map((row) => this.deserializeSkill(row));
  }

  // ─── Execution History ────────────────────────────────────────────────────

  /**
   * Record a skill execution for analytics.
   */
  async recordExecution(
    skillId: string,
    success: boolean,
    durationMs: number,
    context?: Record<string, unknown>,
    errorMessage?: string
  ): Promise<void> {
    this.db.prepare(`
      INSERT INTO skill_executions (skill_id, success, duration_ms, context_json, error_message, executed_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      skillId,
      success ? 1 : 0,
      durationMs,
      context ? JSON.stringify(context) : null,
      errorMessage ?? null,
      new Date().toISOString()
    );
  }

  /**
   * Get execution history for a skill.
   */
  async getExecutionHistory(skillId: string, limit = 20): Promise<Array<{
    success: boolean;
    durationMs: number;
    executedAt: Date;
    errorMessage?: string;
  }>> {
    const rows = this.db.prepare(`
      SELECT success, duration_ms, executed_at, error_message
      FROM skill_executions
      WHERE skill_id = ?
      ORDER BY executed_at DESC
      LIMIT ?
    `).all(skillId, limit) as Array<{
      success: number;
      duration_ms: number;
      executed_at: string;
      error_message: string | null;
    }>;

    return rows.map((r) => ({
      success: r.success === 1,
      durationMs: r.duration_ms,
      executedAt: new Date(r.executed_at),
      errorMessage: r.error_message ?? undefined,
    }));
  }

  // ─── Export/Import ────────────────────────────────────────────────────────

  /**
   * Export a skill as a portable JSON object (for sharing/backup).
   */
  async exportSkill(id: string): Promise<string> {
    const skill = await this.loadById(id);
    if (!skill) throw new Error(`Skill not found: ${id}`);
    return JSON.stringify(skill, null, 2);
  }

  /**
   * Import a skill from a JSON string.
   */
  async importSkill(json: string): Promise<Skill> {
    const skill = JSON.parse(json) as Skill;
    skill.createdAt = new Date(skill.createdAt);
    skill.updatedAt = new Date(skill.updatedAt);
    await this.save(skill);
    return skill;
  }

  // ─── Hub Integration ──────────────────────────────────────────────────────

  /**
   * Search the remote skill hub for community skills.
   * Returns metadata — call downloadFromHub() to install.
   */
  async searchHub(query: string): Promise<HubSkill[]> {
    if (!this.hubUrl) {
      this.logger.debug('Hub URL not configured — skipping hub search');
      return [];
    }

    try {
      const response = await fetch(`${this.hubUrl}/api/skills/search?q=${encodeURIComponent(query)}`);
      if (!response.ok) return [];
      return (await response.json()) as HubSkill[];
    } catch (error) {
      this.logger.warn({ error }, 'Failed to search skill hub');
      return [];
    }
  }

  /**
   * Download and install a skill from the hub.
   */
  async downloadFromHub(hubSkillId: string): Promise<Skill | null> {
    if (!this.hubUrl) return null;

    try {
      const response = await fetch(`${this.hubUrl}/api/skills/${hubSkillId}/download`);
      if (!response.ok) return null;
      const json = await response.text();
      return this.importSkill(json);
    } catch (error) {
      this.logger.warn({ error, hubSkillId }, 'Failed to download from hub');
      return null;
    }
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  /**
   * Convert a database row to a Skill object.
   */
  private deserializeSkill(row: StoredSkill): Skill {
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      category: row.category as Skill['category'],
      steps: JSON.parse(row.steps_json),
      triggers: row.triggers_json ? JSON.parse(row.triggers_json) : undefined,
      preferredAgent: row.preferred_agent ?? undefined,
      requiredCapabilities: row.required_capabilities_json
        ? JSON.parse(row.required_capabilities_json) : undefined,
      version: row.version,
      successRate: row.success_rate,
      executionCount: row.execution_count,
      tags: JSON.parse(row.tags_json),
      published: row.published === 1,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }
}

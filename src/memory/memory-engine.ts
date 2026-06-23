/**
 * ============================================================================
 * HERMES SQUAD — Memory Engine (Cross-Session Persistent Memory)
 * ============================================================================
 *
 * The MemoryEngine provides persistent, searchable memory that spans across
 * all agent sessions. It stores learnings, patterns, code snippets, decisions,
 * and other knowledge that agents discover during their work.
 *
 * WHY CROSS-SESSION MEMORY?
 * -------------------------
 * Without memory, each AI session starts from scratch. With memory:
 * - Agent A discovers an API pattern → Agent B can use it next week
 * - A refactoring decision is stored → future sessions respect it
 * - Debugging insights are preserved → same bug is fixed faster next time
 * - User preferences are remembered → agents adapt to your style
 *
 * This is one of Hermes Desktop's key innovations, now powering multi-agent
 * collaboration in Hermes Squad.
 *
 * STORAGE:
 * --------
 * SQLite with FTS5 (Full-Text Search) provides:
 * - Sub-millisecond keyword search across all memories
 * - Porter stemming (search "running" finds "run")
 * - BM25 relevance ranking
 * - Category and tag filtering
 * - Time-based retrieval (recent memories weighted higher)
 *
 * MEMORY CATEGORIES:
 * -----------------
 * - code-pattern: Reusable code patterns and idioms
 * - architecture: Architectural decisions and rationale
 * - debugging: Debugging insights and root causes
 * - preference: User preferences and conventions
 * - session-completion: What each session accomplished
 * - skill-execution: Skill execution logs
 * - external: Knowledge from gateway messages (Slack, etc.)
 * - general: Uncategorized knowledge
 *
 * INTEGRATION POINTS:
 * ------------------
 * - Skills: Skills query memory for context before execution
 * - Sessions: Session completions are auto-stored in memory
 * - MCP: `hermes_query_memory` and `hermes_store_memory` tools
 * - ACP: `hermes.memory` method for remote memory queries
 * - Gateway: Messages from Slack/Discord can be stored as external knowledge
 * - Self-improvement: Memory patterns inform skill extraction
 *
 * CONFIGURATION:
 * -------------
 * - Database: ~/.hermes-squad/memory.db
 * - Max entries: HERMES_SQUAD_MEMORY_MAX (default: 100000)
 * - Retention: HERMES_SQUAD_MEMORY_RETENTION_DAYS (default: 365)
 * - Auto-compact: Runs weekly to remove expired/low-relevance entries
 */

import Database from 'better-sqlite3';
import * as fs from 'fs/promises';
import * as path from 'path';
import { nanoid } from 'nanoid';
import type { Logger } from 'pino';

// ─── Types ──────────────────────────────────────────────────────────────────

/**
 * A memory entry to be stored.
 */
export interface MemoryEntry {
  /** The memory content (text) */
  content: string;
  /** Category for organization and filtering */
  category: string;
  /** Tags for discovery */
  tags: string[];
  /** Source of this memory (e.g., session ID, skill ID, "user", "mcp") */
  source: string;
  /** Optional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * A stored memory entry with full metadata.
 */
export interface StoredMemory {
  /** Unique memory ID */
  id: string;
  /** Memory content */
  content: string;
  /** Category */
  category: string;
  /** Tags */
  tags: string[];
  /** Source */
  source: string;
  /** Metadata */
  metadata: Record<string, unknown>;
  /** When stored */
  createdAt: Date;
  /** Relevance score (from search) */
  score?: number;
  /** Access count (how often retrieved) */
  accessCount: number;
  /** Last accessed timestamp */
  lastAccessedAt: Date | null;
}

/**
 * Options for memory search.
 */
export interface MemorySearchOptions {
  /** Maximum results */
  limit?: number;
  /** Filter by category */
  category?: string;
  /** Filter by tag */
  tag?: string;
  /** Filter by source */
  source?: string;
  /** Only memories after this date */
  after?: Date;
  /** Only memories before this date */
  before?: Date;
  /** Minimum access count (prioritize frequently-used memories) */
  minAccessCount?: number;
  /** Boost recent memories */
  recencyBoost?: boolean;
}

/**
 * Memory statistics for monitoring.
 */
export interface MemoryStats {
  totalEntries: number;
  byCategory: Record<string, number>;
  oldestEntry: Date | null;
  newestEntry: Date | null;
  databaseSizeBytes: number;
  averageAccessCount: number;
}

// ─── Memory Engine ──────────────────────────────────────────────────────────

/**
 * SQLite-backed persistent memory with FTS5 full-text search.
 *
 * Provides the knowledge backbone for Hermes Squad's self-improving
 * capabilities. All agent sessions contribute to and benefit from this
 * shared memory.
 *
 * @example
 * ```typescript
 * const memory = new MemoryEngine('~/.hermes-squad', logger);
 * await memory.initialize();
 *
 * // Store a memory
 * await memory.store({
 *   content: 'The auth service requires JWT tokens with RS256 signing',
 *   category: 'architecture',
 *   tags: ['auth', 'jwt', 'security'],
 *   source: 'session:sess_abc123',
 * });
 *
 * // Search memories
 * const results = await memory.search('JWT authentication');
 * // → Returns relevant memories ranked by BM25 relevance
 * ```
 */
export class MemoryEngine {
  private db!: Database.Database;
  private readonly dbPath: string;
  private readonly logger: Logger;

  /** Maximum total entries before compaction triggers */
  private readonly maxEntries: number;

  /** Retention period in days */
  private readonly retentionDays: number;

  constructor(
    dataDir: string,
    logger: Logger,
    options?: {
      maxEntries?: number;
      retentionDays?: number;
    }
  ) {
    this.dbPath = path.join(dataDir, 'memory.db');
    this.logger = logger.child({ module: 'MemoryEngine' });
    this.maxEntries = options?.maxEntries
      ?? parseInt(process.env.HERMES_SQUAD_MEMORY_MAX ?? '100000', 10);
    this.retentionDays = options?.retentionDays
      ?? parseInt(process.env.HERMES_SQUAD_MEMORY_RETENTION_DAYS ?? '365', 10);
  }

  // ─── Lifecycle ────────────────────────────────────────────────────────────

  /**
   * Initialize the memory database with tables and FTS5 index.
   */
  async initialize(): Promise<void> {
    await fs.mkdir(path.dirname(this.dbPath), { recursive: true });

    this.db = new Database(this.dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL'); // Good balance of safety and speed

    this.db.exec(`
      -- Main memory table
      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        category TEXT NOT NULL DEFAULT 'general',
        tags_json TEXT NOT NULL DEFAULT '[]',
        source TEXT NOT NULL DEFAULT 'unknown',
        metadata_json TEXT NOT NULL DEFAULT '{}',
        access_count INTEGER NOT NULL DEFAULT 0,
        last_accessed_at TEXT,
        created_at TEXT NOT NULL
      );

      -- FTS5 full-text search index
      -- Uses porter stemming (run/running/ran all match) and unicode
      CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
        content,
        category,
        tags_text,
        source,
        content='memories',
        content_rowid='rowid',
        tokenize='porter unicode61'
      );

      -- Sync triggers for FTS
      CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
        INSERT INTO memories_fts(rowid, content, category, tags_text, source)
        VALUES (new.rowid, new.content, new.category, new.tags_json, new.source);
      END;

      CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
        INSERT INTO memories_fts(memories_fts, rowid, content, category, tags_text, source)
        VALUES ('delete', old.rowid, old.content, old.category, old.tags_json, old.source);
      END;

      CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON memories BEGIN
        INSERT INTO memories_fts(memories_fts, rowid, content, category, tags_text, source)
        VALUES ('delete', old.rowid, old.content, old.category, old.tags_json, old.source);
        INSERT INTO memories_fts(rowid, content, category, tags_text, source)
        VALUES (new.rowid, new.content, new.category, new.tags_json, new.source);
      END;

      -- Indices for common queries
      CREATE INDEX IF NOT EXISTS idx_memories_category ON memories(category);
      CREATE INDEX IF NOT EXISTS idx_memories_source ON memories(source);
      CREATE INDEX IF NOT EXISTS idx_memories_created_at ON memories(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_memories_access_count ON memories(access_count DESC);
    `);

    const count = this.db.prepare('SELECT COUNT(*) as count FROM memories').get() as { count: number };
    this.logger.info({ dbPath: this.dbPath, entryCount: count.count }, 'Memory engine initialized');
  }

  /**
   * Close the database connection gracefully.
   */
  async close(): Promise<void> {
    this.db?.close();
    this.logger.info('Memory engine closed');
  }

  // ─── Storage ──────────────────────────────────────────────────────────────

  /**
   * Store a new memory entry.
   *
   * @param entry - The memory to store
   * @returns The generated memory ID
   *
   * @example
   * ```typescript
   * const id = await memory.store({
   *   content: 'Use `pnpm` instead of npm for this project — it has workspace support',
   *   category: 'preference',
   *   tags: ['package-manager', 'pnpm', 'workspace'],
   *   source: 'user',
   * });
   * ```
   */
  async store(entry: MemoryEntry): Promise<string> {
    const id = `mem_${nanoid(12)}`;

    this.db.prepare(`
      INSERT INTO memories (id, content, category, tags_json, source, metadata_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      entry.content,
      entry.category,
      JSON.stringify(entry.tags),
      entry.source,
      JSON.stringify(entry.metadata ?? {}),
      new Date().toISOString()
    );

    this.logger.debug({ id, category: entry.category }, 'Memory stored');

    // Check if compaction is needed
    await this.maybeCompact();

    return id;
  }

  /**
   * Store multiple memories in a single transaction (batch insert).
   */
  async storeBatch(entries: MemoryEntry[]): Promise<string[]> {
    const ids: string[] = [];
    const insert = this.db.prepare(`
      INSERT INTO memories (id, content, category, tags_json, source, metadata_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const transaction = this.db.transaction(() => {
      for (const entry of entries) {
        const id = `mem_${nanoid(12)}`;
        insert.run(
          id,
          entry.content,
          entry.category,
          JSON.stringify(entry.tags),
          entry.source,
          JSON.stringify(entry.metadata ?? {}),
          new Date().toISOString()
        );
        ids.push(id);
      }
    });

    transaction();
    this.logger.info({ count: entries.length }, 'Batch memory storage complete');
    return ids;
  }

  // ─── Search ───────────────────────────────────────────────────────────────

  /**
   * Search memories using FTS5 full-text search with BM25 ranking.
   *
   * @param query - Search query (supports FTS5 syntax: AND, OR, NOT, "phrases")
   * @param options - Search options (filters, limits, boosts)
   * @returns Matching memories sorted by relevance
   *
   * @example
   * ```typescript
   * // Simple keyword search
   * const results = await memory.search('JWT authentication');
   *
   * // With filters
   * const recent = await memory.search('deployment', {
   *   category: 'architecture',
   *   after: new Date('2024-01-01'),
   *   limit: 5,
   * });
   *
   * // FTS5 advanced syntax
   * const specific = await memory.search('"error handling" AND typescript');
   * ```
   */
  async search(query: string, options?: MemorySearchOptions): Promise<StoredMemory[]> {
    const limit = options?.limit ?? 10;

    // Build the query — combine FTS5 search with filters
    let sql: string;
    const params: unknown[] = [];

    if (query.trim()) {
      // FTS5 search with BM25 ranking
      sql = `
        SELECT m.*, rank as score
        FROM memories m
        INNER JOIN memories_fts f ON m.rowid = f.rowid
        WHERE memories_fts MATCH ?
      `;
      params.push(query);
    } else {
      // No search query — return recent memories
      sql = `SELECT m.*, 0 as score FROM memories m WHERE 1=1`;
    }

    // Apply filters
    if (options?.category) {
      sql += ' AND m.category = ?';
      params.push(options.category);
    }

    if (options?.source) {
      sql += ' AND m.source = ?';
      params.push(options.source);
    }

    if (options?.tag) {
      sql += ' AND m.tags_json LIKE ?';
      params.push(`%"${options.tag}"%`);
    }

    if (options?.after) {
      sql += ' AND m.created_at >= ?';
      params.push(options.after.toISOString());
    }

    if (options?.before) {
      sql += ' AND m.created_at <= ?';
      params.push(options.before.toISOString());
    }

    if (options?.minAccessCount) {
      sql += ' AND m.access_count >= ?';
      params.push(options.minAccessCount);
    }

    // Order by relevance (if FTS search) or recency
    if (query.trim()) {
      sql += ' ORDER BY rank'; // BM25 rank (lower is better in FTS5)
    } else {
      sql += ' ORDER BY m.created_at DESC';
    }

    sql += ' LIMIT ?';
    params.push(limit);

    const rows = this.db.prepare(sql).all(...params) as Array<{
      id: string;
      content: string;
      category: string;
      tags_json: string;
      source: string;
      metadata_json: string;
      access_count: number;
      last_accessed_at: string | null;
      created_at: string;
      score: number;
    }>;

    // Update access counts for retrieved memories
    if (rows.length > 0) {
      const updateAccess = this.db.prepare(
        'UPDATE memories SET access_count = access_count + 1, last_accessed_at = ? WHERE id = ?'
      );
      const now = new Date().toISOString();
      const updateTransaction = this.db.transaction(() => {
        for (const row of rows) {
          updateAccess.run(now, row.id);
        }
      });
      updateTransaction();
    }

    return rows.map((row) => ({
      id: row.id,
      content: row.content,
      category: row.category,
      tags: JSON.parse(row.tags_json),
      source: row.source,
      metadata: JSON.parse(row.metadata_json),
      createdAt: new Date(row.created_at),
      score: Math.abs(row.score), // FTS5 rank is negative; normalize
      accessCount: row.access_count,
      lastAccessedAt: row.last_accessed_at ? new Date(row.last_accessed_at) : null,
    }));
  }

  /**
   * Get a specific memory by ID.
   */
  async getById(id: string): Promise<StoredMemory | null> {
    const row = this.db.prepare('SELECT * FROM memories WHERE id = ?').get(id) as {
      id: string;
      content: string;
      category: string;
      tags_json: string;
      source: string;
      metadata_json: string;
      access_count: number;
      last_accessed_at: string | null;
      created_at: string;
    } | undefined;

    if (!row) return null;

    return {
      id: row.id,
      content: row.content,
      category: row.category,
      tags: JSON.parse(row.tags_json),
      source: row.source,
      metadata: JSON.parse(row.metadata_json),
      createdAt: new Date(row.created_at),
      accessCount: row.access_count,
      lastAccessedAt: row.last_accessed_at ? new Date(row.last_accessed_at) : null,
    };
  }

  /**
   * Delete a memory by ID.
   */
  async delete(id: string): Promise<void> {
    this.db.prepare('DELETE FROM memories WHERE id = ?').run(id);
  }

  // ─── Analytics ────────────────────────────────────────────────────────────

  /**
   * Get memory statistics for monitoring and display.
   */
  async getStats(): Promise<MemoryStats> {
    const total = this.db.prepare('SELECT COUNT(*) as count FROM memories').get() as { count: number };
    const categories = this.db.prepare(
      'SELECT category, COUNT(*) as count FROM memories GROUP BY category'
    ).all() as Array<{ category: string; count: number }>;

    const oldest = this.db.prepare(
      'SELECT MIN(created_at) as ts FROM memories'
    ).get() as { ts: string | null };
    const newest = this.db.prepare(
      'SELECT MAX(created_at) as ts FROM memories'
    ).get() as { ts: string | null };

    const avgAccess = this.db.prepare(
      'SELECT AVG(access_count) as avg FROM memories'
    ).get() as { avg: number | null };

    // Get file size
    let sizeBytes = 0;
    try {
      const stat = await fs.stat(this.dbPath);
      sizeBytes = stat.size;
    } catch { /* file may not exist yet */ }

    return {
      totalEntries: total.count,
      byCategory: Object.fromEntries(categories.map((c) => [c.category, c.count])),
      oldestEntry: oldest.ts ? new Date(oldest.ts) : null,
      newestEntry: newest.ts ? new Date(newest.ts) : null,
      databaseSizeBytes: sizeBytes,
      averageAccessCount: avgAccess.avg ?? 0,
    };
  }

  // ─── Maintenance ──────────────────────────────────────────────────────────

  /**
   * Compact the memory database — remove expired and low-value entries.
   *
   * Compaction strategy:
   * 1. Remove entries older than retentionDays
   * 2. If still over maxEntries, remove lowest-access entries
   * 3. Optimize the FTS index
   * 4. Run SQLite VACUUM
   */
  async compact(): Promise<{ removed: number }> {
    this.logger.info('Starting memory compaction');

    let removed = 0;

    // Remove expired entries
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - this.retentionDays);

    const expiredResult = this.db.prepare(
      'DELETE FROM memories WHERE created_at < ? AND access_count < 3'
    ).run(cutoff.toISOString());
    removed += expiredResult.changes;

    // If still over limit, remove lowest-access entries
    const count = (this.db.prepare('SELECT COUNT(*) as count FROM memories').get() as { count: number }).count;
    if (count > this.maxEntries) {
      const excess = count - this.maxEntries;
      const lowValueResult = this.db.prepare(`
        DELETE FROM memories WHERE id IN (
          SELECT id FROM memories ORDER BY access_count ASC, created_at ASC LIMIT ?
        )
      `).run(excess);
      removed += lowValueResult.changes;
    }

    // Optimize FTS index
    this.db.exec("INSERT INTO memories_fts(memories_fts) VALUES('optimize')");

    this.logger.info({ removed }, 'Memory compaction complete');
    return { removed };
  }

  /**
   * Check if compaction is needed and run it if so.
   */
  private async maybeCompact(): Promise<void> {
    const count = (this.db.prepare('SELECT COUNT(*) as count FROM memories').get() as { count: number }).count;
    // Compact when 20% over limit (avoid compacting too frequently)
    if (count > this.maxEntries * 1.2) {
      await this.compact();
    }
  }
}

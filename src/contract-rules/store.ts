/**
 * Contract Rules — Persistence Store
 *
 * Wraps a small SQLite database (better-sqlite3) for durable rule storage.
 * Falls back to an in-memory store if better-sqlite3 is unavailable — the
 * public API is identical either way, so the evaluator and UI do not need
 * to know which backend they are talking to.
 *
 * Schema:
 *   rules(id INTEGER PK AUTOINCREMENT, name TEXT, description TEXT,
 *         enabled INTEGER, action TEXT, severity TEXT, tags TEXT,
 *         conditions TEXT, created_at TEXT, updated_at TEXT)
 *   conditions and tags are stored as JSON blobs — the schema of a rule is
 *   flexible enough that normalising them into a child table adds friction
 *   without value.
 */

import { Rule, Ruleset } from './types';
import { validateRule } from './evaluator';

export interface StoredRule {
  id: number;
  name: string;
  description: string | null;
  enabled: boolean;
  action: string;
  severity: string | null;
  tags: string[] | null;
  conditions: any[];
  createdAt: string;
  updatedAt: string;
}

export interface RuleStore {
  list(): Rule[];
  getById(id: number): Rule | null;
  add(rule: Rule): Rule;
  update(id: number, rule: Rule): Rule | null;
  delete(id: number): boolean;
  count(): number;
  exportRuleset(): Ruleset;
  importRuleset(ruleset: Ruleset, replace?: boolean): number;
  close(): void;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS rules (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  description TEXT,
  enabled     INTEGER NOT NULL DEFAULT 1,
  action      TEXT NOT NULL,
  severity    TEXT,
  tags        TEXT,
  conditions  TEXT NOT NULL DEFAULT '[]',
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

// ---------------------------------------------------------------------------
// SQLite-backed store
// ---------------------------------------------------------------------------

class SqliteRuleStore implements RuleStore {
  private db: import('better-sqlite3').Database;

  constructor(db: import('better-sqlite3').Database) {
    this.db = db;
    this.db.pragma('journal_mode = WAL');
    this.db.exec(SCHEMA);
  }

  list(): Rule[] {
    const rows = this.db.prepare('SELECT * FROM rules ORDER BY id ASC').all() as RawRow[];
    return rows.map(rowToRule);
  }

  getById(id: number): Rule | null {
    const row = this.db.prepare('SELECT * FROM rules WHERE id = ?').get(id) as RawRow | undefined;
    return row ? rowToRule(row) : null;
  }

  add(rule: Rule): Rule {
    const error = validateRule(rule);
    if (error) throw new Error(`Cannot add rule: ${error}`);
    const stmt = this.db.prepare(`
      INSERT INTO rules (name, description, enabled, action, severity, tags, conditions)
      VALUES (@name, @description, @enabled, @action, @severity, @tags, @conditions)
    `);
    const result = stmt.run({
      name: rule.name,
      description: rule.description ?? null,
      enabled: rule.enabled ? 1 : 0,
      action: rule.action,
      severity: rule.severity ?? null,
      tags: rule.tags ? JSON.stringify(rule.tags) : null,
      conditions: JSON.stringify(rule.conditions ?? []),
    });
    const id = Number(result.lastInsertRowid);
    const created = this.getById(id);
    if (!created) throw new Error('Failed to retrieve inserted rule');
    return created;
  }

  update(id: number, rule: Rule): Rule | null {
    const existing = this.getById(id);
    if (!existing) return null;
    const error = validateRule({ ...rule, id });
    if (error) throw new Error(`Cannot update rule: ${error}`);
    this.db.prepare(`
      UPDATE rules
      SET name = @name, description = @description, enabled = @enabled,
          action = @action, severity = @severity, tags = @tags,
          conditions = @conditions, updated_at = datetime('now')
      WHERE id = @id
    `).run({
      id,
      name: rule.name,
      description: rule.description ?? null,
      enabled: rule.enabled ? 1 : 0,
      action: rule.action,
      severity: rule.severity ?? null,
      tags: rule.tags ? JSON.stringify(rule.tags) : null,
      conditions: JSON.stringify(rule.conditions ?? []),
    });
    return this.getById(id);
  }

  delete(id: number): boolean {
    const result = this.db.prepare('DELETE FROM rules WHERE id = ?').run(id);
    return result.changes > 0;
  }

  count(): number {
    const row = this.db.prepare('SELECT COUNT(*) AS n FROM rules').get() as { n: number };
    return row.n;
  }

  exportRuleset(): Ruleset {
    return { version: '1.0', rules: this.list() };
  }

  importRuleset(ruleset: Ruleset, replace = false): number {
    if (!Array.isArray(ruleset.rules)) throw new Error('ruleset.rules must be an array');
    const tx = this.db.transaction(() => {
      if (replace) this.db.exec('DELETE FROM rules');
      let imported = 0;
      for (const rule of ruleset.rules) {
        try {
          const { id, ...withoutId } = rule; // never import stale id
          this.add({ ...withoutId, id: undefined as never });
          imported++;
        } catch {
          // skip invalid rules but keep importing the rest
        }
      }
      return imported;
    });
    return tx();
  }

  close(): void {
    this.db.close();
  }
}

interface RawRow {
  id: number;
  name: string;
  description: string | null;
  enabled: number;
  action: string;
  severity: string | null;
  tags: string | null;
  conditions: string;
  created_at: string;
  updated_at: string;
}

function rowToRule(row: RawRow): Rule {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    enabled: row.enabled !== 0,
    action: row.action as Rule['action'],
    severity: (row.severity as Rule['severity']) ?? undefined,
    tags: row.tags ? (JSON.parse(row.tags) as string[]) : undefined,
    conditions: JSON.parse(row.conditions) as any[],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ---------------------------------------------------------------------------
// In-memory fallback store (used when better-sqlite3 cannot load)
// ---------------------------------------------------------------------------

class MemoryRuleStore implements RuleStore {
  private rules = new Map<number, Rule>();
  private nextId = 1;

  list(): Rule[] {
    return Array.from(this.rules.values());
  }

  getById(id: number): Rule | null {
    return this.rules.get(id) ?? null;
  }

  add(rule: Rule): Rule {
    const error = validateRule(rule);
    if (error) throw new Error(`Cannot add rule: ${error}`);
    const id = this.nextId++;
    const stored: Rule = { ...rule, id, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    this.rules.set(id, stored);
    return stored;
  }

  update(id: number, rule: Rule): Rule | null {
    const existing = this.rules.get(id);
    if (!existing) return null;
    const error = validateRule({ ...rule, id });
    if (error) throw new Error(`Cannot update rule: ${error}`);
    const updated: Rule = { ...rule, id, createdAt: existing.createdAt, updatedAt: new Date().toISOString() };
    this.rules.set(id, updated);
    return updated;
  }

  delete(id: number): boolean {
    return this.rules.delete(id);
  }

  count(): number {
    return this.rules.size;
  }

  exportRuleset(): Ruleset {
    return { version: '1.0', rules: this.list() };
  }

  importRuleset(ruleset: Ruleset, replace = false): number {
    if (!Array.isArray(ruleset.rules)) throw new Error('ruleset.rules must be an array');
    if (replace) this.rules.clear();
    let imported = 0;
    for (const rule of ruleset.rules) {
      try {
        const { id, ...withoutId } = rule;
        this.add({ ...withoutId, id: undefined as never });
        imported++;
      } catch {
        // skip invalid rules
      }
    }
    return imported;
  }

  close(): void {
    this.rules.clear();
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Open a rule store. When `dbPath` is provided and better-sqlite3 is
 * available, persists to SQLite at that path (use `:memory:` for a
 * transient, file-backed session). When better-sqlite3 fails to load or
 * `dbPath` is omitted, falls back to an in-memory store transparently.
 */
export function openRuleStore(dbPath?: string): RuleStore {
  if (!dbPath) return new MemoryRuleStore();
  try {
    // Lazy require so projects that never call openRuleStore(dbPath) don't fail
    // if better-sqlite3 isn't installed.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Database = require('better-sqlite3');
    const db = new Database(dbPath);
    return new SqliteRuleStore(db);
  } catch {
    return new MemoryRuleStore();
  }
}

export { MemoryRuleStore, SqliteRuleStore };

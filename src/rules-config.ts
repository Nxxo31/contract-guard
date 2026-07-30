/**
 * Configurable Rules Loader
 *
 * Allows loading custom rules from JSON or YAML:
 *
 *   {
 *     "rules": {
 *       "breaking": ["field-removed", "type-changed"],
 *       "warning": ["field-added", "field-deprecated"],
 *       "safe": ["description-changed"]
 *     }
 *   }
 *
 * The CLI accepts --rules ./rules.json (or .yaml). When a rules file is supplied,
 * the classifier re-maps change kinds to severities according to the user's
 * configuration; any kind not mentioned keeps its default severity.
 */

import * as fs from 'fs';
import * as path from 'path';

// ---------- Types ----------

export type Severity = 'breaking' | 'warning' | 'safe';

export interface RulesFile {
  rules: {
    breaking?: string[];
    warning?: string[];
    safe?: string[];
  };
}

// ---------- YAML parsing ----------

/**
 * Minimal YAML subset parser for the rules file format.
 * Only supports the exact shape used by contract-guard (top-level
 * "rules:" key and "breaking:"/"warning:"/"safe:" lists of strings).
 * Falls back to manual line-by-line parsing — avoids a YAML dependency.
 */
export function parseRulesYaml(content: string): RulesFile {
  var result: RulesFile = { rules: {} };
  var currentList: string[] | null = null;

  const lines = content.split('\n');
  for (const rawLine of lines) {
    // strip trailing comments (not inside quotes — simple approach for our schema)
    let line = rawLine.replace(/\s+#.*$/, '');

    if (line.trim() === '') continue;
    // Top-level key
    if (line.startsWith('rules:')) { continue; }
    if (line.startsWith('  breaking:') || line.startsWith('  warning:') || line.startsWith('  safe:')) {
      // Subkey — may have content on the same line or else the list items below.
      // For our restricted format we only support block lists, but we also accept
      // inline list if present.
      if (line.includes('[')) {
        // inline list: `breaking: ["field-removed", "type-changed"]`
        const key = line.trim().split(':')[0].trim() as keyof RulesFile['rules'];
        const valsRaw = line.slice(line.indexOf('[') + 1, line.lastIndexOf(']'));
        const items = valsRaw.split(',').map(x => {
          let item = x.trim();
          item = item.replace(/^["']|["']$/g, '');
          return item;
        }).filter(x => x);
        (result.rules as any)[key] = items;
        currentList = null;
        continue;
      }
      // otherwise: the key is on its own line, list items follow
      const key = line.trim().split(':')[0].trim() as keyof RulesFile['rules'];
      (result.rules as any)[key] = [];
      currentList = (result.rules as any)[key] as string[];
      continue;
    }
    // List items: indentation >= 4 spaces, starting with "- ..."
    const m = line.match(/^\s+-\s+(["']?)([^"']+?)\1\s*$/);
    if (m && currentList !== null) {
      currentList.push(m[2].trim());
      continue;
    }
  }
  return result;
}

/**
 * Detect YAML vs JSON by extension and parse accordingly.
 */
export function loadRules(filePath: string): RulesFile {
  const absolute = path.resolve(filePath);
  const content = fs.readFileSync(absolute, 'utf-8');
  const ext = path.extname(absolute).toLowerCase();
  if (ext === '.yaml' || ext === '.yml') {
    return parseRulesYaml(content);
  }
  // JSON (default)
  return JSON.parse(content) as RulesFile;
}

/**
 * Validate that the RulesFile is well-formed.
 * Returns null on success, or an error message describing the problem.
 */
export function validateRules(ruleFile: RulesFile): string | null {
  if (!ruleFile || typeof ruleFile !== 'object') return 'rules: must be an object';
  if (!ruleFile.rules || typeof ruleFile.rules !== 'object') return 'rules.rules: must be an object';
  const allowedKeys = new Set(['breaking', 'warning', 'safe']);
  for (const k of Object.keys(ruleFile.rules)) {
    if (!allowedKeys.has(k)) return `unknown severity '${k}' in rules`;
    const arr = (ruleFile.rules as any)[k];
    if (!Array.isArray(arr)) return `rules.${k} must be an array of kind names`;
    for (const item of arr) {
      if (typeof item !== 'string') return `rules.${k} must contain only string kind names`;
    }
  }
  return null;
}

/**
 * Build a severity map from a RulesFile: kind -> severity.
 * For any kind not mentioned in the rules file, this returns undefined so
 * callers know to keep the default classification.
 */
export function buildSeverityOverride(rules: RulesFile): Map<string, Severity> {
  const map = new Map<string, Severity>();
  const mapping: Array<[Severity, string[] | undefined]> = [
    ['breaking', rules.rules.breaking],
    ['warning', rules.rules.warning],
    ['safe', rules.rules.safe]
  ];
  for (const [sev, kinds] of mapping) {
    if (!kinds) continue;
    for (const kind of kinds) {
      map.set(kind, sev);
    }
  }
  return map;
}

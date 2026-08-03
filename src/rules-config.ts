/**
 * Configurable Rules Loader
 *
 * Supports two YAML schemas for custom severity classification:
 *
 * 1. Simple schema (backwards-compatible):
 *
 *   rules:
 *     breaking: ["field-removed", "type-changed"]
 *     warning: ["field-added", "field-deprecated"]
 *     safe: ["description-changed"]
 *
 * 2. Extended rule schema (Issue #2):
 *
 *   rules:
 *     - name: no-breaking-change
 *       type: openapi          # openapi | graphql | grpc | any
 *       severity: error         # error (=breaking) | warning | safe
 *       pattern: "endpoint-removed"
 *       description: "Endpoints cannot be removed"
 *     - name: param-type-strict
 *       type: any
 *       severity: warning
 *       pattern: "parameter-type-changed"
 *
 * The CLI accepts --rules <file> (single file) or --rules-dir <dir>
 * (loads all .yaml/.yml/.json files from a directory, default: .contract/rules/).
 * Rules are merged: later files override earlier ones for the same kind.
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

/** A single rule in the extended schema. */
export interface ConfigRule {
  name: string;
  /** Spec type this rule applies to. 'any' matches all formats. */
  type?: 'openapi' | 'graphql' | 'grpc' | 'any';
  /** Severity when the pattern matches. Maps to the internal Severity enum. */
  severity: Severity;
  /** Change kind string or regex pattern to match change.kind. */
  pattern: string;
  description?: string;
}

/** Extended rules file with individual rule definitions. */
export interface ExtendedRulesFile {
  rules: ConfigRule[];
}

/** Either the simple or extended schema, detected at load time. */
export type AnyRulesFile = RulesFile | ExtendedRulesFile;

// ---------- YAML parsing (simple schema) ----------

/**
 * Minimal YAML subset parser for the simple rules file format.
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
    if (line.startsWith('rules:')) {
      // Check if inline dict on same line — if not, it's a block container
      continue;
    }
    if (line.startsWith('  breaking:') || line.startsWith('  warning:') || line.startsWith('  safe:')) {
      // Subkey — may have content on the same line or else the list items below.
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
    const m = line.match(/^\s+-\s+["']?([^"']+)["']?\s*$/);
    if (m && currentList !== null) {
      currentList.push(m[2] ? m[2].trim() : m[1].trim());
      continue;
    }
  }
  return result;
}

// ---------- YAML parsing (extended schema) ----------

/**
 * Minimal YAML parser for the extended rule schema (list of mappings).
 * Supports the format:
 *
 *   rules:
 *     - name: string
 *       type: string
 *       severity: string
 *       pattern: string
 *       description: string (optional)
 *
 * Each rule is a mapping under the `rules:` key, indented.
 * Values are scalars (strings) or inline lists. No nesting beyond 2 levels.
 */
export function parseExtendedRulesYaml(content: string): ExtendedRulesFile {
  const result: ExtendedRulesFile = { rules: [] };
  const lines = content.split('\n');
  let inRules = false;
  let currentRule: Partial<ConfigRule> | null = null;

  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+#.*$/, '');
    const trimmed = line.trim();

    if (trimmed === '') continue;
    if (trimmed.startsWith('#')) continue;

    // Detect "rules:" at top level
    if (line.startsWith('rules:')) {
      inRules = true;
      // If inline list on same line, we don't support it for extended format
      continue;
    }

    if (!inRules) continue;

    // Detect start of a rule entry: "- name: ..." or just "-"
    const ruleMatch = line.match(/^\s+-\s+(.*)$/);
    if (ruleMatch) {
      // Save previous rule
      if (currentRule && currentRule.name && currentRule.severity) {
        result.rules.push(currentRule as ConfigRule);
      }
      currentRule = {};

      // Parse inline content after "- "
      const rest = ruleMatch[1].trim();
      if (rest) {
        const kv = parseKeyValue(rest);
        if (kv) assignRuleField(currentRule, kv.key, kv.value);
      }
      continue;
    }

    // Continuation fields of current rule: "  key: value"
    if (currentRule && trimmed.includes(':')) {
      const kv = parseKeyValue(trimmed);
      if (kv) assignRuleField(currentRule, kv.key, kv.value);
    }
  }

  // Save last rule
  if (currentRule && currentRule.name && currentRule.severity) {
    result.rules.push(currentRule as ConfigRule);
  }

  return result;
}

function parseKeyValue(str: string): { key: string; value: string } | null {
  const colonIdx = str.indexOf(':');
  if (colonIdx === -1) return null;
  const key = str.slice(0, colonIdx).trim();
  let value = str.slice(colonIdx + 1).trim();
  // Strip quotes
  if ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1);
  }
  return { key, value };
}

function assignRuleField(rule: Partial<ConfigRule>, key: string, rawValue: string): void {
  switch (key) {
    case 'name':
      rule.name = rawValue;
      break;
    case 'type':
      rule.type = rawValue as ConfigRule['type'];
      break;
    case 'severity':
      // Normalize: "error" → "breaking"
      const sev = rawValue.toLowerCase();
      if (sev === 'error' || sev === 'breaking') rule.severity = 'breaking';
      else if (sev === 'warning') rule.severity = 'warning';
      else if (sev === 'safe' || sev === 'info') rule.severity = 'safe';
      break;
    case 'pattern':
      rule.pattern = rawValue;
      break;
    case 'description':
      rule.description = rawValue;
      break;
  }
}

// ---------- Schema detection ----------

/**
 * Detect whether a parsed YAML/JSON object is the simple or extended schema.
 * Extended schema: `rules` is an array of objects with `name` + `severity`.
 * Simple schema: `rules` is an object with breaking/warning/safe arrays.
 */
function isExtendedSchema(data: any): data is ExtendedRulesFile {
  return Array.isArray(data?.rules) && data.rules.length > 0 &&
    typeof data.rules[0] === 'object' && 'name' in data.rules[0];
}

// ---------- File-based loader ----------

/**
 * Load a rules file (JSON or YAML), detecting schema automatically.
 * Returns either the simple or extended format.
 */
export function loadRules(filePath: string): AnyRulesFile {
  const absolute = path.resolve(filePath);
  const content = fs.readFileSync(absolute, 'utf-8');
  const ext = path.extname(absolute).toLowerCase();
  let data: any;
  if (ext === '.yaml' || ext === '.yml') {
    // Try simple schema first; if it has array rules with `name`, parse as extended
    // For extended, we need to re-parse with the extended parser
    data = parseRulesYaml(content);
    // Heuristic: if the YAML content contains "- name:" it's extended format
    if (/\n\s*-\s+name:/.test(content) || /^\s*-\s+name:/.test(content.trim())) {
      return parseExtendedRulesYaml(content);
    }
    return data;
  }
  // JSON (default)
  data = JSON.parse(content);
  return data;
}

// ---------- Directory-based loader ----------

/**
 * Load all rule files from a directory (default: .contract/rules/).
 * Supports .yaml, .yml, and .json files. Files are sorted alphabetically
 * for deterministic merge order. Extended rules from different files are
 * concatenated. Simple severity overrides are merged (later files win
 * for duplicate change kinds).
 *
 * Returns null if the directory doesn't exist (not an error — the caller
 * may not have configured custom rules).
 */
export function loadRulesFromDirectory(dirPath: string): AnyRulesFile | null {
  const absolute = path.resolve(dirPath);
  if (!fs.existsSync(absolute)) return null;
  const stat = fs.statSync(absolute);
  if (!stat.isDirectory()) return null;

  const files = fs.readdirSync(absolute)
    .filter(f => /\.(ya?ml|json)$/.test(f))
    .sort(); // deterministic order

  if (files.length === 0) return null;

  // Merge results
  const extendedRules: ConfigRule[] = [];
  const simpleRules: RulesFile = { rules: { breaking: [], warning: [], safe: [] } };
  let foundExtended = false;
  let foundSimple = false;

  for (const file of files) {
    const filePath = path.join(absolute, file);
    const loaded = loadRules(filePath);

    if (isExtendedSchema(loaded)) {
      foundExtended = true;
      extendedRules.push(...loaded.rules);
    } else {
      foundSimple = true;
      const sf = loaded as RulesFile;
      if (sf.rules.breaking) simpleRules.rules.breaking!.push(...sf.rules.breaking);
      if (sf.rules.warning) simpleRules.rules.warning!.push(...sf.rules.warning);
      if (sf.rules.safe) simpleRules.rules.safe!.push(...sf.rules.safe);
    }
  }

  if (foundExtended) {
    return { rules: extendedRules } as ExtendedRulesFile;
  }
  if (foundSimple) {
    // Deduplicate kind arrays
    simpleRules.rules.breaking = [...new Set(simpleRules.rules.breaking ?? [])];
    simpleRules.rules.warning = [...new Set(simpleRules.rules.warning ?? [])];
    simpleRules.rules.safe = [...new Set(simpleRules.rules.safe ?? [])];
    return simpleRules;
  }
  return null;
}

// ---------- Validation ----------

/**
 * Validate that the RulesFile (simple or extended) is well-formed.
 * Returns null on success, or an error message describing the problem.
 */
export function validateRules(ruleFile: AnyRulesFile): string | null {
  if (!ruleFile || typeof ruleFile !== 'object') return 'rules: must be an object';

  // Extended schema
  if (isExtendedSchema(ruleFile)) {
    return validateExtendedRules(ruleFile);
  }

  // Simple schema
  if (!ruleFile.rules || typeof ruleFile.rules !== 'object') return 'rules.rules: must be an object';
  const allowedKeys = new Set(['breaking', 'warning', 'safe']);
  for (const k of Object.keys((ruleFile as RulesFile).rules)) {
    if (!allowedKeys.has(k)) return `unknown severity '${k}' in rules`;
    const arr = ((ruleFile as RulesFile).rules as any)[k];
    if (!Array.isArray(arr)) return `rules.${k} must be an array of kind names`;
    for (const item of arr) {
      if (typeof item !== 'string') return `rules.${k} must contain only string kind names`;
    }
  }
  return null;
}

function validateExtendedRules(ruleFile: ExtendedRulesFile): string | null {
  if (!Array.isArray(ruleFile.rules)) return 'rules must be an array';
  const validSeverities = new Set(['breaking', 'warning', 'safe']);
  const validTypes = new Set(['openapi', 'graphql', 'grpc', 'any', undefined]);
  for (let i = 0; i < ruleFile.rules.length; i++) {
    const r = ruleFile.rules[i];
    if (!r.name || typeof r.name !== 'string') return `rules[${i}].name is required`;
    if (!r.severity || !validSeverities.has(r.severity)) {
      return `rules[${i}].severity must be one of: breaking, warning, safe`;
    }
    if (!r.pattern || typeof r.pattern !== 'string') {
      return `rules[${i}].pattern is required`;
    }
    if (!validTypes.has(r.type)) {
      return `rules[${i}].type must be: openapi, graphql, grpc, any, or omitted`;
    }
  }
  return null;
}

// ---------- Severity override builder ----------

/**
 * Build a severity map from a simple RulesFile: kind -> severity.
 * For any kind not mentioned, returns undefined so callers keep
 * the default classification.
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

// ---------- Extended rules builder ----------

/**
 * Build a severity override map from extended rules.
 * Each rule contributes its `severity` for any `change.kind` matching
 * its `pattern` (treated as exact match first, then regex).
 * Optionally filter by format type.
 */
export function buildExtendedSeverityOverride(
  rules: ConfigRule[],
  format?: 'openapi' | 'graphql' | 'grpc'
): Map<string, Severity> {
  const map = new Map<string, Severity>();
  for (const rule of rules) {
    // Skip rules that don't apply to the current format
    if (rule.type && rule.type !== 'any' && format && rule.type !== format) continue;
    map.set(rule.pattern, rule.severity);
  }
  return map;
}

// ---------- Unified severity override ----------

/**
 * Build a severity override map from any loaded rules file (simple or extended).
 * This is the main entry point for the CLI — it handles both schemas transparently.
 */
export function buildOverrideFromAny(
  rulesFile: AnyRulesFile,
  format?: 'openapi' | 'graphql' | 'grpc'
): Map<string, Severity> {
  if (isExtendedSchema(rulesFile)) {
    return buildExtendedSeverityOverride(rulesFile.rules, format);
  }
  return buildSeverityOverride(rulesFile as RulesFile);
}

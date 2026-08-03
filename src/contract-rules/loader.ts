/**
 * Contract Rules — Runtime Loader
 *
 * Loads rules from JSON or YAML files at runtime — no recompile required.
 * Mirrors the approach of the existing src/rules-config.ts but targets the
 * ContractData rule schema (names, conditions, actions) used by the
 * contract-rules engine.
 *
 *   YAML rules file (rules.yaml):
 *     version: "1.0"
 *     rules:
 *       - name: "amount-limit"
 *         enabled: true
 *         action: block
 *         severity: high
 *         conditions:
 *           - field: amount
 *             operator: ">"
 *             value: 100000
 *             type: number
 *           - field: currency
 *             operator: "="
 *             value: "USD"
 *
 *   Equivalent JSON:
 *     { "version": "1.0", "rules": [ { "name": "amount-limit", ... } ] }
 */

import * as fs from 'fs';
import * as path from 'path';

import { Rule, Ruleset } from './types';
import { validateRuleset } from './evaluator';

const SCHEMA_VERSION = '1.0';

// ---------------------------------------------------------------------------
// YAML parsing (minimal, self-contained — avoids a YAML dependency)
// ---------------------------------------------------------------------------

/**
 * Minimal YAML parser for the rules schema. Supports exactly the shape used
 * here: a top-level `version:` scalar and a `rules:` list of mappings whose
 * values are scalars, sequences, or nested mappings up to 3 levels.
 *
 * This is intentionally NOT a general-purpose YAML parser; it covers the
 * contract-rules schema only. Use JSON for any exotic needs.
 *
 * Implementation: a small indentation-aware recursive-descent parser over the
 * pre-tokenised line list. Each call consumes a block of equally-indented
 * lines and returns the parsed value plus how many lines it consumed, so the
 * caller can resume exactly where this block ended.
 */
export function parseRulesYaml(content: string): Ruleset {
  const result: Ruleset = { version: SCHEMA_VERSION, rules: [] };
  const tokens = tokenise(content);
  let pos = 0;

  while (pos < tokens.length) {
    const tok = tokens[pos];
    if (tok.indent !== 0) { pos++; continue; }
    const key = tok.key;

    if (key === 'version') {
      result.version = stripQuotes(String(tok.value ?? ''));
      pos++;
      continue;
    }
    if (key === 'rules' && tok.isBlockList) {
      // Consume the indented block of rule lines beneath this key.
      const children = collectBlock(tokens, pos + 1, tok.indent);
      for (const ruleStart of children.items) {
        // Each ruleStart is the "- " line that opens a rule mapping.
        const { value: rule, next } = parseRuleMapping(tokens, ruleStart);
        if (rule) result.rules.push(rule);
        // Move past this rule; collectBlock already gave us logical positions.
        pos = next;
      }
      continue;
    }
    pos++;
  }
  return result;
}

interface Token {
  /** Line index in the source for debugging. */
  line: number;
  /** Indentation (number of leading spaces). */
  indent: number;
  /** Whether the line opens with "- " (list item). */
  isItem: boolean;
  /** For "key:" or "key: value" lines, the key. Empty for "- " items without a key. */
  key: string;
  /** Raw value text after the colon (or after "- "). May be empty / undefined. */
  value?: string;
  /** True when the value is a block (list/mapping continues on following lines). */
  isBlockList: boolean;
}

function tokenise(content: string): Token[] {
  const out: Token[] = [];
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const trimmed = raw.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    const indent = raw.length - raw.trimLeft().length;
    const isItem = /^\s*-\s+/.test(raw) || /^\s*-\s*$/.test(raw);
    let rest = trimmed;
    let key = '';
    let value: string | undefined;
    let isBlockList = false;
    if (isItem) {
      rest = trimmed.replace(/^-\s+/, '').replace(/^-\s*$/, '');
    }
    const colon = rest.indexOf(':');
    if (colon >= 0) {
      key = rest.slice(0, colon).trim();
      const after = rest.slice(colon + 1).trim();
      value = after === '' ? undefined : after;
      // "key:" with nothing after → block list/mapping beneath.
      isBlockList = after === '';
      // "key: []" inline list is not a block list.
      if (after.startsWith('[') || after.startsWith('{')) isBlockList = false;
      // "key: - ..." doesn't happen; inline scalars are not blocks.
      if (after !== '' && !after.startsWith('[') && !after.startsWith('{')) isBlockList = false;
    } else if (rest !== '') {
      // bare scalar (rare for our schema) — treat the whole rest as value.
      key = '';
      value = rest;
    }
    out.push({
      line: i,
      indent,
      isItem,
      key,
      value,
      isBlockList,
    });
  }
  return out;
}

/**
 * Collect a contiguous run of tokens strictly more indented than
 * `parentIndent`. Returns the logical item-start positions and the token
 * index just after the block ends.
 */
function collectBlock(tokens: Token[], start: number, parentIndent: number): { items: number[]; end: number } {
  const items: number[] = [];
  let i = start;
  let minIndent = Infinity;
  // First pass: find the indent of the first non-parent line.
  while (i < tokens.length) {
    if (tokens[i].indent <= parentIndent) break;
    if (tokens[i].indent < minIndent) minIndent = tokens[i].indent;
    i++;
  }
  const end = i;
  if (minIndent === Infinity) return { items: [], end };
  // Second pass: each item starts at minIndent (a "- " line or a mapping key).
  for (let k = start; k < end; k++) {
    if (tokens[k].indent === minIndent) items.push(k);
  }
  return { items, end };
}

/**
 * Parse one rule mapping starting at `tokens[startIdx]` (a "- " line at the
 * rule indent). Returns the rule plus the token index just after this rule.
 */
function parseRuleMapping(tokens: Token[], startIdx: number): { value: Rule | null; next: number } {
  const rule: Rule = { name: '', enabled: true, conditions: [], action: 'alert' };
  const ruleIndent = tokens[startIdx].indent;
  // The "- " line may carry inline key: value pairs (e.g. "- name: x").
  if (tokens[startIdx].key !== '' && tokens[startIdx].value !== undefined) {
    assignScalar(rule, tokens[startIdx].key, tokens[startIdx].value);
  }
  let i = startIdx + 1;
  while (i < tokens.length) {
    const tok = tokens[i];
    // Stop at anything at or shallower than the rule indent — that includes
    // the next "- name:" rule line at the same indent.
    if (tok.indent <= ruleIndent) break;

    // Mapping keys at one level deeper (ruleIndent + 2 typically).
    if (tok.isItem) {
      // Shouldn't appear at the mapping-key level; skip defensively.
      i++;
      continue;
    }
    if (tok.key === 'conditions' && tok.isBlockList) {
      const { items: condItems, end } = collectBlock(tokens, i + 1, tok.indent);
      for (const ci of condItems) {
        const cond = parseConditionMapping(tokens, ci);
        if (cond) rule.conditions.push(cond);
      }
      i = end;
      continue;
    }
    if (tok.key !== '') {
      assignScalar(rule, tok.key, tok.value);
    }
    i++;
  }
  return { value: rule, next: i };
}

/** Parse one condition mapping starting at a "- " line inside `conditions:`. */
function parseConditionMapping(tokens: Token[], startIdx: number): any | null {
  const condition: any = { field: '', operator: '=' };
  const condIndent = tokens[startIdx].indent;
  if (tokens[startIdx].key !== '' && tokens[startIdx].value !== undefined) {
    assignScalar(condition, tokens[startIdx].key, tokens[startIdx].value);
  }
  let i = startIdx + 1;
  while (i < tokens.length) {
    const tok = tokens[i];
    if (tok.indent <= condIndent) break;
    // Only map keys at the next indent level belong to this condition.
    if (tok.key !== '') assignScalar(condition, tok.key, tok.value);
    i++;
  }
  // Final scalar coercion: turn "100000" into a number when the type allows it.
  if (typeof condition.value === 'string') {
    const v = condition.value;
    if ((condition.type === 'number' || condition.type === undefined) && /^-?\d+(\.\d+)?$/.test(v)) {
      condition.value = Number(v);
    } else if (v === 'true' && condition.type !== 'string') {
      condition.value = true;
    } else if (v === 'false' && condition.type !== 'string') {
      condition.value = false;
    } else if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      condition.value = stripQuotes(v);
    }
  } else if (Array.isArray(condition.value)) {
    // inline list already parsed — keep as-is.
  } else if (typeof condition.value === 'string' && (condition.value.startsWith('[')) ) {
    condition.value = parseInlineList(condition.value);
  }
  return condition;
}

/** Assign a YAML scalar value to the correct field of a rule or condition. */
function assignScalar(target: any, key: string, rawValue: string | undefined): void {
  if (rawValue === undefined || rawValue === null || rawValue === '') {
    // Block marker (e.g. "conditions:") with no inline value — leave as-is.
    return;
  }
  let value: unknown = rawValue;
  // Decode inline YAML scalars.
  if ((rawValue.startsWith('"') && rawValue.endsWith('"')) || (rawValue.startsWith("'") && rawValue.endsWith("'"))) {
    value = stripQuotes(rawValue);
  } else if (rawValue.startsWith('[') && rawValue.endsWith(']')) {
    value = parseInlineList(rawValue);
  } else if (rawValue === 'true') {
    value = true;
  } else if (rawValue === 'false') {
    value = false;
  } else if (rawValue === 'null' || rawValue === '~') {
    value = null;
  } else if (/^-?\d+(\.\d+)?$/.test(rawValue)) {
    // Keep as a number unless the target field is explicitly string-typed.
    if (key !== 'value' || target.type !== 'string') value = Number(rawValue);
  }
  (target as any)[key] = value;
}

// ---------------------------------------------------------------------------
// Scalar helpers (used by the YAML tokeniser above)
// ---------------------------------------------------------------------------

function stripQuotes(v: string): string {
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    return v.slice(1, -1);
  }
  return v;
}

function parseInlineList(raw: string): unknown[] {
  let v = raw.trim();
  if (v.startsWith('[') && v.endsWith(']')) v = v.slice(1, -1);
  if (v.trim() === '') return [];
  return v.split(',').map((x) => {
    const item = stripQuotes(x.trim());
    if (/^-?\d+(\.\d+)?$/.test(item)) return Number(item);
    return item;
  }).filter((x) => x !== '');
}

// ---------------------------------------------------------------------------
// File-based loader
// ---------------------------------------------------------------------------

/** Load a Ruleset from a JSON or YAML file path.
 * Throws on read errors; leaves schema validation to the caller. */
export function loadRulesFromFile(filePath: string): Ruleset {
  const absolute = path.resolve(filePath);
  const content = fs.readFileSync(absolute, 'utf-8');
  const ext = path.extname(absolute).toLowerCase();
  if (ext === '.yaml' || ext === '.yml') {
    return parseRulesYaml(content);
  }
  return JSON.parse(content) as Ruleset;
}

/** Load and validate a ruleset in one step.
 * Returns { ruleset, errors }. errors is empty on success. */
export function loadRulesetSafe(filePath: string): { ruleset: Ruleset; errors: Array<{ index: number; rule: Rule; error: string }> } {
  const ruleset = loadRulesFromFile(filePath);
  const errors = validateRuleset(ruleset);
  return { ruleset, errors };
}

/** Serialise a ruleset into a pretty JSON string (for export / UI download). */
export function rulesetToJson(ruleset: Ruleset): string {
  return JSON.stringify(ruleset, null, 2);
}

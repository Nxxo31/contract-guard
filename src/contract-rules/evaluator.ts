/**
 * Contract Rules — Evaluator
 *
 * Pure functions that evaluate Rules against a ContractData object.
 * No I/O, no storage — fully deterministic and side-effect-free so it
 * is trivial to test and to reuse from both the CLI and the React UI.
 */

import {
  Condition,
  ConditionResult,
  ContractData,
  EvaluationResult,
  Operator,
  Rule,
  RuleResult,
  Ruleset,
  ValueType,
} from './types';

// ---------------------------------------------------------------------------
// Path resolution
// ---------------------------------------------------------------------------

/** Resolve a dotted path ("partyA.name") into the nested value of `data`.
 * Returns `undefined` for any missing segment. Arrays accept numeric indices
 * ("parties.0.name") and also expose `.length` as a synthetic property so
 * rules can write `parties.length > 2`. */
export function resolveField(data: ContractData, field: string): unknown {
  if (field.length === 0) return data;
  const parts = field.split('.');
  let current: unknown = data;
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    if (Array.isArray(current)) {
      // synthetic `.length`
      if (part === 'length') return current.length;
      const idx = Number(part);
      if (Number.isInteger(idx) && idx >= 0 && idx < current.length) {
        current = current[idx];
        continue;
      }
      return undefined;
    }
    if (typeof current === 'object') {
      current = (current as Record<string, unknown>)[part];
      continue;
    }
    return undefined;
  }
  return current;
}

// ---------------------------------------------------------------------------
// Type coercion
// ---------------------------------------------------------------------------

/** Coerce a runtime value to the target ValueType for comparison.
 * Throws if coercion is impossible — callers should catch and turn this
 * into a non-matching condition rather than crashing evaluation. */
function coerce(value: unknown, type: ValueType): unknown {
  if (value === undefined || value === null) return value;
  switch (type) {
    case 'number': {
      if (typeof value === 'number') return value;
      const n = Number(value);
      return Number.isNaN(n) ? value : n;
    }
    case 'boolean': {
      if (typeof value === 'boolean') return value;
      if (typeof value === 'string') {
        if (value === 'true' || value === '1') return true;
        if (value === 'false' || value === '0') return false;
      }
      if (typeof value === 'number') return value !== 0;
      return value;
    }
    case 'date': {
      if (value instanceof Date) return value.getTime();
      const ms = Date.parse(String(value));
      return Number.isNaN(ms) ? value : ms;
    }
    case 'array': {
      if (Array.isArray(value)) return value;
      return value;
    }
    case 'string':
    default:
      return typeof value === 'string' ? value : String(value ?? '');
  }
}

/** Infer a ValueType from the operator + operand when not explicitly declared. */
function inferType(operator: Operator, value: unknown): ValueType {
  if (operator === 'exists' || operator === 'not-exists') return 'string';
  if (operator === 'in' || operator === 'not-in' || operator === 'contains' || operator === 'not-contains') {
    return Array.isArray(value) ? 'array' : 'string';
  }
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'string') {
    if (/^\d{4}-\d{2}-\d{2}/.test(value) && !Number.isNaN(Date.parse(value))) return 'date';
    return 'string';
  }
  return 'string';
}

// ---------------------------------------------------------------------------
// Operators
// ---------------------------------------------------------------------------

function compareNumbers(a: number, b: number, op: Operator): boolean {
  switch (op) {
    case '>': return a > b;
    case '<': return a < b;
    case '>=': return a >= b;
    case '<=': return a <= b;
    case '=': return a === b;
    case '!=': return a !== b;
    default: return false;
  }
}

function compareStrings(a: string, b: string, op: Operator): boolean {
  switch (op) {
    case '=': return a === b;
    case '!=': return a !== b;
    case 'contains': return a.includes(b);
    case 'not-contains': return !a.includes(b);
    case 'startsWith': return a.startsWith(b);
    case 'endsWith': return a.endsWith(b);
    case '>': return a > b;
    case '<': return a < b;
    case '>=': return a >= b;
    case '<=': return a <= b;
    default: return false;
  }
}

/**
 * Evaluate a single condition against `data`.
 * Never throws — malformed conditions return { matched: false } so a
 * single bad rule cannot poison the whole evaluation.
 */
export function evaluateCondition(condition: Condition, data: ContractData): ConditionResult {
  const { field, operator, value } = condition;
  const actual = resolveField(data, field);

  const result: ConditionResult = {
    field,
    operator,
    expected: value,
    actual,
    matched: false,
    description: condition.description,
  };

  try {
    if (operator === 'exists') {
      result.matched = actual !== undefined && actual !== null;
      return result;
    }
    if (operator === 'not-exists') {
      result.matched = actual === undefined || actual === null;
      return result;
    }
    if (operator === 'in') {
      const list = Array.isArray(value) ? value : String(value ?? '').split(',');
      result.matched = list.some((item) => deepEqual(actual, item));
      return result;
    }
    if (operator === 'not-in') {
      const isinMatch = evaluateCondition({ ...condition, operator: 'in' }, data).matched;
      result.matched = !isinMatch;
      return result;
    }
    if (operator === 'contains' || operator === 'not-contains') {
      result.matched = applyContains(actual, value);
      if (operator === 'not-contains') result.matched = !result.matched;
      return result;
    }
    if (operator === 'regex') {
      const re = new RegExp(String(value ?? ''));
      result.matched = re.test(String(actual ?? ''));
      return result;
    }
    if (operator === 'startsWith' || operator === 'endsWith') {
      result.matched = compareStrings(String(actual ?? ''), String(value ?? ''), operator);
      return result;
    }

    // Comparison operators: coerce both sides to the same type.
    const type = condition.type ?? inferType(operator, value);
    const a = coerce(actual, type);
    const b = coerce(value, type);

    if (type === 'number' || type === 'date') {
      if (typeof a !== 'number' || typeof b !== 'number') return result;
      result.matched = compareNumbers(a, b, operator);
      return result;
    }
    if (type === 'boolean') {
      switch (operator) {
        case '=': result.matched = a === b; break;
        case '!=': result.matched = a !== b; break;
        default: result.matched = compareNumbers(Number(a), Number(b), operator); break;
      }
      return result;
    }
    // string / array fallthrough — use string comparison.
    result.matched = compareStrings(String(a ?? ''), String(b ?? ''), operator);
    return result;
  } catch {
    result.matched = false;
    return result;
  }
}

function applyContains(haystack: unknown, needle: unknown): boolean {
  if (haystack === undefined || haystack === null) return false;
  if (Array.isArray(haystack)) {
    return haystack.some((item) => deepEqual(item, needle));
  }
  if (typeof haystack === 'object') {
    return Object.prototype.hasOwnProperty.call(haystack, String(needle ?? ''));
  }
  return String(haystack).includes(String(needle ?? ''));
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a === 'number' && typeof b === 'number') return a === b;
  if (typeof a === 'boolean' && typeof b === 'boolean') return a === b;
  return String(a ?? '') === String(b ?? '');
}

// ---------------------------------------------------------------------------
// Rule evaluation
// ---------------------------------------------------------------------------

/** Evaluate one rule against one contract. */
export function evaluateRule(rule: Rule, data: ContractData): RuleResult {
  const conditionResults = rule.conditions.map((c) => evaluateCondition(c, data));
  const matched = conditionResults.length === 0 || conditionResults.every((c) => c.matched);
  const detail = conditionResults
    .map((c) => `${c.field} ${c.operator} ${formatValue(c.expected)} → ${c.matched}`)
    .join('; ');
  return {
    ruleId: rule.id ?? rule.name,
    ruleName: rule.name,
    action: rule.action,
    severity: rule.severity,
    matched,
    conditionResults,
    message: matched
      ? `Rule "${rule.name}" matched: ${detail}`
      : `Rule "${rule.name}" did not match (${detail})`,
    tags: rule.tags,
  };
}

/** Evaluate an entire ruleset against one contract. */
export function evaluateRuleset(ruleset: Ruleset, data: ContractData): EvaluationResult {
  const enabled = ruleset.rules.filter((r) => r.enabled !== false);
  const results = enabled.map((r) => evaluateRule(r, data));
  const matched = results.filter((r) => r.matched);
  const contractId = typeof data.contractId === 'string' ? data.contractId : undefined;

  const by: Record<string, RuleResult[]> = { alert: [], block: [], flag: [], notify: [] };
  for (const r of matched) {
    (by[r.action] ?? []).push(r);
  }

  return {
    contractId,
    totalRules: enabled.length,
    matchedCount: matched.length,
    results,
    blockers: by.block,
    alerts: by.alert,
    flags: by.flag,
    notifications: by.notify,
  };
}

/** Evaluate an array of rules directly (handy for storage-backed flows). */
export function evaluateRules(rules: Rule[], data: ContractData): EvaluationResult {
  return evaluateRuleset({ version: '1.0', rules }, data);
}

function formatValue(value: unknown): string {
  if (value === undefined) return '(none)';
  if (value === null) return 'null';
  if (Array.isArray(value)) return JSON.stringify(value);
  if (typeof value === 'string') return `"${value}"`;
  return String(value);
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const VALID_OPERATORS: Operator[] = [
  '>', '<', '>=', '<=', '=', '!=',
  'contains', 'not-contains', 'in', 'not-in',
  'exists', 'not-exists', 'startsWith', 'endsWith', 'regex',
];
const VALID_ACTIONS = ['alert', 'block', 'flag', 'notify'] as const;
const VALID_SEVERITIES = ['low', 'medium', 'high', 'critical'] as const;

/** Validate a single rule. Returns null on success, an error string otherwise. */
export function validateRule(rule: Rule): string | null {
  if (!rule || typeof rule !== 'object') return 'rule must be an object';
  if (typeof rule.name !== 'string' || rule.name.trim() === '') return 'rule.name is required';
  if (!Array.isArray(rule.conditions)) return 'rule.conditions must be an array';
  if (!VALID_ACTIONS.includes(rule.action as never)) {
    return `rule.action must be one of: ${VALID_ACTIONS.join(', ')}`;
  }
  if (rule.severity !== undefined && !VALID_SEVERITIES.includes(rule.severity as never)) {
    return `rule.severity must be one of: ${VALID_SEVERITIES.join(', ')}`;
  }
  for (let i = 0; i < rule.conditions.length; i++) {
    const c = rule.conditions[i];
    const prefix = `condition[${i}]`;
    if (!c || typeof c !== 'object') return `${prefix} must be an object`;
    if (typeof c.field !== 'string' || c.field.trim() === '') return `${prefix}.field is required`;
    if (!VALID_OPERATORS.includes(c.operator)) {
      return `${prefix}.operator must be one of: ${VALID_OPERATORS.join(', ')}`;
    }
    if (c.operator !== 'exists' && c.operator !== 'not-exists' && c.value === undefined) {
      return `${prefix}.value is required for operator "${c.operator}"`;
    }
  }
  return null;
}

/** Validate all rules in a ruleset. Returns an array of {rule, error}. */
export function validateRuleset(ruleset: Ruleset): Array<{ index: number; rule: Rule; error: string }> {
  const errors: Array<{ index: number; rule: Rule; error: string }> = [];
  if (!Array.isArray(ruleset.rules)) {
    errors.push({ index: -1, rule: {} as Rule, error: 'rules must be an array' });
    return errors;
  }
  ruleset.rules.forEach((rule, i) => {
    const err = validateRule(rule);
    if (err) errors.push({ index: i, rule, error: err });
  });
  return errors;
}

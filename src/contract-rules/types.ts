/**
 * Contract Rules — Type definitions
 *
 * A "rule" is a named set of conditions that are evaluated against a
 * ContractData object. Each condition compares a field of the contract
 * against an expected value using one of the supported operators.
 * When ALL conditions of a rule are satisfied, the rule's action fires.
 *
 * Rules are serialisable (JSON / YAML) so they can be loaded at runtime
 * without recompiling the application.
 */

/** Logical operators supported between the rule condition type and the
 * runtime value. The evaluator coerces the runtime value to match the
 *  expected type when it can. */
export type Operator =
  | '>'
  | '<'
  | '>='
  | '<='
  | '='
  | '!='
  | 'contains' // substring / array membership / key in object
  | 'not-contains'
  | 'in' // value ∈ list (runtime value is scalar, list operand)
  | 'not-in'
  | 'exists' // field is present (non-undefined, non-null)
  | 'not-exists'
  | 'startsWith'
  | 'endsWith'
  | 'regex';

/** What to do when a rule is satisfied. */
export type Action = 'alert' | 'block' | 'flag' | 'notify';

/** Type hint for the operand. Lets the validator and evaluator coerce
 * values loaded from YAML/JSON (where everything might come in as a
 * string) into the correct domain for comparison. */
export type ValueType = 'string' | 'number' | 'boolean' | 'date' | 'array';

/**
 * A single condition of a rule.
 *
 *  field    — dotted path into the ContractData (e.g. "amount", "partyA.name")
 *  operator — comparison operator
 *  value    — operand (ignored for `exists` / `not-exists`)
 *  type     — optional type hint; defaults inferred from operator/value
 */
export interface Condition {
  field: string;
  operator: Operator;
  value?: unknown;
  type?: ValueType;
  /** Free-form description that flows into RuleResult for actionable output. */
  description?: string;
}

/** A match-all (AND) rule. `id` uniquely identifies it for CRUD operations. */
export interface Rule {
  id?: string | number;
  name: string;
  description?: string;
  enabled: boolean;
  /** Conditions are AND-combined. An empty array means "always match". */
  conditions: Condition[];
  action: Action;
  severity?: 'low' | 'medium' | 'high' | 'critical';
  /** Optional tags for grouping/filtering in the UI. */
  tags?: string[];
  createdAt?: string;
  updatedAt?: string;
}

/**
 * Arbitrary contract data. Fields are accessed by dotted path.
 * Example:
 *   {
 *     contractId: "C-2026-001",
 *     amount: 150000,
 *     currency: "USD",
 *     signDate: "2026-07-31",
 *     counterparty: "ACME Corp",
 *     partyA: { name: "Sebastian", country: "CO" },
 *     parties: ["Acme", "Globex"],
 *   }
 */
export interface ContractData {
  [key: string]: unknown;
}

/** Outcome of evaluating one rule against one contract. */
export interface RuleResult {
  ruleId: string | number;
  ruleName: string;
  action: Action;
  severity?: 'low' | 'medium' | 'high' | 'critical';
  /** True when ALL conditions matched → action should fire. */
  matched: boolean;
  /** Per-condition evaluation detail (useful for the UI / debugging). */
  conditionResults: ConditionResult[];
  message: string;
  /** When matched, the action to surface to the caller. */
  tags?: string[];
}

export interface ConditionResult {
  field: string;
  operator: Operator;
  expected: unknown;
  actual: unknown;
  matched: boolean;
  description?: string;
}

/** Aggregate result of evaluating a ruleset against one contract. */
export interface EvaluationResult {
  contractId?: string;
  totalRules: number;
  matchedCount: number;
  results: RuleResult[];
  /** Highest severity action across matched rules, for quick triage. */
  blockers: RuleResult[];
  alerts: RuleResult[];
  flags: RuleResult[];
  notifications: RuleResult[];
}

/** Container for a set of rules on disk or in storage. */
export interface Ruleset {
  version: string;
  rules: Rule[];
}

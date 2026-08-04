import { Change } from './diff';

export type Severity = 'breaking' | 'warning' | 'safe';

export interface ClassifiedChange extends Change {
  severity: Severity;
  message: string;
}

const BREAKING_KINDS = new Set([
  'endpoint-removed',
  'method-removed',
  'parameter-removed',
  'parameter-required-added',
  'parameter-type-changed',
  'response-removed',
  'response-type-changed',
  'request-body-required-added',
  'request-body-shape-changed'
]);

const WARNING_KINDS = new Set([
  'parameter-optional-added',
  'description-changed',
  'response-added',
  'parameter-changed'
]);

const SAFE_KINDS = new Set([
  'endpoint-added',
  'method-added',
  'noop'
]);

export function classifyChanges(changes: Change[], rulesOverride?: Map<string, Severity>): ClassifiedChange[] {
  return changes.map(change => {
    let severity: Severity;
    if (rulesOverride && rulesOverride.has(change.kind)) {
      severity = rulesOverride.get(change.kind)!;
    } else {
      if (BREAKING_KINDS.has(change.kind)) severity = 'breaking';
      else if (WARNING_KINDS.has(change.kind)) severity = 'warning';
      else if (SAFE_KINDS.has(change.kind)) severity = 'safe';
      else severity = 'warning';
    }

    return {
      ...change,
      severity,
      message: change.detail
    };
  });
}

export interface RuleOptions {
  /** Treat adding an optional parameter as safe instead of warning */
  optionalParametersAreSafe?: boolean;
}

export function applyRules(
  changes: ClassifiedChange[],
  _options: RuleOptions = {}
): ClassifiedChange[] {
  return changes;
}

export function countBySeverity(changes: ClassifiedChange[]): Record<Severity, number> {
  const counts: Record<Severity, number> = {
    breaking: 0,
    warning: 0,
    safe: 0
  };
  for (const c of changes) {
    counts[c.severity] += 1;
  }
  return counts;
}

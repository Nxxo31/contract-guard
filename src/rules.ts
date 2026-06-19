import { Change } from './diff';

export enum Severity {
  BREAKING = 'breaking',
  WARNING = 'warning',
  SAFE = 'safe'
}

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

export function classifyChanges(changes: Change[]): ClassifiedChange[] {
  return changes.map(change => {
    let severity: Severity;
    if (BREAKING_KINDS.has(change.kind)) severity = Severity.BREAKING;
    else if (WARNING_KINDS.has(change.kind)) severity = Severity.WARNING;
    else if (SAFE_KINDS.has(change.kind)) severity = Severity.SAFE;
    else severity = Severity.WARNING;

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
    [Severity.BREAKING]: 0,
    [Severity.WARNING]: 0,
    [Severity.SAFE]: 0
  };
  for (const c of changes) {
    counts[c.severity] += 1;
  }
  return counts;
}

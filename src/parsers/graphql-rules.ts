/**
 * GraphQL severity classification rules.
 * Breaking changes: changes that break existing clients.
 * Warning changes: potentially risky, needs review.
 * Safe changes: additions that don't break existing clients.
 */

import { GraphQLChange, GraphQLChangeKind } from './graphql-diff';

export enum Severity {
  BREAKING = 'breaking',
  WARNING = 'warning',
  SAFE = 'safe'
}

export interface ClassifiedGraphQLChange extends GraphQLChange {
  severity: Severity;
}

// Breaking changes in GraphQL
const BREAKING_KINDS: Set<GraphQLChangeKind> = new Set([
  'gql-type-removed',
  'gql-field-removed',
  'gql-field-type-changed',          // changing a field's type can break clients
  'gql-field-argument-removed',      // removing an argument breaks callers
  'gql-field-argument-type-changed',  // changing arg type breaks callers
  'gql-field-argument-required-added',// adding required arg breaks callers
  'gql-enum-value-removed',          // removing enum value breaks clients
  'gql-union-member-removed',        // removing union member breaks queries
  'gql-interface-implemented-removed',// removing interface impl breaks type checks
  'gql-root-operation-type-changed', // changing root types is breaking
  'gql-type-kind-changed',           // e.g. object -> interface is breaking
  'gql-field-added',                 // non-null field added = breaking (query must handle)
]);

// Warning changes — may need review
const WARNING_KINDS: Set<GraphQLChangeKind> = new Set([
  'gql-type-added',
  'gql-field-added-optional',        // nullable field added — usually safe but may be unexpected
  'gql-field-argument-added',        // optional arg added — usually safe
  'gql-enum-value-added',            // adding enum value is usually safe
  'gql-union-member-added',          // adding union member is usually safe
  'gql-interface-implemented-added', // adding interface impl is safe
  'gql-field-deprecated',            // deprecation is a warning
  'gql-enum-value-deprecated',
  'gql-scalar-type-changed',         // custom scalar changes need review
]);

// Safe changes
const SAFE_KINDS: Set<GraphQLChangeKind> = new Set([
  'noop',
  'gql-type-description-changed',    // doc changes are safe
]);

export function classifyGraphQLChanges(changes: GraphQLChange[]): ClassifiedGraphQLChange[] {
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
    } as ClassifiedGraphQLChange;
  });
}

export function countBySeverityGraphQL(changes: ClassifiedGraphQLChange[]): Record<Severity, number> {
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
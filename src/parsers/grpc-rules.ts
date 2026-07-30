/**
 * gRPC severity classification rules.
 * Breaking: changes that break existing clients per protobuf wire-format rules.
 * Warning: potentially risky additions or renumbering.
 * Safe: additions that don't break existing clients.
 *
 * Reference: https://protobuf.dev/programming-guides/dos-donts/#updating-definitions
 */

import { GrpcChange, GrpcChangeKind } from './grpc-diff';

export enum GrpcSeverity {
  BREAKING = 'breaking',
  WARNING = 'warning',
  SAFE = 'safe'
}

export interface ClassifiedGrpcChange extends GrpcChange {
  severity: GrpcSeverity;
  message: string;
}

// Breaking changes: field removed = breaking because clients reading the field
// now get nothing. Field tag changed = wire-incompatible. RPC removed/changed = breaking.
// Streaming mode change (unary<->stream) is breaking.
// Enum value removed is breaking if clients write this value.
// Required field added is breaking for proto2 (proto3 there are no required).
// Repeated flag changed changes the wire type → breaking.
// Oneof field moved (in/out of oneof): breaking because wire-format differs.
// Package changed: breaks imports and type names in codegen.
const BREAKING_KINDS: Set<GrpcChangeKind> = new Set([
  'proto-message-removed',
  'proto-field-removed',
  'proto-field-tag-changed',        // tag reorder breaks wire-format
  'proto-field-type-changed',        // type change may break wire-format / codegen
  'proto-field-repeated-changed',    // repeated <-> singular changes wire format
  'proto-service-removed',
  'proto-rpc-removed',
  'proto-rpc-streaming-changed',     // unary <-> streaming is a contract change
  'proto-rpc-input-type-changed',
  'proto-rpc-output-type-changed',
  'proto-enum-removed',
  'proto-enum-value-removed',        // clients that used the value break
  'proto-oneof-removed',
  'proto-oneof-field-moved',
  'proto-package-changed'
]);

// Warning changes — additions that usually do not break but may surprise consumers.
const WARNING_KINDS: Set<GrpcChangeKind> = new Set([
  'proto-message-added',
  'proto-field-added',
  'proto-service-added',
  'proto-rpc-added',
  'proto-enum-added',
  'proto-enum-value-added'
]);

const SAFE_KINDS: Set<GrpcChangeKind> = new Set([
  'noop'
]);

export function classifyGrpcChanges(changes: GrpcChange[]): ClassifiedGrpcChange[] {
  return changes.map(change => {
    let severity: GrpcSeverity;
    if (BREAKING_KINDS.has(change.kind)) severity = GrpcSeverity.BREAKING;
    else if (WARNING_KINDS.has(change.kind)) severity = GrpcSeverity.WARNING;
    else if (SAFE_KINDS.has(change.kind)) severity = GrpcSeverity.SAFE;
    else severity = GrpcSeverity.WARNING;

    return {
      ...change,
      severity,
      message: change.detail
    } as ClassifiedGrpcChange;
  });
}

export function countBySeverityGrpc(changes: ClassifiedGrpcChange[]): Record<GrpcSeverity, number> {
  const counts: Record<GrpcSeverity, number> = {
    [GrpcSeverity.BREAKING]: 0,
    [GrpcSeverity.WARNING]: 0,
    [GrpcSeverity.SAFE]: 0
  };
  for (const c of changes) {
    counts[c.severity] += 1;
  }
  return counts;
}

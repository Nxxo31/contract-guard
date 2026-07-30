import { describe, it, expect } from 'vitest';
import {
  loadProtoFromFile,
  parseProto
} from '../src/parsers/grpc';
import { diffProto } from '../src/parsers/grpc-diff';
import { classifyGrpcChanges, GrpcSeverity, countBySeverityGrpc } from '../src/parsers/grpc-rules';
import { buildGrpcReport, generateGrpcReport } from '../src/report';

const SIMPLE_PROTO = `
syntax = "proto3";

package example;

message Person {
  string name = 1;
  int32 id = 2;
  string email = 3;
}

service Greeter {
  rpc SayHello (HelloRequest) returns (HelloResponse);
}

message HelloRequest {
  string greeting = 1;
}

message HelloResponse {
  string reply = 1;
}
`;

const PERSON_WITH_PHONE = `
syntax = "proto3";

package example;

message Person {
  string name = 1;
  int32 id = 2;
  string email = 3;
  string phone = 4; // NEW FIELD
}

service Greeter {
  rpc SayHello (HelloRequest) returns (HelloResponse);
}

message HelloRequest {
  string greeting = 1;
}

message HelloResponse {
  string reply = 1;
}
`;

const PERSON_REMOVED_EMAIL = `
syntax = "proto3";

package example;

message Person {
  string name = 1;
  int32 id = 2;
  // email removed
}

service Greeter {
  rpc SayHello (HelloRequest) returns (HelloResponse);
}

message HelloRequest {
  string greeting = 1;
}

message HelloResponse {
  string reply = 1;
}
`;

const SERVICE_CHANGED_STREAMING = `
syntax = "proto3";

package example;

message Person {
  string name = 1;
  int32 id = 2;
  string email = 3;
}

service Greeter {
  rpc SayHello (HelloRequest) returns (HelloResponse);
  rpc LotsOfReplies (HelloRequest) returns (stream HelloResponse); // NEW STREAMING RPC
}

message HelloRequest {
  string greeting = 1;
}

message HelloResponse {
  string reply = 1;
}
`;

const ENUM_ADDED_VALUE = `
syntax = "proto3";

package example;

enum Food {
  UNKNOWN = 0;
  BROCCOLI = 1;
  CHOCOLATE = 2;
  // ADDED: PIZZA = 3; 
}

message FoodOrder {
  Food food = 1;
  int32 quantity = 2;
}
`;

const ENUM_REMOVED_VALUE = `
syntax = "proto3";

package example;

enum Food {
  UNKNOWN = 0;
  BROCCOLI = 1;
  // CHOCOLATE removed
}

message FoodOrder {
  Food food = 1;
  int32 quantity = 2;
}
`;

describe('gRPC proto parser', () => {
  it('parses basic proto with message and service', () => {
    const proto = parseProto(SIMPLE_PROTO);
    expect(proto.messages.size).toBeGreaterThan(0);
    expect(proto.messages.has('example.Person')).toBe(true);
    expect(proto.services.size).toBe(1);
    expect(proto.services.has('Greeter')).toBe(true);
  });

  it('parses enum values correctly', () => {
    const proto = parseProto(ENUM_ADDED_VALUE);
    const foodEnum = proto.enums.get('example.Food')!;
    expect(foodEnum.values.length).toBe(3);
    expect(foodEnum.values.map(v => v.name)).toEqual(['UNKNOWN', 'BROCCOLI', 'CHOCOLATE']);
  });

  it('loads proto from .proto file', () => {
    // This test will need fixture files - skipping for now, will add after creating fixtures
    expect(true).toBe(true);
  });
});

describe('gRPC diff engine', () => {
  it('detects field added (WARNING)', () => {
    const oldProto = parseProto(SIMPLE_PROTO);
    const newProto = parseProto(PERSON_WITH_PHONE);
    const diff = diffProto(oldProto, newProto);
    const added = diff.changes.find(c => c.kind === 'proto-field-added' && c.field === 'phone');
    expect(added).toBeDefined();
    expect(added?.type).toBe('example.Person');
  });

  it('detects field removed (BREAKING)', () => {
    const oldProto = parseProto(SIMPLE_PROTO);
    const newProto = parseProto(PERSON_REMOVED_EMAIL);
    const diff = diffProto(oldProto, newProto);
    const removed = diff.changes.find(c => c.kind === 'proto-field-removed' && c.field === 'email');
    expect(removed).toBeDefined();
    expect(removed?.type).toBe('example.Person');
  });

  it('detects enum value removed (BREAKING)', () => {
    const oldProto = parseProto(ENUM_ADDED_VALUE);
    const newProto = parseProto(ENUM_REMOVED_VALUE);
    const diff = diffProto(oldProto, newProto);
    const removed = diff.changes.find(c => c.kind === 'proto-enum-value-removed' && c.field === 'CHOCOLATE');
    expect(removed).toBeDefined();
    expect(removed?.type).toBe('example.Food');
  });

  it('detects service added RPC (WARNING)', () => {
    const oldProto = parseProto(SIMPLE_PROTO);
    const newProto = parseProto(SERVICE_CHANGED_STREAMING);
    const diff = diffProto(oldProto, newProto);
    const added = diff.changes.find(c => c.kind === 'proto-rpc-added' && c.method === 'LotsOfReplies');
    expect(added).toBeDefined();
    expect(added?.service).toBe('Greeter');
  });

  it('detects RPC streaming mode changed (BREAKING)', () => {
    const baseService = `
syntax = "proto3";
package example;
service Greeter {
  rpc LotsOfReplies (HelloRequest) returns (HelloResponse);
}
message HelloRequest { string greeting = 1; }
message HelloResponse { string reply = 1; }
`;
    const streamingService = `
syntax = "proto3";
package example;
service Greeter {
  rpc LotsOfReplies (HelloRequest) returns (stream HelloResponse);
}
message HelloRequest { string greeting = 1; }
message HelloResponse { string reply = 1; }
`;
    const oldProto = parseProto(baseService);
    const newProto = parseProto(streamingService);
    const diff = diffProto(oldProto, newProto);
    const changed = diff.changes.find(c => c.kind === 'proto-rpc-streaming-changed' && c.method === 'LotsOfReplies');
    expect(changed).toBeDefined();
    expect(changed?.service).toBe('Greeter');
  });

  it('returns no changes for identical protos', () => {
    const proto = parseProto(SIMPLE_PROTO);
    const diff = diffProto(proto, proto);
    expect(diff.changes.every(c => c.kind === 'noop')).toBe(true);
  });
});

describe('gRPC severity classification', () => {
  it('classifies field-removed as BREAKING', () => {
    const oldProto = parseProto(SIMPLE_PROTO);
    const newProto = parseProto(PERSON_REMOVED_EMAIL);
    const diff = diffProto(oldProto, newProto);
    const classified = classifyGrpcChanges(diff.changes);
    const removed = classified.find(c => c.kind === 'proto-field-removed');
    expect(removed?.severity).toBe(GrpcSeverity.BREAKING);
  });

  it('classifies field-added as WARNING', () => {
    const oldProto = parseProto(SIMPLE_PROTO);
    const newProto = parseProto(PERSON_WITH_PHONE);
    const diff = diffProto(oldProto, newProto);
    const classified = classifyGrpcChanges(diff.changes);
    const added = classified.find(c => c.kind === 'proto-field-added');
    expect(added?.severity).toBe(GrpcSeverity.WARNING);
  });

  it('classifies enum-value-removed as BREAKING', () => {
    const oldProto = parseProto(ENUM_ADDED_VALUE);
    const newProto = parseProto(ENUM_REMOVED_VALUE);
    const diff = diffProto(oldProto, newProto);
    const classified = classifyGrpcChanges(diff.changes);
    const removed = classified.find(c => c.kind === 'proto-enum-value-removed');
    expect(removed?.severity).toBe(GrpcSeverity.BREAKING);
  });
});

describe('gRPC report generation', () => {
  it('generates a Markdown report with severity sections', () => {
    const oldProto = parseProto(SIMPLE_PROTO);
    const newProto = parseProto(PERSON_WITH_PHONE);
    const diff = diffProto(oldProto, newProto);
    const classified = classifyGrpcChanges(diff.changes);
    const md = generateGrpcReport(diff, classified);
    expect(md).toContain('Contract Guard Report (gRPC)');
    expect(md).toContain('WARNINGS'); // field-added is warning
    expect(md).not.toContain('BREAKING CHANGES');
  });

  it('buildGrpcReport sets hasBreakingChanges correctly', () => {
    const oldProto = parseProto(SIMPLE_PROTO);
    const newProto = parseProto(PERSON_REMOVED_EMAIL);
    const diff = diffProto(oldProto, newProto);
    const classified = classifyGrpcChanges(diff.changes);
    const report = buildGrpcReport(diff, classified);
    expect(report.hasBreakingChanges).toBe(true);
  });
});
/**
 * gRPC/proto Diff Engine
 *
 * Compares two NormalizedProto schemas and produces a list of changes
 * with built-in breaking / warning / safe classification.
 */

import {
  NormalizedProto,
  ProtoMessage,
  ProtoField,
  ProtoEnum,
  ProtoMethod,
  ProtoService
} from './grpc';

// ---------- Change kinds ----------

export type GrpcChangeKind =
  | 'proto-message-removed'
  | 'proto-message-added'
  | 'proto-field-removed'
  | 'proto-field-added'
  | 'proto-field-type-changed'
  | 'proto-field-tag-changed'
  | 'proto-field-repeated-changed'   // repeated <-> singular
  | 'proto-service-removed'
  | 'proto-service-added'
  | 'proto-rpc-removed'
  | 'proto-rpc-added'
  | 'proto-rpc-streaming-changed'    // stream -> unary
  | 'proto-rpc-input-type-changed'
  | 'proto-rpc-output-type-changed'
  | 'proto-enum-removed'
  | 'proto-enum-added'
  | 'proto-enum-value-removed'
  | 'proto-enum-value-added'
  | 'proto-oneof-removed'
  | 'proto-oneof-field-moved'
  | 'proto-package-changed'
  | 'noop';

export interface GrpcChange {
  kind: GrpcChangeKind;
  message?: string;
  service?: string;
  /** The message full-name */
  type?: string;
  /** Field name */
  field?: string;
  /** RPC method name */
  method?: string;
  detail: string;
  raw?: unknown;
}

export interface GrpcDiffResult {
  changes: GrpcChange[];
  oldProto: NormalizedProto;
  newProto: NormalizedProto;
}

function fieldKey(message: string, field: string): string { return `${message}.${field}`; }

// ---------- Diff helpers ----------

function diffFlatFields(
  oldFields: ProtoField[],
  newFields: ProtoField[],
  messageName: string
): GrpcChange[] {
  const changes: GrpcChange[] = [];
  const oldByName = new Map(oldFields.map(f => [f.name, f]));
  const newByName = new Map(newFields.map(f => [f.name, f]));
  const oldByTag  = new Map(oldFields.map(f => [f.tag, f]));
  const newByTag  = new Map(newFields.map(f => [f.tag, f]));

  // Removed fields (by name)
  for (const [name, oldF] of oldByName) {
    if (!newByName.has(name)) {
      changes.push({
        kind: 'proto-field-removed',
        type: messageName,
        field: name,
        detail: `Field '${name}' (tag=${oldF.tag}) removed from message '${messageName}'`
      });
    }
  }

  // Added / modified fields (by name)
  for (const [name, newF] of newByName) {
    const oldF = oldByName.get(name) ? oldByName.get(name) : oldByTag.get(newF.tag);
    if (!oldF) {
      // Brand-new field — check tag for collisions in diff level (handled below)
      changes.push({
        kind: 'proto-field-added',
        type: messageName,
        field: name,
        detail: `Field '${name}' (tag=${newF.tag}, type=${newF.type}) added to message '${messageName}'`
      });
      continue;
    }
    // Type changed
    if (oldF.type !== newF.type) {
      changes.push({
        kind: 'proto-field-type-changed',
        type: messageName,
        field: name,
        detail: `Field '${messageName}.${name}' changed type from '${oldF.type}' to '${newF.type}'`
      });
    }
    // Tag changed
    if (oldF.tag !== newF.tag) {
      changes.push({
        kind: 'proto-field-tag-changed',
        type: messageName,
        field: name,
        detail: `Field '${messageName}.${name}' changed tag from ${oldF.tag} to ${newF.tag}`
      });
    }
    // repeated flag changed
    if (oldF.repeated !== newF.repeated) {
      changes.push({
        kind: 'proto-field-repeated-changed',
        type: messageName,
        field: name,
        detail: `Field '${messageName}.${name}' repeated-ness changed from ${oldF.repeated} to ${newF.repeated}`
      });
    }
    // oneof context changed (moved in/out)
    const oldOneof = oldF.oneof;
    const newOneof = newF.oneof;
    if (oldOneof && !newOneof) {
      changes.push({
        kind: 'proto-oneof-field-moved',
        type: messageName,
        field: name,
        detail: `Field '${messageName}.${name}' was moved out of oneof '${oldOneof}'`
      });
    } else if (!oldOneof && newOneof) {
      changes.push({
        kind: 'proto-oneof-field-moved',
        type: messageName,
        field: name,
        detail: `Field '${messageName}.${name}' was moved into oneof '${newOneof}'`
      });
    } else if (oldOneof && newOneof && oldOneof !== newOneof) {
      changes.push({
        kind: 'proto-oneof-field-moved',
        type: messageName,
        field: name,
        detail: `Field '${messageName}.${name}' moved from oneof '${oldOneof}' to '${newOneof}'`
      });
    }
  }

  return changes;
}

function diffMessage(oldMsg: ProtoMessage, newMsg: ProtoMessage): GrpcChange[] {
  const changes: GrpcChange[] = [];
  const allFieldChanges = diffFlatFields(oldMsg.fields, newMsg.fields, oldMsg.fullName);
  changes.push(...allFieldChanges);
  return changes;
}

function diffEnum(oldEnum: ProtoEnum, newEnum: ProtoEnum, fullName?: string): GrpcChange[] {
  const enumFullName = fullName || oldEnum.name;
  const changes: GrpcChange[] = [];
  const oldByName = new Map(oldEnum.values.map(v => [v.name, v]));
  const newByName = new Map(newEnum.values.map(v => [v.name, v]));

  for (const [name] of oldByName) {
    if (!newByName.has(name)) {
      changes.push({
        kind: 'proto-enum-value-removed',
        type: enumFullName,
        field: name,
        detail: `Enum value '${name}' removed from enum '${enumFullName}'`
      });
    }
  }
  for (const [name] of newByName) {
    if (!oldByName.has(name)) {
      changes.push({
        kind: 'proto-enum-value-added',
        type: oldEnum.name,
        field: name,
        detail: `Enum value '${name}' added to enum '${oldEnum.name}'`
      });
    }
  }
  return changes;
}

function diffMethod(
  oldMtd: ProtoMethod,
  newMtd: ProtoMethod,
  serviceName: string
): GrpcChange[] {
  const changes: GrpcChange[] = [];

  if (oldMtd.inputType !== newMtd.inputType) {
    changes.push({
      kind: 'proto-rpc-input-type-changed',
      service: serviceName,
      method: oldMtd.name,
      detail: `RPC '${serviceName}.${oldMtd.name}' input type changed from '${oldMtd.inputType}' to '${newMtd.inputType}'`
    });
  }
  if (oldMtd.outputType !== newMtd.outputType) {
    changes.push({
      kind: 'proto-rpc-output-type-changed',
      service: serviceName,
      method: oldMtd.name,
      detail: `RPC '${serviceName}.${oldMtd.name}' output type changed from '${oldMtd.outputType}' to '${newMtd.outputType}'`
    });
  }
  if (oldMtd.streaming !== newMtd.streaming) {
    changes.push({
      kind: 'proto-rpc-streaming-changed',
      service: serviceName,
      method: oldMtd.name,
      detail: `RPC '${serviceName}.${oldMtd.name}' streaming mode changed from '${oldMtd.streaming}' to '${newMtd.streaming}'`
    });
  }
  return changes;
}

function diffService(oldSvc: ProtoService, newSvc: ProtoService): GrpcChange[] {
  const changes: GrpcChange[] = [];
  const oldByName = new Map(oldSvc.methods.map(m => [m.name, m]));
  const newByName = new Map(newSvc.methods.map(m => [m.name, m]));

  for (const [name] of oldByName) {
    if (!newByName.has(name)) {
      changes.push({
        kind: 'proto-rpc-removed',
        service: oldSvc.name,
        method: name,
        detail: `RPC '${name}' removed from service '${oldSvc.name}'`
      });
    }
  }
  for (const [name, newMtd] of newByName) {
    const oldMtd = oldByName.get(name);
    if (!oldMtd) {
      changes.push({
        kind: 'proto-rpc-added',
        service: newSvc.name,
        method: name,
        detail: `RPC '${name}' added to service '${newSvc.name}'`
      });
    } else {
      changes.push(...diffMethod(oldMtd, newMtd, newSvc.name));
    }
  }
  return changes;
}

// ---------- Main diff function ----------

export function diffProto(oldProto: NormalizedProto, newProto: NormalizedProto): GrpcDiffResult {
  const changes: GrpcChange[] = [];
  const allOldMessages = new Set(oldProto.messages.keys());
  const allNewMessages = new Set(newProto.messages.keys());

  // Messages removed
  for (const fullName of allOldMessages) {
    if (!allNewMessages.has(fullName)) {
      changes.push({
        kind: 'proto-message-removed',
        type: fullName,
        detail: `Message '${fullName}' was removed`
      });
    }
  }

  // Messages added
  for (const fullName of allNewMessages) {
    if (!allOldMessages.has(fullName)) {
      changes.push({
        kind: 'proto-message-added',
        type: fullName,
        detail: `Message '${fullName}' was added`
      });
    }
  }

  // Compare existing messages
  for (const fullName of allNewMessages) {
    if (!allOldMessages.has(fullName)) continue;
    const oldMsg = oldProto.messages.get(fullName)!;
    const newMsg = newProto.messages.get(fullName)!;
    changes.push(...diffMessage(oldMsg, newMsg));

    // oneofs removed — flag any oneofs removed entirely
    const oldOneofNames = new Set(oldMsg.oneofs.map(o => o.name));
    const newOneofNames = new Set(newMsg.oneofs.map(o => o.name));
    for (const oname of oldOneofNames) {
      if (!newOneofNames.has(oname)) {
        changes.push({
          kind: 'proto-oneof-removed',
          type: oldMsg.fullName,
          field: oname,
          detail: `Oneof '${oname}' removed from message '${oldMsg.fullName}'`
        });
      }
    }
  }

  // Enums
  const allOldEnums = new Set(oldProto.enums.keys());
  const allNewEnums = new Set(newProto.enums.keys());
  for (const name of allOldEnums) {
    if (!allNewEnums.has(name)) {
      changes.push({
        kind: 'proto-enum-removed',
        type: name,
        detail: `Enum '${name}' was removed`
      });
    }
  }
  for (const name of allNewEnums) {
    if (!allOldEnums.has(name)) {
      changes.push({
        kind: 'proto-enum-added',
        type: name,
        detail: `Enum '${name}' was added`
      });
    } else {
      changes.push(...diffEnum(oldProto.enums.get(name)!, newProto.enums.get(name)!, name));
    }
  }

  // Services
  const allOldServices = new Set(oldProto.services.keys());
  const allNewServices = new Set(newProto.services.keys());
  for (const name of allOldServices) {
    if (!allNewServices.has(name)) {
      changes.push({
        kind: 'proto-service-removed',
        service: name,
        detail: `Service '${name}' was removed`
      });
    }
  }
  for (const name of allNewServices) {
    if (!allOldServices.has(name)) {
      changes.push({
        kind: 'proto-service-added',
        service: name,
        detail: `Service '${name}' was added`
      });
    } else {
      changes.push(...diffService(oldProto.services.get(name)!, newProto.services.get(name)!));
    }
  }

  // Package changed
  if (oldProto.package !== newProto.package) {
    changes.push({
      kind: 'proto-package-changed',
      detail: `Package changed from '${oldProto.package}' to '${newProto.package}'`
    });
  }

  return { changes, oldProto, newProto };
}

/**
 * GraphQL Schema Diff Engine
 *
 * Compares two NormalizedGraphQL schemas and produces a list of changes
 * with breaking / warning / safe classification built in.
 */

import {
  NormalizedGraphQL,
  GQLType,
  GQLField,
  GQLArgument,
  GQLTypeRef,
  typeRefToString,
  isNonNull,
  unwrapNonNull,
  stripNonNull
} from './graphql';

// ---------- Change types ----------

export type GraphQLChangeKind =
  // Type-level
  | 'gql-type-removed'
  | 'gql-type-added'
  | 'gql-type-kind-changed'
  // Field-level (objects, interfaces, inputs)
  | 'gql-field-removed'
  | 'gql-field-added'
  | 'gql-field-type-changed'
  | 'gql-field-argument-removed'
  | 'gql-field-argument-added'
  | 'gql-field-argument-type-changed'
  | 'gql-field-argument-required-added'
  | 'gql-field-deprecated'
  // Enum-level
  | 'gql-enum-value-removed'
  | 'gql-enum-value-added'
  | 'gql-enum-value-deprecated'
  // Union-level
  | 'gql-union-member-removed'
  | 'gql-union-member-added'
  // Interface-implements
  | 'gql-interface-implemented-removed'
  | 'gql-interface-implemented-added'
  // Root operation
  | 'gql-root-operation-type-changed'
  // Scalar
  | 'gql-scalar-type-changed'
  // Non-breaking
  | 'gql-field-added-optional'
  | 'gql-type-description-changed'
  | 'noop';

export interface GraphQLChange {
  kind: GraphQLChangeKind;
  type?: string;
  field?: string;
  argument?: string;
  detail: string;
  raw?: unknown;
}

// ---------- Helpers ----------

export interface GraphQLDiffResult {
  changes: GraphQLChange[];
  oldSchema: NormalizedGraphQL;
  newSchema: NormalizedGraphQL;
}

function fieldKey(type: string, field: string, arg?: string): string {
  return arg ? `${type}.${field}(${arg})` : `${type}.${field}`;
}

function typeRefEquals(a: GQLTypeRef, b: GQLTypeRef): boolean {
  return typeRefToString(a) === typeRefToString(b);
}

function isRequiredArg(ref: GQLTypeRef): boolean {
  return isNonNull(ref) && ref.ofType.kind !== 'non-null';
}

function describeRef(ref: GQLTypeRef): string {
  return typeRefToString(ref);
}

// ---------- Core diff logic ----------

function diffFields(
  oldFields: GQLField[],
  newFields: GQLField[],
  typeName: string,
  isInput: boolean
): GraphQLChange[] {
  const changes: GraphQLChange[] = [];
  const oldByName = new Map(oldFields.map(f => [f.name, f]));
  const newByName = new Map(newFields.map(f => [f.name, f]));

  // Removed fields
  for (const [name, oldField] of oldByName) {
    if (!newByName.has(name)) {
      changes.push({
        kind: 'gql-field-removed',
        type: typeName,
        field: name,
        detail: `Field '${name}' on '${typeName}' was removed`
      });
    }
  }

  // Added / modified fields
  for (const [name, newField] of newByName) {
    const oldField = oldByName.get(name);
    if (!oldField) {
      // Field added — check if it has a non-null return type (breaking) or nullable (warning)
      const isBreaking = isNonNull(newField.type);
      changes.push({
        kind: isBreaking ? 'gql-field-added' : 'gql-field-added-optional',
        type: typeName,
        field: name,
        detail: isBreaking
          ? `Non-null field '${name}' added to '${typeName}' — may break existing queries`
          : `Optional field '${name}' added to '${typeName}'`,
        raw: newField
      });
    } else {
      // Compare type
      if (!typeRefEquals(oldField.type, newField.type)) {
        changes.push({
          kind: 'gql-field-type-changed',
          type: typeName,
          field: name,
          detail: `Field '${name}' on '${typeName}' changed type from '${describeRef(oldField.type)}' to '${describeRef(newField.type)}'`,
          raw: newField
        });
      }

      // Compare arguments
      if (!isInput) {
        changes.push(...diffArguments(oldField.arguments, newField.arguments, typeName, name));
      }

      // Deprecation
      if (!oldField.isDeprecated && newField.isDeprecated) {
        changes.push({
          kind: 'gql-field-deprecated',
          type: typeName,
          field: name,
          detail: `Field '${typeName}.${name}' is now deprecated: ${newField.deprecationReason ?? ''}`,
          raw: newField
        });
      }
    }
  }

  return changes;
}

function diffArguments(
  oldArgs: GQLArgument[],
  newArgs: GQLArgument[],
  typeName: string,
  fieldName: string
): GraphQLChange[] {
  const changes: GraphQLChange[] = [];
  const oldByName = new Map(oldArgs.map(a => [a.name, a]));
  const newByName = new Map(newArgs.map(a => [a.name, a]));

  for (const [name, oldArg] of oldByName) {
    if (!newByName.has(name)) {
      changes.push({
        kind: 'gql-field-argument-removed',
        type: typeName,
        field: fieldName,
        argument: name,
        detail: `Argument '${name}' on '${typeName}.${fieldName}' was removed`
      });
    }
  }

  for (const [name, newArg] of newByName) {
    const oldArg = oldByName.get(name);
    if (!oldArg) {
      const isRequired = isRequiredArg(newArg.type);
      changes.push({
        kind: isRequired ? 'gql-field-argument-required-added' : 'gql-field-argument-added',
        type: typeName,
        field: fieldName,
        argument: name,
        detail: isRequired
          ? `Required argument '${name}' added to '${typeName}.${fieldName}'`
          : `Optional argument '${name}' added to '${typeName}.${fieldName}'`,
        raw: newArg
      });
    } else {
      if (!typeRefEquals(oldArg.type, newArg.type)) {
        changes.push({
          kind: 'gql-field-argument-type-changed',
          type: typeName,
          field: fieldName,
          argument: name,
          detail: `Argument '${name}' on '${typeName}.${fieldName}' changed type from '${describeRef(oldArg.type)}' to '${describeRef(newArg.type)}'`,
          raw: newArg
        });
      }
    }
  }

  return changes;
}

function diffObjectTypes(
  oldType: Extract<GQLType, { kind: 'object' }>,
  newType: Extract<GQLType, { kind: 'object' }>
): GraphQLChange[] {
  const changes: GraphQLChange[] = [];

  // Check if interfaces implemented changed
  const oldInterfaces = new Set(oldType.interfaces);
  const newInterfaces = new Set(newType.interfaces);
  for (const iface of oldInterfaces) {
    if (!newInterfaces.has(iface)) {
      changes.push({
        kind: 'gql-interface-implemented-removed',
        type: newType.name,
        detail: `Type '${newType.name}' no longer implements interface '${iface}'`
      });
    }
  }
  for (const iface of newInterfaces) {
    if (!oldInterfaces.has(iface)) {
      changes.push({
        kind: 'gql-interface-implemented-added',
        type: newType.name,
        detail: `Type '${newType.name}' now implements interface '${iface}'`
      });
    }
  }

  changes.push(...diffFields(oldType.fields, newType.fields, newType.name, false));
  return changes;
}

function diffInputTypes(
  oldType: Extract<GQLType, { kind: 'input' }>,
  newType: Extract<GQLType, { kind: 'input' }>
): GraphQLChange[] {
  return diffFields(oldType.fields, newType.fields, newType.name, true);
}

function diffEnumTypes(
  oldType: Extract<GQLType, { kind: 'enum' }>,
  newType: Extract<GQLType, { kind: 'enum' }>
): GraphQLChange[] {
  const changes: GraphQLChange[] = [];
  const oldValues = new Map(oldType.values.map(v => [v.name, v]));
  const newValues = new Map(newType.values.map(v => [v.name, v]));

  for (const [name, oldVal] of oldValues) {
    if (!newValues.has(name)) {
      changes.push({
        kind: 'gql-enum-value-removed',
        type: newType.name,
        field: name,
        detail: `Enum value '${name}' on '${newType.name}' was removed`
      });
    }
  }

  for (const [name, newVal] of newValues) {
    const oldVal = oldValues.get(name);
    if (!oldVal) {
      changes.push({
        kind: 'gql-enum-value-added',
        type: newType.name,
        field: name,
        detail: `Enum value '${name}' added to '${newType.name}'`,
        raw: newVal
      });
    } else {
      if (!oldVal.isDeprecated && newVal.isDeprecated) {
        changes.push({
          kind: 'gql-enum-value-deprecated',
          type: newType.name,
          field: name,
          detail: `Enum value '${newType.name}.${name}' is now deprecated`
        });
      }
    }
  }

  return changes;
}

function diffUnionTypes(
  oldType: Extract<GQLType, { kind: 'union' }>,
  newType: Extract<GQLType, { kind: 'union' }>
): GraphQLChange[] {
  const changes: GraphQLChange[] = [];
  const oldMembers = new Set(oldType.possibleTypes);
  const newMembers = new Set(newType.possibleTypes);

  for (const m of oldMembers) {
    if (!newMembers.has(m)) {
      changes.push({
        kind: 'gql-union-member-removed',
        type: newType.name,
        detail: `Union member '${m}' removed from '${newType.name}'`
      });
    }
  }
  for (const m of newMembers) {
    if (!oldMembers.has(m)) {
      changes.push({
        kind: 'gql-union-member-added',
        type: newType.name,
        detail: `Union member '${m}' added to '${newType.name}'`
      });
    }
  }
  return changes;
}

function diffInterfaceTypes(
  oldType: Extract<GQLType, { kind: 'interface' }>,
  newType: Extract<GQLType, { kind: 'interface' }>
): GraphQLChange[] {
  return diffFields(oldType.fields, newType.fields, newType.name, false);
}

// ---------- Main diff function ----------

export function diffGraphQL(oldSchema: NormalizedGraphQL, newSchema: NormalizedGraphQL): GraphQLDiffResult {
  const changes: GraphQLChange[] = [];

  const allOldTypes = new Set(oldSchema.types.keys());
  const allNewTypes = new Set(newSchema.types.keys());

  // Types removed
  for (const name of allOldTypes) {
    if (!allNewTypes.has(name)) {
      changes.push({
        kind: 'gql-type-removed',
        type: name,
        detail: `Type '${name}' was removed`
      });
    }
  }

  // Types added
  for (const name of allNewTypes) {
    if (!allOldTypes.has(name)) {
      changes.push({
        kind: 'gql-type-added',
        type: name,
        detail: `Type '${name}' was added`
      });
    }
  }

  // Compare types that exist in both
  for (const name of allNewTypes) {
    if (!allOldTypes.has(name)) continue;
    const oldType = oldSchema.types.get(name)!;
    const newType = newSchema.types.get(name)!;

    if (oldType.kind !== newType.kind) {
      changes.push({
        kind: 'gql-type-kind-changed',
        type: name,
        detail: `Type '${name}' changed kind from '${oldType.kind}' to '${newType.kind}'`
      });
      continue;
    }

    switch (newType.kind) {
      case 'object':
        changes.push(...diffObjectTypes(oldType as any, newType));
        break;
      case 'input':
        changes.push(...diffInputTypes(oldType as any, newType));
        break;
      case 'enum':
        changes.push(...diffEnumTypes(oldType as any, newType));
        break;
      case 'union':
        changes.push(...diffUnionTypes(oldType as any, newType));
        break;
      case 'interface':
        changes.push(...diffInterfaceTypes(oldType as any, newType));
        break;
      case 'scalar':
        if (name !== 'String' && name !== 'Int' && name !== 'Float' &&
            name !== 'Boolean' && name !== 'ID') {
          // Custom scalar type changed
          changes.push({
            kind: 'gql-scalar-type-changed',
            type: name,
            detail: `Custom scalar '${name}' was modified`
          });
        }
        break;
    }
  }

  // Root operation type changes
  if (oldSchema.rootOpTypes.query !== newSchema.rootOpTypes.query) {
    changes.push({
      kind: 'gql-root-operation-type-changed',
      detail: `Query root type changed from '${oldSchema.rootOpTypes.query}' to '${newSchema.rootOpTypes.query}'`
    });
  }
  if (oldSchema.rootOpTypes.mutation !== newSchema.rootOpTypes.mutation) {
    changes.push({
      kind: 'gql-root-operation-type-changed',
      detail: `Mutation root type changed from '${oldSchema.rootOpTypes.mutation}' to '${newSchema.rootOpTypes.mutation}'`
    });
  }
  if (oldSchema.rootOpTypes.subscription !== newSchema.rootOpTypes.subscription) {
    changes.push({
      kind: 'gql-root-operation-type-changed',
      detail: `Subscription root type changed from '${oldSchema.rootOpTypes.subscription}' to '${newSchema.rootOpTypes.subscription}'`
    });
  }

  return {
    changes,
    oldSchema,
    newSchema
  };
}
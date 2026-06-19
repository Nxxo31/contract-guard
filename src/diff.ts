import { NormalizedSpec, NormalizedOperation, NormalizedParameter, NormalizedResponse } from './parser';

export type ChangeKind =
  // endpoint-level
  | 'endpoint-removed'
  | 'endpoint-added'
  | 'method-removed'
  | 'method-added'
  // parameters
  | 'parameter-removed'
  | 'parameter-required-added'
  | 'parameter-optional-added'
  | 'parameter-type-changed'
  | 'parameter-changed'
  // responses
  | 'response-removed'
  | 'response-type-changed'
  | 'response-added'
  // body / other
  | 'request-body-required-added'
  | 'request-body-shape-changed'
  | 'description-changed'
  | 'noop';

export interface Change {
  kind: ChangeKind;
  path: string;
  method?: string;
  parameter?: string;
  responseStatus?: string;
  detail: string;
  raw?: any;
}

export interface DiffResult {
  changes: Change[];
  oldSpec: NormalizedSpec;
  newSpec: NormalizedSpec;
}

function opsByEndpoint(spec: NormalizedSpec): Map<string, NormalizedOperation[]> {
  const map = new Map<string, NormalizedOperation[]>();
  for (const op of spec.endpoints) {
    const key = `${op.method.toUpperCase()} ${op.path}`;
    const list = map.get(key) ?? [];
    list.push(op);
    map.set(key, list);
  }
  return map;
}

function compareParameters(
  oldParams: NormalizedParameter[],
  newParams: NormalizedParameter[],
  path: string,
  method: string
): Change[] {
  const changes: Change[] = [];
  const oldByName = new Map(oldParams.map(p => [p.name, p]));
  const newByName = new Map(newParams.map(p => [p.name, p]));

  for (const [name, p] of oldByName) {
    if (!newByName.has(name)) {
      changes.push({
        kind: 'parameter-removed',
        path,
        method,
        parameter: name,
        detail: `Parámetro eliminado: ${p.in}:${name}${p.required ? ' (obligatorio)' : ''}`,
        raw: p
      });
    }
  }

  for (const [name, newP] of newByName) {
    const oldP = oldByName.get(name);
    if (!oldP) {
      changes.push({
        kind: newP.required ? 'parameter-required-added' : 'parameter-optional-added',
        path,
        method,
        parameter: name,
        detail: newP.required
          ? `Parámetro obligatorio nuevo: ${newP.in}:${name}`
          : `Parámetro opcional nuevo: ${newP.in}:${name}`,
        raw: newP
      });
    } else {
      if (!oldP.required && newP.required && newP.in !== 'path') {
        changes.push({
          kind: 'parameter-required-added',
          path,
          method,
          parameter: name,
          detail: `Parámetro ahora obligatorio: ${newP.in}:${name}`,
          raw: newP
        });
      }
      const oldType = oldP.schema?.type;
      const newType = newP.schema?.type;
      if (oldType && newType && oldType !== newType) {
        changes.push({
          kind: 'parameter-type-changed',
          path,
          method,
          parameter: name,
          detail: `Tipo de parámetro ${name} cambió: ${oldType} -> ${newType}`,
          raw: newP
        });
      }
    }
  }

  return changes;
}

function compareResponses(
  oldRes: Record<string, NormalizedResponse>,
  newRes: Record<string, NormalizedResponse>,
  path: string,
  method: string
): Change[] {
  const changes: Change[] = [];

  // Removed responses
  for (const status of Object.keys(oldRes)) {
    if (!(status in newRes)) {
      changes.push({
        kind: 'response-removed',
        path,
        method,
        responseStatus: status,
        detail: `Respuesta ${status} eliminada en ${method.toUpperCase()} ${path}`,
        raw: oldRes[status]
      });
    }
  }

  // New responses
  for (const status of Object.keys(newRes)) {
    if (!(status in oldRes)) {
      changes.push({
        kind: 'response-added',
        path,
        method,
        responseStatus: status,
        detail: `Respuesta ${status} agregada en ${method.toUpperCase()} ${path}`,
        raw: newRes[status]
      });
    }
  }

  return changes;
}

function compareOperations(
  oldOp: NormalizedOperation | undefined,
  newOp: NormalizedOperation | undefined,
  path: string,
  method: string
): Change[] {
  const changes: Change[] = [];

  if (!oldOp && newOp) {
    changes.push({
      kind: 'endpoint-added',
      path,
      method,
      detail: `Endpoint agregado: ${method.toUpperCase()} ${path}`
    });
    return changes;
  }

  if (oldOp && !newOp) {
    changes.push({
      kind: 'endpoint-removed',
      path,
      method,
      detail: `Endpoint eliminado: ${method.toUpperCase()} ${path}`
    });
    return changes;
  }

  if (oldOp && newOp) {
    changes.push(...compareParameters(oldOp.parameters, newOp.parameters, path, method));
    changes.push(...compareResponses(oldOp.responses, newOp.responses, path, method));
  }

  return changes;
}

export function diffSpecs(oldSpec: NormalizedSpec, newSpec: NormalizedSpec): DiffResult {
  const changes: Change[] = [];
  const oldOps = opsByEndpoint(oldSpec);
  const newOps = opsByEndpoint(newSpec);

  // endpoints/methods that exist in old but not in new
  for (const [key, oldOpsList] of oldOps) {
    const newOpsList = newOps.get(key);
    if (!newOpsList || newOpsList.length === 0) {
      // Entire op key disappeared
      for (const op of oldOpsList) {
        changes.push(...compareOperations(op, undefined, op.path, op.method));
      }
    } else {
      // Op key exists but spec may differ
      // Pair first new with first old for parameter/response comparison
      const oldOp = oldOpsList[0];
      const newOp = newOpsList[0];
      changes.push(...compareOperations(oldOp, newOp, oldOp.path, oldOp.method));
    }
  }

  // endpoints/methods added in new
  for (const [key, newOpsList] of newOps) {
    if (!oldOps.has(key)) {
      for (const op of newOpsList) {
        changes.push(...compareOperations(undefined, op, op.path, op.method));
      }
    }
  }

  return {
    changes,
    oldSpec,
    newSpec
  };
}

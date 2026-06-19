import * as fs from 'fs';
import * as path from 'path';

// ---------- OpenAPI 3.x normalized structures ----------

export type HttpMethod = 'get' | 'post' | 'put' | 'delete' | 'patch' | 'options' | 'head' | 'trace';

export interface NormalizedParameter {
  name: string;
  in: 'path' | 'query' | 'header' | 'cookie';
  required: boolean;
  schema?: NormalizedSchema;
  description?: string;
}

export interface NormalizedSchema {
  type?: string;
  format?: string;
  enum?: unknown[];
  items?: NormalizedSchema;
  properties?: Record<string, NormalizedSchema>;
  required?: string[];
  nullable?: boolean;
  $ref?: string;
  raw?: Record<string, unknown>;
}

export interface NormalizedResponse {
  description?: string;
  content?: Record<string, { schema?: NormalizedSchema }>;
}

export interface NormalizedOperation {
  method: HttpMethod;
  path: string;
  operationId?: string;
  summary?: string;
  parameters: NormalizedParameter[];
  requestBody?: { required?: boolean; content?: Record<string, { schema?: NormalizedSchema }> };
  responses: Record<string, NormalizedResponse>;
}

export interface NormalizedSpec {
  title: string;
  version: string;
  openapiVersion: string;
  endpoints: NormalizedOperation[];
  raw: unknown;
}

// ---------- Loaders ----------

export function loadSpecFromFile(filePath: string): unknown {
  const absolute = path.resolve(filePath);
  const content = fs.readFileSync(absolute, 'utf-8');
  return JSON.parse(content);
}

export function loadSpecFromString(content: string): unknown {
  return JSON.parse(content);
}

// ---------- Validation ----------

export function isOpenApi3Object(obj: unknown): obj is Record<string, unknown> {
  if (typeof obj !== 'object' || obj === null) return false;
  const o = obj as Record<string, unknown>;
  return typeof o.openapi === 'string' && o.openapi.startsWith('3.');
}

// ---------- Normalization ----------

const HTTP_METHODS: HttpMethod[] = ['get', 'put', 'post', 'delete', 'patch', 'head', 'options', 'trace'];

function resolveRef(ref: string): string | null {
  if (!ref.startsWith('#/')) return null;
  return ref.substring(2);
}

export function normalizeParameter(raw: any): NormalizedParameter {
  return {
    name: String(raw.name ?? ''),
    in: (raw.in ?? 'query') as NormalizedParameter['in'],
    required: Boolean(raw.required) || raw.in === 'path',
    schema: raw.schema ? normalizeSchema(raw.schema) : undefined,
    description: raw.description
  };
}

export function normalizeSchema(raw: any): NormalizedSchema {
  if (!raw || typeof raw !== 'object') return { type: undefined };
  return {
    type: raw.type,
    format: raw.format,
    enum: raw.enum,
    items: raw.items ? normalizeSchema(raw.items) : undefined,
    properties: raw.properties
      ? Object.fromEntries(Object.entries(raw.properties).map(([k, v]) => [k, normalizeSchema(v)]))
      : undefined,
    required: raw.required,
    nullable: raw.nullable,
    $ref: raw.$ref,
    raw: raw as Record<string, unknown>
  };
}

function resolveRefDeep(spec: any, ref: string): any {
  const parts = ref.split('/').slice(1);
  let cursor: any = spec;
  for (const p of parts) {
    if (cursor == null) return undefined;
    cursor = cursor[p];
  }
  return cursor;
}

function normalizeOperation(method: HttpMethod, p: string, raw: any): NormalizedOperation {
  const parameters: NormalizedParameter[] = (raw.parameters ?? []).map((param: any) => {
    if (param.$ref) {
      // Skip $ref resolution for simplicity in MVP — use as-is
      return normalizeParameter(param);
    }
    return normalizeParameter(param);
  });

  const responses: Record<string, NormalizedResponse> = {};
  if (raw.responses) {
    for (const [statusCode, responseObj] of Object.entries(raw.responses)) {
      const r = responseObj as any;
      const content: Record<string, { schema?: NormalizedSchema }> = {};
      if (r.content) {
        for (const [mediaType, mediaObj] of Object.entries(r.content)) {
          const m = mediaObj as any;
          content[mediaType] = { schema: m.schema ? normalizeSchema(m.schema) : undefined };
        }
      }
      responses[statusCode] = {
        description: r.description,
        content
      };
    }
  }

  return {
    method,
    path: p,
    operationId: raw.operationId,
    summary: raw.summary,
    parameters,
    requestBody: raw.requestBody, // keep raw for V1
    responses
  };
}

export function normalizeSpec(input: unknown): NormalizedSpec {
  if (!isOpenApi3Object(input)) {
    throw new Error('Input is not a valid OpenAPI 3.x object');
  }

  const spec = input as any;
  const info = spec.info ?? {};
  const paths = spec.paths ?? {};
  const endpoints: NormalizedOperation[] = [];

  for (const [pathName, pathObj] of Object.entries(paths)) {
    if (!pathObj || typeof pathObj !== 'object') continue;
    const p = pathObj as Record<string, any>;

    for (const method of HTTP_METHODS) {
      if (!p[method]) continue;
      endpoints.push(normalizeOperation(method, pathName, p[method]));
      // Also consider $ref to a path-item
      if (p[method].$ref) {
        // Currently skipped in MVP
      }
    }
  }

  // Stash the resolver helper for future use
  return {
    title: String(info.title ?? 'Untitled API'),
    version: String(info.version ?? '0.0.0'),
    openapiVersion: String(spec.openapi),
    endpoints,
    raw: spec
  };
}

// ---------- Internals exposed for testing ----------

export const __testing = { resolveRef, resolveRefDeep };

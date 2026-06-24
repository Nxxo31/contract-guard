/**
 * GraphQL Schema Parser — parses GraphQL SDL (schema definition language)
 * into a normalized structure for diffing.
 *
 * Handles:
 * - ObjectTypes, InputTypes, Enums, Scalars, Unions, Interfaces
 * - Fields with arguments
 * - Mutations, Queries, Subscriptions (root types)
 * - Deprecations
 *
 * Normalized schema is format-agnostic so the same diff engine
 * can compare SDL strings, Introspection JSON, or federated schemas.
 */

import * as fs from 'fs';
import * as path from 'path';

// ---------- Types ----------

export type GQLScalarName = string; // e.g. "String", "Int", "ID", "Boolean", "Float"

export type GQLTypeRef =
  | { kind: 'named'; name: string }
  | { kind: 'list'; ofType: GQLTypeRef }
  | { kind: 'non-null'; ofType: GQLTypeRef };

export function typeRefToString(ref: GQLTypeRef): string {
  switch (ref.kind) {
    case 'named': return ref.name;
    case 'list': return `[${typeRefToString(ref.ofType)}]`;
    case 'non-null': return `${typeRefToString(ref.ofType)}!`;
  }
}

export function isNonNull(ref: GQLTypeRef): boolean {
  return ref.kind === 'non-null';
}

export function unwrapNonNull(ref: GQLTypeRef): GQLTypeRef {
  return ref.kind === 'non-null' ? ref.ofType : ref;
}

export function stripNonNull(ref: GQLTypeRef): GQLTypeRef {
  if (ref.kind === 'non-null') return stripNonNull(ref.ofType);
  if (ref.kind === 'list') return { kind: 'list', ofType: stripNonNull(ref.ofType) };
  return ref;
}

export interface GQLArgument {
  name: string;
  type: GQLTypeRef;
  defaultValue?: string;
  description?: string;
  isDeprecated: boolean;
  deprecationReason?: string;
}

export interface GQLField {
  name: string;
  type: GQLTypeRef;
  arguments: GQLArgument[];
  description?: string;
  isDeprecated: boolean;
  deprecationReason?: string;
}

export interface GQLEnumValue {
  name: string;
  description?: string;
  isDeprecated: boolean;
  deprecationReason?: string;
}

export type GQLType =
  | { kind: 'object'; name: string; interfaces: string[]; fields: GQLField[]; description?: string }
  | { kind: 'input'; name: string; fields: GQLField[]; description?: string }
  | { kind: 'enum'; name: string; values: GQLEnumValue[]; description?: string }
  | { kind: 'scalar'; name: string; description?: string }
  | { kind: 'union'; name: string; possibleTypes: string[]; description?: string }
  | { kind: 'interface'; name: string; fields: GQLField[]; description?: string; possibleTypes?: string[] }
  | { kind: 'extension'; name: string; fields: GQLField[] }; // type extensions

export interface RootOperationTypes {
  query: string;
  mutation?: string;
  subscription?: string;
}

export interface NormalizedGraphQL {
  title: string;
  version: string;
  types: Map<string, GQLType>;
  rootOpTypes: RootOperationTypes;
  directives: Map<string, { locations: string[]; args: GQLArgument[] }>;
  raw: string;
}

// ---------- Lexer (simple, for SDL only) ----------

interface Token {
  type: string;
  value: string;
  pos: number;
}

const KEYWORDS = new Set([
  'query', 'mutation', 'subscription', 'type', 'input', 'enum',
  'scalar', 'union', 'interface', 'extend', 'directive', 'on',
  'schema', 'implements', 'fragment', '...'
]);

function isIdentChar(c: string): boolean {
  return /[a-zA-Z0-9_]/.test(c);
}

function isDigit(c: string): boolean {
  return /[0-9]/.test(c);
}

function skipWs(s: string, i: number): number {
  while (i < s.length) {
    const c = s[i];
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') { i++; continue; }
    if (c === '#') { while (i < s.length && s[i] !== '\n') i++; continue; }
    break;
  }
  return i;
}

function parseBlockString(s: string, i: number): { value: string; end: number } {
  // GraphQL block string: """..."""
  i += 3; // skip """
  let value = '';
  while (i < s.length - 2) {
    if (s[i] === '"' && s[i+1] === '"' && s[i+2] === '"') {
      i += 3;
      break;
    }
    value += s[i++];
  }
  return { value: value.trim(), end: i };
}

function tokenize(s: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < s.length) {
    i = skipWs(s, i);
    if (i >= s.length) break;
    let start = i;
    const c = s[i];

    if (c === '"') {
      if (s.slice(i, i+3) === '"""') {
        const { value, end } = parseBlockString(s, i);
        tokens.push({ type: 'STRING', value, pos: start });
        i = end;
        continue;
      }
      // Regular string
      i++;
      let val = '';
      while (i < s.length && s[i] !== '"') {
        if (s[i] === '\\') { i++; val += s[i++]; }
        else val += s[i++];
      }
      i++; // closing "
      tokens.push({ type: 'STRING', value: val, pos: start });
      continue;
    }

    if (c === '{' || c === '}' || c === '(' || c === ')' || c === '[' || c === ']' ||
        c === ':' || c === '=' || c === '|' || c === '@' || c === '!' || c === '&' ||
        c === '|' || c === '+' || c === '...') {
      tokens.push({ type: c, value: c, pos: start });
      i++;
      continue;
    }

    if (isIdentChar(c) || c === '_' || c === '$') {
      let val = '';
      while (i < s.length && isIdentChar(s[i])) { val += s[i++]; }
      if (KEYWORDS.has(val) || (val[0] && val[0] === val[0].toUpperCase() && val[0] !== val[0].toLowerCase())) {
        tokens.push({ type: 'NAME', value: val, pos: start });
      } else {
        tokens.push({ type: 'NAME', value: val, pos: start });
      }
      continue;
    }

    // Numbers
    if (isDigit(c) || (c === '-' && isDigit(s[i+1]))) {
      let val = '';
      if (s[i] === '-') { val += s[i++]; }
      while (i < s.length && isDigit(s[i])) { val += s[i++]; }
      if (s[i] === '.') {
        val += s[i++];
        while (i < s.length && isDigit(s[i])) { val += s[i++]; }
      }
      tokens.push({ type: 'NUMBER', value: val, pos: start });
      continue;
    }

    // Unknown char — skip
    i++;
  }
  return tokens;
}

// ---------- Parser ----------

class GraphQLParser {
  private tokens: Token[];
  private pos = 0;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  peek(): Token | undefined { return this.tokens[this.pos]; }
  peekValue(val: string): boolean { return this.peek()?.value === val; }

  consume(type?: string, value?: string): Token {
    const tok = this.tokens[this.pos++];
    if (type && tok.type !== type) throw new Error(`Expected ${type} at ${tok.pos}, got ${tok.type}`);
    if (value && tok.value !== value) throw new Error(`Expected "${value}" at ${tok.pos}`);
    return tok;
  }

  tryConsume(value: string): Token | null {
    if (this.peekValue(value)) return this.consume();
    return null;
  }

  parseName(): string {
    const tok = this.consume('NAME');
    return tok.value;
  }

  parseDescription(): string | undefined {
    const t = this.peek();
    if (t?.type === 'STRING') {
      return this.consume().value;
    }
    return undefined;
  }

  parseTypeRef(): GQLTypeRef {
    // Handle list type first
    if (this.tryConsume('[')) {
      const inner = this.parseTypeRef();
      this.consume(']');
      let ref: GQLTypeRef = { kind: 'list', ofType: inner };
      if (this.tryConsume('!')) {
        ref = { kind: 'non-null', ofType: ref };
      }
      return ref;
    }
    // Named type
    let ref: GQLTypeRef = { kind: 'named', name: this.parseName() };
    if (this.tryConsume('!')) {
      ref = { kind: 'non-null', ofType: ref };
    }
    return ref;
  }

  parseArguments(): GQLArgument[] {
    const args: GQLArgument[] = [];
    if (!this.tryConsume('(')) return args;
    while (!this.tryConsume(')')) {
      const name = this.parseName();
      this.consume(':');
      const type = this.parseTypeRef();
      const defaultValue = this.tryConsume('=') ? this.consume('STRING', undefined)?.value ?? this.consume().value : undefined;
      const description = this.parseDescription();
      const isDeprecated = this.peekValue('@deprecated');
      let deprecationReason: string | undefined;
      if (isDeprecated) {
        this.consume();
        if (this.tryConsume('(')) {
          deprecationReason = this.consume('STRING').value;
          this.consume(')');
        }
      }
      args.push({ name, type, defaultValue, description, isDeprecated, deprecationReason });
      if (!this.peekValue(')') && !this.peekValue(',')) break;
      if (this.peekValue(',')) this.consume();
    }
    return args;
  }

  parseField(isInput: boolean = false): GQLField {
    const description = this.parseDescription();
    const name = this.parseName();
    const arguments_ = isInput ? [] : this.parseArguments();
    this.consume(':');
    const type = this.parseTypeRef();
    const isDeprecated = this.peekValue('@deprecated');
    let deprecationReason: string | undefined;
    if (isDeprecated) {
      this.consume();
      if (this.tryConsume('(')) {
        deprecationReason = this.consume('STRING').value;
        this.consume(')');
      }
    }
    return { name, type, arguments: arguments_, description, isDeprecated, deprecationReason };
  }

  parseImplements(): string[] {
    const interfaces: string[] = [];
    // First, parse any interface names directly (handles "implements Interface1")
    while (this.peek() && !this.peekValue('{') && !this.peekValue('interface') &&
           !this.peekValue('type') && !this.peekValue('input') && !this.peekValue('enum') &&
           !this.peekValue('scalar') && !this.peekValue('union') && !this.peekValue('extend') &&
           !this.peekValue('&')) {
      interfaces.push(this.parseName());
      if (!this.tryConsume('&')) break;
    }
    // Handle leading & case: "implements & Interface1 & Interface2"
    if (this.tryConsume('&')) {
      while (true) {
        if (this.peekValue('{')) break;
        interfaces.push(this.parseName());
        if (!this.tryConsume('&')) break;
      }
    }
    return interfaces;
  }

  parseRootOperationTypes(): RootOperationTypes {
    const root: RootOperationTypes = { query: 'Query' };
    while (this.peekValue('query') || this.peekValue('mutation') || this.peekValue('subscription')) {
      const type = this.consume().value as 'query' | 'mutation' | 'subscription';
      this.consume(':');
      const name = this.parseName();
      if (type === 'query') root.query = name;
      else if (type === 'mutation') root.mutation = name;
      else if (type === 'subscription') root.subscription = name;
    }
    return root;
  }

  parseEnumValues(): GQLEnumValue[] {
    const values: GQLEnumValue[] = [];
    this.consume('{');
    while (!this.tryConsume('}')) {
      const description = this.parseDescription();
      const name = this.parseName();
      const isDeprecated = this.peekValue('@deprecated');
      let deprecationReason: string | undefined;
      if (isDeprecated) {
        this.consume();
        if (this.tryConsume('(')) {
          deprecationReason = this.consume('STRING').value;
          this.consume(')');
        }
      }
      values.push({ name, description, isDeprecated, deprecationReason });
    }
    return values;
  }

  parseUnionMembers(): string[] {
    const members: string[] = [];
    if (this.tryConsume('=')) {
      this.tryConsume('|'); // optional leading |
      members.push(this.parseName());
      while (this.tryConsume('|')) {
        members.push(this.parseName());
      }
    }
    return members;
  }

  parseTypeExtension(name: string): GQLType {
    const fields: GQLField[] = [];
    this.consume('{');
    while (!this.tryConsume('}')) {
      fields.push(this.parseField(false));
    }
    return { kind: 'extension', name, fields };
  }

  parse(): NormalizedGraphQL {
    const types = new Map<string, GQLType>();
    const directives = new Map<string, { locations: string[]; args: GQLArgument[] }>();
    let rootOpTypes: RootOperationTypes = { query: 'Query' };

    while (this.pos < this.tokens.length) {
      // Description (docstring on a type)
      const _topDesc = this.parseDescription();

      if (this.tryConsume('extend')) {
        // Type extension
        this.consume('type');
        const name = this.parseName();
        const interfaces = this.parseImplements();
        this.consume('{');
        const fields: GQLField[] = [];
        while (!this.tryConsume('}')) {
          fields.push(this.parseField(false));
        }
        if (!interfaces.length) {
          types.set(name, { kind: 'extension', name, fields });
        } else {
          types.set(name, { kind: 'object', name, interfaces, fields, description: _topDesc });
        }
        continue;
      }

      if (this.tryConsume('type')) {
        const name = this.parseName();
        const interfaces = this.parseImplements();
        const description = _topDesc;
        this.consume('{');
        const fields: GQLField[] = [];
        while (!this.tryConsume('}')) {
          fields.push(this.parseField(false));
        }
        types.set(name, { kind: 'object', name, interfaces, fields, description });
        continue;
      }

      if (this.tryConsume('input')) {
        const name = this.parseName();
        const description = _topDesc;
        this.consume('{');
        const fields: GQLField[] = [];
        while (!this.tryConsume('}')) {
          fields.push(this.parseField(true));
        }
        types.set(name, { kind: 'input', name, fields, description });
        continue;
      }

      if (this.tryConsume('enum')) {
        const name = this.parseName();
        const description = _topDesc;
        const values = this.parseEnumValues();
        types.set(name, { kind: 'enum', name, values, description });
        continue;
      }

      if (this.tryConsume('scalar')) {
        const name = this.parseName();
        const description = _topDesc;
        types.set(name, { kind: 'scalar', name, description });
        continue;
      }

      if (this.tryConsume('union')) {
        const name = this.parseName();
        const description = _topDesc;
        const possibleTypes = this.parseUnionMembers();
        types.set(name, { kind: 'union', name, possibleTypes, description });
        continue;
      }

      if (this.tryConsume('interface')) {
        const name = this.parseName();
        const description = _topDesc;
        this.consume('{');
        const fields: GQLField[] = [];
        while (!this.tryConsume('}')) {
          fields.push(this.parseField(false));
        }
        // possibleTypes may appear after
        types.set(name, { kind: 'interface', name, fields, description });
        continue;
      }

      if (this.tryConsume('schema')) {
        this.consume('{');
        rootOpTypes = this.parseRootOperationTypes();
        this.consume('}');
        continue;
      }

      if (this.tryConsume('directive')) {
        const name = this.parseName();
        this.consume('@');
        const desc = this.parseDescription();
        this.consume('(');
        const args = this.parseArguments();
        this.consume(')');
        this.consume('on');
        const locations: string[] = [];
        while (this.peek()) {
          const loc = this.consume('NAME').value;
          locations.push(loc);
          if (!this.tryConsume('|')) break;
        }
        directives.set(name, { locations, args });
        continue;
      }

      // Unknown token, skip
      this.pos++;
    }

    return {
      title: 'GraphQL Schema',
      version: '0.0.0',
      types,
      rootOpTypes,
      directives,
      raw: ''
    };
  }
}

export function parseGraphQLSDL(sdl: string): NormalizedGraphQL {
  const tokens = tokenize(sdl);
  const parser = new GraphQLParser(tokens);
  return parser.parse();
}

// ---------- Introspection JSON support ----------

export interface IntrospectionResult {
  __schema: {
    queryType: { name: string };
    mutationType?: { name: string };
    subscriptionType?: { name: string };
    types: Array<{
      kind: string;
      name: string;
      description?: string;
      fields?: Array<{
        name: string;
        description?: string;
        args: Array<{ name: string; description?: string; defaultValue?: string; type: { kind: string; name?: string; ofType?: { kind: string; name?: string } } }>;
        type: { kind: string; name?: string; ofType?: { kind: string; name?: string } };
        isDeprecated?: boolean;
        deprecationReason?: string;
      }>;
      inputFields?: Array<{ name: string; description?: string; type: { kind: string; name?: string; ofType?: { kind: string; name?: string } } }>;
      enumValues?: Array<{ name: string; description?: string; isDeprecated?: boolean; deprecationReason?: string }>;
      possibleTypes?: Array<{ name: string }>;
      interfaces?: Array<{ name: string }>;
    }>;
    directives: Array<{ name: string; description?: string; locations: string[]; args: Array<{ name: string; description?: string; defaultValue?: string; type: { kind: string; name?: string; ofType?: { kind: string; name?: string } } }> }>;
  };
}

function introspectionTypeRef(introspectionType: any): GQLTypeRef {
  if (introspectionType.kind === 'NON_NULL') {
    return { kind: 'non-null', ofType: introspectionTypeRef(introspectionType.ofType) };
  }
  if (introspectionType.kind === 'LIST') {
    return { kind: 'list', ofType: introspectionTypeRef(introspectionType.ofType) };
  }
  return { kind: 'named', name: introspectionType.name ?? 'Unknown' };
}

export function parseIntrospectionJson(introspection: IntrospectionResult): NormalizedGraphQL {
  const types = new Map<string, GQLType>();
  const schema = introspection.__schema;
  const rootOpTypes: RootOperationTypes = {
    query: schema.queryType.name,
    mutation: schema.mutationType?.name,
    subscription: schema.subscriptionType?.name
  };

  for (const t of schema.types) {
    if (!t.name || t.name.startsWith('__')) continue; // skip introspection types

    if (t.kind === 'OBJECT' || t.kind === 'INTERFACE') {
      const fields: GQLField[] = (t.fields ?? []).map((f: any) => ({
        name: f.name,
        description: f.description,
        type: introspectionTypeRef(f.type),
        arguments: (f.args ?? []).map((a: any) => ({
          name: a.name,
          description: a.description,
          defaultValue: a.defaultValue,
          type: introspectionTypeRef(a.type),
          isDeprecated: a.isDeprecated ?? false,
          deprecationReason: a.deprecationReason
        })),
        isDeprecated: f.isDeprecated ?? false,
        deprecationReason: f.deprecationReason
      }));

      types.set(t.name, {
        kind: t.kind === 'INTERFACE' ? 'interface' : 'object',
        name: t.name,
        description: t.description,
        fields,
        interfaces: (t.interfaces ?? []).map((i: any) => i.name),
        possibleTypes: t.possibleTypes?.map((p: any) => p.name)
      });
    } else if (t.kind === 'INPUT_OBJECT') {
      const fields: GQLField[] = (t.inputFields ?? []).map((f: any) => ({
        name: f.name,
        description: f.description,
        type: introspectionTypeRef(f.type),
        arguments: [],
        isDeprecated: false,
        deprecationReason: undefined
      }));
      types.set(t.name, { kind: 'input', name: t.name, description: t.description, fields });
    } else if (t.kind === 'ENUM') {
      const values: GQLEnumValue[] = (t.enumValues ?? []).map((v: any) => ({
        name: v.name,
        description: v.description,
        isDeprecated: v.isDeprecated ?? false,
        deprecationReason: v.deprecationReason
      }));
      types.set(t.name, { kind: 'enum', name: t.name, description: t.description, values });
    } else if (t.kind === 'SCALAR') {
      types.set(t.name, { kind: 'scalar', name: t.name, description: t.description });
    } else if (t.kind === 'UNION') {
      types.set(t.name, {
        kind: 'union',
        name: t.name,
        description: t.description,
        possibleTypes: t.possibleTypes?.map((p: any) => p.name) ?? []
      });
    }
  }

  const directives = new Map<string, { locations: string[]; args: GQLArgument[] }>();
  for (const d of schema.directives) {
    directives.set(d.name, {
      locations: d.locations,
      args: (d.args ?? []).map((a: any) => ({
        name: a.name,
        description: a.description,
        defaultValue: a.defaultValue,
        type: introspectionTypeRef(a.type),
        isDeprecated: false,
        deprecationReason: undefined
      }))
    });
  }

  return {
    title: 'GraphQL Schema (introspection)',
    version: '0.0.0',
    types,
    rootOpTypes,
    directives,
    raw: ''
  };
}

// ---------- Loaders ----------

export function loadGraphQLFromFile(filePath: string): NormalizedGraphQL {
  const absolute = path.resolve(filePath);
  const content = fs.readFileSync(absolute, 'utf-8').trim();

  // Detect format
  if (content.startsWith('{') && content.includes('"data"')) {
    // JSON introspection
    const parsed = JSON.parse(content) as IntrospectionResult;
    return parseIntrospectionJson(parsed);
  } else {
    // SDL
    return parseGraphQLSDL(content);
  }
}

export function loadGraphQLFromString(content: string): NormalizedGraphQL {
  const trimmed = content.trim();
  if (trimmed.startsWith('{') && trimmed.includes('"data"')) {
    return parseIntrospectionJson(JSON.parse(trimmed) as IntrospectionResult);
  } else {
    return parseGraphQLSDL(trimmed);
  }
}

// ---------- Format detection ----------

export type SchemaFormat = 'openapi' | 'graphql-sdl' | 'graphql-introspection' | 'grpc-protobuf';

export function detectFormat(input: unknown): SchemaFormat {
  if (typeof input !== 'object' || input === null) return 'openapi';
  const obj = input as Record<string, unknown>;

  if (typeof obj.openapi === 'string' && obj.openapi.startsWith('3.')) return 'openapi';
  if (typeof obj.graphql === 'string') return 'graphql-sdl';
  if (obj.__schema) return 'graphql-introspection';
  if (obj.syntax === 'proto3' || obj.package) return 'grpc-protobuf';

  // Try to detect from raw string content
  const raw = obj.raw as string | undefined;
  if (raw) {
    const trimmed = raw.trim();
    if (trimmed.startsWith('syntax') || trimmed.includes('message ')) return 'grpc-protobuf';
    if (trimmed.startsWith('type ') || trimmed.startsWith('query ') || trimmed.startsWith('schema ')) return 'graphql-sdl';
  }

  return 'openapi';
}
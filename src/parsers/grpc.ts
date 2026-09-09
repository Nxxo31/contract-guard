/**
 * gRPC Protobuf Parser — parses .proto files (proto3 IDL)
 * into a normalized structure for diffing.
 *
 * Handles:
 * - Messages (with fields, nested messages, oneofs, reserved)
 * - Services (RPC methods with streaming/unary)
 * - Enums (top-level and nested)
 * - Scalar types, message types, map types, repeated
 * - Package declarations and imports
 *
 * Detection of breaking changes:
 * - Messages removed
 * - Fields removed
 * - Field type changed
 * - Field tag number changed
 * - RPC methods removed
 * - RPC streaming mode changed (stream→unary = breaking)
 * - Enum values removed
 * - Oneof fields moved out of oneof context
 */

import * as fs from 'fs';
import * as path from 'path';

// ---------- Types ----------

export type ProtoScalarType =
  | 'double' | 'float' | 'int32' | 'int64' | 'uint32' | 'uint64'
  | 'sint32' | 'sint64' | 'fixed32' | 'fixed64' | 'sfixed32' | 'sfixed64'
  | 'bool' | 'string' | 'bytes';

export type ProtoMethodStreaming = 'unary' | 'server-streaming' | 'client-streaming' | 'bidi-streaming';

export interface ProtoField {
  name: string;
  /** Tag number in the protobuf wire format */
  tag: number;
  /** Type name — scalar, message name, or enum name */
  type: string;
  /** Whether the type is a known scalar */
  isScalar: boolean;
  /** Whether the field is repeated */
  repeated: boolean;
  /** Whether the field is optional (proto3 optional keyword) */
  optional: boolean;
  /** Map<K, V> fields */
  map?: { key: string; value: string };
  /** Oneof group the field belongs to (if any) */
  oneof?: string;
}

export interface ProtoOneof {
  name: string;
  fields: string[];
}

export interface ProtoEnumValue {
  name: string;
  value: number;
}

export interface ProtoEnum {
  name: string;
  values: ProtoEnumValue[];
}

export interface ProtoReservedRange {
  ranges: string[];
  names: string[];
}

export interface ProtoMessage {
  name: string;
  /** Full qualified name (e.g. "pkg.Message.NestedMessage") */
  fullName: string;
  fields: ProtoField[];
  oneofs: ProtoOneof[];
  nestedMessages: ProtoMessage[];
  enums: ProtoEnum[];
  reserved: ProtoReservedRange[];
}

export interface ProtoMethod {
  name: string;
  inputType: string;
  outputType: string;
  streaming: ProtoMethodStreaming;
  inputStream: boolean;
  outputStream: boolean;
}

export interface ProtoService {
  name: string;
  methods: ProtoMethod[];
}

export interface NormalizedProto {
  syntax: string;
  package: string;
  imports: string[];
  messages: Map<string, ProtoMessage>;
  services: Map<string, ProtoService>;
  enums: Map<string, ProtoEnum>;
  raw: string;
}

// ---------- Lexer ----------

const SCALAR_TYPES = new Set([
  'double', 'float', 'int32', 'int64', 'uint32', 'uint64',
  'sint32', 'sint64', 'fixed32', 'fixed64', 'sfixed32', 'sfixed64',
  'bool', 'string', 'bytes'
]);

interface Token {
  type: string;
  value: string;
  pos: number;
}

function isIdentStart(c: string): boolean {
  return /[a-zA-Z_]/.test(c);
}

function isIdentChar(c: string): boolean {
  return /[a-zA-Z0-9_.]/.test(c);
}

function skipWsAndComments(s: string, i: number): number {
  while (i < s.length) {
    const c = s[i];
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') { i++; continue; }
    if (c === '/' && s[i + 1] === '/') {
      while (i < s.length && s[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && s[i + 1] === '*') {
      i += 2;
      while (i < s.length - 1 && !(s[i] === '*' && s[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    break;
  }
  return i;
}

function tokenizeProto(s: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < s.length) {
    i = skipWsAndComments(s, i);
    if (i >= s.length) break;
    const start = i;
    const c = s[i];

    if (c === '{' || c === '}' || c === '(' || c === ')' || c === '[' ||
        c === ']' || c === ';' || c === '=' || c === ',' || c === '<' ||
        c === '>') {
      tokens.push({ type: c, value: c, pos: start });
      i++;
      continue;
    }

    // Identifier starting with letter (may include . for dotted names)
    if (isIdentStart(c)) {
      let val = '';
      while (i < s.length && isIdentChar(s[i])) { val += s[i++]; }
      // Handle dotted name — if starts with dot, we need type ref context
      tokens.push({ type: 'NAME', value: val, pos: start });
      continue;
    }

    // Standalone dotted name (e.g. .package.Message)
    if (c === '.') {
      let val = '.';
      i++;
      while (i < s.length && isIdentChar(s[i])) { val += s[i++]; }
      tokens.push({ type: 'NAME', value: val, pos: start });
      continue;
    }

    // Numbers
    if (/[0-9-+]/.test(c)) {
      let val = '';
      if (c === '-' || c === '+') { val += s[i++]; }
      while (i < s.length && /[0-9.]/.test(s[i])) { val += s[i++]; }
      tokens.push({ type: 'NUMBER', value: val, pos: start });
      continue;
    }

    // String literal
    if (c === '"' || c === "'") {
      const quote = c;
      i++;
      let val = '';
      while (i < s.length && s[i] !== quote) {
        if (s[i] === '\\') { i++; val += s[i++] ?? ''; }
        else val += s[i++];
      }
      i++;
      tokens.push({ type: 'STRING', value: val, pos: start });
      continue;
    }

    i++;
  }
  return tokens;
}

// ---------- Parser ----------

class ProtoParser {
  private tokens: Token[];
  private pos = 0;
  private pkg = '';

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  peek(): Token | undefined { return this.tokens[this.pos]; }
  peekValue(v: string): boolean { return this.peek()?.value === v; }

  consume(type?: string): Token {
    const tok = this.tokens[this.pos++];
    if (tok === undefined) throw new Error('Unexpected end of input');
    if (type && tok.type !== type) throw new Error(`Expected ${type} at ${tok.pos}, got ${tok.type} (${tok.value})`);
    return tok;
  }

  tryConsume(value: string): Token | null {
    if (this.peek()?.value === value) return this.consume();
    return null;
  }

  parseName(): string {
    const t = this.peek();
    if (t?.type === 'NAME') return this.consume().value;
    throw new Error(`Expected NAME at ${t?.pos}, got ${t?.type}`);
  }

  /**
   * Parse type ref, supporting dotted names e.g. "pkg.Message"
   * and consuming any dot-joined segments remaining.
   */
  parseTypeRef(): string {
    const t = this.peek();
    if (!t || (t.type !== 'NAME' && t.value !== '.')) {
      throw new Error(`Expected type ref at ${t?.pos}`);
    }
    let name = '';
    // First token: dotted-prefixed (".pkg") or "pkg"
    while (this.peek()?.type === 'NAME') {
      name += this.consume('NAME').value;
      const nextVal = this.peek()?.value ?? '';
      if (nextVal === '.' && this.tokens[this.pos + 1]?.type === 'NAME') {
        // merge with dot (but only if next token after . is a NAME)
        name += '.';
        this.consume(); // consume the '.'
      } else {
        break;
      }
    }
    if (this.peek()?.value === '.' && this.tokens[this.pos - 1]?.value === name) {
      // If peek looks like ".something" treat it as continuation
      const dStr = this.peek()?.value;
      if (typeof dStr === 'string' && dStr.startsWith('.')) {
        this.consume();
        const next = this.consume('NAME');
        name += ('.' + next.value);
      }
    }
    if (!name) throw new Error(`Empty type ref at ${t?.pos}`);
    return name;
  }

  /** skip brackets [ ... ] */
  skipFieldOptions(): void {
    if (this.tryConsume('[')) {
      const stack = 1;
      // Use bracket depth count to match nested brackets
      let depth = stack;
      while (depth > 0 && this.peek()) {
        const t = this.consume();
        if (t.value === '[') depth++;
        else if (t.value === ']') depth--;
        if (depth === 0) break;
      }
    }
  }

  /** skip a full statement: option ... ; */
  skipStatement(): void {
    while (this.peek() && !this.tryConsume(';')) {
      if (!this.peek()) break;
      this.consume();
    }
  }

  parseField(oneofContext?: string): ProtoField {
    let repeated = false;
    let optional = false;

    // Check for repeated / optional
    while (this.peekValue('repeated') || this.peekValue('optional') || this.peekValue('required')) {
      if (this.peekValue('repeated')) { repeated = true; this.consume(); }
      else if (this.peekValue('optional')) { optional = true; this.consume(); }
      else if (this.peekValue('required')) { this.consume(); } // proto2 only
    }

    // map<K, V>
    if (this.peekValue('map')) {
      this.consume();
      this.consume('<');
      const key = this.parseTypeRef();
      this.consume(',');
      const value = this.parseTypeRef();
      this.consume('>');
      const name = this.parseName();
      this.consume('=');
      const tag = parseInt(this.consume('NUMBER').value, 10);
      this.skipFieldOptions();
      this.tryConsume(';');
      return { name, tag, type: `map<${key},${value}>`, isScalar: false, repeated: false, optional, map: { key, value }, oneof: oneofContext };
    }

    const typeName = this.parseTypeRef();
    const isScalar = SCALAR_TYPES.has(typeName);
    const name = this.parseName();
    this.consume('=');
    const tag = parseInt(this.consume('NUMBER').value, 10);
    this.skipFieldOptions();
    this.tryConsume(';');

    return { name, tag, type: typeName, isScalar, repeated, optional, oneof: oneofContext };
  }

  parseEnum(): ProtoEnum {
    const name = this.parseName();
    const values: ProtoEnumValue[] = [];
    this.consume('{');
    while (!this.tryConsume('}')) {
      if (this.peekValue('}')) break;
      if (!this.peek()) throw new Error('Unexpected end inside enum');
      if (this.peekValue('option')) { this.skipStatement(); continue; }
      if (this.peekValue('reserved')) { this.skipStatement(); continue; }
      const valName = this.parseName();
      this.consume('=');
      const valValue = parseInt(this.consume('NUMBER').value, 10);
      this.skipFieldOptions();
      this.tryConsume(';');
      values.push({ name: valName, value: valValue });
    }
    return { name, values };
  }

  parseMethod(): ProtoMethod {
    const name = this.parseName();
    this.consume('(');
    const inputStream = this.peekValue('stream');
    if (inputStream) this.consume();
    const inputType = this.parseTypeRef();
    this.consume(')');

    // The token after the ')' can either be "returns" or "="
    if (this.peekValue('returns')) {
      this.consume();
    }

    this.consume('(');
    const outputStream = this.peekValue('stream');
    if (outputStream) this.consume();
    const outputType = this.parseTypeRef();
    this.consume(')');

    this.skipFieldOptions();
    this.tryConsume(';');

    let streaming: ProtoMethodStreaming;
    if (inputStream && outputStream) streaming = 'bidi-streaming';
    else if (inputStream) streaming = 'client-streaming';
    else if (outputStream) streaming = 'server-streaming';
    else streaming = 'unary';

    return { name, inputType, outputType, streaming, inputStream, outputStream };
  }

  parseService(): ProtoService {
    const name = this.parseName();
    const methods: ProtoMethod[] = [];
    this.consume('{');
    while (!this.tryConsume('}')) {
      if (!this.peek()) throw new Error('Unexpected end inside service');
      if (this.peekValue('rpc')) { this.consume(); methods.push(this.parseMethod()); continue; }
      if (this.peekValue('option')) { this.skipStatement(); continue; }
      if (this.peekValue('}')) break;
      // skip stray tokens
      this.consume();
    }
    return { name, methods };
  }

  /**
   * Parse oneof block. Each field becomes a ProtoField with oneof=name set.
   */
  parseOneof(): { oneof: ProtoOneof; fields: ProtoField[] } {
    const name = this.parseName();
    const fieldNames: string[] = [];
    const fields: ProtoField[] = [];
    this.consume('{');
    while (!this.tryConsume('}')) {
      if (this.peekValue('}')) break;
      if (!this.peek()) throw new Error('Unexpected end inside oneof');
      if (this.peekValue('option')) { this.skipStatement(); continue; }

      // type name = tag; — no repeated/optional allowed in oneof
      const typeName = this.parseTypeRef();
      const fieldName = this.parseName();
      this.consume('=');
      const tag = parseInt(this.consume('NUMBER').value, 10);
      this.skipFieldOptions();
      this.tryConsume(';');
      fieldNames.push(fieldName);
      fields.push({ name: fieldName, tag, type: typeName, isScalar: SCALAR_TYPES.has(typeName), repeated: false, optional: false, oneof: name });
    }
    return { oneof: { name, fields: fieldNames }, fields };
  }

  parseMessage(parentPath: string): ProtoMessage {
    const name = this.parseName();
    const fullName = parentPath ? `${parentPath}.${name}` : name;
    const fields: ProtoField[] = [];
    const oneofs: ProtoOneof[] = [];
    const nestedMessages: ProtoMessage[] = [];
    const enums: ProtoEnum[] = [];
    const reserved: ProtoReservedRange[] = [];

    this.consume('{');
    while (!this.tryConsume('}')) {
      if (!this.peek()) throw new Error('Unexpected end inside message');
      if (this.peekValue('}')) break;

      if (this.peekValue('reserved')) {
        this.consume();
        const r: ProtoReservedRange = { ranges: [], names: [] };
        while (!this.tryConsume(';')) {
          if (!this.peek()) break;
          const t = this.peek()!;
          if (t.type === 'STRING') {
            r.names.push(this.consume('STRING').value);
          } else {
            let range = this.consume().value;
            if (this.peekValue('to')) {
              this.consume();
              range += ' to ' + this.consume().value;
            }
            r.ranges.push(range);
          }
          this.tryConsume(',');
        }
        reserved.push(r);
        continue;
      }

      if (this.peekValue('option')) { this.skipStatement(); continue; }

      if (this.peekValue('message')) {
        this.consume();
        nestedMessages.push(this.parseMessage(fullName));
        continue;
      }

      if (this.peekValue('enum')) {
        this.consume();
        enums.push(this.parseEnum());
        continue;
      }

      if (this.peekValue('oneof')) {
        this.consume();
        const result = this.parseOneof();
        oneofs.push(result.oneof);
        fields.push(...result.fields);
        continue;
      }

      // Regular field: [repeated|optional|required] type name = tag;
      fields.push(this.parseField());
    }

    return { name, fullName, fields, oneofs, nestedMessages, enums, reserved };
  }

  parse(): NormalizedProto {
    const messages = new Map<string, ProtoMessage>();
    const services = new Map<string, ProtoService>();
    const enums = new Map<string, ProtoEnum>();
    let syntax = 'proto3';

    const registerMessage = (msg: ProtoMessage) => {
      messages.set(msg.fullName, msg);
      for (const nested of msg.nestedMessages) registerMessage(nested);
      for (const nestedEnum of msg.enums) enums.set(`${this.pkg}.${nestedEnum.name}`, nestedEnum);
    };

    while (this.pos < this.tokens.length) {
      if (!this.peek()) break;

      if (this.peekValue('syntax')) {
        this.consume();
        this.consume('=');
        syntax = this.consume('STRING').value;
        this.tryConsume(';');
        continue;
      }
      if (this.peekValue('package')) {
        this.consume();
        this.pkg = this.parseTypeRef();
        this.tryConsume(';');
        continue;
      }
      if (this.peekValue('import')) {
        this.consume();
        // skip 'public'/'weak' modifier if present
        if (this.peekValue('public') || this.peekValue('weak')) this.consume();
        this.skipStatement();
        continue;
      }
      if (this.peekValue('option')) {
        this.skipStatement();
        continue;
      }
      if (this.peekValue('message')) {
        this.consume();
        registerMessage(this.parseMessage(this.pkg));
        continue;
      }
      if (this.peekValue('service')) {
        this.consume();
        const svc = this.parseService();
        services.set(svc.name, svc);
        continue;
      }
      if (this.peekValue('enum')) {
        this.consume();
        const e = this.parseEnum();
        enums.set(`${this.pkg}.${e.name}`, e);
        continue;
      }
      this.consume(); // skip stray token
    }

    return { syntax, package: this.pkg, imports: [], messages, services, enums, raw: '' };
  }
}

// ---------- Public API ----------

export function parseProto(src: string): NormalizedProto {
  const tokens = tokenizeProto(src);
  const parser = new ProtoParser(tokens);
  return parser.parse();
}

export function loadProtoFromFile(filePath: string): NormalizedProto {
  const absolute = path.resolve(filePath);
  const content = fs.readFileSync(absolute, 'utf-8');
  return parseProto(content);
}

export function loadProtoFromString(content: string): NormalizedProto {
  return parseProto(content);
}

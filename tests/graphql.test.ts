import { describe, it, expect, beforeEach } from 'vitest';
import {
  parseGraphQLSDL,
  loadGraphQLFromFile,
  type NormalizedGraphQL,
  type GQLType
} from '../src/parsers/graphql';
import { diffGraphQL } from '../src/parsers/graphql-diff';
import { classifyGraphQLChanges, Severity, countBySeverityGraphQL } from '../src/parsers/graphql-rules';
import { buildGraphQLReport, generateGraphQLReport } from '../src/report';

const BASE_SCHEMA = `
type User {
  id: ID!
  name: String!
  email: String
  role: String!
}

type Query {
  user(id: ID!): User
  users: [User!]!
}

type Mutation {
  createUser(name: String!, email: String): User!
}
`;

const CHANGE_EMAIL_TO_NON_NULL = `
type User {
  id: ID!
  name: String!
  email: String!
  role: String!
}
type Query { user(id: ID!): User users: [User!]! }
type Mutation { createUser(name: String!, email: String): User! }
`;

const REMOVE_FIELD = `
type User {
  id: ID!
  name: String!
}
type Query { user(id: ID!): User users: [User!]! }
type Mutation { createUser(name: String!, email: String): User! }
`;

const ADD_REQUIRED_ARG = `
type User {
  id: ID!
  name: String!
  email: String
  role: String!
}
type Query { user(id: ID!): User users: [User!]! }
type Mutation {
  createUser(name: String!, email: String, role: String!): User!
}
`;

const ADD_TYPE = `
type User {
  id: ID!
  name: String!
  email: String
  role: String!
}

type Product {
  id: ID!
  name: String!
}

type Query { user(id: ID!): User users: [User!]! product(id: ID!): Product }
type Mutation { createUser(name: String!, email: String): User! }
`;

const ADD_OPTIONAL_FIELD = `
type User {
  id: ID!
  name: String!
  email: String
  role: String!
  age: Int
}
type Query { user(id: ID!): User users: [User!]! }
type Mutation { createUser(name: String!, email: String): User! }
`;

const CHANGE_FIELD_TYPE = `
type User {
  id: ID!
  name: String!
  email: String
  role: Int!
}
type Query { user(id: ID!): User users: [User!]! }
type Mutation { createUser(name: String!, email: String): User! }
`;

const ADD_ENUM_VALUE = `
enum UserRole {
  ADMIN
  USER
  GUEST
  MODERATOR
}

type User {
  id: ID!
  name: String!
  email: String
  role: UserRole!
}
type Query { user(id: ID!): User users: [User!]! }
type Mutation { createUser(name: String!, email: String, role: UserRole!): User! }
`;

const REMOVE_ENUM_VALUE = `
enum UserRole {
  ADMIN
  USER
}

type User {
  id: ID!
  name: String!
  email: String
  role: UserRole!
}
type Query { user(id: ID!): User users: [User!]! }
type Mutation { createUser(name: String!, email: String, role: UserRole!): User! }
`;

const ADD_UNION_MEMBER = `
union SearchResult = User | Product

type User { id: ID! name: String! }
type Product { id: ID! name: String! }
type Order { id: ID! }

type Query { search(id: ID!): SearchResult }
`;

const REMOVE_UNION_MEMBER = `
union SearchResult = User

type User { id: ID! name: String! }
type Product { id: ID! name: String! }

type Query { search(id: ID!): SearchResult }
`;

describe('GraphQL parser', () => {
  it('parses basic SDL with types, queries and mutations', () => {
    const schema = parseGraphQLSDL(BASE_SCHEMA);
    expect(schema.types.size).toBeGreaterThan(0);
    expect(schema.types.has('User')).toBe(true);
    expect(schema.types.has('Query')).toBe(true);
    expect(schema.types.has('Mutation')).toBe(true);

    const userType = schema.types.get('User')!;
    expect(userType.kind).toBe('object');

    const userFields = (userType as any).fields;
    expect(userFields.length).toBe(4); // id, name, email, role

    const queryType = schema.types.get('Query')!;
    expect(queryType.kind).toBe('object');

    const mutationType = schema.types.get('Mutation')!;
    expect(mutationType.kind).toBe('object');
  });

  it('parses field arguments correctly', () => {
    const schema = parseGraphQLSDL(BASE_SCHEMA);
    const queryType = schema.types.get('Query')!;
    const queryFields = (queryType as any).fields;

    const usersField = queryFields.find((f: any) => f.name === 'users');
    expect(usersField).toBeDefined();
    expect(usersField.arguments.length).toBe(2); // limit, offset

    const userField = queryFields.find((f: any) => f.name === 'user');
    expect(userField).toBeDefined();
    expect(userField.arguments.length).toBe(1); // id
  });

  it('parses type references with nullability', () => {
    const schema = parseGraphQLSDL(BASE_SCHEMA);
    const userType = schema.types.get('User')!;
    const fields = (userType as any).fields;

    const idField = fields.find((f: any) => f.name === 'id');
    expect(idField.type.kind).toBe('non-null');
    expect(idField.type.ofType.kind).toBe('named');
    expect(idField.type.ofType.name).toBe('ID');

    const emailField = fields.find((f: any) => f.name === 'email');
    expect(emailField.type.kind).toBe('named'); // nullable String

    const usersField = (schema.types.get('Query') as any).fields.find((f: any) => f.name === 'users');
    expect(usersField.type.kind).toBe('non-null');
    expect(usersField.type.ofType.kind).toBe('list');
  });

  it('parses enum types', () => {
    const schema = parseGraphQLSDL(ADD_ENUM_VALUE);
    expect(schema.types.has('UserRole')).toBe(true);
    const enumType = schema.types.get('UserRole')!;
    expect(enumType.kind).toBe('enum');
    const values = (enumType as any).values;
    expect(values.length).toBe(4);
    expect(values.map((v: any) => v.name)).toEqual(['ADMIN', 'USER', 'GUEST', 'MODERATOR']);
  });

  it('parses union types', () => {
    const schema = parseGraphQLSDL(ADD_UNION_MEMBER);
    expect(schema.types.has('SearchResult')).toBe(true);
    const unionType = schema.types.get('SearchResult')!;
    expect(unionType.kind).toBe('union');
    expect((unionType as any).possibleTypes).toEqual(['User', 'Product']);
  });

  it('parses input types', () => {
    const inputSchema = `
      input CreateUserInput {
        name: String!
        email: String
        role: String!
      }
      type Query { dummy: String }
    `;
    const schema = parseGraphQLSDL(inputSchema);
    expect(schema.types.has('CreateUserInput')).toBe(true);
    const inputType = schema.types.get('CreateUserInput')!;
    expect(inputType.kind).toBe('input');
  });

  it('parses interface types', () => {
    const ifaceSchema = `
      interface Node {
        id: ID!
      }
      type Query { dummy: String }
    `;
    const schema = parseGraphQLSDL(ifaceSchema);
    expect(schema.types.has('Node')).toBe(true);
    const ifaceType = schema.types.get('Node')!;
    expect(ifaceType.kind).toBe('interface');
    expect((ifaceType as any).fields.length).toBe(1);
  });

  it('loads GraphQL schema from .gql file', () => {
    const schema = loadGraphQLFromFile('fixtures/old-schema.gql');
    expect(schema.types.size).toBeGreaterThan(0);
    expect(schema.types.has('User')).toBe(true);
  });
});

describe('GraphQL diff engine', () => {
  it('detects field type changed (BREAKING: email String -> String!)', () => {
    const old = parseGraphQLSDL(BASE_SCHEMA);
    const next = parseGraphQLSDL(CHANGE_EMAIL_TO_NON_NULL);
    const diff = diffGraphQL(old, next);

    const typeChanged = diff.changes.find(
      c => c.kind === 'gql-field-type-changed' && c.field === 'email'
    );
    expect(typeChanged).toBeDefined();
    expect(typeChanged?.type).toBe('User');
  });

  it('detects field removed (BREAKING: role removed from User)', () => {
    const old = parseGraphQLSDL(BASE_SCHEMA);
    const next = parseGraphQLSDL(REMOVE_FIELD);
    const diff = diffGraphQL(old, next);

    const removed = diff.changes.find(
      c => c.kind === 'gql-field-removed' && c.field === 'role'
    );
    expect(removed).toBeDefined();
  });

  it('detects field added with non-null type (BREAKING)', () => {
    const old = parseGraphQLSDL(BASE_SCHEMA);
    const next = parseGraphQLSDL(ADD_REQUIRED_ARG);
    const diff = diffGraphQL(old, next);

    // role is a new non-null arg on createUser
    const added = diff.changes.find(
      c => c.kind === 'gql-field-argument-required-added' && c.argument === 'role'
    );
    expect(added).toBeDefined();
  });

  it('detects type added (WARNING)', () => {
    const old = parseGraphQLSDL(BASE_SCHEMA);
    const next = parseGraphQLSDL(ADD_TYPE);
    const diff = diffGraphQL(old, next);

    const added = diff.changes.find(c => c.kind === 'gql-type-added' && c.type === 'Product');
    expect(added).toBeDefined();
  });

  it('detects optional field added (WARNING)', () => {
    const old = parseGraphQLSDL(BASE_SCHEMA);
    const next = parseGraphQLSDL(ADD_OPTIONAL_FIELD);
    const diff = diffGraphQL(old, next);

    const added = diff.changes.find(
      c => c.kind === 'gql-field-added-optional' && c.field === 'age'
    );
    expect(added).toBeDefined();
  });

  it('detects field type changed (BREAKING: role String! -> Int!)', () => {
    const old = parseGraphQLSDL(BASE_SCHEMA);
    const next = parseGraphQLSDL(CHANGE_FIELD_TYPE);
    const diff = diffGraphQL(old, next);

    const typeChanged = diff.changes.find(
      c => c.kind === 'gql-field-type-changed' && c.field === 'role'
    );
    expect(typeChanged).toBeDefined();
  });

  it('detects enum value added (WARNING)', () => {
    const old = parseGraphQLSDL(ADD_ENUM_VALUE.replace('MODERATOR', ''));
    const next = parseGraphQLSDL(ADD_ENUM_VALUE);
    const diff = diffGraphQL(old, next);

    const added = diff.changes.find(
      c => c.kind === 'gql-enum-value-added' && c.field === 'MODERATOR'
    );
    expect(added).toBeDefined();
  });

  it('detects enum value removed (BREAKING)', () => {
    const old = parseGraphQLSDL(REMOVE_ENUM_VALUE);
    const next = parseGraphQLSDL(REMOVE_ENUM_VALUE.replace('  MODERATOR\n', ''));
    const diff = diffGraphQL(old, next);

    const removed = diff.changes.find(
      c => c.kind === 'gql-enum-value-removed' && c.field === 'MODERATOR'
    );
    expect(removed).toBeDefined();
  });

  it('detects union member added (WARNING)', () => {
    const old = parseGraphQLSDL(ADD_UNION_MEMBER.replace(' | Product', ''));
    const next = parseGraphQLSDL(ADD_UNION_MEMBER);
    const diff = diffGraphQL(old, next);

    const added = diff.changes.find(c => c.kind === 'gql-union-member-added' && c.type === 'SearchResult');
    expect(added).toBeDefined();
  });

  it('detects union member removed (BREAKING)', () => {
    const old = parseGraphQLSDL(ADD_UNION_MEMBER);
    const next = parseGraphQLSDL(REMOVE_UNION_MEMBER);
    const diff = diffGraphQL(old, next);

    const removed = diff.changes.find(
      c => c.kind === 'gql-union-member-removed' && c.type === 'SearchResult'
    );
    expect(removed).toBeDefined();
  });

  it('detects field added with non-null return (BREAKING)', () => {
    const old = parseGraphQLSDL(BASE_SCHEMA);
    const withNewField = `
      type User {
        id: ID!
        name: String!
        email: String
        role: String!
        score: Int!
      }
      type Query {
        user(id: ID!): User
        users: [User!]!
      }
      type Mutation {
        createUser(name: String!, email: String): User!
      }
    `;
    const next = parseGraphQLSDL(withNewField);
    const diff = diffGraphQL(old, next);

    const added = diff.changes.find(c => c.kind === 'gql-field-added' && c.field === 'score');
    expect(added).toBeDefined();
  });

  it('returns no changes for identical schemas', () => {
    const schema = parseGraphQLSDL(BASE_SCHEMA);
    const diff = diffGraphQL(schema, schema);
    expect(diff.changes.every(c => c.kind === 'noop')).toBe(true);
  });
});

describe('GraphQL severity classification', () => {
  it('classifies field-type-changed as BREAKING', () => {
    const old = parseGraphQLSDL(BASE_SCHEMA);
    const next = parseGraphQLSDL(CHANGE_EMAIL_TO_NON_NULL);
    const diff = diffGraphQL(old, next);
    const classified = classifyGraphQLChanges(diff.changes);

    const emailChange = classified.find(c => c.kind === 'gql-field-type-changed');
    expect(emailChange?.severity).toBe(Severity.BREAKING);
  });

  it('classifies field-removed as BREAKING', () => {
    const old = parseGraphQLSDL(BASE_SCHEMA);
    const next = parseGraphQLSDL(REMOVE_FIELD);
    const diff = diffGraphQL(old, next);
    const classified = classifyGraphQLChanges(diff.changes);

    const roleRemoved = classified.find(c => c.kind === 'gql-field-removed');
    expect(roleRemoved?.severity).toBe(Severity.BREAKING);
  });

  it('classifies field-added-optional as WARNING', () => {
    const old = parseGraphQLSDL(BASE_SCHEMA);
    const next = parseGraphQLSDL(ADD_OPTIONAL_FIELD);
    const diff = diffGraphQL(old, next);
    const classified = classifyGraphQLChanges(diff.changes);

    const ageAdded = classified.find(c => c.kind === 'gql-field-added-optional');
    expect(ageAdded?.severity).toBe(Severity.WARNING);
  });

  it('classifies type-added as WARNING', () => {
    const old = parseGraphQLSDL(BASE_SCHEMA);
    const next = parseGraphQLSDL(ADD_TYPE);
    const diff = diffGraphQL(old, next);
    const classified = classifyGraphQLChanges(diff.changes);

    const productAdded = classified.find(c => c.kind === 'gql-type-added');
    expect(productAdded?.severity).toBe(Severity.WARNING);
  });

  it('counts changes by severity correctly', () => {
    const old = parseGraphQLSDL(BASE_SCHEMA);
    const next = parseGraphQLSDL(CHANGE_EMAIL_TO_NON_NULL);
    const diff = diffGraphQL(old, next);
    const classified = classifyGraphQLChanges(diff.changes);
    const counts = countBySeverityGraphQL(classified);

    expect(counts.breaking).toBeGreaterThan(0);
    expect(counts.warning).toBe(0);
    expect(counts.safe).toBe(0);
  });
});

describe('GraphQL report generation', () => {
  it('generates a Markdown report with severity sections', () => {
    const old = parseGraphQLSDL(BASE_SCHEMA);
    const next = parseGraphQLSDL(CHANGE_EMAIL_TO_NON_NULL);
    const diff = diffGraphQL(old, next);
    const classified = classifyGraphQLChanges(diff.changes);
    const md = generateGraphQLReport(diff, classified);

    expect(md).toContain('Contract Guard Report (GraphQL)');
    expect(md).toContain('BREAKING CHANGES');
    expect(md).not.toContain('WARNINGS'); // no warnings in this change
  });

  it('hides SAFE section when includeSafeChanges=false', () => {
    const addTypeSchema = `
      type User { id: ID! name: String! }
      type Product { id: ID! name: String! }
      type Query { dummy: String }
    `;
    const oldSchema = parseGraphQLSDL('type User { id: ID! name: String! } type Query { dummy: String }');
    const newSchema = parseGraphQLSDL(addTypeSchema);
    const diff = diffGraphQL(oldSchema, newSchema);
    const classified = classifyGraphQLChanges(diff.changes);
    const md = generateGraphQLReport(diff, classified, { includeSafeChanges: false });

    expect(md).not.toContain('SAFE CHANGES');
  });

  it('buildGraphQLReport sets hasBreakingChanges correctly', () => {
    const old = parseGraphQLSDL(BASE_SCHEMA);
    const next = parseGraphQLSDL(REMOVE_FIELD);
    const diff = diffGraphQL(old, next);
    const classified = classifyGraphQLChanges(diff.changes);
    const report = buildGraphQLReport(diff, classified);

    expect(report.hasBreakingChanges).toBe(true);
  });

  it('report marks breaking changes count in strict mode', () => {
    const old = parseGraphQLSDL(BASE_SCHEMA);
    const next = parseGraphQLSDL(REMOVE_FIELD);
    const diff = diffGraphQL(old, next);
    const classified = classifyGraphQLChanges(diff.changes);
    const report = buildGraphQLReport(diff, classified, { strict: true });

    expect(report.markdown).toContain('Strict mode');
  });
});

describe('GraphQL — real world fixtures', () => {
  it('loads old-schema.gql and new-schema.gql and finds breaking changes', () => {
    const old = loadGraphQLFromFile('fixtures/old-schema.gql');
    const next = loadGraphQLFromFile('fixtures/new-schema.gql');

    expect(old.types.size).toBeGreaterThan(0);
    expect(next.types.size).toBeGreaterThan(0);

    const diff = diffGraphQL(old, next);
    const classified = classifyGraphQLChanges(diff.changes);

    // We expect multiple breaking changes
    const breaking = classified.filter(c => c.severity === Severity.BREAKING);
    expect(breaking.length).toBeGreaterThan(0);

    // Report should include all sections
    const md = generateGraphQLReport(diff, classified);
    expect(md).toContain('BREAKING CHANGES');
    expect(md).toContain('WARNINGS');
    expect(md).toContain('GraphQL');
  });
});
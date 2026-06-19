import { describe, it, expect } from 'vitest';
import { normalizeSpec } from '../src/parser';
import { diffSpecs } from '../src/diff';
import { classifyChanges, Severity } from '../src/rules';
import { buildReport, generateMarkdownReport } from '../src/report';

const OLD_API = {
  openapi: '3.0.0',
  info: { title: 'Test', version: '1.0.0' },
  paths: {
    '/users': {
      get: {
        responses: { '200': { description: 'OK' } }
      },
      post: {
        parameters: [
          { name: 'name', in: 'query', schema: { type: 'string' } }
        ],
        responses: { '201': { description: 'Created' } }
      }
    }
  }
};

describe('contract-guard MVP — reglas obligatorias', () => {
  it('✓ endpoint agregado (SAFE)', () => {
    const newSpec = {
      ...OLD_API,
      paths: {
        ...OLD_API.paths,
        '/orders': { get: { responses: { '200': { description: 'OK' } } } }
      }
    };
    const diff = diffSpecs(normalizeSpec(OLD_API), normalizeSpec(newSpec));
    expect(diff.changes.some(c => c.kind === 'endpoint-added' && c.path === '/orders')).toBe(true);

    const classified = classifyChanges(diff.changes);
    expect(classified.some(c => c.kind === 'endpoint-added' && c.severity === Severity.SAFE)).toBe(true);
  });

  it('✓ endpoint eliminado (BREAKING)', () => {
    const newSpec: any = {
      ...OLD_API,
      paths: {
        '/users': { get: OLD_API.paths['/users'].get }
      }
    };
    const diff = diffSpecs(normalizeSpec(OLD_API), normalizeSpec(newSpec));
    expect(diff.changes.some(c => c.kind === 'endpoint-removed')).toBe(true);

    const classified = classifyChanges(diff.changes);
    expect(classified.some(c => c.kind === 'endpoint-removed' && c.severity === Severity.BREAKING)).toBe(true);
  });

  it('✓ parámetro agregado opcional (WARNING)', () => {
    const oldSpec: any = { ...OLD_API };
    const newSpec: any = {
      ...OLD_API,
      paths: {
        '/users': {
          get: {
            parameters: [
              { name: 'page', in: 'query', required: false, schema: { type: 'integer' } }
            ],
            responses: { '200': { description: 'OK' } }
          },
          post: OLD_API.paths['/users'].post
        }
      }
    };
    const diff = diffSpecs(normalizeSpec(oldSpec), normalizeSpec(newSpec));
    const added = diff.changes.find(c => c.kind === 'parameter-optional-added');
    expect(added).toBeDefined();
    expect(added?.parameter).toBe('page');
    expect(added?.path).toBe('/users');

    const classified = classifyChanges(diff.changes);
    expect(classified.find(c => c.kind === 'parameter-optional-added')?.severity).toBe(Severity.WARNING);
  });

  it('✓ parámetro obligatorio agregado (BREAKING)', () => {
    const oldSpec: any = { ...OLD_API };
    const newSpec: any = {
      ...OLD_API,
      paths: {
        '/users': {
          get: {
            parameters: [
              { name: 'role', in: 'query', required: true, schema: { type: 'string' } }
            ],
            responses: { '200': { description: 'OK' } }
          },
          post: OLD_API.paths['/users'].post
        }
      }
    };
    const diff = diffSpecs(normalizeSpec(oldSpec), normalizeSpec(newSpec));
    expect(diff.changes.some(c => c.kind === 'parameter-required-added' && c.parameter === 'role')).toBe(true);

    const classified = classifyChanges(diff.changes);
    expect(classified.find(c => c.kind === 'parameter-required-added')?.severity).toBe(Severity.BREAKING);
  });

  it('✓ cambio de tipo de parámetro (BREAKING)', () => {
    const oldSpec: any = { ...OLD_API };
    const newSpec: any = {
      ...OLD_API,
      paths: {
        '/users': {
          get: OLD_API.paths['/users'].get,
          post: {
            parameters: [
              { name: 'name', in: 'query', schema: { type: 'integer' } }
            ],
            responses: { '201': { description: 'Created' } }
          }
        }
      }
    };
    const diff = diffSpecs(normalizeSpec(oldSpec), normalizeSpec(newSpec));
    const changed = diff.changes.find(c => c.kind === 'parameter-type-changed' && c.parameter === 'name');
    expect(changed).toBeDefined();

    const classified = classifyChanges(diff.changes);
    expect(classified.find(c => c.kind === 'parameter-type-changed')?.severity).toBe(Severity.BREAKING);
  });

  it('✓ respuesta eliminada (BREAKING)', () => {
    const oldApi = {
      openapi: '3.0.0',
      info: { title: 'Test', version: '1.0.0' },
      paths: {
        '/users': {
          get: {
            responses: {
              '200': { description: 'OK' },
              '404': { description: 'Not Found' }
            }
          }
        }
      }
    };
    const newApi = {
      ...oldApi,
      paths: {
        '/users': {
          get: {
            responses: {
              '200': { description: 'OK' }
            }
          }
        }
      }
    };
    const diff = diffSpecs(normalizeSpec(oldApi), normalizeSpec(newApi));
    expect(diff.changes.some(c => c.kind === 'response-removed')).toBe(true);

    const classified = classifyChanges(diff.changes);
    expect(classified.find(c => c.kind === 'response-removed')?.severity).toBe(Severity.BREAKING);
  });
});

describe('report generation', () => {
  it('renderiza secciones en el orden esperado (BREAKING > WARNINGS > SAFE)', () => {
    // Construct a fixture with all three severities:
    // /a removed (BREAKING) + /b removed (BREAKING) + lang optional param added (WARNING) + /c added (SAFE)
    const oldApi = {
      openapi: '3.0.0',
      info: { title: 'A', version: '1.0.0' },
      paths: {
        '/a': { get: { responses: { '200': { description: 'OK' } } } },
        '/b': { get: { responses: { '200': { description: 'OK' } } } }
      }
    };
    const newSpec: any = {
      ...oldApi,
      paths: {
        '/a': {
          get: {
            parameters: [
              { name: 'lang', in: 'query', required: false, schema: { type: 'string' } }
            ],
            responses: { '200': { description: 'OK' } }
          }
        },
        '/c': { get: { responses: { '200': { description: 'OK' } } } }
      }
    };
    const diff = diffSpecs(normalizeSpec(oldApi), normalizeSpec(newSpec));
    const classified = classifyChanges(diff.changes);
    const md = generateMarkdownReport(diff, classified);

    const idxBreaking = md.indexOf('BREAKING CHANGES');
    const idxWarning = md.indexOf('WARNINGS');
    const idxSafe = md.indexOf('SAFE CHANGES');
    expect(idxBreaking).toBeGreaterThanOrEqual(0);
    expect(idxWarning).toBeGreaterThan(idxBreaking);
    expect(idxSafe).toBeGreaterThan(idxWarning);
  });

  it('buildReport detecta hasBreakingChanges correctamente', () => {
    const oldApi = {
      openapi: '3.0.0',
      info: { title: 'A', version: '1.0.0' },
      paths: {
        '/users': { get: { responses: { '200': { description: 'OK' } } } }
      }
    };
    const newApi = {
      ...oldApi,
      paths: {}
    };
    const diff = diffSpecs(normalizeSpec(oldApi), normalizeSpec(newApi));
    const classified = classifyChanges(diff.changes);
    const report = buildReport(diff, classified);
    expect(report.hasBreakingChanges).toBe(true);
  });

  it('oculta SAFE CHANGES cuando includeSafeChanges es false', () => {
    const oldApi = {
      openapi: '3.0.0',
      info: { title: 'A', version: '1.0.0' },
      paths: {}
    };
    const newApi = {
      ...oldApi,
      paths: {
        '/new': { get: { responses: { '200': { description: 'OK' } } } }
      }
    };
    const diff = diffSpecs(normalizeSpec(oldApi), normalizeSpec(newApi));
    const classified = classifyChanges(diff.changes);
    const md = generateMarkdownReport(diff, classified, { includeSafeChanges: false });
    expect(md).not.toContain('SAFE CHANGES');
  });
});

describe('parser normalización', () => {
  it('rechaza spec no-OpenAPI 3.x', () => {
    expect(() => normalizeSpec({ openapi: '2.0' })).toThrow();
    expect(() => normalizeSpec({ not: 'openapi' })).toThrow();
  });

  it('extrae endpoints correctamente', () => {
    const oldApi = {
      openapi: '3.0.0',
      info: { title: 'A', version: '1.0.0' },
      paths: {
        '/a': { get: { responses: { '200': { description: 'OK' } } } },
        '/b': {
          post: { responses: { '201': { description: 'Created' } } },
          delete: { responses: { '204': { description: 'No content' } } }
        }
      }
    };
    const spec = normalizeSpec(oldApi);
    expect(spec.endpoints.length).toBe(3);
    expect(spec.endpoints.map(e => `${e.method.toUpperCase()} ${e.path}`).sort()).toEqual([
      'DELETE /b',
      'GET /a',
      'POST /b'
    ]);
  });
});

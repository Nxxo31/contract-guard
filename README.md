# contract-guard

[![npm version](https://img.shields.io/npm/v/contract-guard)](https://www.npmjs.com/package/contract-guard)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![CI](https://github.com/Nxxo31/contract-guard/actions/workflows/ci.yml/badge.svg)](https://github.com/Nxxo31/contract-guard/actions)
[![Node.js 18+](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen)](package.json)

> Los equipos rompen integraciones entre microservicios o con clientes externos porque cambian un campo en su API sin darse cuenta de que es un "breaking change". **contract-guard** lo detecta antes de que llegue a producción.

Detecta cambios incompatibles entre dos versiones de una especificación OpenAPI 3.x y emite un reporte Markdown categorizado por severidad. Sin LLMs, sin servicios externos, sin dependencias de pago.

## Estado

**v1.0.0 — MVP publicado.** Soporte OpenAPI 3.x, 8 reglas de detección (endpoints, parámetros, respuestas, tipos), reporte Markdown, modo `--strict` para CI.

## Instalación

```bash
# Paquete npm global
npm install -g contract-guard
contract-guard compare old.json new.json

# Con npx (sin instalar)
npx contract-guard compare old.json new.json

# Como dependencia de proyecto
npm install --save-dev contract-guard
```

## Uso rápido

```bash
# Comparar dos specs y mostrar reporte en stdout
contract-guard compare old.json new.json

# Escribir reporte a archivo
contract-guard compare old.json new.json -o report.md

# Modo estricto para CI (exit 1 si hay breaking changes)
contract-guard compare old.json new.json --strict

# Ocultar SAFE CHANGES
contract-guard compare old.json new.json --no-safe
```

## Reglas detectadas (v1.0.0)

### 🔴 Breaking changes
| Kind | Descripción |
|------|-------------|
| `endpoint-removed` | Operación eliminada |
| `parameter-removed` | Parámetro eliminado |
| `parameter-required-added` | Nuevo parámetro obligatorio |
| `parameter-type-changed` | Cambio de tipo en parámetro existente |
| `response-removed` | Código de respuesta eliminado |

### 🟡 Warnings
| Kind | Descripción |
|------|-------------|
| `parameter-optional-added` | Nuevo parámetro opcional |

### 🟢 Safe
| Kind | Descripción |
|------|-------------|
| `endpoint-added` | Nueva operación agregada |
| `response-added` | Nuevo código de respuesta |

## Salida ejemplo

```markdown
## 🔴 BREAKING CHANGES

- Parámetro obligatorio nuevo: query:role
- Respuesta 404 eliminada en GET /users/{id}
- Endpoint eliminado: DELETE /users/{id}
- Tipo de parámetro limit cambió: integer -> string

## 🟡 WARNINGS

- Parámetro opcional nuevo: query:offset

## 🟢 SAFE CHANGES

- Endpoint agregado: GET /orders
```

## Documentación

| Documento | Descripción |
|-----------|-------------|
| [PROJECT.md](PROJECT.md) | Especificación del producto |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Arquitectura y diagramas de flujo |
| [docs/TECHNICAL_DESIGN.md](docs/TECHNICAL_DESIGN.md) | Diseño técnico detallado, tipos TypeScript |
| [docs/OPERATIONS.md](docs/OPERATIONS.md) | Integración CI/CD, patrones de uso |
| [docs/EXAMPLES.md](docs/EXAMPLES.md) | Ejemplos con comandos reales |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Guía para contribuir |

## Scripts de desarrollo

```bash
npm test               # suite completa (vitest, 11 tests)
npm run typecheck      # tsc --noEmit
npm run lint           # eslint en src/
npm run build          # compilación a dist/
npm run dev            # tsc --watch (desarrollo)
```

## Estructura del proyecto

```
contract-guard/
├── src/
│   ├── parser.ts       normalización OpenAPI 3.x → AST tipado
│   ├── diff.ts         comparación semántica entre specs
│   ├── rules.ts        clasificación breaking/warning/safe
│   ├── report.ts       generación de reportes Markdown
│   └── cli.ts          Commander CLI
├── tests/
│   └── contract-guard.test.ts   11 tests unitarios
├── fixtures/
│   ├── old-api.json    spec base de prueba
│   └── new-api.json    spec modificada con casos variados
├── docs/
│   ├── ARCHITECTURE.md      arquitectura y diagramas Mermaid
│   ├── TECHNICAL_DESIGN.md diseño técnico e interfaces
│   ├── OPERATIONS.md       integración CI/CD y operaciones
│   └── EXAMPLES.md          ejemplos con comandos reales
├── .github/workflows/ci.yml  GitHub Actions CI
├── package.json
└── LICENSE
```

## License

MIT © 2026 Sebastian Zapata — ver [LICENSE](LICENSE).
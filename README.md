# contract-guard

[![npm version](https://img.shields.io/npm/v/contract-guard)](https://www.npmjs.com/package/contract-guard)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![CI](https://github.com/Nxxo31/contract-guard/actions/workflows/ci.yml/badge.svg)](https://github.com/Nxxo31/contract-guard/actions)

> Los equipos rompen integraciones entre microservicios o con clientes externos porque cambian un campo en su API sin darse cuenta de que es un "breaking change". **contract-guard** lo detecta antes de que llegue a producción.

Detecta cambios incompatibles entre dos versiones de una especificación OpenAPI 3.x y emite un reporte Markdown. Sin LLMs, sin servicios externos, sin dependencias de pago.

Para detalles del producto consulta [PROJECT.md](PROJECT.md).

## Estado

**v1.0.0 — MVP publicado.**
- Soporte OpenAPI 3.x.
- 10 reglas de detección (endpoints, parámetros, respuestas, tipos).
- Reporte Markdown categorizado (breaking / warnings / safe).
- Modo `--strict` que falla el build cuando hay breaking changes.

## Instalación

```bash
# Como paquete npm global
npm install -g contract-guard
contract-guard compare old.json new.json

# Con npx (sin instalar)
npx contract-guard compare old.json new.json

# Como dependencia de proyecto
npm install --save-dev contract-guard
```

## Uso

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

## Tests

```bash
npm test               # suite completa (vitest)
npm run typecheck      # solo type-check
npm run lint           # eslint en src/
npm run build          # compilación a dist/
```

## Estructura

```
src/
├── parser.ts     # normalización OpenAPI 3.x → AST tipado
├── diff.ts       # comparación semántica entre specs
├── rules.ts      # clasificación breaking/warning/safe
├── report.ts      # generación de reportes Markdown
└── cli.ts        # Commander CLI

tests/
└── contract-guard.test.ts   # tests unitarios

fixtures/
├── old-api.json  # spec base
└── new-api.json  # spec con cambios variados
```

## License

MIT © Sebastian Velasco— ver [LICENSE](LICENSE).

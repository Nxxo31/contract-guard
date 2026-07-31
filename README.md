# contract-guard

[![npm version](https://img.shields.io/npm/v/contract-guard)](https://www.npmjs.com/package/contract-guard)
[![CI](https://github.com/Nxxo31/contract-guard/actions/workflows/ci.yml/badge.svg)](https://github.com/Nxxo31/contract-guard/actions/workflows/ci.yml)
[![Node.js 18+](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen?logo=node.js&logoColor=white)](package.json)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.4+-3178C6?logo=typescript&logoColor=white)](tsconfig.json)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

> Los equipos rompen integraciones entre microservicios o con clientes externos porque cambian un campo en su API sin darse cuenta de que es un "breaking change". **contract-guard** lo detecta antes de que llegue a producción.

Detecta cambios incompatibles entre dos versiones de una especificación de API — **OpenAPI 3.x**, **GraphQL SDL**, o **gRPC proto3** — y emite un reporte Markdown categorizado por severidad. Sin LLMs, sin servicios externos, sin dependencias de pago.

---

## Formatos soportados

| Formato | Extensiones | Versiones | Reglas de detección |
|---------|-------------|-----------|---------------------|
| **OpenAPI** | `.json`, `.yaml` | 3.x | 8 reglas (endpoints, parámetros, respuestas, tipos) |
| **GraphQL** | `.graphql`, `.gql` | SDL | Types, fields, arguments, enums, interfaces |
| **gRPC** | `.proto` | proto3 | Services, methods, message fields, enums |

El formato se autodetecta por extensión de archivo. Usa `--format` para forzar un parser específico.

---

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

**Requisitos:** Node.js 18+

---

## Uso rápido

### OpenAPI

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

### GraphQL

```bash
# Comparar dos schemas SDL
contract-guard compare old.graphql new.graphql

# Forzar formato GraphQL (si la extensión no es estándar)
contract-guard compare schema-v1.txt schema-v2.txt --format graphql

# Modo estricto para CI
contract-guard compare old.graphql new.graphql --strict -o breaking-report.md
```

### gRPC

```bash
# Comparar dos archivos proto
contract-guard compare old.proto new.proto

# Reporte a archivo + modo estricto
contract-guard compare v1.proto v2.proto --strict -o proto-changes.md
```

### Reglas personalizadas

```bash
# Usar archivo de reglas custom para clasificación de severidad
contract-guard compare old.json new.json --rules my-rules.json
```

---

## Reglas detectadas (v2.0.0)

### 🔴 Breaking changes

| Kind | OpenAPI | GraphQL | gRPC |
|------|---------|---------|------|
| `endpoint-removed` | ✅ | — | — |
| `parameter-removed` | ✅ | — | — |
| `parameter-required-added` | ✅ | — | — |
| `parameter-type-changed` | ✅ | — | — |
| `response-removed` | ✅ | — | — |
| `type-removed` | — | ✅ | — |
| `field-removed` | — | ✅ | ✅ |
| `method-removed` | — | — | ✅ |
| `service-removed` | — | — | ✅ |

### 🟡 Warnings

| Kind | Formato |
|------|---------|
| `parameter-optional-added` | OpenAPI |
| `field-optional-added` | GraphQL, gRPC |
| `enum-value-removed` | GraphQL, gRPC |

### 🟢 Safe

| Kind | Formato |
|------|---------|
| `endpoint-added` | OpenAPI |
| `response-added` | OpenAPI |
| `type-added` | GraphQL |
| `field-added` | GraphQL, gRPC |
| `method-added` | gRPC |

---

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

---

## Integración CI/CD

```yaml
# .github/workflows/contract-check.yml
name: Contract Check
on: [pull_request]
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: actions/checkout@v4
        with:
          ref: ${{ github.event.pull_request.base.sha }}
          path: base
      - run: npx contract-guard compare base/api.json api.json --strict
```

El flag `--strict` hace que el proceso termine con exit code 1 si se detectan breaking changes, fallando el pipeline.

---

## Documentación

| Documento | Descripción |
|-----------|-------------|
| [PROJECT.md](PROJECT.md) | Especificación del producto |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Arquitectura y diagramas de flujo |
| [docs/TECHNICAL_DESIGN.md](docs/TECHNICAL_DESIGN.md) | Diseño técnico detallado, tipos TypeScript |
| [docs/OPERATIONS.md](docs/OPERATIONS.md) | Integración CI/CD, patrones de uso |
| [docs/EXAMPLES.md](docs/EXAMPLES.md) | Ejemplos con comandos reales |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Guía para contribuir |

---

## Scripts de desarrollo

```bash
npm test               # suite completa (vitest)
npm run typecheck      # tsc --noEmit
npm run lint           # eslint en src/
npm run build          # compilación a dist/
npm run dev            # tsc --watch (desarrollo)
```

---

## Estructura del proyecto

```
contract-guard/
├── src/
│   ├── parser.ts           normalización OpenAPI 3.x → AST tipado
│   ├── diff.ts             comparación semántica entre specs
│   ├── rules.ts            clasificación breaking/warning/safe (OpenAPI)
│   ├── rules-config.ts     reglas personalizadas (JSON/YAML)
│   ├── report.ts           generación de reportes Markdown
│   ├── cli.ts              Commander CLI
│   └── parsers/
│       ├── graphql.ts       parser GraphQL SDL
│       ├── graphql-diff.ts  diff engine GraphQL
│       ├── graphql-rules.ts reglas GraphQL
│       ├── grpc.ts          parser proto3
│       ├── grpc-diff.ts     diff engine gRPC
│       └── grpc-rules.ts    reglas gRPC
├── tests/
├── fixtures/
├── docs/
├── .github/workflows/ci.yml
├── package.json
└── LICENSE
```

---

## Estado

**v2.0.0 — Multi-formato publicado.** Soporte OpenAPI 3.x, GraphQL SDL, y gRPC proto3, con autodetección de formato, reglas personalizadas, y modo `--strict` para CI.

---

## License

This project is dual-licensed under:

| License | File | Use case |
|---------|------|----------|
| **MIT** | [LICENSE-MIT](LICENSE-MIT) | Permissive — integrate in any project |
| **GPL-3.0** | [LICENSE-GPL](LICENSE-GPL) | Copyleft — ensures derivative works remain free |

Sumario disponible en [LICENSE](LICENSE).

Copyright © 2026 Sebastian Zapata.

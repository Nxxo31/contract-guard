# contract-guard

> Los equipos rompen integraciones entre microservicios o con clientes externos porque cambian un campo en su API (OpenAPI/GraphQL/gRPC) sin darse cuenta de que es un "breaking change".

**contract-guard** detecta cambios incompatibles entre dos versiones de una especificación OpenAPI 3.x y emite un reporte Markdown. Sin LLMs, sin servicios externos, sin dependencias de pago.

Para detalles del producto consulta [PROJECT.md](PROJECT.md).

## Estado

**MVP V1 implementado.**
- Soporte OpenAPI 3.x.
- 10 reglas de detección (endpoint/métodos/parámetros/respuestas/tipos).
- Reporte Markdown.
- Modo `--strict` que falla el build cuando hay breaking changes.
- 11 tests unitarios pasando.

## Instalación

```bash
npm install
npm run build
```

## Uso

```bash
# Comparar dos specs OpenAPI JSON y mostrar reporte en stdout
node dist/cli.js compare old.json new.json

# Escribir reporte a archivo
node dist/cli.js compare old.json new.json -o report.md

# Modo estricto para CI (exit 1 si hay breaking changes)
node dist/cli.js compare old.json new.json --strict

# Ocultar SAFE CHANGES
node dist/cli.js compare old.json new.json --no-safe
```

## Reglas detectadas (MVP V1)

### 🔴 Breaking changes
- `endpoint-removed` — operación eliminada
- `parameter-removed` — parámetro eliminado
- `parameter-required-added` — nuevo parámetro obligatorio
- `parameter-type-changed` — cambio de tipo en parámetro existente
- `response-removed` — código de respuesta eliminado

### 🟡 Warnings
- `parameter-optional-added` — nuevo parámetro opcional

### 🟢 Safe
- `endpoint-added` — nueva operación agregada
- `response-added` — nuevo código de respuesta

## Tests

```bash
npm test               # suite completa (vitest, 11 tests)
npm run typecheck      # solo type-check
npm run lint           # eslint en src/
npm run build          # compilación a dist/
```

## Estructura

```
src/
├── parser.ts     # normalización OpenAPI 3.x → AST
├── diff.ts       # diff entre dos ASTs
├── rules.ts      # clasificación breaking/warning/safe
├── report.ts     # generación de Markdown
└── cli.ts        # Commander CLI

tests/
└── contract-guard.test.ts   # 11 tests unitarios

fixtures/
├── old-api.json  # spec base
└── new-api.json  # spec modificada con breaking + warning + safe
```

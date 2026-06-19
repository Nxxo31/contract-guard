# Architecture — contract-guard MVP V1

## Overview

`contract-guard` es una CLI stateless que lee dos archivos JSON (especificación OpenAPI 3.x antigua y nueva), los normaliza a un AST interno, compara los ASTs con un motor de reglas declarativo, y emite un reporte Markdown clasificado por severidad.

```
openapi-old.json  ─┐
                   ├──► parser.ts ─► NormalizedSpec
openapi-new.json  ─┘                              │
                                                 ▼
                                           diff.ts
                                                 │
                                                 ▼
                                          Change[]
                                                 │
                                                 ▼
                                           rules.ts
                                                 │
                                                 ▼
                                      ClassifiedChange[]
                                                 │
                                                 ▼
                                           report.ts
                                                 │
                                                 ▼
                                          Markdown Report
```

## Source modules

### `src/parser.ts`

**Responsabilidad:** Leer y validar specs OpenAPI 3.x, normalizar a estructuras tipadas.

**Entrada:** JSON arbitrario (fs.readFileSync).

**Salida:** `NormalizedSpec` con un array de `NormalizedOperation`.

**Estructuras NormalizedSpec:**
- `title` / `version` / `openapiVersion` extraídos de `info` y `openapi`
- `endpoints[]` — una entrada por cada `(method, path)` en `paths`
- Cada `NormalizedOperation` contiene: method, path, parameters, responses, requestBody

**Notas de implementación:**
- Soporta solo OpenAPI 3.x (`openapi` empieza con `3.`)
- `$ref` en parámetros se procesa como parámetro vacío (MVP — resolución completa en V2)
- `normalizeSchema` es recursiva para `properties` y `items`

### `src/diff.ts`

**Responsabilidad:** Comparar dos `NormalizedSpec` y enumerar todos los cambios.

**Estrategia:**
1. Construir un mapa `opsByEndpoint` → `Map<"GET /users", NormalizedOperation[]>` para cada spec.
2. Recorrer los keys de la spec antigua:
   - Si el key no existe en la nueva → `endpoint-removed`.
   - Si existe → llamar `compareOperations(oldOp, newOp)`.
3. Recorrer los keys de la spec nueva que no existen en la antigua → `endpoint-added`.
4. `compareOperations` delega a `compareParameters` y `compareResponses`.

**Cambios detectados:**
| Kind | Clasificado como |
|------|-----------------|
| `endpoint-removed` | 🔴 BREAKING |
| `parameter-removed` | 🔴 BREAKING |
| `parameter-required-added` | 🔴 BREAKING |
| `parameter-type-changed` | 🔴 BREAKING |
| `response-removed` | 🔴 BREAKING |
| `parameter-optional-added` | 🟡 WARNING |
| `endpoint-added` | 🟢 SAFE |
| `response-added` | 🟡 WARNING |

### `src/rules.ts`

**Responsabilidad:** Clasificar cambios por severidad e imponer reglas configurables.

**Archivo:**
- `Severity` enum: `BREAKING | WARNING | SAFE`
- `classifyChanges(changes[])` — mapea cada `ChangeKind` a `Severity`
- `countBySeverity(changes[])` — cuenta cambios por bucket
- `applyRules(changes[], options)` — stub para reglas configurables (ej. `optionalParametersAreSafe`)
- `RuleOptions` — interfaz para configuración de reglas (extensible en V2)

**Extensibilidad:** Añadir nuevas reglas = agregar el `ChangeKind` al Set correspondiente (BREAKING/WARNING/SAFE).

### `src/report.ts`

**Responsabilidad:** Generar el reporte estructurado y su representación.

**`buildReport(diff, classified, options)` → `Report`:**
```ts
interface Report {
  markdown: string;       // Cuerpo del reporte en Markdown
  hasBreakingChanges: boolean;
  hasWarnings: boolean;
  summary: string;        // "N breaking, N warning(s), N safe"
}
```

**Orden de secciones en el Markdown:** BREAKING CHANGES → WARNINGS → SAFE CHANGES (vacías se omiten).

**`--no-safe` flag:** filtra la sección SAFE CHANGES del output.

### `src/cli.ts`

**Responsabilidad:** Interfaz de usuario (Commander CLI).

**Comandos:**
```
contract-guard compare <old> <new> [-o report.md] [--strict] [--no-safe]
```

**Exit codes:**
- `0` — ejecución exitosa (incluso con breaking changes, salvo `--strict`)
- `1` — ejecución exitosa + `--strict` + se detectaron breaking changes
- `2` — error (spec no válida, archivo no encontrado, parse error)

**Flujo:**
1. `loadSpecFromFile(oldPath)` + `loadSpecFromFile(newPath)`
2. `normalizeSpec()` × 2
3. `diffSpecs()` → `Change[]`
4. `classifyChanges()` → `ClassifiedChange[]`
5. `buildReport()` → `Report`
6. stdout o archivo según `-o`
7. `process.exit(1)` si `--strict` && `hasBreakingChanges`

## Testing

- **Vitest** como test runner.
- 11 tests cubriendo las 6 reglas obligatorias del MVP + report + parser.
- **Fixtures reales** en `fixtures/old-api.json` y `fixtures/new-api.json`.

## Roadmap V2

- GraphQL SDL y gRPC/protobuf
- Reglas configurables por organización (archivo `contract-guard.config.ts`)
- Comentarios automáticos en PR (GitHub API)
- SARIF output para integraciones de security scanning
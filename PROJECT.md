# PROJECT.md — Contract Guard

> **Estado:** Activo | **Versión:** 1.0.0 | **Última actualización:** 2026-07-31

---

## 🎯 Objetivo Principal

Detectar breaking changes en specs de APIs (OpenAPI 3.x, GraphQL SDL, gRPC proto3) antes de que lleguen a producción, clasificándolos por severidad y fallando el build en CI cuando son críticos.

## 🎯 Objetivos Secundarios

1. Soportar múltiples formatos de spec (OpenAPI, GraphQL, gRPC) con autodetección por extensión
2. Generar reportes legibles en Markdown con severidad por cambio (breaking / warning / safe)
3. Integrarse en pipelines CI con modo `--strict` que falla el build ante breaking changes
4. Permitir reglas configurables para adaptar la clasificación de severidad por equipo

---

## 📐 Arquitectura

### Stack Tecnológico

| Capa | Tecnología | Versión | Propósito |
|------|-----------|---------|-----------|
| Lenguaje | TypeScript | 5.x | Tipado estático, ergonomía CLI |
| Framework CLI | Commander | 5.x | Parsing de argumentos y subcomandos |
| Testing | Vitest | 1.x | Tests unitarios (11 tests en V1) |
| Build | tsc | 5.x | Compilación a JS distribuible |
| Análisis | Local (sin servicios externos) | — | 100% offline, sin dependencias de red |

### Diagrama de Arquitectura

```
┌─────────────────────────────────────────────────────┐
│                    Capa CLIENTE                      │
│              CLI (commander) — `compare`              │
├─────────────────────────────────────────────────────┤
│                    Capa LÓGICA                       │
│  [parser.ts] → [diff.ts] → [rules.ts] → [report.ts]  │
│  parsers/{openapi,graphql,grpc}.ts (autodetección)   │
├─────────────────────────────────────────────────────┤
│                   Capa DATOS                          │
│         File System (specs antes/después)            │
└─────────────────────────────────────────────────────┘
```

### Flujo de Datos

```
[A.spec] + [B.spec] → [Autodetección formato] → [Parser] → [AST normalizado]
  → [Diff semántico] → [Rules engine (breaking/warning/safe)] → [Reporter Markdown] → [stdout/archivo]
  → (si --strict && hay breaking) → exit code ≠ 0
```

---

## 📊 Matriz de Trazabilidad

| Req ID | Descripción | Componente | Estado | Verificación |
|--------|-------------|------------|--------|--------------|
| R-01 | Comparar dos versiones de OpenAPI 3.x | src/parser.ts, src/diff.ts | ✅ | `vitest` — suite OpenAPI diff |
| R-02 | Clasificar cambios en breaking/warning/safe | src/rules.ts | ✅ | Tests de reglas core |
| R-03 | Reporte Markdown con severidad | src/report.ts | ✅ | Test de reporter |
| R-04 | Modo `--strict` que falla CI en breaking | src/cli.ts | ✅ | Test CLI con exit codes |
| R-05 | Detección: endpoints eliminados, params obligatorios nuevos, cambios de tipo, respuestas eliminadas | src/diff.ts | ✅ | Casos de test individuales |
| R-06 | Soporte GraphQL SDL | src/parsers/graphql.ts, graphql-diff.ts, graphql-rules.ts | ✅ | V1 extendido |
| R-07 | Soporte gRPC proto3 | src/parsers/grpc.ts, grpc-diff.ts, grpc-rules.ts | ✅ | V1 extendido |
| R-08 | Reglas configurables | src/rules.ts | ⏳ | Pendiente — Issue #1 (V3 AsyncAPI) |

---

## 🏗️ Marcos Conceptuales

### Contract Testing
El proyecto implementó contract testing del lado del proveedor: compara la versión anterior del contrato (la que los consumidores ya integraron) con la nueva versión propuesta, y verifica que todo cambio sea backward-compatible. A diferencia de tests de runtime (Pact), hace análisis estático sobre la spec.

### Breaking Change Detection semántica
No compara texto — compara la estructura semántica del AST: un campo que cambia de `required: false` a `required: true` es un breaking change aunque el texto cambie poco. Esto requiere un parser por formato que normalice a un modelo común antes del diff.

---

## ✅ Justificación de Decisiones Técnicas

| Decisión | Opción elegida | Alternativas evaluadas | Razón |
|----------|---------------|----------------------|-------|
| Lenguaje | TypeScript | Python (openapi-diff), Go (oasdiff) | Ecosistema TS ya familiar; commander es minimal y suficiente para una CLI de análisis |
| Framework CLI | Commander | yargs, oclif | Commander es el más ligero y soporta subcomandos sin overhead |
| Testing | Vitest | Jest | Vitest usa el mismo runtime de Vite, arranque instantáneo, ESM nativo |
| Cobertura multi-formato | Un parser por formato + AST común | Un único parser agnóstico | GraphQL y gRPC tienen semánticas distintas; normalizar a un AST común permite reusar el diff/rules engine |

---

## 📦 Estado de Implementación

### Fases Completadas

| Fase | Descripción | Commit | Verificación |
|------|-------------|--------|--------------|
| V1 | OpenAPI + reglas core + CLI + tests (MVP) | 814a745 | `vitest` 11 tests verde; `tsc` sin errores |
| V1.1 | GraphQL + gRPC + parsers extendidos | 33619fa | Tests por parser; build limpio |

### Próximos Pasos (Backlog)

| ID | Descripción | Prioridad | Issue |
|----|-------------|-----------|-------|
| B-1 | Reglas configurables (YAML/JSON) | Alta | #1 |
| B-2 | V3 — AsyncAPI support | Media | #1 |
| B-3 | Comentarios automáticos en PR (GitHub Action) | Media | — |
| B-4 | Detección basada en tráfico real (SaaS + dashboard de impacto por consumidor) | Baja | — |

---

## ⚠️ Limitaciones Conocidas

1. El diff es estático — no detecta breaking changes que solo se manifiestan en runtime (ej. contrato abierto vs. datos reales)
2. No hay persistencia entre runs — cada invocación compara dos archivos sin memoria histórica
3. Las reglas son fijas en código hasta que se implemente la configuración externa (B-1)

---

## 🔐 Seguridad

- 100% local: no envía specs a servicios externos (importante para APIs propietarias)
- Modo `--strict` protege la rama principal fallando el build antes del merge

---

## 📚 Referencias

- [OpenAPI Specification 3.x](https://spec.openapis.org/oas/v3.1.0)
- [GraphQL SDL](https://spec.graphql.org/)
- [Protocol Buffers / gRPC proto3](https://protobuf.dev/programming-guides/proto3/)
- [oasdiff](https://github.com/Tufin/oasdiff) — referencia de comparación para OpenAPI

---

*Generado por SophIA — Sebastian Velasco's autonomous operating system*

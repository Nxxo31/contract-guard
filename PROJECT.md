# Contract Guard

## Estado y Sprint
- **Estado**: MVP V1 completado y push a GitHub
- **Sprint goal**: Comparador funcional de OpenAPI 3.x con detección de breaking changes

## Problema
Los equipos rompen integraciones entre microservicios o con clientes externos porque cambian un campo en su API (OpenAPI/GraphQL/gRPC) sin darse cuenta de que es un "breaking change". Las herramientas existentes (Buf) cubren solo protobuf.

## Mercado
Equipos de plataforma/backend en empresas con arquitecturas de microservicios, equipos que mantienen APIs públicas (fintech, SaaS B2B).

## Stack
- **Lenguaje:** TypeScript
- **Framework:** CLI con Commander
- **Testing:** Vitest (11 tests)
- **Análisis:** 100% local, sin servicios externos

## Requisitos funcionales (MVP V1 — completados)
- [x] Comparar dos versiones de OpenAPI 3.x y clasificar cambios: breaking, warning, safe
- [x] Detección de: endpoints eliminados, parámetros nuevos/obligatorios, cambios de tipo, respuestas eliminadas
- [x] Reporte legible en Markdown con severidad por cambio
- [x] Modo "strict" que falla el build en CI si hay breaking changes
- [x] CLI con comando `compare` y opciones --output, --strict

## Arquitectura
```
src/
  parser.ts   → Normalización de specs OpenAPI 3.x
  diff.ts     → Comparación semántica entre specs
  rules.ts    → Clasificación de severidad (breaking/warning/safe)
  report.ts   → Generación de reportes Markdown
  cli.ts      → Interfaz de línea de comandos (Commander)
```

## Roadmap
- **V1 (completado):** OpenAPI + reglas core + CLI + tests
- **V2:** GraphQL y gRPC, reglas configurables, comentarios automáticos en PR
- **V3:** Detección basada en tráfico real (SaaS), dashboard de impacto por consumidor

## Complejidad
Media

## Tiempo estimado
2-3 semanas (MVP V1 completado en 1 sesión)

## Impacto GitHub
8/10

## Valor empleabilidad
8/10

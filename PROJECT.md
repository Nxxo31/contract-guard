# Contract Guard

## Status & Sprint
- **Status**: Inicialización (sin implementación funcional)
- **Sprint goal**: Crear estructura base y formalizar el proyecto para desarrollo futuro

## Problema
Los equipos rompen integraciones entre microservicios o con clientes externos porque cambian un campo en su API (OpenAPI/GraphQL/gRPC) sin darse cuenta de que es un "breaking change". Las herramientas existentes (Buf) cubren solo protobuf.

## Mercado
Equipos de plataforma/backend en empresas con arquitecturas de microservicios, equipos que mantienen APIs públicas (fintech, SaaS B2B).

## Valor profesional
Demuestra parsing de especificaciones, diseño de reglas de compatibilidad semántica, integración con CI/CD y pensamiento de "contract-first development".

## Diferenciación
A diferencia de linters genéricos de OpenAPI, esta herramienta entiende semántica de compatibilidad (no solo sintaxis): detecta si un cambio rompe a consumidores reales basándose en uso histórico capturado de logs, no solo en la especificación estática.

## Modelo de negocio
CLI/Action de GitHub gratuita; versión Pro con detección basada en tráfico real (requiere conector a logs) y reportes de impacto por consumidor. **Sin tecnologías de pago en el stack**.

## Stack recomendado
- **Lenguaje:** TypeScript (parsers de OpenAPI/GraphQL maduros) con núcleo de reglas en Rust si se requiere rendimiento en repos grandes (opcional V3). Sin costo.
- **Framework:** CLI con Commander/oclif; acción de GitHub nativa. Sin costo.
- **Base de datos:** SQLite local para historial de versiones de contrato; Postgres en la versión SaaS. Sin costo en MVP.
- **APIs:** Parsers de OpenAPI 3.x, GraphQL SDL, protobuf (gRPC). Sin costo.
- **Infraestructura:** Distribución como GitHub Action y binario npm. Sin costo.
- **Testing:** Suite de "fixtures" con cientos de pares de specs (compatible/incompatible) como tests de regresión. Sin costo.
- **Seguridad:** No requiere credenciales; análisis 100% estático en el caso base.

## Requisitos funcionales
- Comparar dos versiones de una especificación (OpenAPI/GraphQL/proto) y clasificar cambios: breaking, no-breaking, ambiguo.
- Reglas configurables por organización (ej. "quitar un campo opcional no es breaking").
- Reporte legible en PR (comentario automático) con severidad por cambio.
- Modo "strict" que falla el build en CI si hay breaking changes sin aprobación explícita.
- Historial de versiones de contrato versionado junto al repo.

## Requisitos no funcionales
- Análisis de specs de hasta 5,000 endpoints en menos de 10 segundos.
- Cero falsos positivos en el set de reglas core (validado con fixtures).
- Operación 100% offline para el core gratuito (sin enviar datos a un servidor externo).

## Arquitectura
CLI que parsea ambas versiones de la especificación a un AST normalizado propio (independiente del formato origen), aplica un motor de reglas declarativo (similar a ESLint) sobre el diff del AST, y genera un reporte estructurado (JSON) consumido por el formateador de salida (terminal, comentario de PR, SARIF para integraciones de seguridad).

## MVP
Soporte solo OpenAPI 3.x, 10 reglas de breaking-change más comunes, salida en terminal y como GitHub Action.

## Roadmap
- **V1:** OpenAPI + reglas core + GitHub Action.
- **V2:** GraphQL y gRPC, reglas configurables, comentarios automáticos en PR.
- **V3:** Detección basada en tráfico real (SaaS), dashboard de impacto por consumidor.

## Complejidad
Media

## Tiempo estimado
2-3 semanas

## Impacto GitHub
8/10

## Valor empleabilidad
8/10

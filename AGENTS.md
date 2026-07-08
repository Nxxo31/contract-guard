# contract-guard — Contexto del agente

## Proyecto
Detector de breaking changes en specs OpenAPI 3.x para CI/CD y GitHub Actions.
GitHub: https://github.com/Nxxo31/contract-guard

## Stack
- Node.js + TypeScript 5
- CLI: commander
- Tests: Vitest
- Build: tsc → dist/
- Node mínimo: 18.0.0

## Comandos
- Build: `npm run build`
- Test: `npm test`
- Typecheck: `npx tsc --noEmit`
- Lint: `npm run lint`

## Reglas críticas
- tsc --noEmit antes de commit
- Cambios en parsing GraphQL → actualizar tests
- dist/ generado — no editar

## Loop de trabajo
1. `cat PROJECT.md` → verificar estado
2. Implementar → `npx tsc --noEmit && npm test`
3. Commit atómico en español → push

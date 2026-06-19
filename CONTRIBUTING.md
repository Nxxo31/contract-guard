# Contributing to contract-guard

Thank you for your interest in contributing!

## Development Setup

```bash
git clone https://github.com/Nxxo31/contract-guard.git
cd contract-guard
npm install
npm run build
```

## Workflow

1. Fork the repository and create a branch from `main`.
2. Name your branch using the type prefix: `feat/`, `fix/`, `docs/`, `chore/`.
3. Make your changes, following the existing code style.
4. Run the full validation suite before pushing:

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

5. Open a Pull Request with a clear description.

## Coding Standards

- **TypeScript strict mode** is enabled. All code must pass `tsc --noEmit`.
- **ESLint** rules apply to all files in `src/`.
- **Vitest** for unit tests. Aim for meaningful coverage of new logic.
- **Conventional Commits** for commit messages (`feat:`, `fix:`, `docs:`, `chore:`, etc.).
- **No external LLM calls** in the core library. Heuristics-only for the open-source version.

## What to Contribute

- New detection rules for OpenAPI 3.x compatibility.
- Support for other specification formats (GraphQL SDL, gRPC/protobuf — planned for V2).
- Additional output formatters (SARIF, JSON, HTML).
- GitHub Action improvements.
- Test fixtures for edge-case OpenAPI specs.

## Reporting Issues

Bug reports and feature requests are welcome. Please search existing issues before duplicating.

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
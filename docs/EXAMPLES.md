# Examples — contract-guard MVP V1

## Basic Usage

### Compare two OpenAPI specs

```bash
node dist/cli.js compare old-api.json new-api.json
```

**Output:**
```markdown
# Contract Guard Report

**Old version:** `My API` 1.0.0
**New version:** `My API` 2.0.0

## 🔴 BREAKING CHANGES

- Endpoint eliminado: DELETE /users/{id}
- Parámetro obligatorio nuevo: query:role

## 🟡 WARNINGS

- Parámetro opcional nuevo: query:offset

## 🟢 SAFE CHANGES

- Endpoint agregado: GET /orders

---
```

## CI Integration

### GitHub Actions (strict mode — fails on breaking changes)

```yaml
- name: Check API contract
  run: |
    npm install
    npm run build
    node dist/cli.js compare api-v1.json api-v2.json --strict
```

### GitHub Actions (with output file)

```yaml
- name: Generate contract report
  run: |
    node dist/cli.js compare api-v1.json api-v2.json -o contract-report.md

- name: Upload report
  uses: actions/upload-artifact@v4
  with:
    name: contract-report
    path: contract-report.md
```

## Using Fixtures

The repository includes example specs for testing:

```bash
node dist/cli.js compare fixtures/old-api.json fixtures/new-api.json
```

**Expected output:**
```markdown
## 🔴 BREAKING CHANGES
- Parámetro obligatorio nuevo: query:role
- Respuesta 404 eliminada en GET /users/{id}
- Endpoint eliminado: DELETE /users/{id}
- Tipo de parámetro limit cambió: integer -> string
- Endpoint eliminado: GET /products

## 🟡 WARNINGS
- Parámetro opcional nuevo: query:offset

## 🟢 SAFE CHANGES
- Endpoint agregado: GET /orders
```

## Programmatic Usage

```ts
import { loadSpecFromFile, normalizeSpec } from './parser';
import { diffSpecs } from './diff';
import { classifyChanges } from './rules';
import { buildReport } from './report';

const oldSpec = normalizeSpec(loadSpecFromFile('old-api.json'));
const newSpec = normalizeSpec(loadSpecFromFile('new-api.json'));
const diff = diffSpecs(oldSpec, newSpec);
const classified = classifyChanges(diff.changes);
const report = buildReport(diff, classified, { includeSafeChanges: false });

console.log(report.markdown);
// Exit 1 if breaking changes exist (use in CI):
if (report.hasBreakingChanges) {
  process.exit(1);
}
```

## Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Success — no breaking changes (or `--strict` not used) |
| `1` | Breaking changes detected in `--strict` mode |
| `2` | Error (invalid spec, file not found, parse error) |
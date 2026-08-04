#!/usr/bin/env node

import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import { loadSpecFromFile, normalizeSpec } from './parser';
import { loadGraphQLFromFile } from './parsers/graphql';
import { diffSpecs } from './diff';
import { diffGraphQL } from './parsers/graphql-diff';
import { classifyChanges, countBySeverity, Severity } from './rules';
import { classifyGraphQLChanges, countBySeverityGraphQL, Severity as GQLSeverity } from './parsers/graphql-rules';
import { buildReport, generateMarkdownReport } from './report';
import { buildGraphQLReport, generateGraphQLReport } from './report';
import { loadProtoFromFile } from './parsers/grpc';
import { diffProto } from './parsers/grpc-diff';
import { classifyGrpcChanges, GrpcSeverity, countBySeverityGrpc } from './parsers/grpc-rules';
import { buildGrpcReport, generateGrpcReport } from './report';
import { loadRules, validateRules, buildSeverityOverride, loadRulesFromDirectory, buildOverrideFromAny } from './rules-config';
import { loadRulesFromFile } from './contract-rules/loader';
import { evaluateRuleset } from './contract-rules/evaluator';
import { validateRuleset } from './contract-rules/evaluator';

const program = new Command();

program
  .name('contract-guard')
  .description('Detect breaking changes between API specification versions (OpenAPI 3.x, GraphQL, and gRPC)')
  .version('2.0.0');

program
  .command('compare')
  .description('Compare two API spec files and emit a Markdown report.')
  .argument('<old>', 'Path to the old spec file (OpenAPI JSON, GraphQL SDL, or gRPC proto)')
  .argument('<new>', 'Path to the new spec file')
  .option('-o, --output <file>', 'Write the report to a file instead of stdout')
  .option('--format <format>', 'Force format: openapi, graphql, or grpc (auto-detected if omitted)')
  .option('--rules <file>', 'Path to JSON/YAML rules file for custom severity classification')
  .option('--rules-dir <dir>', 'Directory with rule files (.contract/rules/ by default)')
  .option('--no-safe', 'Hide SAFE CHANGES in the report')
  .option('--strict', 'Exit with non-zero code if breaking changes exist (for CI)')
  .action((oldPath: string, newPath: string, options: { output?: string; format?: string; rules?: string; rulesDir?: string; safe?: boolean; strict?: boolean }) => {
    try {
      const format = detectSchemaFormat(oldPath, options.format);
      let rulesOverride: Map<string, 'breaking' | 'warning' | 'safe'> | undefined;
      if (options.rules) {
        const rulesFile = loadRules(options.rules);
        const validationError = validateRules(rulesFile);
        if (validationError) {
          console.error('contract-guard: Invalid rules file:', validationError);
          process.exit(2);
        }
        const detectedFormat = format === 'graphql' ? 'graphql' : format === 'grpc' ? 'grpc' : 'openapi';
        rulesOverride = buildOverrideFromAny(rulesFile, detectedFormat);
      } else if (options.rulesDir) {
        const loaded = loadRulesFromDirectory(options.rulesDir);
        if (loaded) {
          const validationError = validateRules(loaded);
          if (validationError) {
            console.error('contract-guard: Invalid rules in', options.rulesDir + ':', validationError);
            process.exit(2);
          }
          const detectedFormat = format === 'graphql' ? 'graphql' : format === 'grpc' ? 'grpc' : 'openapi';
          rulesOverride = buildOverrideFromAny(loaded, detectedFormat);
        }
      } else {
        // Auto-load from .contract/rules/ if it exists
        const dir = path.resolve(process.cwd(), '.contract', 'rules');
        const loaded = loadRulesFromDirectory(dir);
        if (loaded) {
          const validationError = validateRules(loaded);
          if (!validationError) {
            const detectedFormat = format === 'graphql' ? 'graphql' : format === 'grpc' ? 'grpc' : 'openapi';
            rulesOverride = buildOverrideFromAny(loaded, detectedFormat);
          }
        }
      }

      if (format === 'graphql') {
        const oldSchema = loadGraphQLFromFile(oldPath);
        const newSchema = loadGraphQLFromFile(newPath);
        const diff = diffGraphQL(oldSchema, newSchema);
        let classified = classifyGraphQLChanges(diff.changes);
        if (rulesOverride) {
          classified = classified.map(c => {
            const override = rulesOverride.get(c.kind);
            if (override) {
              let severity: GQLSeverity;
              switch (override) {
                case 'breaking': severity = GQLSeverity.BREAKING; break;
                case 'warning': severity = GQLSeverity.WARNING; break;
                case 'safe': severity = GQLSeverity.SAFE; break;
              }
              return { ...c, severity, message: c.detail };
            }
            return c;
          });
        }
        const includeSafe = options.safe !== false;
        const filtered = includeSafe ? classified : classified.filter(c => c.severity !== GQLSeverity.SAFE);
        const report = buildGraphQLReport(diff, filtered, {
          includeSafeChanges: includeSafe,
          strict: options.strict ?? false
        });
        if (options.output) {
          const out = path.resolve(options.output);
          fs.writeFileSync(out, report.markdown, 'utf-8');
          const counts = countBySeverityGraphQL(classified);
          console.log(`Report written to ${out}`);
          console.log(`Summary: ${counts.breaking} breaking, ${counts.warning} warning(s), ${counts.safe} safe`);
        } else {
          console.log(report.markdown);
        }
        if (options.strict && report.hasBreakingChanges) {
          process.exit(1);
        }
      } else if (format === 'grpc') {
        const oldProto = loadProtoFromFile(oldPath);
        const newProto = loadProtoFromFile(newPath);
        const diff = diffProto(oldProto, newProto);
        let classified = classifyGrpcChanges(diff.changes);
        if (rulesOverride) {
          classified = classified.map(c => {
            const override = rulesOverride.get(c.kind);
            if (override) {
              let severity: GrpcSeverity;
              switch (override) {
                case 'breaking': severity = GrpcSeverity.BREAKING; break;
                case 'warning': severity = GrpcSeverity.WARNING; break;
                case 'safe': severity = GrpcSeverity.SAFE; break;
              }
              return { ...c, severity, message: c.detail };
            }
            return c;
          });
        }
        const includeSafe = options.safe !== false;
        const filtered = includeSafe ? classified : classified.filter(c => c.severity !== GrpcSeverity.SAFE);
        const report = buildGrpcReport(diff, filtered, {
          includeSafeChanges: includeSafe,
          strict: options.strict ?? false
        });
        if (options.output) {
          const out = path.resolve(options.output);
          fs.writeFileSync(out, report.markdown, 'utf-8');
          const counts = countBySeverityGrpc(classified);
          console.log(`Report written to ${out}`);
          console.log(`Summary: ${counts.breaking} breaking, ${counts.warning} warning(s), ${counts.safe} safe`);
        } else {
          console.log(report.markdown);
        }
        if (options.strict && report.hasBreakingChanges) {
          process.exit(1);
        }
      } else {
        // OpenAPI
        const rawOld = loadSpecFromFile(oldPath);
        const rawNew = loadSpecFromFile(newPath);
        const oldSpec = normalizeSpec(rawOld);
        const newSpec = normalizeSpec(rawNew);
        const diff = diffSpecs(oldSpec, newSpec);
        const includeSafe = options.safe !== false;
        const classified = classifyChanges(diff.changes, rulesOverride);
        const report = buildReport(diff, classified, {
          includeSafeChanges: includeSafe,
          strict: options.strict ?? false
        });
        if (options.output) {
          const out = path.resolve(options.output);
          fs.writeFileSync(out, report.markdown, 'utf-8');
          const counts = countBySeverity(classified);
          console.log(`Report written to ${out}`);
          console.log(`Summary: ${counts.breaking} breaking, ${counts.warning} warning(s), ${counts.safe} safe`);
        } else {
          console.log(report.markdown);
        }
        if (options.strict && report.hasBreakingChanges) {
          process.exit(1);
        }
      }
    } catch (error) {
      console.error('contract-guard:', (error as Error).message);
      process.exit(2);
    }
  });

function detectSchemaFormat(filePath: string, forcedFormat?: string): 'openapi' | 'graphql' | 'grpc' {
  if (forcedFormat === 'openapi') return 'openapi';
  if (forcedFormat === 'graphql') return 'graphql';
  if (forcedFormat === 'grpc') return 'grpc';

  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.gql' || ext === '.graphql' || ext === '.gql') return 'graphql';
  if (ext === '.proto') return 'grpc';
  if (ext === '.json') {
    // Try to peek at content to detect GraphQL introspection
    const absolute = path.resolve(filePath);
    const content = fs.readFileSync(absolute, 'utf-8').trimStart();
    if (content.startsWith('{') && (content.includes('"data"') || content.includes('__schema"'))) {
      return 'graphql';
    }
    return 'openapi';
  }
  // Default to OpenAPI
  return 'openapi';
}

// ---------------------------------------------------------------------------
// contract-rules subcommand
// ---------------------------------------------------------------------------
// Evaluates a JSON/YAML ruleset against a single contract data file. The
// rules are loaded at runtime — no recompile required. Useful for CI checks
// on contract payload as well as for sanity-checking the React UI output.
//
//   contract-guard contract-rules --rules ./examples/rules.yaml \
//     --contract ./examples/contract.json
//   contract-guard contract-rules --rules ./examples/rules.yaml \
//     --json '{"amount": 99999}'
program
  .command('contract-rules')
  .description('Evaluate a JSON/YAML ruleset against contract data and report matched rules.')
  .requiredOption('--rules <file>', 'Path to JSON or YAML rules file (loaded at runtime)')
  .option('--contract <file>', 'Path to a JSON contract data file')
  .option('--json <string>', 'Inline JSON contract data (overrides --contract)')
  .option('--summary', 'Print only a one-line summary instead of the detail table')
  .action((options: { rules: string; contract?: string; json?: string; summary?: boolean }) => {
    try {
      const { ruleset, errors } = (function loadAndValidate() {
        const loaded = loadRulesFromFile(options.rules);
        const errs = validateRuleset(loaded);
        return { ruleset: loaded, errors: errs };
      })();

      if (errors.length > 0) {
        for (const e of errors) {
          console.error(`contract-guard: invalid rule #${e.index}: ${e.error}`);
        }
        process.exit(2);
      }

      let data: Record<string, unknown>;
      if (options.json) {
        data = JSON.parse(options.json) as Record<string, unknown>;
      } else if (options.contract) {
        const content = fs.readFileSync(path.resolve(options.contract), 'utf-8');
        data = JSON.parse(content) as Record<string, unknown>;
      } else {
        console.error('contract-guard: --contract or --json is required');
        process.exit(2);
        return; // unreachable, but satisfies the type checker
      }

      const result = evaluateRuleset(ruleset, data);

      if (options.summary) {
        console.log(`Contract ${result.contractId ?? '(no id)'}: ${result.matchedCount}/${result.totalRules} rules matched — ${result.blockers.length} block, ${result.alerts.length} alert, ${result.flags.length} flag, ${result.notifications.length} notify`);
      } else {
        console.log(`\nContract rules evaluation — ${result.contractId ?? '(no contractId)'}\n`);
        console.log(`Total rules: ${result.totalRules} | Matched: ${result.matchedCount}\n`);
        for (const r of result.results) {
          const status = r.matched ? '✓ MATCH' : '✗ no match';
          console.log(`${status}  [${r.action.toUpperCase()}] ${r.ruleName}${r.severity ? ` (${r.severity})` : ''}`);
          for (const c of r.conditionResults) {
            const mark = c.matched ? '+' : '-';
            console.log(`    ${mark} ${c.field} ${c.operator} ${formatInline(c.expected)} → got ${formatInline(c.actual)}`);
          }
        }
        if (result.blockers.length > 0) {
          console.log(`\n⚠ ${result.blockers.length} BLOCK action(s) — contract should not proceed.`);
        }
      }

      // Non-zero exit when any block action fires (CI-friendly).
      if (result.blockers.length > 0) process.exit(1);
    } catch (error) {
      console.error('contract-guard:', (error as Error).message);
      process.exit(2);
    }
  });

function formatInline(v: unknown): string {
  if (v === undefined) return 'undefined';
  if (v === null) return 'null';
  if (Array.isArray(v)) return JSON.stringify(v);
  if (typeof v === 'string') return `"${v}"`;
  return String(v);
}

program.parse(process.argv);
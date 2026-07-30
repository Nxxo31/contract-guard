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
import { loadRules, validateRules, buildSeverityOverride } from './rules-config';

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
  .option('--no-safe', 'Hide SAFE CHANGES in the report')
  .option('--strict', 'Exit with non-zero code if breaking changes exist (for CI)')
  .action((oldPath: string, newPath: string, options: { output?: string; format?: string; rules?: string; safe?: boolean; strict?: boolean }) => {
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
        rulesOverride = buildSeverityOverride(rulesFile);
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
        let classified = classifyChanges(diff.changes);
        if (rulesOverride) {
          classified = classified.map(c => {
            const override = rulesOverride.get(c.kind);
            if (override) {
              let severity: Severity;
              switch (override) {
                case 'breaking': severity = Severity.BREAKING; break;
                case 'warning': severity = Severity.WARNING; break;
                case 'safe': severity = Severity.SAFE; break;
              }
              return { ...c, severity, message: c.detail };
            }
            return c;
          });
        }
        const includeSafe = options.safe !== false;
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

program.parse(process.argv);
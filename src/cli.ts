#!/usr/bin/env node

import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import { loadSpecFromFile, normalizeSpec } from './parser';
import { loadGraphQLFromFile } from './parsers/graphql';
import { diffSpecs } from './diff';
import { diffGraphQL } from './parsers/graphql-diff';
import { classifyChanges, countBySeverity } from './rules';
import { classifyGraphQLChanges, countBySeverityGraphQL } from './parsers/graphql-rules';
import { buildReport, buildGraphQLReport } from './report';

const program = new Command();

program
  .name('contract-guard')
  .description('Detect breaking changes between API specification versions (OpenAPI 3.x and GraphQL)')
  .version('2.0.0');

program
  .command('compare')
  .description('Compare two API spec files and emit a Markdown report.')
  .argument('<old>', 'Path to the old spec file (OpenAPI JSON, GraphQL SDL, or Introspection JSON)')
  .argument('<new>', 'Path to the new spec file')
  .option('-o, --output <file>', 'Write the report to a file instead of stdout')
  .option('--format <format>', 'Force format: openapi, graphql (auto-detected if omitted)')
  .option('--no-safe', 'Hide SAFE CHANGES in the report')
  .option('--strict', 'Exit with non-zero code if breaking changes exist (for CI)')
  .action((
    oldPath: string,
    newPath: string,
    options: { output?: string; format?: string; safe?: boolean; strict?: boolean }
  ) => {
    try {
      const format = detectSchemaFormat(oldPath, options.format);

      if (format === 'graphql') {
        const oldSchema = loadGraphQLFromFile(oldPath);
        const newSchema = loadGraphQLFromFile(newPath);

        const diff = diffGraphQL(oldSchema, newSchema);
        const classified = classifyGraphQLChanges(diff.changes);

        const includeSafe = options.safe !== false;
        const filtered = includeSafe
          ? classified
          : classified.filter(c => c.severity !== 'safe' as const);

        const report = buildGraphQLReport(diff, filtered, {
          includeSafeChanges: includeSafe,
          strict: options.strict ?? false
        });

        if (options.output) {
          const out = path.resolve(options.output);
          fs.writeFileSync(out, report.markdown, 'utf-8');
          const counts = countBySeverityGraphQL(classified);
          console.log(`Report written to ${out}`);
          console.log(
            `Summary: ${counts.breaking} breaking, ${counts.warning} warning(s), ${counts.safe} safe`
          );
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
        const classified = classifyChanges(diff.changes);

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
          console.log(
            `Summary: ${counts.breaking} breaking, ${counts.warning} warning(s), ${counts.safe} safe`
          );
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

function detectSchemaFormat(filePath: string, forcedFormat?: string): 'openapi' | 'graphql' {
  if (forcedFormat === 'openapi') return 'openapi';
  if (forcedFormat === 'graphql') return 'graphql';

  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.gql' || ext === '.graphql' || ext === '. gql') return 'graphql';
  if (ext === '.json') {
    // Try to peek at content to detect GraphQL introspection
    const absolute = path.resolve(filePath);
    const content = fs.readFileSync(absolute, 'utf-8').trimStart();
    if (content.startsWith('{') && (content.includes('"data"') || content.includes('__schema"'))) {
      return 'graphql';
    }
    return 'openapi';
  }
  if (ext === '.proto') return 'openapi'; // TODO: gRPC support
  // Default to OpenAPI
  return 'openapi';
}

program.parse(process.argv);
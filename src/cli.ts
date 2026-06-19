#!/usr/bin/env node

import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import { loadSpecFromFile, normalizeSpec } from './parser';
import { diffSpecs } from './diff';
import { classifyChanges, countBySeverity } from './rules';
import { buildReport, Report } from './report';

const program = new Command();

program
  .name('contract-guard')
  .description('Detect breaking changes between OpenAPI specification versions')
  .version('0.1.0');

program
  .command('compare')
  .description('Compare two OpenAPI JSON files and emit a Markdown report.')
  .argument('<old>', 'Path to the old OpenAPI spec (JSON)')
  .argument('<new>', 'Path to the new OpenAPI spec (JSON)')
  .option('-o, --output <file>', 'Write the report to a file instead of stdout')
  .option('--no-safe', 'Hide SAFE CHANGES in the report')
  .option('--strict', 'Exit with non-zero code if breaking changes exist (for CI)')
  .action((oldPath: string, newPath: string, options: { output?: string; safe?: boolean; strict?: boolean }) => {
    try {
      const rawOld = loadSpecFromFile(oldPath);
      const rawNew = loadSpecFromFile(newPath);

      const oldSpec = normalizeSpec(rawOld);
      const newSpec = normalizeSpec(rawNew);

      const diff = diffSpecs(oldSpec, newSpec);
      const classified = classifyChanges(diff.changes);

      const includeSafe = options.safe !== false;
      const report: Report = buildReport(diff, classified, {
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
    } catch (error) {
      console.error('contract-guard:', (error as Error).message);
      process.exit(2);
    }
  });

program.parse(process.argv);

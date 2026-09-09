import { describe, it, expect } from 'vitest';
import {
  loadRules,
  validateRules,
  buildSeverityOverride,
  parseRulesYaml
} from '../src/rules-config';

describe('rules-config loader', () => {
  it('loads JSON rules file', () => {
    const content = `{
  "rules": {
    "breaking": ["field-removed", "type-changed"],
    "warning": ["field-added", "field-deprecated"],
    "safe": ["description-changed"]
  }
}`;
    const rules = loadRules('dummy.json'); // path ignored, we pass content via mock
    // Since loadBooks reads file system, we mock by temporarily overriding fs.readFileSync
    const originalReadFileSync = require('fs').readFileSync;
    require('fs').readFileSync = () => content;
    const loaded = loadRules('dummy.json');
    require('fs').readFileSync = originalReadFileSync;

    expect(loaded.rules.breaking).toEqual(['field-removed', 'type-changed']);
    expect(loaded.rules.warning).toEqual(['field-added', 'field-deprecated']);
    expect(loaded.rules.safe).toEqual(['description-changed']);
  });

  it('loads YAML rules file', () => {
    const yamlContent = `
rules:
  breaking:
    - field-removed
    - type-changed
  warning:
    - field-added
    - field-deprecated
  safe:
    - description-changed
`;
    const originalReadFileSync = require('fs').readFileSync;
    require('fs').readFileSync = () => yamlContent;
    const loaded = loadRules('dummy.yaml');
    require('fs').readFileSync = originalReadFileSync;

    expect(loaded.rules.breaking).toEqual(['field-removed', 'type-changed']);
    expect(loaded.rules.warning).toEqual(['field-added', 'field-deprecated']);
    expect(loaded.rules.safe).toEqual(['description-changed']);
  });

  it('validates correct rules', () => {
    const valid = {
      rules: {
        breaking: ['field-removed'],
        warning: ['field-added'],
        safe: ['description-changed']
      }
    };
    expect(validateRules(valid)).toBeNull();
  });

  it('rejects unknown severity', () => {
    const invalid = {
      rules: {
        unknown: ['field-removed']
      }
    };
    const err = validateRules(invalid);
    expect(err).toContain('unknown severity');
  });

  it('rejects non-array values', () => {
    const invalid = {
      rules: {
        breaking: 'field-removed'
      }
    };
    const err = validateRules(invalid);
    expect(err).toContain('must be an array');
  });

  it('builds severity override map', () => {
    const rules = {
      rules: {
        breaking: ['field-removed', 'type-changed'],
        warning: ['field-added'],
        safe: ['description-changed']
      }
    };
    const map = buildSeverityOverride(rules);
    expect(map.get('field-removed')).toBe('breaking');
    expect(map.get('type-changed')).toBe('breaking');
    expect(map.get('field-added')).toBe('warning');
    expect(map.get('description-changed')).toBe('safe');
  });

  it('parseRulesYaml handles inline lists', () => {
    const yaml = `
rules:
  breaking: [field-removed, type-changed]
  warning: [field-added]
  safe: [description-changed]
`;
    const parsed = parseRulesYaml(yaml);
    expect(parsed.rules.breaking).toEqual(['field-removed', 'type-changed']);
    expect(parsed.rules.warning).toEqual(['field-added']);
    expect(parsed.rules.safe).toEqual(['description-changed']);
  });

  it('parseRulesYaml handles block lists', () => {
    const yaml = `
rules:
  breaking:
    - field-removed
    - type-changed
  warning:
    - field-added
  safe:
    - description-changed
`;
    const parsed = parseRulesYaml(yaml);
    expect(parsed.rules.breaking).toEqual(['field-removed', 'type-changed']);
    expect(parsed.rules.warning).toEqual(['field-added']);
    expect(parsed.rules.safe).toEqual(['description-changed']);
  });
});
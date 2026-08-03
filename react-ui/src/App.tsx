import React, { useState, useEffect } from 'react';
import { evaluateRuleset, validateRuleset, type Ruleset, type Rule, type Condition, type Operator, type Action, type ValueType } from '../src/contract-rules';

function loadRules(): Ruleset {
  try {
    const json = localStorage.getItem('contract-guard-rules');
    if (json) {
      const parsed = JSON.parse(json) as Ruleset;
      if (Array.isArray(parsed.rules)) return parsed;
    }
  } catch (_) { /* fall back to default */ }
  return { version: '1.0', rules: [] };
}
function saveRules(rs: Ruleset) {
  try {
    localStorage.setItem('contract-guard-rules', JSON.stringify(rs));
  } catch (_) { /* ignore */ }
}

type FormMode = 'add' | 'edit';

const OperatorOptions: Array<{ label: string; value: Operator }> = [
  { label: '>', value: '>' },
  { label: '<', value: '<' },
  { label: '>=', value: '>=' },
  { label: '<=', value: '<=' },
  { label: '=', value: '=' },
  { label: '!=', value: '!=' },
  { label: 'contains', value: 'contains' },
  { label: 'not-contains', value: 'not-contains' },
  { label: 'in', value: 'in' },
  { label: 'not-in', value: 'not-in' },
  { label: 'exists', value: 'exists' },
  { label: 'not-exists', value: 'not-exists' },
  { label: 'startsWith', value: 'startsWith' },
  { label: 'endsWith', value: 'endsWith' },
  { label: 'regex', value: 'regex' },
];

const ActionOptions: Array<{ label: string; value: Action }> = [
  { label: 'Alert', value: 'alert' },
  { label: 'Block', value: 'block' },
  { label: 'Flag', value: 'flag' },
  { label: 'Notify', value: 'notify' },
];

const SeverityOptions: Array<{ label: string; value: 'low' | 'medium' | 'high' | 'critical' }> = [
  { label: 'Low', value: 'low' },
  { label: 'Medium', value: 'medium' },
  { label: 'High', value: 'high' },
  { label: 'Critical', value: 'critical' },
];

const ValueTypeOptions: Array<{ label: string; value: ValueType }> = [
  { label: 'String', value: 'string' },
  { label: 'Number', value: 'number' },
  { label: 'Boolean', value: 'boolean' },
  { label: 'Date', value: 'date' },
  { label: 'Array', value: 'array' },
];

function App() {
  const [ruleset, setRuleset] = useState<Ruleset>(loadRules);
  const [formMode, setFormMode] = useState<FormMode>('add');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formValues, setFormValues] = useState<{
    name: string;
    description: string;
    enabled: boolean;
    action: Action;
    severity: 'low' | 'medium' | 'high' | 'critical' | undefined;
    tags: string[];
    conditions: {
      field: string;
      operator: Operator;
      value: string | number | boolean | undefined;
      type: ValueType | undefined;
      description: string;
    }[];
  }>({
    name: '',
    description: '',
    enabled: true,
    action: 'alert',
    severity: undefined,
    tags: [],
    conditions: [{ field: '', operator: '>', value: '', type: undefined, description: '' }],
  }));
  const [editingConditionIndex, setEditingConditionIndex] = useState<number | null>(null);
  const [testJson, setTestJson] = useState('');
  const [evalResult, setEvalResult] = useState<any>(null);
  const [evalError, setEvalError] = useState<string | null>(null);
  const [isEvaluating, setIsEvaluating] = useState(false);

  useEffect(() => {
    saveRules(ruleset);
  }, [ruleset]);

  const resetForm = () => {
    setFormValues({
      name: '',
      description: '',
      enabled: true,
      action: 'alert',
      severity: undefined,
      tags: [],
      conditions: [{ field: '', operator: '>', value: '', type: undefined, description: '' }]
    });
    setEditingConditionIndex(null);
  };

  const startAdd = () => {
    setFormMode('add');
    setEditingId(null);
    resetForm();
  };

  const startEdit = (rule: Rule) => {
    setFormMode('edit');
    setEditingId(rule.id?.toString() ?? null);
    setFormValues({
      name: rule.name ?? '',
      description: rule.description ?? '',
      enabled: rule.enabled ?? true,
      action: rule.action,
      severity: rule.severity as any,
      tags: Array.isArray(rule.tags) ? rule.tags : [],
      conditions: rule.conditions.map(c => ({
        field: c.field ?? '',
        operator: c.operator ?? '>',
        value: typeof c.value === 'string' || typeof c.value === 'number' || typeof c.value === 'boolean' ? c.value : '',
        type: (() => {
          if (typeof c.value === 'number') return 'number';
          if (typeof c.value === 'boolean') return 'boolean';
          if (typeof c.value === 'string' && !isNaN(Date.parse(c.value))) return 'date';
          if (Array.isArray(c.value)) return 'array';
          return 'string';
        })() as ValueType,
        description: c.description ?? '',
      })) ?? [{ field: '', operator: '>', value: '', type: undefined, description: '' }],
    });
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value, type } = e.target;
    setFormValues(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? (e.target as HTMLInputElement).checked : value,
    }));
  };

  const handleSelectChange = <T extends keyof any>(name: T, value: any) => {
    setFormValues(prev => ({ ...prev, [name]: value }));
  };

  const handleConditionChange = (idx: number, e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value, type } = e.target as HTMLInputElement | HTMLSelectElement;
    let checked: boolean | undefined;
    if (e.target instanceof HTMLInputElement && (e.target as HTMLInputElement).type === 'checkbox') {
      checked = (e.target as HTMLInputElement).checked;
    }
    setFormValues(prev => {
      const conditions = [...prev.conditions];
      if (!conditions[idx]) {
        conditions[idx] = { field: '', operator: '>', value: '', type: undefined, description: '' };
      }
      const incoming =
        type === 'checkbox'
          ? (checked !== undefined ? checked : value)
          : value;
      return {
        ...prev,
        conditions: conditions.map((c, i) =>
          i === idx ? { ...c, [name]: incoming } : c
        ),
      };
    });
  };

  const handleConditionSelectChange = (idx: number, name: keyof any, value: any) => {
    setFormValues(prev => {
      const conditions = [...prev.conditions];
      if (!conditions[idx]) {
        conditions[idx] = { field: '', operator: '>', value: '', type: undefined, description: '' };
      }
      return {
        ...prev,
        conditions: conditions.map((c, i) =>
          i === idx ? { ...c, [name]: value } : c
        ),
      };
    });
  };

  const addCondition = () => {
    setFormValues(prev => ({
      ...prev,
      conditions: [
        ...prev.conditions,
        { field: '', operator: '>', value: '', type: undefined, description: '' },
      ],
    }));
  };

  const removeCondition = (idx: number) => {
    if (formValues.conditions.length <= 1) return;
    setFormValues(prev => ({
      ...prev,
      conditions: prev.conditions.filter((_, i) => i !== idx),
    }));
  };

  const startEditCondition = (idx: number) => {
    setEditingConditionIndex(idx);
  };

  const cancelEditCondition = () => {
    setEditingConditionIndex(null);
  };

  const saveConditionEdit = (idx: number) => {
    setEditingConditionIndex(null);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const {
      name,
      description,
      enabled,
      action,
      severity,
      tags,
      conditions,
    } = formValues;
    if (!name.trim()) {
      alert('Rule name is required');
      return;
    }
    const invalidCond = conditions.find(c => !c.field || !c.operator);
    if (invalidCond) {
      alert('Each condition must have a field and an operator');
      return;
    }
    const newRule: Rule = {
      name: name.trim(),
      description: description.trim() || undefined,
      enabled: !!enabled,
      action,
      severity: severity as any,
      tags: Array.isArray(tags) ? tags.filter(t => t.trim()).map(t => t.trim()) : [],
      conditions: conditions
        .map(c => ({
          field: c.field.trim(),
          operator: c.operator,
          value:
            typeof c.value === 'string' && c.value === ''
              ? undefined
              : c.value,
          type: c.type as any,
          description: c.description.trim() || undefined,
        }))
        .filter(c => c.field && c.operator),
    };
    if (formMode === 'add') {
      newRule.id = -Date.now() - Math.floor(Math.random() * 10000);
      setRuleset(prev => ({
        ...prev,
        rules: [...prev.rules, newRule],
      }));
    } else if (editingId !== null) {
      const idNum = parseInt(editingId, 10);
      setRuleset(prev => ({
        ...prev,
        rules: prev.rules.map(r =>
          r.id === idNum ? { ...r, ...newRule, id: r.id } : r
        ),
      }));
    }
    setFormMode('add');
    setEditingId(null);
    resetForm();
  };

  const handleDelete = (id: number | string) => {
    if (!window.confirm('Delete this rule?')) return;
    setRuleset(prev => ({
      ...prev,
      rules: prev.rules.filter(r => (r.id?.toString() !== id.toString())),
    }));
    if (editingId === String(id)) {
      setFormMode('add');
      setEditingId(null);
      resetForm();
    }
  };

  const handleEvaluate = async () => {
    setEvalError(null);
    setEvalResult(null);
    setIsEvaluating(true);
    try {
      const data = testJson.trim() ? JSON.parse(testJson) : {};
      const errors = validateRuleset(ruleset);
      if (errors.length > 0) {
        const msgs = errors.map(e => `Rule #${e.index}: ${e.error}`).join('\n');
        throw new Error(`Invalid ruleset:\n${msgs}`);
      }
      const result = evaluateRuleset(ruleset, data);
      setEvalResult(result);
    } catch (err: any) {
      setEvalError(err.message || String(err));
    } finally {
      setIsEvaluating(false);
    }
  };

  const fmt = (v: unknown): string => {
    if (v === undefined) return '(none)';
    if (v === null) return 'null';
    if (typeof v === 'string') return `"${v}"`;
    if (Array.isArray(v)) return JSON.stringify(v);
    return String(v);
  };

  const ConditionRow = ({
    condition,
    index,
    onRemove,
    onEditStart,
  }: {
    condition: any;
    index: number;
    onRemove: (idx: number) => void;
    onEditStart: (idx: number) => void;
  }) => {
    const isEditing = editingConditionIndex === index;
    return (
      <div className="condition-row p-2 border rounded mb-2" key={index}>
        {isEditing ? (
          <>
            <input
              name="field"
              value={condition.field ?? ''}
              onChange={e => handleConditionChange(index, e)}
              placeholder="field (e.g. amount)"
              className="border p-1 mr-2 w-32"
            />
            <select
              name="operator"
              value={condition.operator ?? '>'}
              onChange={e => handleConditionSelectChange(index, 'operator', e.target.value as any)}
              className="border p-1 mr-2 w-32"
            >
              {OperatorOptions.map(o => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            {condition.operator !== 'exists' && condition.operator !== 'not-exists' ? (
              <>
                <input
                  name="value"
                  value={typeof condition.value === 'string' ? condition.value : ''}
                  onChange={e => handleConditionChange(index, e)}
                  placeholder="value"
                  className="border p-1 mr-2 w-32"
                />
                <select
                  name="type"
                  value={condition.type ?? 'string'}
                  onChange={e => handleConditionSelectChange(index, 'type', e.target.value as any)}
                  className="border p-1 ml-2 w-32"
                >
                  <option value="string">string</option>
                  <option value="number">number</option>
                  <option value="boolean">boolean</option>
                  <option value="date">date</option>
                  <option value="array">array</option>
                </select>
              </>
            ) : null}
            <button
              onClick={() => saveConditionEdit(index)}
              className="btn btn-sm btn-primary mr-2"
            >
              Save
            </button>
            <button
              onClick={cancelEditCondition}
              className="btn btn-sm btn-secondary mr-2"
            >
              Cancel
            </button>
          </>
        ) : (
          <>
            <span className="font-mono mr-2">{condition.field ?? ''}</span>
            <span className="mr-2">{condition.operator ?? '>'}</span>
            {condition.operator !== 'exists' && condition.operator !== 'not-exists' ? (
              <>
                <span className="font-mono mr-2">{fmt(condition.value)}</span>
                <span className="ml-2 mr-2 italic text-sm">{condition.type ?? 'string'}</span>
              </>
            ) : null}
          </>
        )}
        <div className="flex mt-2 space-x-2">
          <button
            onClick={() => onEditStart(index)}
            className="btn btn-sm btn-outline"
          >
            Edit
          </button>
          <button
            onClick={() => onRemove(index)}
            className="btn btn-sm btn-outline btn-error"
          >
            – Remove
          </button>
        </div>
        {condition.description && (
          <p className="text-xs text-muted mt-1">{condition.description}</p>
        )}
      </div>
    );
  };

  return (
    <div className="container mx-auto p-4">
      <h1 className="text-2xl font-bold mb-6">Contract Guard – Rules UI</h1>

      <div className="grid gap-6 md:grid-cols-[1fr_300px]">
        {/* Main panel: rule list + form */}
        <div className="space-y-6">
          <h2 className="text-xl font-semibold">Rules ({ruleset.rules.length})</h2>
          <div className="space-y-4">
            {ruleset.rules.map((rule) => (
              <div key={rule.id ?? rule.name} className="border rounded-lg p-4 shadow-sm">
                <div className="flex justify-between items-start mb-2">
                  <h3 className="font-medium text-lg">{rule.name}</h3>
                  <div className="flex space-x-2">
                    <span
                      className={`px-2 py-1 text-xs rounded-full ${
                        rule.action === 'block'
                          ? 'bg-red-100 text-red-800'
                          : rule.action === 'flag'
                          ? 'bg-yellow-100 text-yellow-800'
                          : rule.action === 'alert'
                          ? 'bg-blue-100 text-blue-800'
                          : 'bg-green-100 text-green-800'
                      }`}
                    >
                      {rule.action.toUpperCase()}
                    </span>
                    {rule.severity && (
                      <span
                        className={`px-2 py-1 text-xs rounded-full ${
                          rule.severity === 'critical'
                            ? 'bg-red-200 text-red-900'
                            : rule.severity === 'high'
                            ? 'bg-orange-200 text-orange-900'
                            : rule.severity === 'medium'
                            ? 'bg-yellow-200 text-yellow-900'
                            : 'bg-green-200 text-green-900'
                        }`}
                      >
                        {rule.severity}
                      </span>
                    )}
                  </div>
                </div>
                {rule.description && <p className="text-sm text-muted mb-2">{rule.description}</p>}
                <div className="space-y-2">
                  {rule.conditions?.map((cond, idx) => (
                    <ConditionRow
                      key={idx}
                      condition={cond}
                      index={idx}
                      onRemove={removeCondition}
                      onEditStart={startEditCondition}
                    />
                  ))}
                </div>
                {rule.tags?.length && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {rule.tags.map((tag) => (
                      <span key={tag} className="px-2 py-0.5 text-xs bg-gray-200 rounded">
                        #{tag}
                      </span>
                    ))}
                  </div>
                )}
                <div className="flex justify-end space-x-2 mt-4">
                  <button
                    onClick={() => startEdit(rule)}
                    className="btn btn-sm btn-outline"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => handleDelete(rule.id ?? rule.name)}
                    className="btn btn-sm btn-outline btn-error"
                  >
                    Delete
                  </button>
                </div>
              </div>
            )}
          </div>

          <h2 className="text-xl font-semibold">{formMode === 'add' ? 'Add New Rule' : 'Edit Rule'}</h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="field">
              <label className="label">Name</label>
              <input
                type="text"
                name="name"
                value={formValues.name ?? ''}
                onChange={handleChange}
                className="input input-bordered w-full"
                required
              />
            </div>
            <div className="field">
              <label className="label">Description (optional)</label>
              <textarea
                name="description"
                value={formValues.description ?? ''}
                onChange={handleChange}
                className="textarea textarea-bordered w-full"
                rows={2}
              />
            </div>
            <div className="flex flex-wrap gap-4">
              <div className="field w-48">
                <label className="label">Enabled</label>
                <input
                  type="checkbox"
                  name="enabled"
                  checked={formValues.enabled ?? true}
                  onChange={handleChange}
                  className="checkbox"
                />
              </div>
              <div className="field w-48">
                <label className="label">Action</label>
                <select
                  name="action"
                  value={formValues.action ?? 'alert'}
                  onChange={e => handleSelectChange('action', e.target.value as any)}
                  className="select select-bordered w-full"
                >
                  {ActionOptions.map(o => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field w-48">
                <label className="label">Severity (optional)</label>
                <select
                  name="severity"
                  value={formValues.severity ?? ''}
                  onChange={e => handleSelectChange('severity', e.target.value as any)}
                  className="select select-bordered w-full"
                >
                  <option value=""> — none — </option>
                  {SeverityOptions.map(o => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="field w-full">
              <label className="label">Tags (comma-separated, optional)</label>
              <input
                type="text"
                name="tags"
                value={Array.isArray(formValues.tags) ? formValues.tags.join(', ') : ''}
                onChange={e => {
                  const val = e.target.value;
                  setFormValues(prev => ({
                    ...prev,
                    tags: val.trim() ? val.split(',').map(t => t.trim()).filter(t => t.length > 0) : [],
                  }));
                }}
                className="input input-bordered w-full"
              />
            </div>

            <fieldset className="border p-4">
              <legend className="font-medium">Conditions (ALL must match)</legend>
              <div className="space-y-2">
                {formValues.conditions.map((cond, idx) => (
                  <ConditionRow
                    key={idx}
                    condition={cond}
                    index={idx}
                    onRemove={removeCondition}
                    onEditStart={startEditCondition}
                  />
                ))}
              </div>
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={addCondition}
                  className="btn btn-sm btn-outline"
                >
                  + Add Condition
                </button>
              </div>
            </fieldset>

            <div className="flex justify-end pt-4">
              <button
                type="button"
                onClick={() => {
                  setFormMode('add');
                  setEditingId(null);
                  resetForm();
                }}
                className="btn btn-sm btn-outline"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="btn btn-primary"
              >
                {formMode === 'add' ? 'Add Rule' : 'Save Changes'}
              </button>
            </div>
          </form>
        </div>

        {/* Sidebar: Tester / Evaluator */}
        <div className="space-y-4">
          <h2 className="text-xl font-semibold">Test Ruleset</h2>
          <div className="field">
            <label className="label">Contract Data (JSON)</label>
            <textarea
              name="testJson"
              value={testJson}
              onChange={e => setTestJson(e.target.value)}
              className="textarea textarea-bordered w-full h-64 font-mono"
              placeholder='Paste a JSON object here, e.g. {"amount": 150000, "currency": "USD"}'
            />
          </div>
          <div className="flex justify-end">
            <button
              type="button"
              onClick={handleEvaluate}
              disabled={isEvaluating}
              className={`btn btn-primary ${isEvaluating ? 'opacity-50' : ''}`}
            >
              {isEvaluating ? 'Evaluating...' : 'Evaluate'}
            </button>
          </div>
          {evalError && (
            <div className="p-4 bg-red-50 border border-red-200 rounded mb-4">
              <h3 className="font-semibold text-red-800">Evaluation Error</h3>
              <p className="text-red-600">{evalError}</p>
            </div>
          )}
          {evalResult && (
            <div className="space-y-4">
              <h3 className="font-semibold">Evaluation Result</h3>
              <p className="mb-2">
                Total rules: <span className="font-mono">{evalResult.totalRules}</span> &vert; Matched: <span className="font-mono">{evalResult.matchedCount}</span>
              </p>
              <div className="space-y-2">
                {['blockers', 'alerts', 'flags', 'notifications'].map((key) => {
                  const arr = evalResult[key as keyof typeof evalResult];
                  if (!arr || arr.length === 0) return null;
                  const title =
                    key === 'blockers'
                      ? '🚫 BLOCK'
                      : key === 'alerts'
                      ? '⚠️ ALERT'
                      : key === 'flags'
                      ? '🏁 FLAG'
                      : '📢 NOTIFY';
                  return (
                    <div key={key} className="border-t pt-2">
                      <h4 className="font-medium text-lg">{title} ({arr.length})</h4>
                      <div className="space-y-2 mt-2">
                        {arr.map((r: any, i: number) => (
                          <div key={i} className="p-2 bg-gray-50 rounded">
                            <strong>{r.ruleName}</strong> {r.severity && `(${r.severity})`}
                            <p className="mt-1 text-sm">{r.message}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default App;
import { describe, expect, it } from 'vitest';
import { collectRuleIssues, validateRules } from './validate';
import { resolveRulesSaveStatus, isRulesUnsaved } from './saveStatus';
import type { Rule } from './types';

const validRule = {
  id: 'r1',
  name: 'R',
  enabled: true,
  method: 'ANY' as const,
  host: 'a.com',
  pathTemplate: '/x',
  query: [],
  action: { type: 'rewrite' as const, target: '/y', status: 302 },
};

describe('collectRuleIssues（编辑区自动保存反馈的可定位问题）', () => {
  it('合法规则表返回空列表', () => {
    expect(collectRuleIssues([validRule])).toEqual([]);
  });

  it('「添加条件」后的空参数名：定位到具体规则与条件下标', () => {
    const issues = collectRuleIssues([
      validRule,
      {
        host: 'b.com',
        action: { target: '/z' },
        query: [{ name: '', op: 'exists', value: '' }],
      },
    ]);
    expect(issues).toHaveLength(1);
    expect(issues[0].ruleIndex).toBe(1);
    expect(issues[0].conditionIndex).toBe(0);
    expect(issues[0].field).toBe('query');
    expect(issues[0].message).toContain('参数名不能为空');
  });

  it('同表内的多个问题一次性收集，互不掩盖', () => {
    const issues = collectRuleIssues([
      {
        host: 'a.com',
        action: { type: 'rewrite', target: '' },
        query: [{ name: ' ', op: 'exists' }],
      },
      { host: 'b.com', action: { type: 'rewrite', target: '/z' } },
    ]);
    const messages = issues.map((x) => x.message);
    expect(messages.some((m) => m.includes('参数名不能为空'))).toBe(true);
    expect(messages.some((m) => m.includes('target 不能为空'))).toBe(true);
    const targetIssue = issues.find((x) => x.field === 'action.target');
    expect(targetIssue?.ruleIndex).toBe(0);
    expect(targetIssue?.conditionIndex).toBeNull();
  });

  it('参数名重复定位到后出现的条件，措辞与 validateRules 抛出的错误一致', () => {
    const data = [
      {
        host: 'a.com',
        action: { target: '/y' },
        query: [
          { name: 'env' },
          { name: 'other' },
          { name: 'env', op: 'equals', value: 'x' },
        ],
      },
    ];
    const issues = collectRuleIssues(data);
    const dup = issues.find((x) => x.message.includes('重复参数名'));
    expect(dup?.conditionIndex).toBe(2);
    expect(dup?.message).toBe('第 1 条规则的查询条件存在重复参数名「env」');
    expect(() => validateRules(data)).toThrow(dup!.message);
  });

  it('非数组返回 ruleIndex=-1 的顶层问题', () => {
    const issues = collectRuleIssues({});
    expect(issues).toEqual([
      {
        ruleIndex: -1,
        conditionIndex: null,
        message: 'JSON 顶层必须是规则数组',
      },
    ]);
  });

  it('validateRules 仍在第一个问题处抛出且消息不变（持久化层拒绝整表的既有契约）', () => {
    expect(() => validateRules([{ query: 'x=1' }])).toThrow(
      '第 1 条规则的 query 必须是数组',
    );
    expect(() => validateRules([{ query: [{ name: 1 }] }])).toThrow(
      'name 必须是字符串',
    );
  });
});

describe('resolveRulesSaveStatus', () => {
  it('ok 且未降级：saved，不视为未保存', () => {
    const status = resolveRulesSaveStatus({ ok: true }, []);
    expect(status.kind).toBe('saved');
    expect(isRulesUnsaved(status)).toBe(false);
  });

  it('ok 但 degraded：degraded，不冒充已持久化，也不触发离开提示', () => {
    const status = resolveRulesSaveStatus({ ok: true, degraded: true }, []);
    expect(status.kind).toBe('degraded');
    expect(isRulesUnsaved(status)).toBe(false);
  });

  it('invalidData：携带结构化问题，视为未保存', () => {
    const issues = collectRuleIssues([
      { ...validRule, query: [{ name: '', op: 'exists', value: '' }] } as Partial<Rule>,
    ]);
    const status = resolveRulesSaveStatus(
      { ok: false, invalidData: '第 1 条规则的第 1 条查询条件的参数名不能为空' },
      issues,
    );
    expect(status.kind).toBe('invalid');
    if (status.kind === 'invalid') {
      expect(status.issues[0].ruleIndex).toBe(0);
      expect(status.issues[0].conditionIndex).toBe(0);
    }
    expect(isRulesUnsaved(status)).toBe(true);
  });

  it('invalidData 但收集不到问题（防御情形）：退回原因文本而不是空提示', () => {
    const status = resolveRulesSaveStatus(
      { ok: false, invalidData: '底层校验失败细节' },
      [],
    );
    expect(status.kind).toBe('invalid');
    if (status.kind === 'invalid') {
      expect(status.issues).toHaveLength(1);
      expect(status.issues[0].message).toBe('底层校验失败细节');
    }
  });

  it('并发中止与存储错误：error 且视为未保存，原因可见', () => {
    const conflict = resolveRulesSaveStatus(
      { ok: false, abortedConflict: true },
      [],
    );
    expect(conflict.kind).toBe('error');
    expect(isRulesUnsaved(conflict)).toBe(true);

    const failed = resolveRulesSaveStatus(
      { ok: false, storageError: 'QuotaExceededError' },
      [],
    );
    expect(failed.kind).toBe('error');
    if (failed.kind === 'error') expect(failed.detail).toContain('QuotaExceededError');
  });
});

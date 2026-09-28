import { describe, expect, it } from 'vitest';
import type { Rule } from './types';
import { validateRules } from './validate';
import type { SaveResult } from './persistence';
import { buildSaveStatus, locateValidationError } from './ruleSaveStatus';

describe('locateValidationError', () => {
  it('解析「第 N 条规则的第 M 条查询条件」为 0 基序号', () => {
    expect(
      locateValidationError('第 2 条规则的第 3 条查询条件的参数名不能为空'),
    ).toEqual({ ruleIndex: 1, condIndex: 2 });
  });

  it('只能定位到规则时 condIndex 为 null', () => {
    expect(
      locateValidationError(
        '第 1 条规则的 action.target 不能为空（rewrite / redirect 需要目标）',
      ),
    ).toEqual({ ruleIndex: 0, condIndex: null });
  });

  it('重复参数名错误只定位到规则', () => {
    expect(
      locateValidationError('第 3 条规则的查询条件存在重复参数名「env」'),
    ).toEqual({ ruleIndex: 2, condIndex: null });
  });

  it('与规则无关的错误消息两个维度均为 null', () => {
    expect(locateValidationError('保存失败：原因未知')).toEqual({
      ruleIndex: null,
      condIndex: null,
    });
  });
});

describe('buildSaveStatus', () => {
  it('保存成功：saved=true 且无原因 / 定位', () => {
    expect(buildSaveStatus({ ok: true })).toEqual({
      saved: true,
      reason: null,
      ruleIndex: null,
      condIndex: null,
      degraded: false,
    });
  });

  it('降级保存成功：saved=true、degraded=true（界面据此不显示「已保存到本地」）', () => {
    expect(buildSaveStatus({ ok: true, degraded: true })).toMatchObject({
      saved: true,
      degraded: true,
      reason: null,
    });
  });

  it('校验失败：saved=false 且原因可定位到规则与条件', () => {
    const result: SaveResult = {
      ok: false,
      invalidData: '第 3 条规则的第 1 条查询条件的参数名不能为空',
    };
    expect(buildSaveStatus(result)).toMatchObject({
      saved: false,
      ruleIndex: 2,
      condIndex: 0,
      degraded: false,
    });
  });

  it('存储错误：saved=false 且原因透传', () => {
    const status = buildSaveStatus({ ok: false, storageError: '配额耗尽' });
    expect(status.saved).toBe(false);
    expect(status.reason).toBe('配额耗尽');
    expect(status.degraded).toBe(false);
  });

  it('并发冲突中止：saved=false 且提示编辑未丢失、无法定位', () => {
    const status = buildSaveStatus({ ok: false, abortedConflict: true });
    expect(status.saved).toBe(false);
    expect(status.reason).toContain('并发');
    expect(status.ruleIndex).toBeNull();
  });

  it('保存失败但无任何原因字段时给出兜底原因', () => {
    const status = buildSaveStatus({ ok: false });
    expect(status.saved).toBe(false);
    expect(status.reason).toContain('原因未知');
  });
});

describe('与 validateRules 的衔接（添加条件后空参数名的整表拒绝）', () => {
  function emptyRule(id: string, query: Rule['query']): Rule {
    return {
      id,
      name: id,
      enabled: true,
      method: 'ANY',
      host: 'example.com',
      pathTemplate: '/',
      query,
      action: { type: 'stop', target: '', status: 302 },
    };
  }

  it('空参数名条件的校验消息可定位到对应规则与条件', () => {
    const rules = [
      emptyRule('a', []),
      emptyRule('b', [{ name: '', op: 'exists', value: '' }]),
    ];
    let message = '';
    try {
      validateRules(rules);
      throw new Error('应当校验失败');
    } catch (err) {
      message = err instanceof Error ? err.message : String(err);
    }
    expect(message).toContain('参数名不能为空');
    expect(locateValidationError(message)).toEqual({ ruleIndex: 1, condIndex: 0 });
  });

  it('补齐参数名后通过校验（界面据此自动保存并消除提示）', () => {
    const rules = [
      emptyRule('b', [{ name: 'env', op: 'exists', value: '' }]),
    ];
    expect(() => validateRules(rules)).not.toThrow();
  });
});

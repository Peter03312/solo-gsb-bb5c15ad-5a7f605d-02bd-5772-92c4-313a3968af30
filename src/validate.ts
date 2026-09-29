import type { QueryCondition, Rule } from './types';
import { METHOD_MATCHERS, QUERY_OPERATORS, REDIRECT_STATUSES } from './types';

export function uid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `r-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * 一条可定位的规则校验问题。
 * - ruleIndex：规则在规则表中的下标（0 基；-1 表示规则表顶层结构问题）；
 * - conditionIndex：查询条件下标（0 基）；规则级问题为 null；
 * - field：问题字段（界面高亮用），如 query / action.target；
 * - message：完整中文原因，沿用校验层措辞（本身含「第 N 条规则的第 M 条查询条件…」定位）。
 */
export interface RuleIssue {
  ruleIndex: number;
  conditionIndex: number | null;
  field?: string;
  message: string;
}

interface ReportOptions {
  field?: string;
  conditionIndex?: number | null;
}

/** 校验问题上报：抛出模式立即抛错；收集模式逐条记录后继续检查其余字段 */
type Report = (
  ruleIndex: number,
  message: string,
  opts?: ReportOptions,
) => void;

/**
 * 校验并规范化一条规则的查询参数条件。
 * 字段缺失（旧数据）时回退为空条件数组。
 * 抛出模式在第一个问题处中止；收集模式继续检查并规范化其余条件，
 * 参数名重复定位到后出现的那条条件（与历史报错信息一致）。
 * 返回 ok=false 表示本规则至少存在一个 query 相关问题。
 */
function checkQuery(
  rawQuery: unknown,
  at: string,
  ruleIndex: number,
  report: Report,
): { ok: boolean; conds: QueryCondition[] } {
  if (rawQuery === undefined) return { ok: true, conds: [] };
  if (!Array.isArray(rawQuery)) {
    report(ruleIndex, `${at}的 query 必须是数组`, { field: 'query' });
    return { ok: false, conds: [] };
  }
  let ok = true;
  const conds: QueryCondition[] = [];
  const seen = new Set<string>();
  rawQuery.forEach((rawCond, j) => {
    const atCond = `${at}的第 ${j + 1} 条查询条件`;
    const fail = (message: string, field?: string): void => {
      ok = false;
      report(ruleIndex, message, { field, conditionIndex: j });
    };
    if (!isRecord(rawCond)) {
      fail(`${atCond}不是对象`, 'query');
      return;
    }
    const name = rawCond.name ?? '';
    if (typeof name !== 'string') {
      fail(`${atCond}的 name 必须是字符串`, 'query');
      return;
    }
    if (name.trim() === '') {
      fail(`${atCond}的参数名不能为空`, 'query');
      return;
    }
    const op = rawCond.op ?? 'exists';
    if (
      typeof op !== 'string' ||
      !(QUERY_OPERATORS as readonly string[]).includes(op)
    ) {
      fail(
        `${atCond}的 op 必须是 ${QUERY_OPERATORS.join(' / ')} 之一`,
        'query',
      );
      return;
    }
    const value = rawCond.value ?? '';
    if (typeof value !== 'string') {
      fail(`${atCond}的 value 必须是字符串`, 'query');
      return;
    }
    const cond: QueryCondition = {
      name: name.trim(),
      op: op as QueryCondition['op'],
      value,
    };
    if (seen.has(cond.name)) {
      fail(`${at}的查询条件存在重复参数名「${cond.name}」`, 'query');
    }
    seen.add(cond.name);
    conds.push(cond);
  });
  return { ok, conds };
}

/** 校验并规范化单条规则；抛出模式遇错即停，收集模式尽量补全默认值并继续 */
function checkRule(
  raw: unknown,
  i: number,
  resolveId: (rawId: unknown) => string,
  report: Report,
): Rule {
  const at = `第 ${i + 1} 条规则`;
  const fail = (message: string, opts?: ReportOptions): void =>
    report(i, message, opts);

  if (!isRecord(raw)) {
    fail(`${at}不是对象`);
    return {
      id: resolveId(null),
      name: `规则 ${i + 1}`,
      enabled: true,
      method: 'ANY',
      host: '',
      pathTemplate: '',
      query: [],
      action: { type: 'rewrite', target: '', status: 302 },
    };
  }

  let rawMethod = raw.method ?? 'ANY';
  const methodOk =
    typeof rawMethod === 'string' &&
    (METHOD_MATCHERS as readonly string[]).includes(rawMethod);
  if (!methodOk) {
    fail(`${at}的 method 必须是 ${METHOD_MATCHERS.join(' / ')} 之一`, {
      field: 'method',
    });
    rawMethod = 'ANY';
  }

  let host = '';
  if (raw.host !== undefined) {
    if (typeof raw.host !== 'string') {
      fail(`${at}的 host 必须是字符串`, { field: 'host' });
    } else {
      host = raw.host;
    }
  }

  let pathTemplate = '';
  if (raw.pathTemplate !== undefined) {
    if (typeof raw.pathTemplate !== 'string') {
      fail(`${at}的 pathTemplate 必须是字符串`, {
        field: 'pathTemplate',
      });
    } else {
      pathTemplate = raw.pathTemplate;
    }
  }

  const queryResult = checkQuery(raw.query, at, i, report);

  let action: Rule['action'] = { type: 'rewrite', target: '', status: 302 };
  const rawAction = raw.action ?? {};
  if (!isRecord(rawAction)) {
    fail(`${at}的 action 必须是对象`, { field: 'action' });
  } else {
    let type: Rule['action']['type'] =
      rawAction.type === 'rewrite' ||
      rawAction.type === 'redirect' ||
      rawAction.type === 'stop'
        ? rawAction.type
        : 'rewrite';
    if (
      rawAction.type !== undefined &&
      rawAction.type !== 'rewrite' &&
      rawAction.type !== 'redirect' &&
      rawAction.type !== 'stop'
    ) {
      fail(`${at}的 action.type 必须是 rewrite / redirect / stop 之一`, {
        field: 'action.type',
      });
    }
    const rawTarget = rawAction.target ?? '';
    let target = '';
    if (typeof rawTarget !== 'string') {
      fail(`${at}的 action.target 必须是字符串`, {
        field: 'action.target',
      });
    } else {
      target = rawTarget;
      if (type !== 'stop' && target.trim() === '') {
        fail(`${at}的 action.target 不能为空（rewrite / redirect 需要目标）`, {
          field: 'action.target',
        });
      }
    }
    const rawStatus = rawAction.status ?? 302;
    let status = 302;
    if (
      typeof rawStatus !== 'number' ||
      !(REDIRECT_STATUSES as readonly number[]).includes(rawStatus)
    ) {
      fail(
        `${at}的 action.status 必须是 ${REDIRECT_STATUSES.join(' / ')} 之一`,
        { field: 'action.status' },
      );
    } else {
      status = rawStatus;
    }
    action = { type, target, status };
  }

  // 收集模式下返回的 Rule[] 只用于补全 id；各字段的非法值已全部经 fail 上报
  return {
    id: resolveId(raw.id),
    name: typeof raw.name === 'string' && raw.name !== '' ? raw.name : `规则 ${i + 1}`,
    enabled: typeof raw.enabled === 'boolean' ? raw.enabled : true,
    method: methodOk ? (rawMethod as Rule['method']) : 'ANY',
    host,
    pathTemplate,
    // query 一旦含非法条件即整体放弃规范化（合法路径仍走 validateRules 的返回值）
    query: queryResult.ok ? queryResult.conds : [],
    action,
  };
}

/**
 * 遍历规则表做校验 / 规范化。id 按原顺序去重：首次出现的非空 id 原样保留，
 * 重复或缺失的 id 重新生成（不与原数据携带的 id 及已分配的 id 相撞），
 * 保证规则表内 id 唯一，规则顺序与匹配字段不受影响。
 */
function checkRules(
  data: readonly unknown[],
  genId: () => string,
  report: Report,
): Rule[] {
  // 先收集原数据携带的全部非空 id：补发的新 id 除不能撞已分配的 id 外，
  // 也不能撞原数据中尚未遍历到的 id，否则会抢占后续规则首次出现时应保留的 id
  const incoming = new Set<string>();
  for (const raw of data) {
    if (isRecord(raw) && typeof raw.id === 'string' && raw.id !== '') {
      incoming.add(raw.id);
    }
  }
  const assigned = new Set<string>();
  const resolveId = (rawId: unknown): string => {
    if (typeof rawId === 'string' && rawId !== '' && !assigned.has(rawId)) {
      assigned.add(rawId);
      return rawId;
    }
    let id = genId();
    while (assigned.has(id) || incoming.has(id)) id = genId();
    assigned.add(id);
    return id;
  };
  return data.map((raw, i) => checkRule(raw, i, resolveId, report));
}

/**
 * 校验并规范化导入的规则 JSON。
 * 字段缺失时给出合理默认值，类型错误时抛出带位置信息的中文错误。
 * 遇到的第一个问题即抛出（消息与历史版本完全一致），供持久化层拒绝整张写入、
 * 导入流程报错使用；需要一次拿到全部问题（编辑区反馈）时用 collectRuleIssues。
 */
export function validateRules(data: unknown, genId: () => string = uid): Rule[] {
  if (!Array.isArray(data)) {
    throw new Error('JSON 顶层必须是规则数组');
  }
  const issues: RuleIssue[] = [];
  const rules = checkRules(data, genId, (ruleIndex, message, opts) => {
    issues.push({
      ruleIndex,
      conditionIndex: opts?.conditionIndex ?? null,
      ...(opts?.field !== undefined ? { field: opts.field } : {}),
      message,
    });
  });
  if (issues.length > 0) throw new Error(issues[0].message);
  return rules;
}

/**
 * 收集整张规则表的全部校验问题（不抛错），供编辑区逐条展示与定位。
 * 规则表本身不是数组时返回一条 ruleIndex=-1 的顶层问题。
 */
export function collectRuleIssues(
  data: unknown,
  genId: () => string = uid,
): RuleIssue[] {
  if (!Array.isArray(data)) {
    return [{ ruleIndex: -1, conditionIndex: null, message: 'JSON 顶层必须是规则数组' }];
  }
  const issues: RuleIssue[] = [];
  checkRules(data, genId, (ruleIndex, message, opts) => {
    issues.push({
      ruleIndex,
      conditionIndex: opts?.conditionIndex ?? null,
      ...(opts?.field !== undefined ? { field: opts.field } : {}),
      message,
    });
  });
  return issues;
}

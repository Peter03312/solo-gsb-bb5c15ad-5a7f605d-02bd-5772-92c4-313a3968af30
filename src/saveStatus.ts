import type { RuleIssue } from './validate';

/**
 * 规则表自动保存的反馈状态。
 *
 * - saved：最近一次整张规则表写入已持久化到浏览器本地存储；
 * - degraded：写入只落在本页内存副本（存储已降级），沿用顶部降级横幅的口径，
 *   绝不算作已持久化；
 * - invalid：规则表未通过校验（如「添加条件」后参数名为空），持久化层拒绝整张
 *   写入——磁盘仍是上一份有效数据，当前编辑完整保留在页面内存，修正后自动重试；
 * - error：存储层写入失败（且未被降级适配器兜住，如并发中止 / 意外异常）。
 */
export type RulesSaveStatus =
  | { kind: 'saved' }
  | { kind: 'degraded'; detail: string }
  | { kind: 'invalid'; issues: RuleIssue[] }
  | { kind: 'error'; detail: string };

export const SAVED: RulesSaveStatus = { kind: 'saved' };

/** 当前状态是否意味着「最新编辑尚未持久化，刷新 / 离开会丢失本轮改动」 */
export function isRulesUnsaved(status: RulesSaveStatus): boolean {
  return status.kind === 'invalid' || status.kind === 'error';
}

/**
 * 把持久化层的保存结果转成界面反馈。
 * 校验失败时以结构化问题列表给出（可定位到规则 / 条件），不使用 saveStore
 * 拼好的 invalidData 字符串。
 */
export function resolveRulesSaveStatus(
  result: {
    ok: boolean;
    invalidData?: string;
    abortedConflict?: boolean;
    storageError?: string;
    degraded?: boolean;
  },
  issues: RuleIssue[],
): RulesSaveStatus {
  if (result.ok) {
    return result.degraded
      ? {
          kind: 'degraded',
          detail:
            '浏览器本地存储不可用，本次改动只保存在本页内存副本中，刷新或关闭页面可能恢复为旧数据（或丢失）。',
        }
      : SAVED;
  }
  if (result.invalidData !== undefined) {
    return {
      kind: 'invalid',
      // 持久化层的拒绝必须由结构化问题承载；理论上与 invalidData 同时出现，
      // 极端情况下（校验器与存储层不一致）退回原因文本，避免无提示
      issues:
        issues.length > 0
          ? issues
          : [{ ruleIndex: -1, conditionIndex: null, message: result.invalidData }],
    };
  }
  if (result.abortedConflict) {
    return {
      kind: 'error',
      detail:
        '检测到另一个标签页 / 窗口正在保存同一份规则，本次自动保存已安全中止（未改动任何数据），继续编辑即会重试。',
    };
  }
  return {
    kind: 'error',
    detail: result.storageError
      ? `写入浏览器本地存储失败：${result.storageError}`
      : '写入浏览器本地存储失败（未知原因），当前编辑保留在页面中，继续编辑即会重试。',
  };
}

import type { SaveResult } from './persistence';

/**
 * 规则表自动保存状态（界面展示用）。
 *
 * 规则表的每次编辑都会经版本化持久化层原子写入（见 persistence.ts）：
 * 数据先过当前版本校验，校验不过不触碰任何键。因此保存失败时：
 * - 当前编辑原样保留在界面（历史快照不回退）；
 * - 磁盘上仍是上一份有效数据，不会被半写入覆盖；
 * - 用户修正后自动保存最新整张规则表，状态随之消除。
 */
export interface RuleSaveStatus {
  /** 最近一次保存尝试是否成功（数据已通过校验；降级模式下数据在本页内存副本中完整） */
  saved: boolean;
  /** 未保存的原因（可展示给用户的中文消息）；saved 时为 null */
  reason: string | null;
  /** 未保存定位到的规则序号（0 起，对应规则卡片顺序），无法定位时为 null */
  ruleIndex: number | null;
  /** 未保存定位到的查询条件序号（0 起），无法定位到条件时为 null */
  condIndex: number | null;
  /**
   * 本次保存是否只落在本页内存副本（存储已降级）：数据在本页面完整可读，
   * 但刷新可能丢失。界面不得把这种情况显示为「已保存到本地」。
   */
  degraded: boolean;
}

const RULE_RE = /第\s*(\d+)\s*条规则/;
const COND_RE = /第\s*(\d+)\s*条查询条件/;

/**
 * 从校验错误消息中解析「第 N 条规则 / 第 M 条查询条件」定位。
 * 解析失败的维度返回 null（如存储层错误无法定位到具体规则）。
 */
export function locateValidationError(message: string): {
  ruleIndex: number | null;
  condIndex: number | null;
} {
  const ruleMatch = message.match(RULE_RE);
  const condMatch = message.match(COND_RE);
  return {
    ruleIndex: ruleMatch ? Number(ruleMatch[1]) - 1 : null,
    condIndex: condMatch ? Number(condMatch[1]) - 1 : null,
  };
}

/** 持久化层保存结果 → 界面保存状态 */
export function buildSaveStatus(result: SaveResult): RuleSaveStatus {
  if (result.ok) {
    return {
      saved: true,
      reason: null,
      ruleIndex: null,
      condIndex: null,
      degraded: result.degraded ?? false,
    };
  }
  // 临时键被并发写入方替换：本次写入安全中止，未改动主键，调用方保有的状态不丢。
  // 下一次编辑会重新发起写入，这里按未保存提示，避免用户误以为已持久化。
  if (result.abortedConflict) {
    return {
      saved: false,
      reason: '保存被并发写入中止（本轮编辑未丢失），请再编辑一次以重新保存',
      ruleIndex: null,
      condIndex: null,
      degraded: false,
    };
  }
  const reason =
    result.invalidData ?? result.storageError ?? '保存失败：原因未知，本轮编辑尚未写入本地存储';
  const loc = locateValidationError(reason);
  return {
    saved: false,
    reason,
    ruleIndex: loc.ruleIndex,
    condIndex: loc.condIndex,
    degraded: false,
  };
}

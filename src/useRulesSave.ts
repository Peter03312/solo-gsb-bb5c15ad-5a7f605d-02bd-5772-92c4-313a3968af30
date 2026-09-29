import { useEffect, useState } from 'react';
import type { Rule } from './types';
import type { ManagedStore } from './persistence';
import { collectRuleIssues } from './validate';
import {
  resolveRulesSaveStatus,
  SAVED,
  isRulesUnsaved,
  type RulesSaveStatus,
} from './saveStatus';

/**
 * 规则表自动保存的 React 绑定。
 *
 * 每次 rules 变化都把**整张规则表**交给版本化持久化层原子写入，并把结果转成
 * 编辑区反馈：
 * - 校验失败（如新增条件后参数名为空、目标为空）：持久化层不触碰任何键，
 *   磁盘保留上一份有效数据，当前编辑留在页面状态中；反馈携带可定位到规则 /
 *   条件的问题列表，用户修正后下一次变化自动重新保存并消除提示；
 * - 存储降级：保存只落在本页内存，状态为 degraded（不算持久化，沿用顶部横幅）；
 * - 其他写入失败：保留当前编辑并提示原因，后续编辑自动重试。
 *
 * 仅在校验 / 写入失败导致最新编辑尚未持久化时，挂载浏览器标准 beforeunload
 * 离开提示；degraded 不重复弹原生对话框（已有顶部降级横幅明示风险）。
 */
export function useRulesSave(
  rules: readonly Rule[],
  managed: ManagedStore<Rule[]> | null,
): RulesSaveStatus {
  const [status, setStatus] = useState<RulesSaveStatus>(SAVED);

  useEffect(() => {
    if (managed === null) return;
    const result = managed.save(rules as Rule[]);
    const issues = result.invalidData !== undefined ? collectRuleIssues(rules) : [];
    setStatus(resolveRulesSaveStatus(result, issues));
  }, [rules, managed]);

  useEffect(() => {
    if (!isRulesUnsaved(status)) return;
    const onBeforeUnload = (e: BeforeUnloadEvent): void => {
      // 浏览器标准离开提示：最新编辑未通过校验 / 未保存，刷新或离开会回退到
      // 磁盘上的上一份有效数据
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [status]);

  return status;
}

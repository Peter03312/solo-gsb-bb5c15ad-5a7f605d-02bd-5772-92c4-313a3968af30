import type { Rule } from '../types';
import type { RulesSaveStatus } from '../saveStatus';

interface Props {
  status: RulesSaveStatus;
  rules: readonly Rule[];
  /** 点击某条原因：滚动定位到对应规则卡片（及条件行）并短暂高亮 */
  onLocate: (ruleIndex: number, conditionIndex: number | null) => void;
}

/**
 * 规则表自动保存反馈（位于规则编辑区内部）：
 * - saved：已持久化到本地；
 * - degraded：仅本页内存（口径与顶部降级横幅一致，明确「未持久化」）；
 * - invalid：校验失败，整张规则表被持久化层拒绝，磁盘仍是上一份有效数据；
 *   逐条列出可定位到规则 / 条件的原因，点击即可滚动高亮；
 * - error：存储层写入失败 / 并发中止。
 * 用户修正后下一次自动保存成功，本提示自动消除。
 */
export function RulesSaveStatusBar({ status, rules, onLocate }: Props) {
  if (status.kind === 'saved') {
    return (
      <div className="rules-save-state saved" role="status">
        ✓ 已自动保存到浏览器本地
      </div>
    );
  }

  if (status.kind === 'degraded') {
    return (
      <div className="banner warn rules-save-state" role="status">
        <strong>⚠️ 未持久化：{status.detail}</strong>
      </div>
    );
  }

  if (status.kind === 'error') {
    return (
      <div className="banner error rules-save-state" role="alert">
        <strong>⚠️ 规则表未保存：</strong>
        {status.detail}
        <span className="rules-save-hint">当前编辑仍保留在页面中，稍后自动重试。</span>
      </div>
    );
  }

  const located = status.issues.filter((issue) => issue.ruleIndex >= 0 && issue.ruleIndex < rules.length);
  const topLevel = status.issues.filter((issue) => issue.ruleIndex < 0 || issue.ruleIndex >= rules.length);

  return (
    <div className="banner error rules-save-state" role="alert">
      <div className="rules-save-head">
        <strong>
          ⚠️ 当前规则表未通过校验，本轮编辑尚未保存（本地仍保留上一份有效规则，刷新会回到它）：
        </strong>
        <span className="rules-save-hint">修正下列问题后会自动保存整表并消除提示。</span>
      </div>
      <ul className="rules-save-issues">
        {located.map((issue, k) => {
          const rule = rules[issue.ruleIndex];
          // 消息本身含「第 N 条规则（的）第 M 条查询条件」定位前缀，
          // 按钮前缀已经给出规则名与条件序号，这里剥掉前缀只留原因本身
          let reason = issue.message
            .replace(/^第 \d+ 条规则的?/, '')
            .trim();
          if (issue.conditionIndex !== null) {
            reason = reason
              .replace(/^第 \d+ 条查询条件的?/, '')
              .trim();
          }
          return (
            <li key={`${issue.ruleIndex}-${issue.conditionIndex ?? 'r'}-${k}`}>
              <button
                type="button"
                className="rules-save-issue-link"
                title={`定位到第 ${issue.ruleIndex + 1} 条规则${
                  issue.conditionIndex !== null
                    ? `的第 ${issue.conditionIndex + 1} 条查询条件`
                    : ''
                }`}
                onClick={() => onLocate(issue.ruleIndex, issue.conditionIndex)}
              >
                {`第 ${issue.ruleIndex + 1} 条规则「${rule.name}」${
                  issue.conditionIndex !== null
                    ? ` · 第 ${issue.conditionIndex + 1} 条条件`
                    : ''
                }：${reason}`}
              </button>
            </li>
          );
        })}
        {topLevel.map((issue, k) => (
          <li key={`top-${k}`}>{issue.message}</li>
        ))}
      </ul>
    </div>
  );
}

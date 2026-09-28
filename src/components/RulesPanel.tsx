import { useCallback, useMemo, useRef, useState } from 'react';
import type { Rule } from '../types';
import { uid, validateRules } from '../validate';
import { analyzeShadowing, type ShadowReport } from '../shadow';
import { SAMPLE_RULES } from '../samples';
import { RuleCard } from './RuleCard';
import { BundleExportDialog } from './BundleExportDialog';
import type { RuleHistoryApi } from '../useRuleHistory';
import type { RuleSaveStatus } from '../ruleSaveStatus';

interface Props {
  history: RuleHistoryApi;
  onShare: () => void;
  /** 已设置断点的规则 id 集合（仅当前页面会话保留） */
  breakpoints: ReadonlySet<string>;
  onToggleBreakpoint: (ruleId: string) => void;
  /** 规则表自动保存状态（成功 / 未保存原因与定位 / 仅内存降级） */
  saveStatus: RuleSaveStatus;
}

/** 文本输入框的合并会话：聚焦开始、连续输入、失焦合并为一步 */
export interface TextSession<T> {
  begin: () => void;
  change: (next: T) => void;
  end: (next: T) => void;
}

/** 「定位」按钮触发的一次滚动 + 闪烁：nonce 每次点击递增以重复触发动画 */
interface LocateState {
  ruleIndex: number;
  condIndex: number | null;
  nonce: number;
}

export function RulesPanel({
  history,
  onShare,
  breakpoints,
  onToggleBreakpoint,
  saveStatus,
}: Props) {
  const { rules, canUndo, canRedo, commit } = history;
  const fileRef = useRef<HTMLInputElement>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [exportingBundle, setExportingBundle] = useState(false);
  const [locate, setLocate] = useState<LocateState | null>(null);
  const cardRefs = useRef(new Map<number, HTMLDivElement>());
  const locateSeq = useRef(0);

  const setCardRef = useCallback(
    (i: number) =>
      (el: HTMLDivElement | null): void => {
        if (el) cardRefs.current.set(i, el);
        else cardRefs.current.delete(i);
      },
    [],
  );

  /** 未保存横幅的「定位」：高亮并滚动到保存错误对应的规则 / 条件 */
  const handleLocate = useCallback(() => {
    const { ruleIndex, condIndex } = saveStatus;
    if (ruleIndex === null) return;
    locateSeq.current += 1;
    const nonce = locateSeq.current;
    setLocate({ ruleIndex, condIndex, nonce });
    // 等本轮渲染挂载高亮后再滚动，保证目标卡片已是最新 DOM
    requestAnimationFrame(() => {
      cardRefs.current
        .get(ruleIndex)
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }, [saveStatus]);

  // 遮蔽诊断：规则表每次变化（增删、排序、字段、启停）即时重新分析，
  // 仅作提示，不影响模拟执行
  const shadowMap = useMemo(() => {
    const map = new Map<string, ShadowReport>();
    for (const report of analyzeShadowing(rules)) map.set(report.ruleId, report);
    return map;
  }, [rules]);

  const update = (i: number, next: Rule) =>
    commit(rules.map((r, j) => (j === i ? next : r)));

  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= rules.length) return;
    const next = [...rules];
    [next[i], next[j]] = [next[j], next[i]];
    commit(next);
  };

  const remove = (i: number) => commit(rules.filter((_, j) => j !== i));

  const add = () =>
    commit([
      ...rules,
      {
        id: uid(),
        name: `规则 ${rules.length + 1}`,
        enabled: true,
        method: 'ANY',
        host: 'example.com',
        pathTemplate: '/',
        query: [],
        action: { type: 'rewrite', target: '/', status: 302 },
      },
    ]);

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(rules, null, 2)], {
      type: 'application/json',
    });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'url-rules.json';
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const importJson = async (file: File) => {
    try {
      const text = await file.text();
      const parsed = validateRules(JSON.parse(text));
      commit(parsed);
      setImportError(null);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : String(err));
    }
  };

  /** 某条规则的文本输入会话：编辑先落到对应卡片，失焦时合并为一步 */
  const textSession = (i: number): TextSession<Rule> => ({
    begin: history.beginSession,
    change: (next) => history.editSession(rules.map((r, j) => (j === i ? next : r))),
    end: (next) => history.endSession(rules.map((r, j) => (j === i ? next : r))),
  });

  return (
    <section className="panel">
      <div className="panel-title">
        <h2>规则表（按顺序匹配，首条命中生效）</h2>
        <div className="toolbar">
          <button onClick={history.undo} disabled={!canUndo} title="撤销（Ctrl/Cmd+Z）">
            ↶ 撤销
          </button>
          <button
            onClick={history.redo}
            disabled={!canRedo}
            title="重做（Ctrl/Cmd+Shift+Z）"
          >
            ↷ 重做
          </button>
          <span className="toolbar-sep" aria-hidden />
          <button onClick={add}>＋ 添加规则</button>
          <button onClick={() => fileRef.current?.click()}>导入 JSON</button>
          <button onClick={exportJson} disabled={rules.length === 0}>
            导出 JSON
          </button>
          <button onClick={() => setExportingBundle(true)}>导出路由器</button>
          <button onClick={onShare}>加密分享</button>
          <button onClick={() => commit(structuredClone(SAMPLE_RULES))}>
            载入示例
          </button>
          <button
            className="danger"
            disabled={rules.length === 0}
            onClick={() => commit([])}
          >
            清空
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void importJson(f);
              e.target.value = '';
            }}
          />
        </div>
      </div>

      <div className="rule-save-state" role="status" aria-live="polite">
        {saveStatus.saved ? (
          saveStatus.degraded ? (
            <span className="save-state degraded">
              仅本页内存（本地存储不可用，刷新可能丢失，详见顶部提示）
            </span>
          ) : (
            <span className="save-state ok">✓ 已自动保存到本地</span>
          )
        ) : (
          <span className="save-state unsaved">● 有未保存的修改</span>
        )}
      </div>

      {importError && <div className="banner error">导入失败：{importError}</div>}

      {!saveStatus.saved && saveStatus.reason && (
        <div className="banner error rule-save-banner" role="alert">
          <div className="rule-save-head">
            <strong>未保存：{saveStatus.reason}</strong>
            {saveStatus.ruleIndex !== null && (
              <button onClick={handleLocate}>
                定位到第 {saveStatus.ruleIndex + 1} 条规则
                {saveStatus.condIndex !== null
                  ? `的第 ${saveStatus.condIndex + 1} 条查询条件`
                  : ''}
              </button>
            )}
          </div>
          <p className="rule-save-hint">
            当前编辑保留在页面中，本地存储仍是上一份有效规则表；修正上述问题后会自动保存最新整张规则表，本提示随之消失。
            刷新或离开页面前浏览器会弹出标准离开提示。
          </p>
        </div>
      )}

      {shadowMap.size > 0 && (
        <div className="banner warn">
          ⚠️ 遮蔽诊断：{shadowMap.size} 条已启用规则不可达（全部被更早的启用规则覆盖），
          详见对应规则卡片。诊断仅作提示，不影响模拟执行。
        </div>
      )}

      {rules.length === 0 ? (
        <p className="empty">暂无规则。点击「添加规则」或「载入示例」开始。</p>
      ) : (
        rules.map((rule, i) => (
          <RuleCard
            key={rule.id}
            rule={rule}
            index={i}
            total={rules.length}
            shadow={shadowMap.get(rule.id)}
            breakpoint={breakpoints.has(rule.id)}
            onCommit={(next) => update(i, next)}
            session={textSession(i)}
            onMove={(dir) => move(i, dir)}
            onRemove={() => remove(i)}
            onToggleBreakpoint={() => onToggleBreakpoint(rule.id)}
            cardRef={setCardRef(i)}
            errorRule={!saveStatus.saved && saveStatus.ruleIndex === i}
            errorCond={
              !saveStatus.saved && saveStatus.ruleIndex === i
                ? saveStatus.condIndex
                : null
            }
            locateNonce={locate?.ruleIndex === i ? locate.nonce : 0}
          />
        ))
      )}

      {exportingBundle && (
        <BundleExportDialog rules={rules} onClose={() => setExportingBundle(false)} />
      )}
    </section>
  );
}

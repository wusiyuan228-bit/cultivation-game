/**
 * S_RULE 规则介绍弹窗（通用组件）
 *
 * 所有规则文本从 /config/ui/rules_text.json 动态加载，策划可编辑。
 * 用法：
 *   <RuleModal ruleKey="coop_battle" open={open} onClose={...} />
 *
 * 支持模板替换（如 final_battle 中的 {{faction_goal}}）。
 */
import React, { useEffect, useState } from 'react';
import { asset } from '@/utils/assetPath';
import { AnimatePresence, motion } from 'framer-motion';
import type { RulesTextData, RuleKey, RuleContent, Faction } from '@/types/game';
import styles from './RuleModal.module.css';

interface Props {
  open: boolean;
  ruleKey: RuleKey;
  onClose: () => void;
  /** 对 final_battle：传入玩家阵营，用于替换 {{faction_goal}} */
  faction?: Faction | 'swing_A' | 'swing_B';
  /** 自定义标题（覆盖 JSON 中的 title） */
  titleOverride?: string;
  /** 自定义确认按钮文字 */
  confirmText?: string;
}

// 模块级缓存，避免重复 fetch
let rulesCache: RulesTextData | null = null;
let rulesPromise: Promise<RulesTextData | null> | null = null;

function fetchRules(): Promise<RulesTextData | null> {
  if (rulesCache) return Promise.resolve(rulesCache);
  if (rulesPromise) return rulesPromise;
  rulesPromise = fetch(asset('config/ui/rules_text.json'))
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => {
      rulesCache = d;
      return d;
    })
    .catch(() => null);
  return rulesPromise;
}

/**
 * S5 入门测试前置规则（内置，不走 JSON —— 因为 rules_text.json 只有战斗场景）
 */
const S5_ENTRY_RULE: RuleContent = {
  title: '入门测试 — 规则说明',
  sections: [
    {
      subtitle: '战斗考核',
      text: '每次发起攻击，双方同时投掷二面骰子\n骰子数量 = 修为值\n造成伤害 = 我方点数和 − 敌方点数和（最少 1 点）',
    },
    {
      subtitle: '理论考核',
      text: '四选一修仙知识问答。心境值越高，排除项越多',
    },
    {
      subtitle: '拜师仪式',
      text: '完成全部考核后，进行拜师仪式，获得奖励',
    },
  ],
};

export const RuleModal: React.FC<Props> = ({
  open,
  ruleKey,
  onClose,
  faction,
  titleOverride,
  confirmText = '我已了解，开始！',
}) => {
  const [content, setContent] = useState<RuleContent | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;

    if (ruleKey === 's5_entry') {
      setContent(S5_ENTRY_RULE);
      setError(null);
      return;
    }

    let canceled = false;
    fetchRules().then((data) => {
      if (canceled) return;
      if (!data) {
        setError('规则文本加载失败');
        return;
      }
      const base = data[ruleKey as 'coop_battle' | 'arena_battle' | 'final_battle'];
      if (!base) {
        setError(`规则 ${ruleKey} 不存在`);
        return;
      }
      // 处理 final_battle 的 {{faction_goal}} 模板
      if (ruleKey === 'final_battle' && faction && data.final_battle.faction_goals) {
        const goal =
          data.final_battle.faction_goals[faction] ??
          data.final_battle.faction_goals[(faction as string).startsWith('swing') ? faction : faction] ??
          '';
        const processed: RuleContent = {
          title: base.title,
          sections: base.sections.map((s) =>
            s.text.includes('{{faction_goal}}') ? { ...s, text: s.text.replace('{{faction_goal}}', goal) } : s
          ),
        };
        setContent(processed);
      } else {
        setContent(base);
      }
      setError(null);
    });

    return () => {
      canceled = true;
    };
  }, [open, ruleKey, faction]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className={styles.overlay}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <motion.div
            className={styles.scroll}
            initial={{ scale: 0.9, opacity: 0, y: 20 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.9, opacity: 0, y: 20 }}
            transition={{ duration: 0.3, ease: 'easeOut' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className={styles.rod} data-side="top" />

            <div className={styles.paper}>
              <h2 className={styles.title}>
                {titleOverride ?? content?.title ?? '规则说明'}
              </h2>
              <div className={styles.divider} />

              {error ? (
                <div className={styles.errorMsg}>{error}</div>
              ) : !content ? (
                <div className={styles.loading}>展开卷轴中...</div>
              ) : (
                <div className={styles.sectionList}>
                  {content.sections.map((sec, i) => (
                    <div key={i} className={styles.section}>
                      <h3 className={styles.subtitle}>{sec.subtitle}</h3>
                      <p className={styles.bodyText}>{sec.text}</p>
                    </div>
                  ))}
                </div>
              )}

              <div className={styles.actionBar}>
                <button
                  type="button"
                  className={styles.confirmBtn}
                  onClick={onClose}
                  disabled={!content}
                >
                  {confirmText}
                </button>
              </div>
            </div>

            <div className={styles.rod} data-side="bottom" />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

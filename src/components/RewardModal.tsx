/**
 * S_REWARD 奖励抉择弹窗（每次抽卡前出现）
 *
 * 三个选项竖排：
 *   ① 提升境界：消耗灵石升境（凡人→炼气 3 / 炼气→筑基 5 / 筑基→结丹 8）
 *   ② 招募道友：进入 S6 抽卡
 *   ③ 进入下一阶段：保留灵石继续冒险
 *
 * 选择 ①/② 完成后返回此界面继续选择，选择 ③ 正式关闭
 *
 * 用法：
 *   <RewardModal open onClose={...} onRecruit={() => navigate('/s6')} onAdvance={() => ...} />
 */
import React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useGameStore } from '@/stores/gameStore';
import styles from './RewardModal.module.css';

interface Props {
  open: boolean;
  /** 关闭（不论哪种流转都调这个先关） */
  onClose: () => void;
  /** 选择"招募道友"回调：通常导航到 /s6 */
  onRecruit?: () => void;
  /** 选择"进入下一阶段"回调（继续主线） */
  onAdvance?: () => void;
  /** 自定义标题 */
  title?: string;
}

const LEVEL_COST: Record<string, number> = {
  凡人: 3,
  炼气: 5,
  筑基: 8,
  结丹: 0,
};

const NEXT_LEVEL: Record<string, string> = {
  凡人: '炼气',
  炼气: '筑基',
  筑基: '结丹',
  结丹: '—',
};

export const RewardModal: React.FC<Props> = ({ open, onClose, onRecruit, onAdvance, title = '灵石分配' }) => {
  const spiritStones = useGameStore((s) => s.spiritStones);
  const mentalLevel = useGameStore((s) => s.mentalLevel);
  const upgradeMentalLevel = useGameStore((s) => s.upgradeMentalLevel);
  const [feedback, setFeedback] = React.useState<string | null>(null);

  const cost = LEVEL_COST[mentalLevel] ?? 0;
  const nextLv = NEXT_LEVEL[mentalLevel] ?? '—';
  const canUpgrade = mentalLevel !== '结丹' && spiritStones >= cost;

  const handleUpgrade = () => {
    const ok = upgradeMentalLevel();
    if (ok) {
      setFeedback(`✨ 境界提升至「${NEXT_LEVEL[mentalLevel]}」！消耗灵石 ${cost}`);
      setTimeout(() => setFeedback(null), 2200);
    } else {
      setFeedback('灵石不足或已达最高境界');
      setTimeout(() => setFeedback(null), 1800);
    }
  };

  const handleRecruit = () => {
    onClose();
    onRecruit?.();
  };

  const handleAdvance = () => {
    onClose();
    onAdvance?.();
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className={styles.overlay}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <motion.div
            className={styles.panel}
            initial={{ scale: 0.9, opacity: 0, y: 20 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.9, opacity: 0, y: 20 }}
            transition={{ duration: 0.3, ease: 'easeOut' }}
          >
            <div className={styles.header}>
              <h2 className={styles.title}>{title}</h2>
              <div className={styles.stoneRow}>
                <span className={styles.stoneIcon}>◈</span>
                <span className={styles.stoneNum}>{spiritStones}</span>
                <span className={styles.stoneLabel}>灵石</span>
                <span className={styles.levelTag}>境界：{mentalLevel}</span>
              </div>
            </div>

            <div className={styles.divider} />

            {/* 选项 1：提升境界 */}
            <button
              type="button"
              className={`${styles.option} ${styles.optUpgrade}`}
              onClick={handleUpgrade}
              disabled={!canUpgrade}
            >
              <span className={styles.optIcon}>✨</span>
              <div className={styles.optBody}>
                <div className={styles.optTitle}>提升境界</div>
                <div className={styles.optDesc}>
                  {mentalLevel === '结丹'
                    ? '已达最高境界'
                    : `消耗灵石 ${cost}，突破至「${nextLv}」`}
                </div>
              </div>
              <span className={styles.optArrow}>›</span>
            </button>

            {/* 选项 2：招募道友 */}
            <button
              type="button"
              className={`${styles.option} ${styles.optRecruit}`}
              onClick={handleRecruit}
            >
              <span className={styles.optIcon}>🎴</span>
              <div className={styles.optBody}>
                <div className={styles.optTitle}>招募道友</div>
                <div className={styles.optDesc}>进入招募界面获取新伙伴（S6 开放后启用）</div>
              </div>
              <span className={styles.optArrow}>›</span>
            </button>

            {/* 选项 3：进入下一阶段 */}
            <button
              type="button"
              className={`${styles.option} ${styles.optAdvance}`}
              onClick={handleAdvance}
            >
              <span className={styles.optIcon}>→</span>
              <div className={styles.optBody}>
                <div className={styles.optTitle}>进入下一阶段</div>
                <div className={styles.optDesc}>保留灵石，继续冒险</div>
              </div>
              <span className={styles.optArrow}>›</span>
            </button>

            <AnimatePresence>
              {feedback && (
                <motion.div
                  className={styles.feedback}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                >
                  {feedback}
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

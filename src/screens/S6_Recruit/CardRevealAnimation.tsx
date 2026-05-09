/**
 * 抽卡演出动画 —— 按稀有度分档
 * - 全屏遮罩通过 createPortal 渲染到 body，绕过 stage 的 transform scale
 * - 玩家可点击任意位置提前关闭
 * - AI 回合自动在 DURATION 后关闭
 */
import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import type { PoolCard } from '@/types/recruit';
import styles from './CardRevealAnimation.module.css';

interface Props {
  card: PoolCard | null;
  visible: boolean;
  /** 可点击关闭（玩家可点击任意位置提前结束，AI 自动计时） */
  canDismiss?: boolean;
  onFinish: () => void;
}

const DURATION: Record<string, number> = {
  N: 900,
  R: 1400,
  SR: 1800,
  SSR: 2500,
  UR: 3000,
};

const RARITY_COLOR: Record<string, string> = {
  N: '#8a8a8a',
  R: '#4a9a6a',
  SR: '#b47bff',
  SSR: '#ffd65e',
  UR: '#a83b3b',
};

export const CardRevealAnimation: React.FC<Props> = ({ card, visible, canDismiss = false, onFinish }) => {
  useEffect(() => {
    if (visible && card) {
      const dur = DURATION[card.rarity] ?? 1000;
      const t = setTimeout(() => onFinish(), dur);
      return () => clearTimeout(t);
    }
  }, [visible, card, onFinish]);

  return (
    <AnimatePresence>
      {visible && card && createPortal(
        <motion.div
          className={styles.overlay}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={canDismiss ? () => onFinish() : undefined}
          style={{ cursor: canDismiss ? 'pointer' : 'default' }}
        >
          {/* 稀有度光效 */}
          <div
            className={`${styles.glow} ${styles[`glow_${card.rarity}`]}`}
            style={{ ['--rarity-color' as any]: RARITY_COLOR[card.rarity] }}
          />

          {/* 卡面 */}
          <motion.div
            className={styles.card}
            style={{ borderColor: RARITY_COLOR[card.rarity] }}
            initial={{ scale: 0.3, rotateY: 180, opacity: 0 }}
            animate={{ scale: 1, rotateY: 0, opacity: 1 }}
            transition={{ duration: 0.6, ease: 'easeOut' }}
          >
            <div
              className={styles.rarityTag}
              style={{ background: RARITY_COLOR[card.rarity] }}
            >
              {card.rarity}
            </div>
            <div className={styles.cardName}>{card.name}</div>
            <div className={styles.cardSub}>
              {card.ip} · {card.type} · {card.realm}
            </div>
            <div className={styles.stats}>
              <span>气血 {card.hp}</span>
              <span>修为 {card.atk}</span>
              <span>心境 {card.mnd}</span>
            </div>
            {card.runSkill && (
              <div className={styles.skill}>
                <div className={styles.skillName}>【{card.runSkill.name}】</div>
                <div className={styles.skillDesc}>{card.runSkill.desc}</div>
              </div>
            )}
            {canDismiss && (
              <div className={styles.dismissHint}>点击任意处关闭</div>
            )}
          </motion.div>
        </motion.div>,
        document.body
      )}
    </AnimatePresence>
  );
};

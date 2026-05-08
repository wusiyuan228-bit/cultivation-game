/**
 * 顶栏·卡池横条 —— 紧凑显示剩余/稀有度统计
 * 2026-04-27 调整：去除 hint 文字，去除空稀有度显示
 */
import React from 'react';
import { motion } from 'framer-motion';
import type { Rarity } from '@/types/recruit';
import styles from './CardPoolDisplay.module.css';

interface Props {
  remaining: number;
  total: number;
  rarityCounts: Record<Rarity, number>;
  onClick: () => void;
}

export const CardPoolDisplay: React.FC<Props> = ({ remaining, total, rarityCounts, onClick }) => {
  return (
    <motion.button
      className={styles.poolBar}
      onClick={onClick}
      whileHover={{ scale: 1.03 }}
      whileTap={{ scale: 0.98 }}
    >
      <span className={styles.label}>当前卡池</span>
      <span className={styles.count}>
        <span className={styles.countNum}>{remaining}</span>
        <span className={styles.countTotal}> / {total}</span>
      </span>
      <span className={styles.sep}>·</span>
      <span className={styles.rarityGroup}>
        {rarityCounts.SSR > 0 && (
          <span className={`${styles.rarityTag} ${styles.ssr}`}>SSR {rarityCounts.SSR}</span>
        )}
        {rarityCounts.SR > 0 && (
          <span className={`${styles.rarityTag} ${styles.sr}`}>SR {rarityCounts.SR}</span>
        )}
        {rarityCounts.R > 0 && (
          <span className={`${styles.rarityTag} ${styles.r}`}>R {rarityCounts.R}</span>
        )}
        {rarityCounts.N > 0 && (
          <span className={`${styles.rarityTag} ${styles.n}`}>N {rarityCounts.N}</span>
        )}
      </span>
    </motion.button>
  );
};

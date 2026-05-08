/**
 * 指定抽卡弹窗（designate_paid 如蛮胡子）
 */
import React, { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import type { PoolCard } from '@/types/recruit';
import styles from './DesignatePickModal.module.css';

interface Props {
  open: boolean;
  pool: PoolCard[];
  onPick: (id: string) => void;
  onClose: () => void;
}

const RARITY_COLOR: Record<string, string> = {
  N: '#8a8a8a',
  R: '#4a9a6a',
  SR: '#3b6fa8',
  SSR: '#c8a14b',
  UR: '#a83b3b',
};

export const DesignatePickModal: React.FC<Props> = ({ open, pool, onPick, onClose }) => {
  const [filter, setFilter] = useState<'all' | 'R' | 'N'>('all');
  const shown = filter === 'all' ? pool : pool.filter((c) => c.rarity === filter);

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
            className={styles.panel}
            initial={{ scale: 0.9 }}
            animate={{ scale: 1 }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2>指定抽卡</h2>
            <p>从卡池中选择一张卡直接获取（支付灵石已扣除）</p>
            <div className={styles.filter}>
              <button
                className={filter === 'all' ? styles.active : ''}
                onClick={() => setFilter('all')}
              >全部 ({pool.length})</button>
              <button
                className={filter === 'R' ? styles.active : ''}
                onClick={() => setFilter('R')}
              >R ({pool.filter((c) => c.rarity === 'R').length})</button>
              <button
                className={filter === 'N' ? styles.active : ''}
                onClick={() => setFilter('N')}
              >N ({pool.filter((c) => c.rarity === 'N').length})</button>
            </div>
            <div className={styles.grid}>
              {shown.map((c) => (
                <button
                  key={c.id}
                  className={styles.card}
                  style={{ borderColor: RARITY_COLOR[c.rarity] }}
                  onClick={() => onPick(c.id)}
                >
                  <span className={styles.rarity} style={{ background: RARITY_COLOR[c.rarity] }}>
                    {c.rarity}
                  </span>
                  <span className={styles.name}>{c.name}</span>
                  <span className={styles.type}>{c.type}</span>
                </button>
              ))}
            </div>
            <button className={styles.close} onClick={onClose}>取消</button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

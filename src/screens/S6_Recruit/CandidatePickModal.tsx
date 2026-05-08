/**
 * 候选卡选择弹窗（preview_N 技能使用后）
 */
import React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import type { PoolCard } from '@/types/recruit';
import styles from './CandidatePickModal.module.css';

interface Props {
  open: boolean;
  candidates: PoolCard[];
  onPick: (id: string) => void;
}

const RARITY_COLOR: Record<string, string> = {
  N: '#8a8a8a',
  R: '#4a9a6a',
  SR: '#3b6fa8',
  SSR: '#c8a14b',
  UR: '#a83b3b',
};

export const CandidatePickModal: React.FC<Props> = ({ open, candidates, onPick }) => {
  return (
    <AnimatePresence>
      {open && candidates.length > 0 && (
        <motion.div
          className={styles.overlay}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <motion.div
            className={styles.panel}
            initial={{ scale: 0.8, y: 30 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.9, opacity: 0 }}
          >
            <h2 className={styles.title}>请选择保留 1 张</h2>
            <p className={styles.sub}>其他卡将放回卡池底部</p>
            <div className={styles.grid}>
              {candidates.map((c) => (
                <motion.button
                  key={c.id}
                  className={styles.card}
                  style={{ borderColor: RARITY_COLOR[c.rarity] }}
                  onClick={() => onPick(c.id)}
                  whileHover={{ y: -8, scale: 1.04 }}
                  whileTap={{ scale: 0.97 }}
                >
                  <div className={styles.rarity} style={{ background: RARITY_COLOR[c.rarity] }}>
                    {c.rarity}
                  </div>
                  <div className={styles.cardName}>{c.name}</div>
                  <div className={styles.cardType}>
                    {c.ip} · {c.type}
                  </div>
                  <div className={styles.cardStats}>
                    气血 {c.hp} · 修为 {c.atk} · 心境 {c.mnd}
                  </div>
                  {c.runSkill && (
                    <div className={styles.skill}>
                      <div className={styles.skillName}>【{c.runSkill.name}】</div>
                      <div className={styles.skillDesc}>{c.runSkill.desc}</div>
                    </div>
                  )}
                </motion.button>
              ))}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

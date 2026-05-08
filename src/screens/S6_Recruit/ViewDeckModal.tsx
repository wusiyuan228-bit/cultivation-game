/**
 * 查看某参与者的已收集卡册（只读）
 *   - 点击他人"持卡 X 张"打开此弹窗
 *   - 布局与 SwitchCardModal 一致（立绘 / 稀有度-类型 / 名称 / 技能）
 */
import React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import type { Participant } from '@/types/recruit';
import { getCachedImage } from '@/utils/imageCache';
import styles from './ViewDeckModal.module.css';

interface Props {
  open: boolean;
  participant: Participant | null;
  onClose: () => void;
}

const RARITY_COLOR: Record<string, string> = {
  N: '#8a8a8a',
  R: '#4a9a6a',
  SR: '#3b6fa8',
  SSR: '#c8a14b',
  UR: '#a83b3b',
};

export const ViewDeckModal: React.FC<Props> = ({ open, participant, onClose }) => {
  return (
    <AnimatePresence>
      {open && participant && (
        <motion.div
          className={styles.overlay}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <motion.div
            className={styles.panel}
            initial={{ scale: 0.92, y: 20 }}
            animate={{ scale: 1, y: 0 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className={styles.header}>
              <h2 className={styles.title}>{participant.name} · 已收集卡牌</h2>
              <span className={styles.subtitle}>
                共 {participant.ownedCards.length} 张 · 灵石 {participant.gems}
              </span>
            </div>

            {participant.ownedCards.length === 0 ? (
              <div className={styles.empty}>暂未拥有任何卡</div>
            ) : (
              <div className={styles.grid}>
                {participant.ownedCards.map((c) => {
                  const portraitUrl = getCachedImage(c.id);
                  return (
                    <div
                      key={c.id}
                      className={styles.card}
                      style={{ borderColor: RARITY_COLOR[c.rarity] }}
                    >
                      <div className={styles.portraitBox}>
                        <div
                          className={styles.portraitImg}
                          style={{ backgroundImage: `url(${portraitUrl})` }}
                        />
                      </div>
                      <div className={styles.headerRow}>
                        <span className={styles.rarity} style={{ background: RARITY_COLOR[c.rarity] }}>
                          {c.rarity}
                        </span>
                        <span className={styles.type}>{c.type}</span>
                      </div>
                      <div className={styles.name}>{c.name}</div>
                      <div className={styles.stats}>
                        <span className={styles.statItem}>修为 <strong>{c.atk}</strong></span>
                        <span className={styles.statItem}>心境 <strong>{c.mnd}</strong></span>
                        <span className={styles.statItem}>生命 <strong>{c.hp}</strong></span>
                      </div>
                      {c.runSkill ? (
                        <div className={styles.skill}>
                          <div className={styles.skillName}>【{c.runSkill.name}】</div>
                          <div className={styles.skillDesc}>{c.runSkill.desc}</div>
                        </div>
                      ) : (
                        <div className={styles.noSkill}>（无抽卡技能）</div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            <button className={styles.close} onClick={onClose}>关闭</button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

/**
 * 替换抽卡代理角色 弹窗（2026-04-27 重构）
 *   - 加入立绘小图
 *   - 去掉 IP 字段
 *   - 布局：立绘 / [稀有度 修士类型] / 名称 / 技能描述
 */
import React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import type { Participant } from '@/types/recruit';
import { getCachedImage } from '@/utils/imageCache';
import styles from './SwitchCardModal.module.css';

interface Props {
  open: boolean;
  participant: Participant;
  onPick: (cardId: string) => void;
  onClose: () => void;
}

const RARITY_COLOR: Record<string, string> = {
  N: '#8a8a8a',
  R: '#4a9a6a',
  SR: '#3b6fa8',
  SSR: '#c8a14b',
  UR: '#a83b3b',
};

export const SwitchCardModal: React.FC<Props> = ({ open, participant, onPick, onClose }) => {
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
            initial={{ scale: 0.92, y: 20 }}
            animate={{ scale: 1, y: 0 }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2>更换抽卡代理角色</h2>
            <p className={styles.hint}>
              每小轮可换 1 次 · 本轮刚抽到的 R 卡需下一大轮才可使用技能
            </p>
            <div className={styles.grid}>
              {participant.ownedCards.map((c) => {
                const isCurrent = c.id === participant.activeCardId;
                const lockedByTurn = participant.rCardsDrawnThisTurn.includes(c.id);
                const disabled = isCurrent || lockedByTurn;
                const portraitUrl = getCachedImage(c.id);
                return (
                  <button
                    key={c.id}
                    className={`${styles.card} ${isCurrent ? styles.current : ''} ${lockedByTurn ? styles.locked : ''}`}
                    style={{ borderColor: RARITY_COLOR[c.rarity] }}
                    disabled={disabled}
                    onClick={() => onPick(c.id)}
                  >
                    {/* 立绘 */}
                    <div className={styles.portraitBox}>
                      <div
                        className={styles.portraitImg}
                        style={{ backgroundImage: `url(${portraitUrl})` }}
                      />
                    </div>

                    {/* 稀有度 + 修士类型 */}
                    <div className={styles.headerRow}>
                      <span className={styles.rarity} style={{ background: RARITY_COLOR[c.rarity] }}>
                        {c.rarity}
                      </span>
                      <span className={styles.type}>{c.type}</span>
                    </div>

                    {/* 名称 */}
                    <div className={styles.name}>{c.name}</div>

                    {/* 技能 */}
                    {c.runSkill ? (
                      <div className={styles.skill}>
                        <div className={styles.skillName}>【{c.runSkill.name}】</div>
                        <div className={styles.skillDesc}>{c.runSkill.desc}</div>
                      </div>
                    ) : (
                      <div className={styles.noSkill}>（无抽卡技能）</div>
                    )}

                    {isCurrent && <div className={styles.badge}>当前</div>}
                    {lockedByTurn && <div className={styles.badgeLock}>本轮新抽 · 下轮可用</div>}
                  </button>
                );
              })}
            </div>
            <button className={styles.close} onClick={onClose}>取消</button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

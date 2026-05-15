/**
 * 查看某参与者的已收集卡册（只读）
 *   - 点击他人"持卡 X 张"打开此弹窗
 *   - 布局与 SwitchCardModal 一致（立绘 / 稀有度-类型 / 名称 / 技能）
 *
 * 🔧 2026-05-15：属性值改为有效值（叠加境界提升 + 拜师加成），与
 *    S6 主界面、S7B/S7D 战斗界面、剧情阅读、图鉴等保持一致。
 *    - 主角卡（isHeroBattleCard）：走 getEffectiveHeroStats(c.id, includeMentor=true)
 *    - 普通卡：走 getEffectiveCardStats({hp,atk,mnd}, c.id) 仅叠 cardBonuses
 */
import React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import type { Participant } from '@/types/recruit';
import type { HeroId } from '@/types/game';
import { getCachedImage } from '@/utils/imageCache';
import { getEffectiveHeroStats, getEffectiveCardStats } from '@/utils/heroStats';
import styles from './ViewDeckModal.module.css';

interface Props {
  open: boolean;
  participant: Participant | null;
  onClose: () => void;
  /**
   * 是否显示战斗技能与绝技。
   * - S6 招募阶段：false（玩家还没进战斗，避免信息过载）
   * - S7A 及之后：true（战斗环节已开启，玩家需要参考技能描述）
   * 默认 false。
   */
  showBattleSkill?: boolean;
}

const RARITY_COLOR: Record<string, string> = {
  N: '#8a8a8a',
  R: '#4a9a6a',
  SR: '#b47bff',
  SSR: '#ffd65e',
  UR: '#a83b3b',
};

export const ViewDeckModal: React.FC<Props> = ({ open, participant, onClose, showBattleSkill = false }) => {
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
                  // 🔧 2026-05-15：计算有效属性
                  let effHp = c.hp, effAtk = c.atk, effMnd = c.mnd;
                  let realmUps = 0; // 该卡境界提升次数（用于显示 +N tag）
                  let mentorPlus = false; // 主角卡是否带拜师加成
                  if (c.isHeroBattleCard) {
                    // 主角卡：c.id 就是 HeroId
                    const eff = getEffectiveHeroStats(c.id as HeroId, { includeMentor: true });
                    effHp = eff.hp;
                    effAtk = eff.atk;
                    effMnd = eff.mnd;
                    mentorPlus = eff.mentorBonusAtk > 0 || eff.mentorBonusMnd > 0;
                    if (eff.realmBonusHp || eff.realmBonusAtk || eff.realmBonusMnd) {
                      // 至少有一维 +1 即视为提升过 1 次（具体次数从 cardBonuses.realmUps 拿更准）
                      realmUps = Math.max(eff.realmBonusHp, eff.realmBonusAtk, eff.realmBonusMnd);
                    }
                  } else {
                    const eff = getEffectiveCardStats(
                      { hp: c.hp, atk: c.atk, mnd: c.mnd },
                      c.id,
                    );
                    effHp = eff.hp;
                    effAtk = eff.atk;
                    effMnd = eff.mnd;
                    realmUps = Math.max(
                      eff.hp - c.hp,
                      eff.atk - c.atk,
                      eff.mnd - c.mnd,
                    );
                  }
                  const hpUp = effHp > c.hp;
                  const atkUp = effAtk > c.atk;
                  const mndUp = effMnd > c.mnd;
                  return (
                    <div
                      key={c.id}
                      className={styles.card}
                      style={{ borderColor: RARITY_COLOR[c.rarity] }}
                      title={
                        (realmUps > 0 ? `境界提升 ×${realmUps}` : '') +
                        (mentorPlus ? (realmUps > 0 ? ' · ' : '') + '已拜师' : '')
                      }
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
                        <span className={styles.statItem}>
                          修为 <strong style={atkUp ? { color: '#7fffaa' } : undefined}>{effAtk}</strong>
                        </span>
                        <span className={styles.statItem}>
                          心境 <strong style={mndUp ? { color: '#7fffaa' } : undefined}>{effMnd}</strong>
                        </span>
                        <span className={styles.statItem}>
                          生命 <strong style={hpUp ? { color: '#7fffaa' } : undefined}>{effHp}</strong>
                        </span>
                      </div>
                      {c.runSkill ? (
                        <div className={styles.skill}>
                          <div className={styles.skillName}>【招募·{c.runSkill.name}】</div>
                          <div className={styles.skillDesc}>{c.runSkill.desc}</div>
                        </div>
                      ) : (
                        <div className={styles.noSkill}>（无招募技能）</div>
                      )}
                      {showBattleSkill && c.battleSkill && (
                        <div className={styles.battleSkill}>
                          <div className={styles.battleSkillName}>【战斗·{c.battleSkill.name}】</div>
                          <div className={styles.battleSkillDesc}>{c.battleSkill.desc}</div>
                        </div>
                      )}
                      {showBattleSkill && c.ultimate && (
                        <div className={styles.ultimate}>
                          <div className={styles.ultimateName}>【绝技·{c.ultimate.name}】</div>
                          <div className={styles.ultimateDesc}>{c.ultimate.desc}</div>
                        </div>
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

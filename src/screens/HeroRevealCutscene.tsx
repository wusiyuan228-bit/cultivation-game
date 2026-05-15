/**
 * 「仙缘初见」开场卡牌领取过场（首次进入第二章前触发，仅一次）
 *
 * 三段动画：
 *   1) 透明光球居中浮现，文字"仙缘初见"提示玩家点击
 *   2) 点击光球 → 光球碎裂消失，主角立绘卡从屏幕中心由小到大放大出现，
 *      卡面正面 = 立绘大图，金色光晕环绕（首次入场专属）
 *   3) 点击立绘卡 → 3D 翻转到技能详情看板（背面），再次点击翻回立绘
 *      关闭按钮 → 触发 onClose，由父组件继续后续流程（如跳第二章）
 *
 * 完全独立渲染，不复用 S4 已有的 detailModal（避免和"已收集卡牌"详情态打架）。
 */

import React, { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { getHeroById } from '@/hooks/useConfig';
import { getRealmAfterUps, useGameStore } from '@/stores/gameStore';
import { getCachedImage, getCachedCardFull } from '@/utils/imageCache';
import type { HeroId, CultivationType } from '@/types/game';
import styles from './HeroRevealCutscene.module.css';

const RARITY_COLOR = '#ffd65e'; // 主角统一 SSR 金色

const COUNTER_MAP: Record<CultivationType, { beats: string; beatenBy: string } | null> = {
  剑修: { beats: '妖修', beatenBy: '法修' },
  法修: { beats: '剑修', beatenBy: '灵修' },
  体修: { beats: '灵修', beatenBy: '妖修' },
  灵修: { beats: '法修', beatenBy: '体修' },
  妖修: { beats: '体修', beatenBy: '剑修' },
  丹修: null,
};

interface Props {
  heroId: HeroId;
  /** 关闭并继续后续流程（如跳第二章） */
  onClose: () => void;
}

type Stage = 'orb' | 'card';

export const HeroRevealCutscene: React.FC<Props> = ({ heroId, onClose }) => {
  const [stage, setStage] = useState<Stage>('orb');
  const [flipped, setFlipped] = useState(false); // false = 立绘正面（金光放大入场）, true = 技能详情看板

  const hero = getHeroById(heroId);
  const cardBonuses = useGameStore((s) => s.cardBonuses);
  const battleBonus = useGameStore((s) => s.battleBonus);
  const knowledgeBonus = useGameStore((s) => s.knowledgeBonus);

  if (!hero) {
    // 兜底：缺数据直接走完
    return null;
  }

  const counters = COUNTER_MAP[hero.type as CultivationType];
  const bonus = cardBonuses[heroId] ?? { hp: 0, atk: 0, mnd: 0, realmUps: 0 };
  const displayHp = hero.run_card.hp + bonus.hp;
  const displayAtk = hero.run_card.atk + bonus.atk + battleBonus;
  const displayMnd = hero.run_card.mnd + bonus.mnd + knowledgeBonus;
  const totalAtkBonus = bonus.atk + battleBonus;
  const totalMndBonus = bonus.mnd + knowledgeBonus;
  const totalHpBonus = bonus.hp;
  const currentRealm = getRealmAfterUps(hero.realm, bonus.realmUps);

  return (
    <motion.div
      className={styles.overlay}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.4 }}
      // 阻止背景剧情误响应键盘/点击
      onKeyDown={(e) => e.stopPropagation()}
    >
      <AnimatePresence mode="wait">
        {/* ============= 阶段 1：透明光球 ============= */}
        {stage === 'orb' && (
          <motion.div
            key="orb"
            className={styles.orbWrap}
            initial={{ opacity: 0, scale: 0.4 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 1.6 }}
            transition={{ duration: 0.6, ease: 'easeOut' }}
            onClick={() => setStage('card')}
          >
            <div className={styles.orbAura} />
            <div className={styles.orb}>
              <div className={styles.orbInner} />
              <div className={styles.orbHighlight} />
            </div>
            <div className={styles.orbText}>仙缘初见</div>
            <div className={styles.orbHint}>点击光球，开启仙缘</div>
          </motion.div>
        )}

        {/* ============= 阶段 2：金光卡牌（含 3D 翻转）============= */}
        {stage === 'card' && (
          <motion.div
            key="card"
            className={styles.cardStage}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
          >
            {/* 金色背景光柱（首次入场仪式专属） */}
            <div className={styles.goldenRays} />

            {/* 卡牌容器 —— 由小到大放大入场 */}
            <motion.div
              className={styles.cardWrap}
              initial={{ scale: 0.05, opacity: 0, rotateZ: -15 }}
              animate={{ scale: 1, opacity: 1, rotateZ: 0 }}
              transition={{
                duration: 0.9,
                ease: [0.16, 1, 0.3, 1], // easeOutExpo 般的缓动
              }}
            >
              {/* 金色发光边框（呼吸光晕）*/}
              <div className={styles.glowRing} />
              <div className={styles.glowRingOuter} />

              {/* 右上角翻面按钮：始终可点击，独立于卡牌 onClick */}
              <button
                type="button"
                className={styles.flipBtn}
                onClick={(e) => {
                  e.stopPropagation();
                  setFlipped((f) => !f);
                }}
                title={flipped ? '查看立绘' : '查看技能详情'}
                aria-label="翻转卡牌"
              >
                <span className={styles.flipBtnIcon}>⟳</span>
                <span className={styles.flipBtnText}>{flipped ? '看立绘' : '看技能'}</span>
              </button>

              <div
                className={`${styles.flipContainer} ${flipped ? styles.isFlipped : ''}`}
              >
                {/* ===== 正面：立绘大图（首次入场默认面） ===== */}
                <div className={`${styles.cardFace} ${styles.cardFaceFront}`}>
                  <div
                    className={styles.cardFullImg}
                    style={{ backgroundImage: `url(${getCachedCardFull(heroId)})` }}
                  />
                  {/* 金色边角装饰 */}
                  <div className={`${styles.corner} ${styles.cornerTL}`} />
                  <div className={`${styles.corner} ${styles.cornerTR}`} />
                  <div className={`${styles.corner} ${styles.cornerBL}`} />
                  <div className={`${styles.corner} ${styles.cornerBR}`} />

                  <div className={styles.cardFullMeta}>
                    <div className={styles.cardFullName}>{hero.name}</div>
                    <div className={styles.cardFullTags}>
                      <span className={styles.rarityTag}>SSR · {hero.type}</span>
                    </div>
                  </div>
                </div>

                {/* ===== 反面：技能详情看板 ===== */}
                <div className={`${styles.cardFace} ${styles.cardFaceBack}`}>
                  <div className={styles.detailView}>
                    <div className={styles.detailHeader}>
                      <div
                        className={styles.detailPortrait}
                        style={{ backgroundImage: `url(${getCachedImage(heroId)})` }}
                      />
                      <div className={styles.detailMeta}>
                        <div className={styles.detailName}>{hero.name}</div>
                        <div className={styles.detailRarity}>SSR · {hero.type}</div>
                        <div className={styles.detailRealm}>境界：{currentRealm}</div>
                        <div className={styles.statsBlock}>
                          <div className={styles.statsLabel}>属性</div>
                          <div className={styles.detailStats}>
                            <span>
                              生命 {displayHp}
                              {totalHpBonus > 0 && (
                                <em className={styles.bonusTip}>(+{totalHpBonus})</em>
                              )}
                            </span>
                            <span>
                              修为 {displayAtk}
                              {totalAtkBonus > 0 && (
                                <em className={styles.bonusTip}>(+{totalAtkBonus})</em>
                              )}
                            </span>
                            <span>
                              心境 {displayMnd}
                              {totalMndBonus > 0 && (
                                <em className={styles.bonusTip}>(+{totalMndBonus})</em>
                              )}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                    <div className={styles.detailDivider} />

                    {/* 招募技能 */}
                    <div className={styles.detailSection}>
                      <h3 className={styles.sectionTitle}>招募技能</h3>
                      {hero.battle_card.skills.run_skill ? (
                        <div className={styles.skillRow}>
                          <span className={styles.skillName}>
                            {hero.battle_card.skills.run_skill.name}
                          </span>
                          <span className={styles.skillDesc}>
                            {hero.battle_card.skills.run_skill.desc}
                          </span>
                        </div>
                      ) : (
                        <div className={styles.skillNone}>无</div>
                      )}
                    </div>

                    {/* 战斗技能（第二章前隐藏，但仪式发生时章节即将变为2，仍按 ch<3 隐藏战斗细节）*/}
                    <div className={styles.detailSection}>
                      <h3 className={styles.sectionTitle}>战斗技能</h3>
                      <div className={styles.skillLocked}>
                        <span className={styles.lockIcon}>🔒</span>
                        <span>战斗环节揭晓</span>
                      </div>
                    </div>

                    {/* 觉醒技能（如有）*/}
                    {hero.awakening && (
                      <div className={styles.detailSection}>
                        <h3 className={styles.sectionTitle}>觉醒技能</h3>
                        <div className={styles.skillLocked}>
                          <span className={styles.lockIcon}>🔒</span>
                          <span>需在战斗中满足特定条件后揭晓</span>
                        </div>
                      </div>
                    )}

                    <div className={styles.detailDivider} />

                    {/* 克制关系 */}
                    <div className={styles.detailSection}>
                      <h3 className={styles.sectionTitle}>克制关系</h3>
                      <div className={styles.counterInfo}>
                        {counters ? (
                          <>
                            <span className={styles.counterWin}>
                              克制 <strong>{counters.beats}</strong>
                            </span>
                            <span className={styles.counterLose}>
                              被 <strong>{counters.beatenBy}</strong> 克制
                            </span>
                          </>
                        ) : (
                          <span className={styles.counterNeutral}>
                            丹修 · 中立，不参与克制循环
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>

            {/* 关闭按钮 → 继续后续流程 */}
            <motion.button
              className={styles.continueBtn}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 1.0, duration: 0.4 }}
              onClick={(e) => {
                e.stopPropagation();
                onClose();
              }}
            >
              ✦ 携此仙缘，前往第二章 ✦
            </motion.button>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};

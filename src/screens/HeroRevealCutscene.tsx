/**
 * 「仙缘初见」开场卡牌领取过场（首次进入第二章前触发，仅一次）
 *
 * 三段动画：
 *   1) 透明光球居中浮现，文字"仙缘初见"提示玩家点击
 *   2) 点击光球 → 光球碎裂消失，主角立绘卡（3:4，与"已收集卡牌"详情页同尺寸）
 *      由小到大放大出现，金色光晕环绕（首次入场专属）
 *   3) 右上角"⟳ 看技能/看立绘"按钮可无限翻转：
 *       - 正面 = 立绘大图（与 S4 已收集卡牌「翻面看立绘」一致）
 *       - 反面 = 技能详情看板（直接复用 S4_StoryReading.module.css 的 detailView 样式）
 *      点击下方按钮 → onClose，由父组件继续后续流程（如跳第二章）
 *
 * 关键工程点：
 *   - 整个组件通过 createPortal 挂到 document.body
 *     → 绕过 .app-stage 的 transform: scale，避免 fixed 定位在 transform 祖先下退化
 *     → 解决"卡牌偏右、按钮偏右"的根因
 *   - 技能详情面 className 全部使用 S4_StoryReading.module.css 中已有的样式 token
 *     → 与「已收集卡牌→详情页」视觉完全一致（用户要求直接复用，不新创样式）
 */

import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { getHeroById } from '@/hooks/useConfig';
import { getRealmAfterUps, useGameStore } from '@/stores/gameStore';
import { getCachedImage, getCachedCardFull } from '@/utils/imageCache';
import type { HeroId, CultivationType } from '@/types/game';
import s4Styles from './S4_StoryReading.module.css';
import styles from './HeroRevealCutscene.module.css';

const RARITY_COLOR = '#ffd65e'; // 主角统一 SSR 金色
const RARITY_LABEL = 'SSR';

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
  const [flipped, setFlipped] = useState(false); // false = 立绘正面，true = 技能详情看板

  const hero = getHeroById(heroId);
  const cardBonuses = useGameStore((s) => s.cardBonuses);
  const battleBonus = useGameStore((s) => s.battleBonus);
  const knowledgeBonus = useGameStore((s) => s.knowledgeBonus);

  if (!hero) return null;

  const counters = COUNTER_MAP[hero.type as CultivationType];
  const bonus = cardBonuses[heroId] ?? { hp: 0, atk: 0, mnd: 0, realmUps: 0 };
  const displayHp = hero.run_card.hp + bonus.hp;
  const displayAtk = hero.run_card.atk + bonus.atk + battleBonus;
  const displayMnd = hero.run_card.mnd + bonus.mnd + knowledgeBonus;
  const totalAtkBonus = bonus.atk + battleBonus;
  const totalMndBonus = bonus.mnd + knowledgeBonus;
  const totalHpBonus = bonus.hp;
  const currentRealm = getRealmAfterUps(hero.realm, bonus.realmUps);

  const node = (
    <motion.div
      className={styles.overlay}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.4 }}
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
            {/* 卡牌后方：金色径向光板（明显可见的金光，非灰雾） */}
            <div className={styles.goldenHalo} />
            <div className={styles.goldenRays} />

            {/* 卡牌容器 —— 由小到大放大入场（尺寸与 S4 详情 modal 一致：640×854） */}
            <motion.div
              className={styles.cardWrap}
              initial={{ scale: 0.05, opacity: 0, rotateZ: -15 }}
              animate={{ scale: 1, opacity: 1, rotateZ: 0 }}
              transition={{
                duration: 0.9,
                ease: [0.16, 1, 0.3, 1],
              }}
            >
              {/* 右上角翻面按钮（独立于卡牌，可无限翻转） */}
              <button
                type="button"
                className={styles.flipBtnTop}
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

              {/* 复用 S4 的 detailModal 翻转骨架 */}
              <div
                className={`${s4Styles.flipContainer} ${flipped ? s4Styles.isFlipped : ''}`}
              >
                {/* ===== 正面：立绘大图（首次入场默认面，与 S4 反面立绘同样式） ===== */}
                <div
                  className={`${s4Styles.cardFace} ${s4Styles.cardFaceBack}`}
                  style={{ borderColor: RARITY_COLOR, transform: 'rotateY(0deg)' }}
                >
                  <div
                    className={s4Styles.cardFullImg}
                    style={{ backgroundImage: `url(${getCachedCardFull(heroId)})` }}
                  />
                  <div className={s4Styles.cardFullMeta}>
                    <div className={s4Styles.cardFullName}>{hero.name}</div>
                    <div className={s4Styles.cardFullTags}>
                      <span style={{ color: RARITY_COLOR }}>{RARITY_LABEL}</span>
                      <span>{hero.type}</span>
                    </div>
                  </div>
                </div>

                {/* ===== 反面：技能详情看板（与 S4 已收集卡牌详情页完全一致） ===== */}
                <div
                  className={`${s4Styles.cardFace} ${s4Styles.cardFaceFront}`}
                  style={{ borderColor: RARITY_COLOR, transform: 'rotateY(180deg)' }}
                >
                  <div
                    className={s4Styles.detailView}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className={s4Styles.detailHeader}>
                      <div
                        className={s4Styles.detailPortrait}
                        style={{
                          backgroundImage: `url(${getCachedImage(heroId)})`,
                          borderColor: RARITY_COLOR,
                        }}
                      />
                      <div className={s4Styles.detailMeta}>
                        <div className={s4Styles.detailName}>{hero.name}</div>
                        <div className={s4Styles.detailRarity} style={{ color: RARITY_COLOR }}>
                          {RARITY_LABEL} · {hero.type}
                        </div>
                        <div className={s4Styles.detailRealm}>境界：{currentRealm}</div>
                        <div className={s4Styles.statsBlock}>
                          <div className={s4Styles.statsLabel}>属性</div>
                          <div className={s4Styles.detailStats}>
                            <span>
                              生命 {displayHp}
                              {totalHpBonus > 0 && (
                                <em
                                  style={{ color: '#5be05b', fontSize: 12, marginLeft: 2, fontStyle: 'normal' }}
                                >(+{totalHpBonus})</em>
                              )}
                            </span>
                            <span>
                              修为 {displayAtk}
                              {totalAtkBonus > 0 && (
                                <em
                                  style={{ color: '#5be05b', fontSize: 12, marginLeft: 2, fontStyle: 'normal' }}
                                >(+{totalAtkBonus})</em>
                              )}
                            </span>
                            <span>
                              心境 {displayMnd}
                              {totalMndBonus > 0 && (
                                <em
                                  style={{ color: '#5be05b', fontSize: 12, marginLeft: 2, fontStyle: 'normal' }}
                                >(+{totalMndBonus})</em>
                              )}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className={s4Styles.detailDivider} />

                    {/* 招募技能 */}
                    <div className={s4Styles.detailSection}>
                      <h3 className={s4Styles.sectionTitle}>招募技能</h3>
                      {hero.battle_card.skills.run_skill ? (
                        <div className={s4Styles.skillRow}>
                          <span className={s4Styles.skillName}>{hero.battle_card.skills.run_skill.name}</span>
                          <span className={s4Styles.skillDesc}>{hero.battle_card.skills.run_skill.desc}</span>
                        </div>
                      ) : (
                        <div className={s4Styles.skillNone}>无</div>
                      )}
                    </div>

                    {/* 战斗技能（chapter<3 阶段统一显示"战斗环节揭晓"） */}
                    <div className={s4Styles.detailSection}>
                      <h3 className={s4Styles.sectionTitle}>战斗技能</h3>
                      <div className={s4Styles.awakeningHidden}>
                        <span className={s4Styles.lockIcon}>🔒</span>
                        <span>战斗环节揭晓</span>
                      </div>
                    </div>

                    {/* 觉醒技能（如有） */}
                    {hero.awakening && (
                      <div className={s4Styles.detailSection}>
                        <h3 className={s4Styles.sectionTitle}>觉醒技能</h3>
                        <div className={s4Styles.awakeningHidden}>
                          <span className={s4Styles.lockIcon}>🔒</span>
                          <span>觉醒条件与技能效果未知，需在战斗中满足特定条件后揭晓</span>
                        </div>
                      </div>
                    )}

                    <div className={s4Styles.detailDivider} />

                    {/* 克制关系 */}
                    <div className={s4Styles.detailSection}>
                      <h3 className={s4Styles.sectionTitle}>克制关系</h3>
                      <div className={s4Styles.counterInfo}>
                        {counters ? (
                          <>
                            <span className={s4Styles.counterWin}>
                              克制 <strong>{counters.beats}</strong>
                            </span>
                            <span className={s4Styles.counterLose}>
                              被 <strong>{counters.beatenBy}</strong> 克制
                            </span>
                          </>
                        ) : (
                          <span className={s4Styles.counterNeutral}>
                            丹修 · 中立，不参与克制循环
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>

            {/* 底部继续按钮 → 触发 onClose（fixed 屏幕居中，因 portal 已绕开 stage scale） */}
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

  // 关键：portal 到 body，绕开 .app-stage 的 transform: scale，
  // 否则 fixed/vw 等会被 transform 祖先吃掉，导致内容偏离屏幕中心。
  return createPortal(node, document.body);
};

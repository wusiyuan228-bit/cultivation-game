/**
 * 「仙缘初见」开场卡牌领取过场（首次进入第二章前触发，仅一次）
 *
 * 三段动画：
 *   1) 透明光球居中浮现，文字"仙缘初见"提示玩家点击
 *   2) 点击光球 → 主角立绘卡（3:4，与"已收集卡牌"详情页同尺寸 580×774）
 *      由小到大放大出现，金色光晕环绕（首次入场专属）
 *   3) 卡牌可翻面：
 *       - 整卡任意位置点击翻面（与 CollectionModal 行为一致）
 *       - 右上角 ⟳ 按钮（复用 S4 .flipBtn 样式）
 *
 * 进入第二章：在「卡牌」阶段，点击卡牌之外的任意空白处即触发 onClose
 *
 * 自适应方案（关键）：
 *   ★ 本组件渲染在 .app-stage 内部，依赖 App.tsx 的 transform: scale 整体缩放
 *   ★ 因此 overlay 用 position: absolute（覆盖 1920×1080 画布），不用 fixed
 *   ★ 卡牌、光球都用固定 px 尺寸 → 自动随画布等比缩放，与 S4 详情卡 / 抽卡演出行为完全一致
 *   ★ 严禁使用 createPortal 挂到 document.body，那会脱离画布缩放（UI_SPEC 明确禁令）
 */

import React, { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { getHeroById } from '@/hooks/useConfig';
import { getRealmAfterUps, useGameStore } from '@/stores/gameStore';
import { getCachedImage, getCachedCardFull } from '@/utils/imageCache';
import type { HeroId, CultivationType } from '@/types/game';
import s4Styles from './S4_StoryReading.module.css';
import styles from './HeroRevealCutscene.module.css';

const RARITY_COLOR = '#ffd65e';
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
  onClose: () => void;
}

type Stage = 'orb' | 'card';

export const HeroRevealCutscene: React.FC<Props> = ({ heroId, onClose }) => {
  const [stage, setStage] = useState<Stage>('orb');
  const [flipped, setFlipped] = useState(false);

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

  const toggleFlip = () => setFlipped((f) => !f);

  return (
    <motion.div
      className={styles.overlay}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.4 }}
      onClick={() => {
        // 仅在「卡牌」阶段，点击卡牌之外的任意空白处进入第二章
        if (stage === 'card') onClose();
      }}
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
            onClick={(e) => { e.stopPropagation(); setStage('card'); }}
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

        {/* ============= 阶段 2：金光卡牌 ============= */}
        {stage === 'card' && (
          <motion.div
            key="card"
            className={styles.cardStage}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
          >
            {/* 卡牌后方金色光板（不参与布局） */}
            <div className={styles.goldenHalo} />
            <div className={styles.goldenRays} />

            {/* 卡牌本体：固定 580×774，由 .app-stage 整体 transform: scale 自适应 */}
            <motion.div
              className={styles.cardWrap}
              initial={{ scale: 0.05, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
              onClick={(e) => e.stopPropagation()}
            >
              {/* 翻面骨架：整卡可点翻面（与 CollectionModal 一致） */}
              <div
                className={`${s4Styles.flipContainer} ${flipped ? s4Styles.isFlipped : ''}`}
                onClick={toggleFlip}
              >
                {/* 右上角小圆按钮（复用 S4 .flipBtn 样式） */}
                <button
                  type="button"
                  className={s4Styles.flipBtn}
                  onClick={(e) => { e.stopPropagation(); toggleFlip(); }}
                  title={flipped ? '翻面查看立绘' : '翻面查看技能详情'}
                  aria-label="翻转卡牌"
                >
                  ⟳
                </button>

                {/* ===== 正面：立绘大图 ===== */}
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

                {/* ===== 反面：技能详情看板（复用 S4 detailView） ===== */}
                <div
                  className={`${s4Styles.cardFace} ${s4Styles.cardFaceFront}`}
                  style={{ borderColor: RARITY_COLOR, transform: 'rotateY(180deg)' }}
                >
                  <div className={s4Styles.detailView}>
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
                                <em style={{ color: '#5be05b', fontSize: 12, marginLeft: 2, fontStyle: 'normal' }}>
                                  (+{totalHpBonus})
                                </em>
                              )}
                            </span>
                            <span>
                              修为 {displayAtk}
                              {totalAtkBonus > 0 && (
                                <em style={{ color: '#5be05b', fontSize: 12, marginLeft: 2, fontStyle: 'normal' }}>
                                  (+{totalAtkBonus})
                                </em>
                              )}
                            </span>
                            <span>
                              心境 {displayMnd}
                              {totalMndBonus > 0 && (
                                <em style={{ color: '#5be05b', fontSize: 12, marginLeft: 2, fontStyle: 'normal' }}>
                                  (+{totalMndBonus})
                                </em>
                              )}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className={s4Styles.detailDivider} />

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

                    <div className={s4Styles.detailSection}>
                      <h3 className={s4Styles.sectionTitle}>战斗技能</h3>
                      <div className={s4Styles.awakeningHidden}>
                        <span className={s4Styles.lockIcon}>🔒</span>
                        <span>战斗环节揭晓</span>
                      </div>
                    </div>

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
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};

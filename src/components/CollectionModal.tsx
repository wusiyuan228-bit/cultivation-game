/**
 * CollectionModal 已收集角色弹窗
 *
 * 复用 S4_StoryReading 的样式，提供"已收集角色列表 → 详情翻面"的完整查看体验。
 * 可在任何界面（S5c 拜师、S6 筹备阶段等）复用。
 *
 * Props:
 *  - open: 是否显示
 *  - onClose: 关闭回调
 *  - chapter?: 当前章节（影响决战卡属性展示），默认 1
 */
import React, { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useGameStore } from '@/stores/gameStore';
import { getRealmAfterUps } from '@/stores/gameStore';
import { getHeroById } from '@/hooks/useConfig';
import { getPoolCardById } from '@/systems/recruit/cardPoolLoader';
import { getCachedImage, getCachedCardFull } from '@/utils/imageCache';
import { getDisplayCardList } from '@/utils/cardDisplayOrder';
import { TYPE_TOKEN } from '@/data/heroConstants';
import type { HeroId, CultivationType, Hero } from '@/types/game';
import styles from '@/screens/S4_StoryReading.module.css';

const RARITY_COLOR: Record<string, string> = {
  N: '#8a8a8a',
  R: '#4a9a6a',
  SR: '#b47bff',
  SSR: '#ffd65e',
  UR: '#a83b3b',
};

const COUNTER_MAP: Record<CultivationType, { beats: string; beatenBy: string } | null> = {
  剑修: { beats: '妖修', beatenBy: '法修' },
  法修: { beats: '剑修', beatenBy: '灵修' },
  体修: { beats: '灵修', beatenBy: '妖修' },
  灵修: { beats: '法修', beatenBy: '体修' },
  妖修: { beats: '体修', beatenBy: '剑修' },
  丹修: null,
};

interface Props {
  open: boolean;
  onClose: () => void;
  chapter?: number;
  /**
   * 打开弹窗时直接跳到指定卡牌详情页（跳过列表视图）。
   *   - 若提供：打开即进详情；"返回列表"按钮会直接关闭弹窗（因为没有列表可回）
   *   - 若为空：行为同原版（先列表 → 点击进详情）
   */
  initialDetailId?: string | null;
  /**
   * 当 initialDetailId 存在时，是否完全隐藏"返回列表"按钮（避免无列表可回时按钮误导玩家）
   * 默认为 true（自动判断）
   */
  hideListReturn?: boolean;
  /**
   * 详情页底部的额外操作按钮（如 S7D 备战页的"加入卡组 / 移除"）。
   *   - 入参 = 当前详情卡的 id
   *   - 返回 ReactNode，会被渲染到详情页最底部
   */
  detailExtraActions?: (cardId: string) => React.ReactNode;
}

/**
 * 统一查找角色/卡牌信息
 * 主角 → 从 HEROES_DATA 查
 * R/N 卡 → 从卡池缓存查，映射成 Hero 兼容结构
 */
function resolveCard(id: string): Hero | null {
  const hero = getHeroById(id as HeroId);
  if (hero) return hero;
  // R/N 卡回退
  const poolCard = getPoolCardById(id);
  if (!poolCard) return null;
  return {
    id: poolCard.id,
    name: poolCard.name,
    tribute: poolCard.tribute ?? poolCard.name,
    rarity: poolCard.rarity,
    ip: poolCard.ip as any,
    type: poolCard.type as any,
    gender: poolCard.gender ?? '男',
    faction: '摇摆',
    realm: poolCard.realm,
    realm_level: 2,
    max_realm: '结丹',
    max_realm_level: 3,
    run_card: { hp: poolCard.hp, atk: poolCard.atk, mnd: poolCard.mnd, skills: { run_skill: poolCard.runSkill ? { name: poolCard.runSkill.name, desc: poolCard.runSkill.desc, type: 'recruit' } : null, battle_skill: null } },
    battle_card: { hp: poolCard.hp, atk: poolCard.atk, mnd: poolCard.mnd, skills: { run_skill: poolCard.runSkill ? { name: poolCard.runSkill.name, desc: poolCard.runSkill.desc, type: 'recruit', category: poolCard.runSkill.category, params: poolCard.runSkill.params } : null, battle_skill: null, ultimate: null } },
    awakening: null,
  } as any;
}

export const CollectionModal: React.FC<Props> = ({
  open,
  onClose,
  chapter = 1,
  initialDetailId = null,
  hideListReturn,
  detailExtraActions,
}) => {
  const heroId = useGameStore((s) => s.heroId);
  const ownedCardIds = useGameStore((s) => s.ownedCardIds);
  const battleBonus = useGameStore((s) => s.battleBonus);
  const knowledgeBonus = useGameStore((s) => s.knowledgeBonus);
  const cardBonuses = useGameStore((s) => s.cardBonuses);

  const [detailCardId, setDetailCardId] = useState<HeroId | null>(
    (initialDetailId as HeroId | null) ?? null,
  );
  const [cardFlipped, setCardFlipped] = useState(false);

  // 是否是"直达详情"模式（打开即进详情，无列表可回）
  const isDirectDetailMode = !!initialDetailId;
  const shouldHideListReturn = hideListReturn ?? isDirectDetailMode;

  // 跟随 initialDetailId 变化 / open 状态同步 detailCardId
  React.useEffect(() => {
    if (open) {
      setDetailCardId((initialDetailId as HeroId | null) ?? null);
      setCardFlipped(false);
    }
  }, [open, initialDetailId]);

  // 关闭弹窗时重置内部状态
  const handleClose = () => {
    setDetailCardId(null);
    setCardFlipped(false);
    onClose();
  };

  // "返回列表"处理：直达模式下等同于关闭弹窗
  const handleReturnToList = () => {
    if (isDirectDetailMode) {
      handleClose();
    } else {
      setDetailCardId(null);
      setCardFlipped(false);
    }
  };

  // 所有已收集的角色（主角 + ownedCardIds），按全局统一规则排序
  //   规则：主角置顶 → 稀有度降序（SSR→SR→R→N）→ 同稀有度保持收集顺序
  const allCollected: HeroId[] = React.useMemo(() => {
    return getDisplayCardList(heroId, ownedCardIds as readonly string[], resolveCard) as HeroId[];
  }, [heroId, ownedCardIds]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className={styles.modalOverlay}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={() => {
            if (detailCardId && !isDirectDetailMode) {
              setDetailCardId(null);
              setCardFlipped(false);
            } else {
              handleClose();
            }
          }}
        >
          {detailCardId ? (
            /* 详情 Modal —— 3:4 比例卡牌，支持 3D 翻转 */
            (() => {
              const hero = resolveCard(detailCardId);
              if (!hero) return null;
              const counters = COUNTER_MAP[hero.type as CultivationType];
              const rarityLabel = hero.rarity === '主角' ? 'SSR' : hero.rarity;
              const rarityColor = RARITY_COLOR[rarityLabel] ?? '#888';
              const toggleFlip = () => setCardFlipped((f) => !f);

              // 主角卡属性 = 基础值 + 游戏过程中的加成（拜师/境界提升等）
              const isMainHero = detailCardId === heroId;
              const cardBonus = cardBonuses[detailCardId] ?? { hp: 0, atk: 0, mnd: 0, realmUps: 0 };
              const displayAtk = hero.run_card.atk + cardBonus.atk + (isMainHero ? battleBonus : 0);
              const displayMnd = hero.run_card.mnd + cardBonus.mnd + (isMainHero ? knowledgeBonus : 0);
              const displayHp = hero.run_card.hp + cardBonus.hp;
              const totalAtkBonus = cardBonus.atk + (isMainHero ? battleBonus : 0);
              const totalMndBonus = cardBonus.mnd + (isMainHero ? knowledgeBonus : 0);
              const totalHpBonus = cardBonus.hp;
              // 当前境界（含提升次数）
              const currentRealm = getRealmAfterUps(hero.realm, cardBonus.realmUps);
              return (
                <motion.div
                  className={styles.detailModal}
                  initial={{ scale: 0.88, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0.88, opacity: 0 }}
                  transition={{ duration: 0.25 }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <div
                    className={`${styles.flipContainer} ${cardFlipped ? styles.isFlipped : ''}`}
                    onClick={toggleFlip}
                  >
                    {/* ========== 正面：详情页 ========== */}
                    <div
                      className={`${styles.cardFace} ${styles.cardFaceFront}`}
                      style={{ borderColor: rarityColor }}
                    >
                      <span className={styles.flipHint}>点击翻面看立绘</span>
                      <button
                        className={styles.flipBtn}
                        onClick={(e) => { e.stopPropagation(); toggleFlip(); }}
                        title="翻面查看立绘"
                      >⇋</button>
                      <div
                        className={styles.detailView}
                        onClick={(e) => e.stopPropagation()}
                      >
                        {!shouldHideListReturn && (
                          <button className={styles.backBtn} onClick={handleReturnToList}>← 返回列表</button>
                        )}
                        {shouldHideListReturn && (
                          <button className={styles.backBtn} onClick={handleReturnToList}>× 关闭</button>
                        )}
                        <div className={styles.detailHeader}>
                          <div className={styles.detailPortrait} style={{ backgroundImage: `url(${getCachedImage(detailCardId)})`, borderColor: rarityColor }} />
                          <div className={styles.detailMeta}>
                            <div className={styles.detailName}>{hero.name}</div>
                            <div className={styles.detailRarity} style={{ color: rarityColor }}>{rarityLabel} · {hero.type}</div>
                            <div className={styles.detailRealm}>境界：{currentRealm}</div>
                            <div className={styles.statsBlock}>
                              <div className={styles.statsLabel}>跑团卡属性</div>
                              <div className={styles.detailStats}>
                                <span>生命 {displayHp}{totalHpBonus > 0 ? <em style={{ color: '#5be05b', fontSize: 12, marginLeft: 2 }}>(+{totalHpBonus})</em> : null}</span>
                                <span>修为 {displayAtk}{totalAtkBonus > 0 ? <em style={{ color: '#5be05b', fontSize: 12, marginLeft: 2 }}>(+{totalAtkBonus})</em> : null}</span>
                                <span>心境 {displayMnd}{totalMndBonus > 0 ? <em style={{ color: '#5be05b', fontSize: 12, marginLeft: 2 }}>(+{totalMndBonus})</em> : null}</span>
                              </div>
                            </div>
                            {chapter >= 5 && (
                              <div className={styles.statsBlock}>
                                <div className={styles.statsLabel}>决战卡属性</div>
                                <div className={styles.detailStats}>
                                  <span>生命 {hero.battle_card.hp}</span>
                                  <span>修为 {hero.battle_card.atk}</span>
                                  <span>心境 {hero.battle_card.mnd}</span>
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                        <div className={styles.detailDivider} />
                        {/* ===== 技能展示（按阶段可见性分类） =====
                             chapter<5: 显示密谈+招募；战斗/觉醒 → 暂未揭晓
                             chapter>=5（最终决战章）: 隐藏密谈+招募；显示战斗真实技能，觉醒仍锁定（或已揭晓） */}
                        {chapter < 5 && (
                          <>
                            <div className={styles.detailSection}>
                              <h3 className={styles.sectionTitle}>招募技能</h3>
                              {hero.battle_card.skills.run_skill ? (
                                <div className={styles.skillRow}>
                                  <span className={styles.skillName}>{hero.battle_card.skills.run_skill.name}</span>
                                  <span className={styles.skillDesc}>{hero.battle_card.skills.run_skill.desc}</span>
                                </div>
                              ) : <div className={styles.skillNone}>无</div>}
                            </div>
                          </>
                        )}
                        <div className={styles.detailSection}>
                          <h3 className={styles.sectionTitle}>战斗技能</h3>
                          {((hero.rarity as string) === 'N' || (hero.rarity as string) === 'R') ? (
                            <div className={styles.skillNone}>此卡无战斗技能（仅数值上阵）</div>
                          ) : chapter < 5 ? (
                            <div className={styles.awakeningHidden}>
                              <span className={styles.lockIcon}>🔒</span>
                              <span>战斗环节揭晓</span>
                            </div>
                          ) : (
                            <>
                              {hero.battle_card.skills.battle_skill ? (
                                <div className={styles.skillRow}>
                                  <span className={styles.skillName}>{hero.battle_card.skills.battle_skill.name}</span>
                                  <span className={styles.skillDesc}>{hero.battle_card.skills.battle_skill.desc}</span>
                                </div>
                              ) : <div className={styles.skillNone}>无</div>}
                              {hero.battle_card.skills.ultimate && (
                                <div className={styles.skillRow}>
                                  <span className={styles.skillName}>绝技：{hero.battle_card.skills.ultimate.name}</span>
                                  <span className={styles.skillDesc}>{hero.battle_card.skills.ultimate.desc}（单场战斗仅限释放1次）</span>
                                </div>
                              )}
                            </>
                          )}
                        </div>
                        {hero.awakening && ((hero.rarity as string) !== 'N' && (hero.rarity as string) !== 'R') && (
                          <div className={styles.detailSection}>
                            <h3 className={styles.sectionTitle}>觉醒技能</h3>
                            <div className={styles.awakeningHidden}>
                              <span className={styles.lockIcon}>🔒</span>
                              <span>觉醒条件与技能效果未知，需在战斗中满足特定条件后揭晓</span>
                            </div>
                          </div>
                        )}
                        <div className={styles.detailDivider} />
                        <div className={styles.detailSection}>
                          <h3 className={styles.sectionTitle}>克制关系</h3>
                          <div className={styles.counterInfo}>
                            {counters ? (
                              <>
                                <span className={styles.counterWin}>克制 <strong>{counters.beats}</strong></span>
                                <span className={styles.counterLose}>被 <strong>{counters.beatenBy}</strong> 克制</span>
                              </>
                            ) : (
                              <span className={styles.counterNeutral}>丹修 · 中立，不参与克制循环</span>
                            )}
                          </div>
                        </div>
                        {detailExtraActions && (
                          <>
                            <div className={styles.detailDivider} />
                            <div className={styles.detailSection}>
                              {detailExtraActions(detailCardId)}
                            </div>
                          </>
                        )}
                      </div>
                    </div>

                    {/* ========== 反面：整屏立绘大图 ========== */}
                    <div
                      className={`${styles.cardFace} ${styles.cardFaceBack}`}
                      style={{ borderColor: rarityColor }}
                    >
                      <div
                        className={styles.cardFullImg}
                        style={{ backgroundImage: `url(${getCachedCardFull(detailCardId)})` }}
                      />
                      <button
                        className={styles.flipBtn}
                        onClick={(e) => { e.stopPropagation(); toggleFlip(); }}
                        title="翻回详情"
                      >⇋</button>
                      <div className={styles.cardFullMeta}>
                        <div className={styles.cardFullName}>{hero.name}</div>
                        <div className={styles.cardFullTags}>
                          <span style={{ color: rarityColor, borderLeft: `3px solid ${rarityColor}`, paddingLeft: 10 }}>{rarityLabel}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </motion.div>
              );
            })()
          ) : (
            /* 列表 Modal —— 缩略图网格 */
            <motion.div
              className={styles.cardModal}
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
            >
              <h2 className={styles.modalTitle}>已收集角色</h2>
              <div className={styles.thumbGrid}>
                {allCollected.map((id) => {
                  const hero = resolveCard(id);
                  if (!hero) return null;
                  const rarityLabel = hero.rarity === '主角' ? 'SSR' : hero.rarity;
                  const rarityColor = RARITY_COLOR[rarityLabel] ?? '#888';
                  const cBonus = cardBonuses[id];
                  const thumbRealm = getRealmAfterUps(hero.realm, cBonus?.realmUps ?? 0);
                  return (
                    <div
                      key={id}
                      className={styles.thumbCard}
                      style={{ borderColor: rarityColor }}
                      onClick={() => setDetailCardId(id)}
                    >
                      <div className={styles.thumbPortrait} style={{ backgroundImage: `url(${getCachedImage(id)})` }} />
                      <div className={styles.thumbTopVeil} />
                      <div className={styles.thumbBottomVeil} />
                      <div className={styles.thumbRarity} style={{ background: rarityColor }}>{rarityLabel}</div>
                      <div className={styles.thumbRealm}>{thumbRealm}</div>
                      <div className={styles.thumbName}>{hero.name}</div>
                      <div className={styles.thumbType} style={{ background: TYPE_TOKEN[hero.type as CultivationType] }}>{hero.type}</div>
                    </div>
                  );
                })}
                {allCollected.length === 0 && (
                  <div style={{ padding: 24, color: 'rgba(232,200,120,0.6)' }}>暂无角色</div>
                )}
              </div>
              <button className={styles.modalClose} onClick={handleClose}>关闭</button>
            </motion.div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
};

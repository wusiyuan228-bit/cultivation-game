/**
 * S6 筹备阶段（对应策划 S_REWARD 奖励抉择界面）
 *
 * 三选一：
 *   ① 提升境界 — 弹出角色选择列表，消耗5灵石提升所选角色境界（三维各+1）
 *   ② 招募道友（抽卡）— 暂占位（本版本S6抽卡尚未实装）
 *   ③ 进入下一回合 — 保留灵石进入下一章剧情
 */
import React, { useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { BackButton } from '@/components/BackButton';
import { useReturnToMenu } from '@/hooks/useReturnToMenu';
import { MusicToggle } from '@/components/MusicToggle';
import { CommonHud } from '@/components/CommonHud';
import {
  useGameStore,
  SaveSystem,
  REALM_UPGRADE_COST,
  REALM_ORDER,
  getRealmAfterUps,
  canUpgradeRealm,
} from '@/stores/gameStore';
import { getHeroById } from '@/hooks/useConfig';
import { getPoolCardById } from '@/systems/recruit/cardPoolLoader';
import { getCachedImage } from '@/utils/imageCache';
import { TYPE_TOKEN } from '@/data/heroConstants';
import type { HeroId, CultivationType, Hero } from '@/types/game';
import styles from './S6_Preparation.module.css';

const RARITY_COLOR: Record<string, string> = {
  N: '#8a8a8a',
  R: '#4a9a6a',
  SR: '#b47bff',
  SSR: '#ffd65e',
  UR: '#a83b3b',
};

/** 统一查找角色/卡牌：主角从HEROES_DATA查，R/N卡从卡池缓存查 */
function resolveCard(id: string): Hero | null {
  const hero = getHeroById(id as HeroId);
  if (hero) return hero;
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

export const S6_Preparation: React.FC = () => {
  const navigate = useNavigate();
  const returnToMenu = useReturnToMenu();
  const heroId = useGameStore((s) => s.heroId);
  const heroName = useGameStore((s) => s.heroName);
  const spiritStones = useGameStore((s) => s.spiritStones);
  const ownedCardIds = useGameStore((s) => s.ownedCardIds);
  const mentalLevel = useGameStore((s) => s.mentalLevel);
  const battleBonus = useGameStore((s) => s.battleBonus);
  const knowledgeBonus = useGameStore((s) => s.knowledgeBonus);
  const cardBonuses = useGameStore((s) => s.cardBonuses);
  const recruitDone = useGameStore((s) => s.recruitDone);
  const chapter = useGameStore((s) => s.chapter);
  const upgradeCardRealm = useGameStore((s) => s.upgradeCardRealm);
  const markPhaseDone = useGameStore((s) => s.markPhaseDone);
  const setChapter = useGameStore((s) => s.setChapter);
  const canEnterChapter = useGameStore((s) => s.canEnterChapter);

  const hero = heroId ? getHeroById(heroId) : null;

  const [toast, setToast] = useState<{ type: 'ok' | 'bad'; msg: string } | null>(null);
  const [showUpgradePicker, setShowUpgradePicker] = useState(false);
  const showToast = useCallback((type: 'ok' | 'bad', msg: string) => {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 2500);
  }, []);

  /** 已收集的全部角色id列表（主角+收集卡） */
  const allCollected: HeroId[] = useMemo(() => {
    const arr: HeroId[] = [];
    if (heroId) arr.push(heroId);
    (ownedCardIds as HeroId[]).forEach((id) => {
      if (!arr.includes(id)) arr.push(id);
    });
    return arr;
  }, [heroId, ownedCardIds]);

  /** 点击"提升境界"卡片 → 检查灵石后弹角色选择 */
  const handleUpgradeClick = useCallback(() => {
    if (spiritStones < REALM_UPGRADE_COST) {
      showToast('bad', `灵石不足（需要 ${REALM_UPGRADE_COST} 颗）`);
      return;
    }
    // 检查是否所有角色都已到结丹
    const hasUpgradeable = allCollected.some((id) => {
      const h = resolveCard(id);
      if (!h) return false;
      const bonus = cardBonuses[id];
      return canUpgradeRealm(h.realm, bonus?.realmUps ?? 0);
    });
    if (!hasUpgradeable) {
      showToast('bad', '所有角色均已达最高境界·结丹');
      return;
    }
    setShowUpgradePicker(true);
  }, [spiritStones, allCollected, cardBonuses, showToast]);

  /** 在角色选择弹窗中选择某角色提升 */
  const handlePickCardUpgrade = useCallback(
    (cardId: string) => {
      const h = resolveCard(cardId);
      if (!h) return;
      const ok = upgradeCardRealm(cardId, h.realm);
      if (ok) {
        const bonus = cardBonuses[cardId];
        const newRealm = getRealmAfterUps(h.realm, (bonus?.realmUps ?? 0) + 1);
        showToast('ok', `${h.name} 境界提升 → ${newRealm}！三维各+1`);
        SaveSystem.save(1);
        setShowUpgradePicker(false);
      } else {
        showToast('bad', '提升失败（灵石不足或已达最高境界）');
      }
    },
    [upgradeCardRealm, cardBonuses, showToast],
  );

  const handleRecruit = useCallback(() => {
    if (recruitDone) return;
    // 第四章走 招募2（SR池）；其它章节走默认招募1
    const ch = useGameStore.getState().chapter;
    if (ch === 4) {
      navigate('/s6r?pool=2');
    } else {
      navigate('/s6r');
    }
  }, [navigate, recruitDone]);

  const handleNextRound = useCallback(() => {
    const ch = useGameStore.getState().chapter;
    // 当前 chapter 的玩法环节收尾
    markPhaseDone(ch);
    SaveSystem.save(1);
    // 章节推进策略：
    // - ch=2（S5c→首次筹备）：S6a 招募后 → 推进到第3章剧情（S7A 在剧情后触发）
    // - ch=4（S6b 招募后第二次筹备）：保持 ch=4，进入第4章剧情
    //   后续由 S4_StoryReading 自然衔接：第4章剧情 → S7B 首场 → 次场 → 排名 → S6c → S8b → 第5章
    // - 其它情况按既有 canEnterChapter 规则推进，避免跳章
    if (ch === 4) {
      // 第二次筹备：不推进章节，让玩家进入第4章剧情，由后续流程驱动 chapter 演进
      navigate('/story');
      return;
    }
    if (canEnterChapter(ch + 1)) {
      setChapter(ch + 1);
    }
    navigate('/story');
  }, [markPhaseDone, canEnterChapter, setChapter, navigate]);

  if (!hero) return null;

  const displayName = heroName || hero.name;
  const mainBonus = cardBonuses[heroId!];
  const heroAtk = hero.run_card.atk + battleBonus + (mainBonus?.atk ?? 0);
  const heroMnd = hero.run_card.mnd + knowledgeBonus + (mainBonus?.mnd ?? 0);
  const heroHp = hero.run_card.hp + (mainBonus?.hp ?? 0);
  const totalAtkBonus = battleBonus + (mainBonus?.atk ?? 0);
  const totalMndBonus = knowledgeBonus + (mainBonus?.mnd ?? 0);
  const totalHpBonus = mainBonus?.hp ?? 0;

  // 主角当前境界（含提升）
  const currentMainRealm = getRealmAfterUps(hero.realm, mainBonus?.realmUps ?? 0);

  return (
    <div className={styles.screen}>
      <div className={styles.bg} />
      <div className={styles.bgVeil} />

      <BackButton onClick={returnToMenu} />
      <MusicToggle />
      <CommonHud chapter={chapter} />

      {/* 标题 */}
      <div className={styles.header}>
        <h1 className={styles.title}>筹备阶段</h1>
        <div className={styles.sub}>修炼·求道·取舍</div>
      </div>

      {/* 左上角角色状态面板 */}
      <div className={styles.statusPanel}>
        <div className={styles.statusName}>{displayName}</div>
        <div className={styles.statusRealm}>当前境界：<strong>{currentMainRealm}</strong></div>
        <div className={styles.statusStats}>
          <span>修为 {heroAtk}{totalAtkBonus > 0 && <em>(+{totalAtkBonus})</em>}</span>
          <span>心境 {heroMnd}{totalMndBonus > 0 && <em>(+{totalMndBonus})</em>}</span>
          <span>气血 {heroHp}{totalHpBonus > 0 && <em>(+{totalHpBonus})</em>}</span>
        </div>
      </div>

      {/* 右下角 HUD：已获得灵石 / 已收集角色 — 由 CommonHud 统一提供（4件套常驻） */}

      {/* 三张抉择卡 */}
      <div className={styles.cardsRow}>
        {/* ① 提升境界 */}
        <motion.button
          type="button"
          className={`${styles.card} ${styles.cardUpgrade} ${spiritStones < REALM_UPGRADE_COST ? styles.cardDim : ''}`}
          onClick={handleUpgradeClick}
          whileHover={{ y: -6 }}
          whileTap={{ scale: 0.97 }}
        >
          <div className={styles.cardIcon}>✨</div>
          <div className={styles.cardName}>提 升 境 界</div>
          <div className={styles.cardDesc}>
            <div>选择一位角色提升境界</div>
            <div className={styles.costLine}>
              消耗灵石 <strong>×{REALM_UPGRADE_COST}</strong>
            </div>
            <div style={{ fontSize: 13, color: 'rgba(235,220,180,0.7)', marginTop: 2 }}>
              修为+1 · 心境+1 · 气血+1
            </div>
          </div>
          <div className={styles.cardFoot}>未达结丹的角色均可提升</div>
        </motion.button>

        {/* ② 招募道友（已完成则隐藏整卡） */}
        {!recruitDone && (
          <motion.button
            type="button"
            className={`${styles.card} ${styles.cardRecruit}`}
            onClick={handleRecruit}
            whileHover={{ y: -6 }}
            whileTap={{ scale: 0.97 }}
          >
            <div className={styles.cardIcon}>🎴</div>
            <div className={styles.cardName}>招 募 道 友</div>
            <div className={styles.cardDesc}>
              <div>消耗灵石抽取卡牌</div>
              <div className={styles.costLine}>NR池 · 5 灵石/抽</div>
            </div>
            <div className={styles.cardFoot}>
              玩家 + 5 AI 轮流抽卡
            </div>
          </motion.button>
        )}

        {/* ③ 进入下一回合 */}
        <motion.button
          type="button"
          className={`${styles.card} ${styles.cardNext}`}
          onClick={handleNextRound}
          whileHover={{ y: -6 }}
          whileTap={{ scale: 0.97 }}
        >
          <div className={styles.cardIcon}>🌙</div>
          <div className={styles.cardName}>进入下一回合</div>
          <div className={styles.cardDesc}>
            <div>保留剩余灵石</div>
            <div className={styles.costLine}>踏入新篇章</div>
          </div>
          <div className={styles.cardFoot}></div>
        </motion.button>
      </div>

      {/* 底部提示 */}
      <div className={styles.hint}>
        ①可反复选择，③ 将正式离开筹备阶段
      </div>

      {/* Toast */}
      <AnimatePresence>
        {toast && (
          <motion.div
            className={`${styles.toast} ${toast.type === 'ok' ? styles.toastOk : styles.toastBad}`}
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
          >
            {toast.msg}
          </motion.div>
        )}
      </AnimatePresence>

      {/* ====== 角色选择弹窗：境界提升 ====== */}
      <AnimatePresence>
        {showUpgradePicker && (
          <motion.div
            className={styles.pickerOverlay}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setShowUpgradePicker(false)}
          >
            <motion.div
              className={styles.pickerPanel}
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
            >
              <h2 className={styles.pickerTitle}>选择要提升境界的角色</h2>
              <div className={styles.pickerSub}>
                消耗 <strong>{REALM_UPGRADE_COST}</strong> 灵石，提升后三维属性各+1
              </div>
              <div className={styles.pickerGrid}>
                {allCollected.map((id) => {
                  const h = resolveCard(id);
                  if (!h) return null;
                  const bonus = cardBonuses[id];
                  const realmUps = bonus?.realmUps ?? 0;
                  const currentRealm = getRealmAfterUps(h.realm, realmUps);
                  const upgradeable = canUpgradeRealm(h.realm, realmUps);
                  const nextRealm = upgradeable
                    ? getRealmAfterUps(h.realm, realmUps + 1)
                    : null;
                  const rarityLabel = h.rarity === '主角' ? 'SSR' : h.rarity;
                  const rarityColor = RARITY_COLOR[rarityLabel] ?? '#888';

                  // 显示属性（含已有加成）
                  const dispHp = h.run_card.hp + (bonus?.hp ?? 0) + (id === heroId ? 0 : 0);
                  const dispAtk = h.run_card.atk + (bonus?.atk ?? 0) + (id === heroId ? battleBonus : 0);
                  const dispMnd = h.run_card.mnd + (bonus?.mnd ?? 0) + (id === heroId ? knowledgeBonus : 0);

                  return (
                    <button
                      key={id}
                      type="button"
                      className={`${styles.pickerCard} ${!upgradeable ? styles.pickerCardDim : ''}`}
                      style={{ borderColor: upgradeable ? rarityColor : '#555' }}
                      onClick={() => upgradeable && handlePickCardUpgrade(id)}
                      disabled={!upgradeable}
                    >
                      <div
                        className={styles.pickerPortrait}
                        style={{ backgroundImage: `url(${getCachedImage(id)})` }}
                      />
                      <div className={styles.pickerInfo}>
                        <div className={styles.pickerName}>
                          <span style={{ color: rarityColor }}>{rarityLabel}</span>
                          {' '}{h.name}
                        </div>
                        <div className={styles.pickerRealm}>
                          {currentRealm}
                          {nextRealm ? (
                            <span className={styles.pickerArrow}> → <strong>{nextRealm}</strong></span>
                          ) : (
                            <span className={styles.pickerMax}>（已满级）</span>
                          )}
                        </div>
                        <div className={styles.pickerStats}>
                          <span>气血 {dispHp}{nextRealm ? <em>→{dispHp + 1}</em> : null}</span>
                          <span>修为 {dispAtk}{nextRealm ? <em>→{dispAtk + 1}</em> : null}</span>
                          <span>心境 {dispMnd}{nextRealm ? <em>→{dispMnd + 1}</em> : null}</span>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
              <button
                type="button"
                className={styles.pickerClose}
                onClick={() => setShowUpgradePicker(false)}
              >
                取消
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 已收集角色弹窗由 CommonHud 自动托管，无需在此重复挂载 */}
    </div>
  );
};

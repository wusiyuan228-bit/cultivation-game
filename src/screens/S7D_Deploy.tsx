/**
 * S7D_Deploy · 坠魔谷决战 · 备战选卡界面
 *
 * 职责：
 *   1. 展示玩家全部非主角卡牌（按全局统一排序：稀有度降序 + 收集序）
 *   2. 玩家从中挑选 **恰好 5 张** 参战
 *   3. 主角作为第 6 张固定上阵（右上"主角锁定槽"展示，不可操作）
 *   4. 点击"确认出征"写入 gameStore.s7dDeployedCards 并跳转 /s7d/lineup（首发登场页）
 *
 * 设计要点：
 *   - 左侧候选列表：可滚动的卡牌网格，点击加入卡槽（若已满 5 张则替换最早加入的）
 *   - 右侧卡槽区：1 个主角固定槽 + 5 个可选槽
 *   - 已入槽卡在左侧呈"灰暗+√"状态
 *   - 底部"出征"按钮：未选满 5 张时禁用；选满后高亮
 *   - "一键清空" / "随机填满" 两个辅助按钮（方便测试）
 */
import React, { useMemo, useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useGameStore } from '@/stores/gameStore';
import { HEROES_DATA } from '@/data/heroesData';
import type { HeroId, Hero } from '@/types/game';
import { BackButton } from '@/components/BackButton';
import { useReturnToMenu } from '@/hooks/useReturnToMenu';
import { MusicToggle } from '@/components/MusicToggle';
import { CommonHud } from '@/components/CommonHud';
import { CollectionModal } from '@/components/CollectionModal';
import { sortCardsForDisplay } from '@/utils/cardDisplayOrder';
import {
  getPoolCardById,
  loadRecruitPool1,
  loadRecruitPool2,
  loadRecruitPool3,
} from '@/systems/recruit/cardPoolLoader';
import { getCachedImage } from '@/utils/imageCache';
import styles from './S7D_Deploy.module.css';

/** 上阵卡牌总数（含主角） */
const TOTAL_DEPLOY_SIZE = 6;
/** 玩家需挑选的非主角卡数量 */
const PICK_SIZE = 5;

/**
 * R/N 卡在 S7D 决战中的可用性提示文案
 * - 兜底规则：当玩家 SR+SSR 数量不足以凑满 5 张时，允许 R/N 兜底；
 *   否则 R/N 被强制视为"无战斗技能，不在决战中使用"。
 */
const RN_DISABLED_HINT = '无战斗技能，不在决战中使用';

const RARITY_COLOR: Record<string, string> = {
  主角: '#c8a14b',
  N: '#8a8a8a',
  R: '#4a9a6a',
  SR: '#b47bff',
  SSR: '#ffd65e',
  UR: '#a83b3b',
};

/** 单张卡的展示信息（同时兼容主角卡和池卡） */
interface CardDisplayInfo {
  id: string;
  name: string;
  rarity: string;
  type: string;
  realm: string;
  hp: number;
  atk: number;
  mnd: number;
  portrait: string;
  isHero: boolean;
}

function resolveCard(id: string): CardDisplayInfo | null {
  const hero = HEROES_DATA.find((h) => h.id === id);
  if (hero) {
    return {
      id: hero.id,
      name: hero.name,
      rarity: '主角',
      type: hero.type,
      realm: hero.realm,
      hp: hero.battle_card.hp,
      atk: hero.battle_card.atk,
      mnd: hero.battle_card.mnd,
      portrait: getCachedImage(hero.id) ?? '',
      isHero: true,
    };
  }
  const p = getPoolCardById(id);
  if (!p) return null;
  return {
    id: p.id,
    name: p.name,
    rarity: p.rarity,
    type: p.type,
    realm: p.realm,
    hp: p.hp,
    atk: p.atk,
    mnd: p.mnd,
    portrait: getCachedImage(p.id) ?? '',
    isHero: false,
  };
}

export const S7D_Deploy: React.FC = () => {
  const navigate = useNavigate();
  const returnToMenu = useReturnToMenu();
  const heroId = useGameStore((s) => s.heroId);
  const heroName = useGameStore((s) => s.heroName);
  const ownedCardIds = useGameStore((s) => s.ownedCardIds);
  const cardBonuses = useGameStore((s) => s.cardBonuses);
  const setS7DDeployedCards = useGameStore((s) => s.setS7DDeployedCards);
  const existingDeploy = useGameStore((s) => s.s7dDeployedCards);

  /** 池子是否已加载完毕（用于 resolveCard 正常工作） */
  const [poolReady, setPoolReady] = useState(false);

  /** 已选的 5 张卡 id（顺序 = 添加顺序） */
  const [selected, setSelected] = useState<string[]>(() => {
    // 若 gameStore 中已有残留值，恢复之
    if (Array.isArray(existingDeploy) && existingDeploy.length > 0) {
      return existingDeploy.slice(0, PICK_SIZE);
    }
    return [];
  });

  /** 悬停查看详情的卡 id */
  const [hoverId, setHoverId] = useState<string | null>(null);

  /**
   * 当前在详情弹窗中展示的卡 id。
   * 非空 → 显示 CollectionModal 的详情视图（跳过列表）
   * null → 不显示详情弹窗
   */
  const [detailCardId, setDetailCardId] = useState<string | null>(null);

  // 加载 3 个抽卡池，保证 getPoolCardById 能命中
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        await Promise.all([
          loadRecruitPool1(),
          loadRecruitPool2(),
          loadRecruitPool3([]),
        ]);
      } catch (e) {
        console.warn('[S7D_Deploy] 卡池加载失败', e);
      }
      if (alive) setPoolReady(true);
    })();
    return () => { alive = false; };
  }, []);

  // 主角信息
  const heroInfo = useMemo<CardDisplayInfo | null>(() => {
    if (!heroId) return null;
    return resolveCard(heroId);
  }, [heroId, poolReady]);

  // 候选卡列表：全部非主角已收集卡，按统一规则排序
  const candidateIds = useMemo<string[]>(() => {
    if (!heroId) return [];
    const resolver = (id: string) => {
      const info = resolveCard(id);
      if (!info) return null;
      return { rarity: info.rarity === '主角' ? 'SSR' : info.rarity } as unknown as Hero;
    };
    const merged = [heroId, ...ownedCardIds];
    const sorted = sortCardsForDisplay(merged, heroId, resolver);
    // 剔除主角（它固定第 6 张）
    return sorted.filter((id) => id !== heroId);
  }, [heroId, ownedCardIds, poolReady]);

  /**
   * R/N 兜底模式：当玩家已收集的 SR+SSR 合计 < 5（即无法用纯 SR/SSR 凑满 5 张）
   * 时，允许把 R/N 卡作为兜底可选。
   * 大多数玩家前中期可能触发；中后期收集充足时自动退出兜底模式。
   */
  const rnFallbackMode = useMemo(() => {
    if (!poolReady) return false;
    let srPlusSsr = 0;
    for (const id of candidateIds) {
      const info = resolveCard(id);
      if (!info) continue;
      if (info.rarity === 'SR' || info.rarity === 'SSR') srPlusSsr++;
    }
    return srPlusSsr < PICK_SIZE;
  }, [candidateIds, poolReady]);

  /** 判定一张卡是否被"决战规则"禁用（R/N 卡在非兜底模式下禁用） */
  const isCardDisabledForBattle = (rarity: string): boolean => {
    if (rnFallbackMode) return false; // 兜底模式下全部可选
    return rarity === 'R' || rarity === 'N';
  };

  /** 点击候选卡：加入 / 移除 */
  const toggleCard = (id: string) => {
    const info = resolveCard(id);
    // 禁用的卡不允许加入（已选的可以取消）
    if (info && isCardDisabledForBattle(info.rarity) && !selected.includes(id)) {
      return;
    }
    setSelected((prev) => {
      if (prev.includes(id)) {
        // 已选 → 移除
        return prev.filter((x) => x !== id);
      }
      if (prev.length >= PICK_SIZE) {
        // 已满 → 替换最早一张（FIFO）
        return [...prev.slice(1), id];
      }
      return [...prev, id];
    });
  };

  /** 点击卡槽：移除该卡 */
  const removeFromSlot = (id: string) => {
    setSelected((prev) => prev.filter((x) => x !== id));
  };

  /** 清空 */
  const handleClear = () => setSelected([]);

  /** 随机填满（测试用）—— 非兜底模式下跳过 R/N 卡 */
  const handleAutoFill = () => {
    const validCandidates = candidateIds.filter((id) => {
      const info = resolveCard(id);
      return info && !isCardDisabledForBattle(info.rarity);
    });
    if (validCandidates.length < PICK_SIZE) return;
    const shuffled = [...validCandidates].sort(() => Math.random() - 0.5);
    setSelected(shuffled.slice(0, PICK_SIZE));
  };

  /** 确认出征 */
  const handleConfirm = () => {
    if (selected.length !== PICK_SIZE) return;
    setS7DDeployedCards(selected);
    // 写入备战卡后进入首发登场页（从 6 张中挑 2 张首发）
    navigate('/s7d/lineup');
  };

  const canLaunch = selected.length === PICK_SIZE;
  const hoverInfo = hoverId ? resolveCard(hoverId) : null;
  const hoverBonus = hoverId ? (cardBonuses[hoverId] ?? { hp: 0, atk: 0, mnd: 0, realmUps: 0 }) : null;

  if (!heroId || !heroInfo) {
    return (
      <div className={styles.screen}>
        <BackButton onClick={returnToMenu} />
        <div className={styles.empty}>尚未选择主角，无法进入备战。</div>
      </div>
    );
  }

  return (
    <div className={styles.screen}>
      <BackButton onClick={returnToMenu} />
      <MusicToggle />
      <CommonHud chapter={5} />

      {/* 顶部标题 */}
      <motion.div
        className={styles.topBar}
        initial={{ opacity: 0, y: -16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
        <div className={styles.topTitle}>📜 备战点将 · 坠魔谷</div>
        <div className={styles.topSubtitle}>
          主角必上阵 · 再挑 {PICK_SIZE} 张参战卡 · 点击卡牌查看技能详情
          {rnFallbackMode
            ? ' · ⚠ SR/SSR 不足，允许 R/N 兜底'
            : ' · R/N 无战斗技能，已禁用'}
        </div>
      </motion.div>

      {/* 主区域：左候选 + 右卡槽 */}
      <div className={styles.body}>
        {/* 左侧候选卡池 */}
        <motion.div
          className={styles.candidatePanel}
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.5 }}
        >
          <div className={styles.panelHeader}>
            <span className={styles.panelTitle}>可选卡牌</span>
            <span className={styles.panelMeta}>
              共 {candidateIds.length} 张 · 已选 {selected.length}/{PICK_SIZE}
            </span>
          </div>
          <div className={styles.cardGrid}>
            {!poolReady && <div className={styles.loading}>载入卡池中…</div>}
            {poolReady && candidateIds.length === 0 && (
              <div className={styles.empty}>尚未收集任何非主角卡牌。</div>
            )}
            {poolReady && candidateIds.map((id) => {
              const info = resolveCard(id);
              if (!info) return null;
              const picked = selected.includes(id);
              const rColor = RARITY_COLOR[info.rarity] ?? '#888';
              const battleDisabled = isCardDisabledForBattle(info.rarity);
              return (
                <div
                  key={id}
                  className={`${styles.cardItem} ${picked ? styles.picked : ''} ${battleDisabled ? styles.battleDisabled : ''}`}
                  style={{ borderColor: rColor }}
                  onClick={() => setDetailCardId(id)}
                  onMouseEnter={() => setHoverId(id)}
                  onMouseLeave={() => setHoverId((prev) => (prev === id ? null : prev))}
                  title={battleDisabled ? RN_DISABLED_HINT : undefined}
                >
                  <div
                    className={styles.cardPortrait}
                    style={info.portrait ? { backgroundImage: `url(${info.portrait})` } : undefined}
                  />
                  <div className={styles.cardBottom}>
                    <span className={styles.cardRarity} style={{ background: rColor }}>
                      {info.rarity}
                    </span>
                    <span className={styles.cardName}>{info.name}</span>
                  </div>
                  {picked && (
                    <div className={styles.pickedOverlay}>
                      <span className={styles.pickedCheck}>✓</span>
                      <span className={styles.pickedLabel}>
                        第 {selected.indexOf(id) + 1} 位
                      </span>
                    </div>
                  )}
                  {battleDisabled && !picked && (
                    <div className={styles.disabledOverlay}>
                      <span className={styles.disabledIcon}>🚫</span>
                      <span className={styles.disabledLabel}>无战斗技能</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </motion.div>

        {/* 右侧卡槽 */}
        <motion.div
          className={styles.deployPanel}
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.5, delay: 0.1 }}
        >
          <div className={styles.panelHeader}>
            <span className={styles.panelTitle}>出战阵容（{TOTAL_DEPLOY_SIZE}）</span>
            <span className={styles.panelMeta}>{selected.length + 1}/{TOTAL_DEPLOY_SIZE}</span>
          </div>

          {/* 主角锁定槽 */}
          <div className={styles.heroSlot}>
            <div
              className={styles.slotPortrait}
              style={heroInfo.portrait ? { backgroundImage: `url(${heroInfo.portrait})` } : undefined}
            />
            <div className={styles.slotInfo}>
              <div className={styles.slotName}>
                {heroName || heroInfo.name}
                <span className={styles.slotTag}>主角 · 锁定</span>
              </div>
              <div className={styles.slotStats}>
                HP {heroInfo.hp} · 攻 {heroInfo.atk} · 心 {heroInfo.mnd}
              </div>
            </div>
            <div className={styles.slotLock}>🔒</div>
          </div>

          {/* 5 个挑选槽 */}
          <div className={styles.pickSlots}>
            {Array.from({ length: PICK_SIZE }).map((_, idx) => {
              const id = selected[idx];
              if (!id) {
                return (
                  <div key={idx} className={styles.emptySlot}>
                    <span className={styles.emptySlotLabel}>第 {idx + 1} 位 · 待挑</span>
                  </div>
                );
              }
              const info = resolveCard(id);
              if (!info) return null;
              const rColor = RARITY_COLOR[info.rarity] ?? '#888';
              return (
                <motion.div
                  key={`${id}-${idx}`}
                  className={styles.filledSlot}
                  style={{ borderColor: rColor }}
                  initial={{ opacity: 0, scale: 0.85 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ duration: 0.2 }}
                  onClick={() => setDetailCardId(id)}
                >
                  <div
                    className={styles.slotPortrait}
                    style={info.portrait ? { backgroundImage: `url(${info.portrait})` } : undefined}
                  />
                  <div className={styles.slotInfo}>
                    <div className={styles.slotName}>
                      {info.name}
                      <span
                        className={styles.slotTag}
                        style={{ background: rColor, color: '#000' }}
                      >
                        {info.rarity}
                      </span>
                    </div>
                    <div className={styles.slotStats}>
                      HP {info.hp} · 攻 {info.atk} · 心 {info.mnd}
                    </div>
                  </div>
                  <button
                    type="button"
                    className={styles.slotRemove}
                    onClick={(e) => { e.stopPropagation(); removeFromSlot(id); }}
                    title="从阵容移除"
                  >✕</button>
                </motion.div>
              );
            })}
          </div>

          {/* 辅助按钮 */}
          <div className={styles.toolRow}>
            <button
              type="button"
              className={styles.toolBtn}
              onClick={handleClear}
              disabled={selected.length === 0}
            >
              清空
            </button>
            <button
              type="button"
              className={styles.toolBtn}
              onClick={handleAutoFill}
              disabled={candidateIds.length < PICK_SIZE}
            >
              随机填满
            </button>
          </div>

          {/* 出征按钮 */}
          <button
            type="button"
            className={`${styles.launchBtn} ${canLaunch ? styles.launchReady : ''}`}
            onClick={handleConfirm}
            disabled={!canLaunch}
          >
            {canLaunch ? '⚔ 确认出征 · 奔赴坠魔谷' : `还需 ${PICK_SIZE - selected.length} 张`}
          </button>
        </motion.div>
      </div>

      {/* 悬停详情气泡 */}
      <AnimatePresence>
        {hoverInfo && (
          <motion.div
            key={hoverInfo.id}
            className={styles.hoverCard}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
          >
            <div
              className={styles.hoverPortrait}
              style={hoverInfo.portrait ? { backgroundImage: `url(${hoverInfo.portrait})` } : undefined}
            />
            <div className={styles.hoverMeta}>
              <div
                className={styles.hoverName}
                style={{ color: RARITY_COLOR[hoverInfo.rarity] }}
              >
                {hoverInfo.name} <span className={styles.hoverSmall}>({hoverInfo.rarity})</span>
              </div>
              <div className={styles.hoverSmall}>{hoverInfo.type} · {hoverInfo.realm}</div>
              <div className={styles.hoverStats}>
                <span>气血 <b>{hoverInfo.hp}</b>{hoverBonus && hoverBonus.hp > 0 ? <em> +{hoverBonus.hp}</em> : null}</span>
                <span>修为 <b>{hoverInfo.atk}</b>{hoverBonus && hoverBonus.atk > 0 ? <em> +{hoverBonus.atk}</em> : null}</span>
                <span>心境 <b>{hoverInfo.mnd}</b>{hoverBonus && hoverBonus.mnd > 0 ? <em> +{hoverBonus.mnd}</em> : null}</span>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ============================================================
       * 卡牌详情弹窗（复用 CollectionModal 的详情视图）
       *   - initialDetailId 非空时打开直达详情，无列表可回
       *   - detailExtraActions 向详情页注入"加入阵容 / 从阵容移除"按钮
       *   - chapter=5 → 战斗技能、绝技完整可见（最终决战阶段）
       * ============================================================ */}
      <CollectionModal
        open={detailCardId !== null}
        onClose={() => setDetailCardId(null)}
        chapter={5}
        initialDetailId={detailCardId}
        detailExtraActions={(cid) => {
          // 主角卡：仅展示提示，不可操作
          if (cid === heroId) {
            return (
              <div className={styles.actionHint}>
                <span>🔒 主角卡 · 决战必上阵，无需手动挑选</span>
              </div>
            );
          }
          // R/N 卡：非兜底模式下显示"无战斗技能"禁用提示
          const cardInfo = resolveCard(cid);
          const battleDisabled = cardInfo ? isCardDisabledForBattle(cardInfo.rarity) : false;
          if (battleDisabled) {
            return (
              <div className={styles.actionHint}>
                <span>🚫 {RN_DISABLED_HINT}（{cardInfo?.rarity} 卡仅含跑团/无技能）</span>
                <button
                  type="button"
                  className={`${styles.actionBtn} ${styles.actionCancel}`}
                  onClick={() => setDetailCardId(null)}
                >
                  返回挑选
                </button>
              </div>
            );
          }
          const already = selected.includes(cid);
          return (
            <div className={styles.actionRow}>
              {already ? (
                <button
                  type="button"
                  className={`${styles.actionBtn} ${styles.actionRemove}`}
                  onClick={() => {
                    removeFromSlot(cid);
                    setDetailCardId(null);
                  }}
                >
                  ✕ 从阵容移除
                </button>
              ) : (
                <button
                  type="button"
                  className={`${styles.actionBtn} ${styles.actionAdd}`}
                  onClick={() => {
                    toggleCard(cid);
                    setDetailCardId(null);
                  }}
                  disabled={selected.length >= PICK_SIZE}
                  title={selected.length >= PICK_SIZE ? '已选满 5 张，请先移除一张' : '加入决战阵容'}
                >
                  {selected.length >= PICK_SIZE ? '⚠ 阵容已满' : '✓ 加入阵容'}
                </button>
              )}
              <button
                type="button"
                className={`${styles.actionBtn} ${styles.actionCancel}`}
                onClick={() => setDetailCardId(null)}
              >
                返回挑选
              </button>
            </div>
          );
        }}
      />
    </div>
  );
};

export default S7D_Deploy;

/**
 * S7D_Lineup · 坠魔谷决战 · 登场选卡界面（通用版）
 *
 * 本界面在两种场景复用（通过 `mode` prop / 路由 query 区分）：
 *
 *   ┌──────────────┬─────────────────────┬──────────────────────────────────┐
 *   │  模式         │ 触发时机              │ 行为                              │
 *   ├──────────────┼─────────────────────┼──────────────────────────────────┤
 *   │ starter      │ 决战开局，仅出现 1 次  │ 从 6 张可战卡挑 2 张作为首发登场    │
 *   │ reinforce    │ 场上角色卡阵亡后补位    │ 从手牌区挑 N 张（N=空缺数），必选    │
 *   └──────────────┴─────────────────────┴──────────────────────────────────┘
 *
 * 三区模型（术语统一）：
 *   - 战斗区（Battle Zone）：地图上实际战斗的卡，最多 2 张（即原"备战区/场上"）
 *   - 手牌区（Hand Zone）：未上场、未阵亡的候补卡
 *   - 弃牌区（Graveyard Zone）：已阵亡的卡
 *
 * 补位模式核心规则（由上层传入，本组件仅负责 UI+选中逻辑）：
 *   1. 战斗区必须补满 2 张（若手牌足够）；手牌空时允许低于 2 张
 *   2. 候选池 = 手牌区 = 6 张 − 战斗区 − 弃牌区
 *   3. 队友信息栏显示队友"当前在场上的卡"（由战场系统实时提供），而非首发
 *
 * ⚠️ 补位模式的战场实时数据依赖阶段 5 的 battleStore 扩展；本次 MVP 仅提供
 *    UI 骨架与参数化接口，真实触发与数据接入将在阶段 5 完成。
 */
import React, { useMemo, useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useGameStore } from '@/stores/gameStore';
import { HEROES_DATA } from '@/data/heroesData';
import type { Hero } from '@/types/game';
import { BackButton } from '@/components/BackButton';
import { useReturnToMenu } from '@/hooks/useReturnToMenu';
import { MusicToggle } from '@/components/MusicToggle';
import { CommonHud } from '@/components/CommonHud';
import { CollectionModal } from '@/components/CollectionModal';
import { getPoolCardById } from '@/systems/recruit/cardPoolLoader';
import { getCachedImage } from '@/utils/imageCache';
import { generateAllAiLineups } from '@/utils/s7dAiLineup';
import styles from './S7D_Lineup.module.css';

/** 登场选卡场景模式 */
export type LineupMode = 'starter' | 'reinforce';

/** 通用 Props（reinforce 模式所需的战场数据） */
export interface LineupProps {
  /** 默认 'starter'；'reinforce' 走补位分支 */
  mode?: LineupMode;
  /** 补位时必选的数量（= 战斗区空缺数），starter 模式恒为 2 */
  pickSize?: 1 | 2;
  /**
   * 补位模式下：当前仍在战斗区的卡 id 列表
   * 该列表的卡会在 UI 中**锁定展示**、不可被再次选中
   */
  lockedCards?: string[];
  /**
   * 补位模式下：已在弃牌区的卡 id 列表
   * 展示在 UI 的"弃牌区"小节，禁止选中
   */
  graveyardCards?: string[];
  /**
   * 补位模式下：队友当前场上阵容（用于替换首发展示）
   * 由战场系统（battleStore）实时提供
   */
  allyOnField?: Array<{ heroId: string; cardIds: string[] }>;
  /**
   * 补位确认回调（补位模式下必填）
   * 收到补位选中的 N 张卡 id，由上层决定如何写入战场
   */
  onReinforceConfirm?: (picks: string[]) => void;
}

/** starter 模式首发数量 */
const STARTER_SIZE = 2;

const RARITY_COLOR: Record<string, string> = {
  主角: '#c8a14b',
  N: '#8a8a8a',
  R: '#4a9a6a',
  SR: '#b47bff',
  SSR: '#ffd65e',
  UR: '#a83b3b',
};

// --------------------------------------------------------------------------
// 卡牌信息统一解析
// --------------------------------------------------------------------------

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

// --------------------------------------------------------------------------
// 阵营与队友推导（与 S7D_PreBattle 逻辑对齐）
// --------------------------------------------------------------------------

function resolveHeroFaction(
  hero: Hero,
  swingAssignment: { hanli: 'A' | 'B'; wanglin: 'A' | 'B' } | null,
): 'A' | 'B' {
  if (hero.faction === '摇摆') {
    if (hero.id === 'hero_hanli') return swingAssignment?.hanli ?? 'A';
    if (hero.id === 'hero_wanglin') return swingAssignment?.wanglin ?? 'B';
  }
  return hero.faction === 'B' ? 'B' : 'A';
}

/** @deprecated starter 首发已改为从真实 AI 阵容数据（s7dAiLineups）读取，此函数保留兼容不再使用 */
// function generateAllyStarters(ally: Hero) {
//   return {
//     starterName: ally.name,
//     starterType: ally.type,
//     starterRealm: ally.realm,
//   };
// }

// --------------------------------------------------------------------------
// 主组件
// --------------------------------------------------------------------------

export const S7D_Lineup: React.FC<LineupProps> = (props) => {
  const navigate = useNavigate();
  const returnToMenu = useReturnToMenu();
  const [searchParams] = useSearchParams();

  // 优先级：props.mode > URL query ?mode=... > 'starter'
  const urlMode = searchParams.get('mode') as LineupMode | null;
  const mode: LineupMode = props.mode ?? (urlMode === 'reinforce' ? 'reinforce' : 'starter');
  const isReinforce = mode === 'reinforce';

  const heroId = useGameStore((s) => s.heroId);
  const finalFaction = useGameStore((s) => s.finalFaction);
  const swingAssignment = useGameStore((s) => s.swingAssignment);
  const s7dAiLineups = useGameStore((s) => s.s7dAiLineups);
  const setS7DAiLineups = useGameStore((s) => s.setS7DAiLineups);
  const ownedCardIds = useGameStore((s) => s.ownedCardIds);
  const s7dDeployedCards = useGameStore((s) => s.s7dDeployedCards);
  const s7dStarters = useGameStore((s) => s.s7dStarters);
  const setS7DStarters = useGameStore((s) => s.setS7DStarters);

  // ---- 可战 6 张 = 主角 + 5 张参战备选 ----
  const deployableIds = useMemo<string[]>(() => {
    if (!heroId) return [];
    const deployed = Array.isArray(s7dDeployedCards) ? s7dDeployedCards : [];
    return [heroId, ...deployed];
  }, [heroId, s7dDeployedCards]);

  // ---- 候选池：starter=全部6张；reinforce=手牌区(6张-战斗区-弃牌区) ----
  const lockedSet = useMemo(() => new Set(props.lockedCards ?? []), [props.lockedCards]);
  const graveSet = useMemo(() => new Set(props.graveyardCards ?? []), [props.graveyardCards]);

  const candidateIds = useMemo<string[]>(() => {
    if (!isReinforce) return deployableIds;
    // 手牌区 = 可战 − 战斗区 − 弃牌区
    return deployableIds.filter((id) => !lockedSet.has(id) && !graveSet.has(id));
  }, [isReinforce, deployableIds, lockedSet, graveSet]);

  // ---- 必选数量 ----
  const requiredPickSize: number = useMemo(() => {
    if (!isReinforce) return STARTER_SIZE;
    // 补位：pickSize 优先；否则取 "2 - 当前战斗区数量"
    if (typeof props.pickSize === 'number') return props.pickSize;
    const slotLeft = Math.max(0, 2 - (props.lockedCards?.length ?? 0));
    return slotLeft || 1;
  }, [isReinforce, props.pickSize, props.lockedCards]);

  /** 当前选中的卡 id（starter 持久化读取；reinforce 每次弹窗全新） */
  const [selected, setSelected] = useState<string[]>(() => {
    if (isReinforce) return [];
    return s7dStarters?.slice() ?? [];
  });
  /** 详情弹窗展示中的卡 id */
  const [detailCardId, setDetailCardId] = useState<string | null>(null);

  // starter 模式：若备战数据缺失自动跳回 deploy
  useEffect(() => {
    if (isReinforce) return;
    if (!heroId) return;
    if (!Array.isArray(s7dDeployedCards) || s7dDeployedCards.length < 5) {
      navigate('/s7d/deploy', { replace: true });
    }
  }, [isReinforce, heroId, s7dDeployedCards, navigate]);

  // starter 模式：若 AI 阵容尚未生成（如从测试入口直达），后台懒加载一次
  useEffect(() => {
    if (isReinforce) return;
    if (!heroId) return;
    if (s7dAiLineups) return;
    const resolvedFaction: 'A' | 'B' = (() => {
      if (finalFaction === 'A' || finalFaction === 'B') return finalFaction;
      const mh = HEROES_DATA.find((h) => h.id === heroId);
      if (!mh) return 'A';
      return mh.faction === 'B' ? 'B' : 'A';
    })();
    let cancelled = false;
    generateAllAiLineups({
      playerHeroId: heroId,
      playerFaction: resolvedFaction,
      swingAssignment,
      ownedCardIds,
    })
      .then((lineups) => {
        if (cancelled) return;
        setS7DAiLineups(lineups);
      })
      .catch((err) => {
        console.error('[S7D_Lineup] AI 阵容懒加载失败', err);
      });
    return () => {
      cancelled = true;
    };
  }, [isReinforce, heroId, s7dAiLineups, finalFaction, swingAssignment, ownedCardIds, setS7DAiLineups]);

  // ---- 阵营 + 队友推导 ----
  const { playerFaction, allies } = useMemo(() => {
    const resolvedFaction: 'A' | 'B' = (() => {
      if (finalFaction === 'A' || finalFaction === 'B') return finalFaction;
      const mh = HEROES_DATA.find((h) => h.id === heroId);
      if (!mh) return 'A';
      return mh.faction === 'B' ? 'B' : 'A';
    })();
    const playerTeam: Hero[] = [];
    HEROES_DATA.forEach((h) => {
      if (resolveHeroFaction(h, swingAssignment) === resolvedFaction) {
        playerTeam.push(h);
      }
    });
    const ally = playerTeam.filter((h) => h.id !== heroId);
    return { playerFaction: resolvedFaction, allies: ally };
  }, [heroId, finalFaction, swingAssignment]);

  // ---- 点击卡牌 = 打开详情 ----
  const openDetail = (id: string) => {
    // 补位模式下点击已锁定或弃牌区卡，仅查看，无法操作
    setDetailCardId(id);
  };

  // ---- 详情弹窗内的"选为登场 / 取消登场" ----
  const toggleStarter = (id: string) => {
    // 补位模式：已锁定/已阵亡卡无法选
    if (isReinforce && (lockedSet.has(id) || graveSet.has(id))) return;

    setSelected((prev) => {
      if (prev.includes(id)) {
        return prev.filter((x) => x !== id);
      }
      if (prev.length >= requiredPickSize) {
        // FIFO 替换最早选中的
        return [...prev.slice(1), id];
      }
      return [...prev, id];
    });
  };

  const handleClear = () => setSelected([]);
  const handleRandom = () => {
    if (candidateIds.length < requiredPickSize) {
      setSelected(candidateIds.slice());
      return;
    }
    const shuffled = [...candidateIds].sort(() => Math.random() - 0.5);
    setSelected(shuffled.slice(0, requiredPickSize));
  };

  // ---- 确认提交 ----
  const handleConfirm = () => {
    if (selected.length !== requiredPickSize) return;
    if (isReinforce) {
      // 补位模式：调用上层回调，由战场系统接管
      props.onReinforceConfirm?.(selected);
      return;
    }
    // 首发模式：写入 store + 跳转决战
    setS7DStarters(selected);
    navigate('/s7d/battle');
  };

  const canLaunch = selected.length === requiredPickSize;

  // ---- 术语 ----
  const zoneTitle = isReinforce ? '手牌区候选' : '可上阵卡牌（6 张）';
  const slotTitle = isReinforce ? '补位登场' : '首发阵容';
  const pageTitle = isReinforce ? '战斗区补位 · 补充登场' : '决战先锋 · 首发登场';
  const pageSubtitle = isReinforce
    ? `战斗区空缺 ${requiredPickSize} 位 · 从手牌区挑 ${requiredPickSize} 张补位（必选）`
    : `从 6 张参战卡中挑 ${STARTER_SIZE} 张率先登场 · 余下 4 张作为后备手牌 · 主角非强制首发`;
  const launchBtnText = isReinforce ? '✓ 确认补位 · 返回战斗' : '⚔ 确认出征 · 决战坠魔谷';

  if (!heroId) {
    return (
      <div className={styles.screen}>
        <BackButton onClick={returnToMenu} />
        <div className={styles.empty}>尚未选择主角，无法进入登场界面。</div>
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
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
      >
        <div className={styles.topTitle}>{pageTitle}</div>
        <div className={styles.topSubtitle}>{pageSubtitle}</div>
      </motion.div>

      {/* 我方队友信息条 */}
      <motion.div
        className={styles.allyBar}
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.15 }}
      >
        <div className={styles.allyBarTitle}>
          我方阵营 · {playerFaction === 'A' ? '护道派' : '弑道派'} ·{' '}
          {isReinforce ? '友军当前战斗区' : '友军出战信息'}
        </div>
        <div className={styles.allyList}>
          {allies.map((h) => {
            const avatar = getCachedImage(h.id) ?? '';
            const isSwing = h.faction === '摇摆';
            // 补位模式：从 props.allyOnField 读取友军实时在场卡
            const onFieldEntry = props.allyOnField?.find((a) => a.heroId === h.id);
            const onFieldCards = onFieldEntry?.cardIds ?? [];
            return (
              <div key={h.id} className={styles.allyItem}>
                <div
                  className={styles.allyAvatar}
                  style={avatar ? { backgroundImage: `url(${avatar})` } : undefined}
                />
                <div className={styles.allyInfo}>
                  <div className={styles.allyName}>
                    {h.name}
                    {isSwing && <span className={styles.allySwingTag}>摇摆</span>}
                  </div>
                  {isReinforce ? (
                    <div className={styles.allyStarters}>
                      <span className={styles.allyStarterLabel}>场上：</span>
                      {onFieldCards.length > 0 ? (
                        onFieldCards.map((cid) => {
                          const info = resolveCard(cid);
                          return (
                            <span key={cid} className={styles.allyStarterCard}>
                              {info?.name ?? cid}
                            </span>
                          );
                        })
                      ) : (
                        <span className={styles.allyStarterMore}>— 无友军战场数据 —</span>
                      )}
                    </div>
                  ) : (
                    (() => {
                      // starter 模式：显示真实 AI 首发（来自 s7dAiLineups）
                      const aiLineup = s7dAiLineups?.[h.id];
                      if (!aiLineup) {
                        return (
                          <div className={styles.allyStarters}>
                            <span className={styles.allyStarterLabel}>首发：</span>
                            <span className={styles.allyStarterMore}>
                              阵容配置中…
                            </span>
                          </div>
                        );
                      }
                      const starterCards = aiLineup.starterCards;
                      return (
                        <div className={styles.allyStarters}>
                          <span className={styles.allyStarterLabel}>首发：</span>
                          {starterCards.map((cid) => {
                            const info = resolveCard(cid);
                            const isHero = cid === h.id;
                            return (
                              <span
                                key={cid}
                                className={styles.allyStarterCard}
                                title={info?.name ?? cid}
                              >
                                {info?.name ?? cid}
                                {isHero && '·主'}
                              </span>
                            );
                          })}
                          <span className={styles.allyStarterMore}>
                            +{aiLineup.deployedCards.length - starterCards.filter((c) => c !== h.id).length} 张后备
                          </span>
                        </div>
                      );
                    })()
                  )}
                </div>
              </div>
            );
          })}
          {allies.length === 0 && (
            <div className={styles.allyEmpty}>暂无队友数据</div>
          )}
        </div>
      </motion.div>

      {/* 主区：左候选 + 右登场槽 */}
      <div className={styles.mainPanel}>
        {/* ---------- 左：候选 ---------- */}
        <div className={styles.candidatePanel}>
          <div className={styles.panelHeader}>
            <div className={styles.panelTitle}>
              {zoneTitle}
              {isReinforce && (
                <span className={styles.panelSubTitle}>
                  （共 {candidateIds.length} 张可选）
                </span>
              )}
            </div>
            <div className={styles.panelActions}>
              <button type="button" className={styles.helperBtn} onClick={handleClear}>
                清空
              </button>
              <button type="button" className={styles.helperBtn} onClick={handleRandom}>
                随机 {requiredPickSize} 张
              </button>
            </div>
          </div>

          <div className={styles.candidateGrid}>
            {/* 可选候选 */}
            {candidateIds.map((id) => {
              const info = resolveCard(id);
              if (!info) return null;
              const picked = selected.includes(id);
              const rColor = RARITY_COLOR[info.rarity] ?? '#888';
              return (
                <div
                  key={id}
                  className={`${styles.cardItem} ${picked ? styles.picked : ''} ${info.isHero ? styles.hero : ''}`}
                  style={{ borderColor: rColor }}
                  onClick={() => openDetail(id)}
                >
                  <div
                    className={styles.cardPortrait}
                    style={info.portrait ? { backgroundImage: `url(${info.portrait})` } : undefined}
                  />
                  <div className={styles.cardTopVeil} />
                  <div className={styles.cardBottomVeil} />
                  <div className={styles.cardRarity} style={{ background: rColor, color: '#000' }}>
                    {info.rarity}
                  </div>
                  {info.isHero && <div className={styles.heroTag}>主角</div>}
                  {picked && <div className={styles.pickedBadge}>{isReinforce ? '补位' : '首发'}</div>}
                  <div className={styles.cardName}>{info.name}</div>
                  <div className={styles.cardMeta}>
                    {info.type} · {info.realm}
                  </div>
                  <div className={styles.cardStats}>
                    HP {info.hp} · 攻 {info.atk} · 心 {info.mnd}
                  </div>
                </div>
              );
            })}

            {/* 补位模式：已锁定卡（战斗区） —— 灰色展示、不可选 */}
            {isReinforce && (props.lockedCards?.length ?? 0) > 0 && (
              <>
                <div className={styles.zoneDivider}>— 战斗区（已上阵 · 锁定）—</div>
                {props.lockedCards!.map((id) => {
                  const info = resolveCard(id);
                  if (!info) return null;
                  const rColor = RARITY_COLOR[info.rarity] ?? '#888';
                  return (
                    <div
                      key={`locked-${id}`}
                      className={`${styles.cardItem} ${styles.cardLocked}`}
                      style={{ borderColor: rColor }}
                      onClick={() => openDetail(id)}
                    >
                      <div
                        className={styles.cardPortrait}
                        style={info.portrait ? { backgroundImage: `url(${info.portrait})` } : undefined}
                      />
                      <div className={styles.cardTopVeil} />
                      <div className={styles.cardBottomVeil} />
                      <div className={styles.cardRarity} style={{ background: rColor, color: '#000' }}>
                        {info.rarity}
                      </div>
                      <div className={styles.lockedBadge}>战斗区</div>
                      <div className={styles.cardName}>{info.name}</div>
                      <div className={styles.cardMeta}>
                        {info.type} · {info.realm}
                      </div>
                    </div>
                  );
                })}
              </>
            )}

            {/* 补位模式：弃牌区 —— 红色标记、不可选 */}
            {isReinforce && (props.graveyardCards?.length ?? 0) > 0 && (
              <>
                <div className={styles.zoneDivider}>— 弃牌区（阵亡）—</div>
                {props.graveyardCards!.map((id) => {
                  const info = resolveCard(id);
                  if (!info) return null;
                  return (
                    <div
                      key={`grave-${id}`}
                      className={`${styles.cardItem} ${styles.cardGrave}`}
                      onClick={() => openDetail(id)}
                    >
                      <div
                        className={styles.cardPortrait}
                        style={info.portrait ? { backgroundImage: `url(${info.portrait})` } : undefined}
                      />
                      <div className={styles.cardTopVeil} />
                      <div className={styles.cardBottomVeil} />
                      <div className={styles.graveBadge}>阵亡</div>
                      <div className={styles.cardName}>{info.name}</div>
                    </div>
                  );
                })}
              </>
            )}

            {/* 候选为空提示 */}
            {candidateIds.length === 0 && !isReinforce && (
              <div className={styles.candidateEmpty}>
                尚未完成参战备选（上一页挑 5 张），请返回。
              </div>
            )}
            {candidateIds.length === 0 && isReinforce && (
              <div className={styles.candidateEmpty}>
                手牌区已空 · 无法再补位
              </div>
            )}
          </div>
        </div>

        {/* ---------- 右：登场槽 + 后备展示 ---------- */}
        <div className={styles.lineupPanel}>
          <div className={styles.lineupHeader}>
            <div className={styles.lineupTitle}>
              {slotTitle}（{selected.length}/{requiredPickSize}）
            </div>
            <div className={styles.lineupHint}>
              {selected.length === requiredPickSize
                ? isReinforce ? '✓ 补位已定，可返回战场' : '✓ 首发已定，可出征'
                : `请再挑选 ${requiredPickSize - selected.length} 张`}
            </div>
          </div>

          {/* 登场槽位 */}
          <div className={styles.starterSlots}>
            {Array.from({ length: requiredPickSize }).map((_, idx) => {
              const id = selected[idx];
              const info = id ? resolveCard(id) : null;
              const rColor = info ? RARITY_COLOR[info.rarity] ?? '#888' : '#444';
              return (
                <AnimatePresence key={idx} mode="wait">
                  {info ? (
                    <motion.div
                      key={`slot-${id}-${idx}`}
                      className={styles.filledStarter}
                      style={{ borderColor: rColor }}
                      initial={{ scale: 0.85, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      exit={{ scale: 0.85, opacity: 0 }}
                      transition={{ duration: 0.2 }}
                      onClick={() => openDetail(id!)}
                    >
                      <div
                        className={styles.starterPortrait}
                        style={info.portrait ? { backgroundImage: `url(${info.portrait})` } : undefined}
                      />
                      <div className={styles.starterTag} style={{ background: rColor, color: '#000' }}>
                        {info.rarity}
                      </div>
                      <div className={styles.starterName}>{info.name}</div>
                      <div className={styles.starterMeta}>
                        {info.type} · {info.realm}
                      </div>
                      <div className={styles.starterStats}>
                        HP {info.hp} · 攻 {info.atk} · 心 {info.mnd}
                      </div>
                      <button
                        type="button"
                        className={styles.starterRemove}
                        onClick={(e) => { e.stopPropagation(); toggleStarter(id!); }}
                        title={isReinforce ? '取消补位' : '取消首发'}
                      >✕</button>
                    </motion.div>
                  ) : (
                    <motion.div
                      key={`empty-${idx}`}
                      className={styles.emptyStarter}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                    >
                      <div className={styles.emptyIndex}>
                        {isReinforce ? '补位' : '首发'} · {idx + 1}
                      </div>
                      <div className={styles.emptyHint}>
                        点击左侧卡牌<br/>→ 详情内{isReinforce ? '确认补位' : '选为首发'}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              );
            })}
          </div>

          {/* 后备区展示（仅 starter 模式） */}
          {!isReinforce && (
            <>
              <div className={styles.reserveHeader}>
                后备手牌区（{deployableIds.length - selected.length} 张）· 战斗中补位
              </div>
              <div className={styles.reserveList}>
                {deployableIds
                  .filter((id) => !selected.includes(id))
                  .map((id) => {
                    const info = resolveCard(id);
                    if (!info) return null;
                    const rColor = RARITY_COLOR[info.rarity] ?? '#888';
                    return (
                      <div
                        key={id}
                        className={styles.reserveCard}
                        style={{ borderColor: rColor }}
                        onClick={() => openDetail(id)}
                      >
                        <div
                          className={styles.reservePortrait}
                          style={info.portrait ? { backgroundImage: `url(${info.portrait})` } : undefined}
                        />
                        <div className={styles.reserveName}>{info.name}</div>
                      </div>
                    );
                  })}
                {deployableIds.length - selected.length === 0 && (
                  <div className={styles.reserveEmpty}>全员首发 · 无后备</div>
                )}
              </div>
            </>
          )}

          {/* 确认按钮 */}
          <button
            type="button"
            className={`${styles.launchBtn} ${canLaunch ? styles.launchBtnReady : ''}`}
            onClick={handleConfirm}
            disabled={!canLaunch}
          >
            {canLaunch
              ? launchBtnText
              : `还需 ${requiredPickSize - selected.length} 张${isReinforce ? '补位' : '首发'}`}
          </button>
        </div>
      </div>

      {/* ============================================================
       * 详情弹窗（复用 CollectionModal 直达详情模式）
       * ============================================================ */}
      <CollectionModal
        open={detailCardId !== null}
        onClose={() => setDetailCardId(null)}
        chapter={5}
        initialDetailId={detailCardId}
        detailExtraActions={(cid) => {
          const inStarter = selected.includes(cid);
          const pickFull = selected.length >= requiredPickSize;

          // 补位模式：已锁定/弃牌区卡禁止操作，仅显示只读状态
          if (isReinforce && lockedSet.has(cid)) {
            return (
              <div className={styles.actionRow}>
                <div className={styles.actionReadonly}>⚔ 战斗区中 · 无法选中</div>
                <button
                  type="button"
                  className={`${styles.actionBtn} ${styles.actionCancel}`}
                  onClick={() => setDetailCardId(null)}
                >
                  返回
                </button>
              </div>
            );
          }
          if (isReinforce && graveSet.has(cid)) {
            return (
              <div className={styles.actionRow}>
                <div className={styles.actionReadonly}>☠ 已阵亡 · 无法选中</div>
                <button
                  type="button"
                  className={`${styles.actionBtn} ${styles.actionCancel}`}
                  onClick={() => setDetailCardId(null)}
                >
                  返回
                </button>
              </div>
            );
          }

          return (
            <div className={styles.actionRow}>
              {inStarter ? (
                <button
                  type="button"
                  className={`${styles.actionBtn} ${styles.actionRemove}`}
                  onClick={() => {
                    toggleStarter(cid);
                    setDetailCardId(null);
                  }}
                >
                  ✕ {isReinforce ? '取消补位' : '取消首发'}
                </button>
              ) : (
                <button
                  type="button"
                  className={`${styles.actionBtn} ${styles.actionAdd}`}
                  onClick={() => {
                    toggleStarter(cid);
                    setDetailCardId(null);
                  }}
                  disabled={pickFull}
                  title={pickFull ? `已满 ${requiredPickSize} 张，请先取消一位` : (isReinforce ? '选为补位登场' : '选为首发登场')}
                >
                  {pickFull ? '⚠ 已满' : (isReinforce ? '✓ 选为补位' : '✓ 选为首发')}
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

export default S7D_Lineup;

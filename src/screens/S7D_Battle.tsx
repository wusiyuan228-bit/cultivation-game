/**
 * S7D_Battle · 坠魔谷决战主战斗页面（Batch 1 · 完整交互版）
 *
 * ═════════════════════════════════════════════════════════════════════
 *  本页面职责
 * ═════════════════════════════════════════════════════════════════════
 *   1. 可视化渲染 18×12 地图 + 12 棋子 + 双方水晶
 *   2. 玩家交互：点击己方棋子 → 高亮可达/可攻击 → 移动/攻击
 *   3. 骰子弹窗：攻击结算动画
 *   4. 结束回合按钮：跳过当前行动者
 *   5. AI 自动行动：非玩家回合自动推进（简化 AI，Batch 3 再差异化）
 *   6. 胜负判定 + 结果弹窗
 *
 * ═════════════════════════════════════════════════════════════════════
 *  分批进度
 * ═════════════════════════════════════════════════════════════════════
 *   Batch 1（本次）：移动/攻击/骰子/结束回合/AI/胜负 - 核心闭环
 *   Batch 2：战技/绝技 UI + 水晶相邻攻击 + 阵亡补位弹窗
 *   Batch 3：5 个 AI 差异化决策 + 规则弹窗 + 打磨
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { asset } from '@/utils/assetPath';
import { getCachedImage } from '@/utils/imageCache';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { BackButton } from '@/components/BackButton';
import { useReturnToMenu } from '@/hooks/useReturnToMenu';
import { useGameStore } from '@/stores/gameStore';
import { SaveSystem } from '@/stores/gameStore';
import { useS7DBattleStore } from '@/stores/s7dBattleStore';
import {
  S7D_MAP_COLS,
  S7D_MAP_ROWS,
  S7D_TILE_DESC,
  generateS7DMap,
  isCrystalA,
  isCrystalB,
  isSpawnA,
  isSpawnB,
  type S7DTile,
} from '@/data/s7dMap';
import { generateAllAiLineups } from '@/utils/s7dAiLineup';
import { HEROES_DATA } from '@/data/heroesData';
import type { Hero, HeroId } from '@/types/game';
import type {
  BattleCardInstance,
  BattleFaction,
  BattleOwnerId,
  Crystal,
  GridPos,
} from '@/types/s7dBattle';
import {
  canAttackUnit,
  getAttackableEnemies,
  manhattan,
  type S7DDiceResult,
} from '@/utils/s7dBattleCombat';
import { decideAiAction } from '@/utils/s7dAiSimple';
import { SkillRegistry } from '@/systems/battle/skillRegistry';
import {
  checkSkillCastability,
  hasAdjacentEnemyOf as hasAdjEnemyRaw,
  hasAnyLivingEnemyOf as hasAnyEnemyRaw,
  type SkillCheckUnit,
} from '@/systems/battle/skillCastability';
import { S7D_Lineup } from './S7D_Lineup';
import styles from './S7D_Battle.module.css';

// ==========================================================================
// 常量
// ==========================================================================

const CELL_SIZE = 70;
const AI_OWNER_PREFIX = 'ai_';
/** AI 每个动作之间的动画间隔（ms） */
const AI_STEP_DELAY = 600;
/** 骰子弹窗展示时间（ms） */
const DICE_SHOW_DURATION = 2000;

// ==========================================================================
// 工具函数
// ==========================================================================

function getHero(heroId: HeroId): Hero | undefined {
  return (HEROES_DATA as Hero[]).find((h) => h.id === heroId);
}

function aiOwnerIdOf(heroId: HeroId): BattleOwnerId {
  return `${AI_OWNER_PREFIX}${heroId}`;
}

/** 把格子坐标转为 "r,c" 字符串 */
function posKey(r: number, c: number) {
  return `${r},${c}`;
}

/**
 * 把 S7D 的 BattleCardInstance 适配为 SkillCheckUnit 结构。
 * checkSkillCastability 使用的是结构型接口，这里按需补齐字段。
 */
function toSkillCheckUnit(u: BattleCardInstance, playerFaction: BattleFaction): SkillCheckUnit {
  return {
    id: u.instanceId,
    dead: u.hp <= 0 || u.zone === 'grave',
    row: u.position?.row ?? -1,
    col: u.position?.col ?? -1,
    isEnemy: u.faction !== playerFaction, // 以玩家阵营为参照
    attackedThisTurn: !!u.attackedThisTurn,
    ultimateUsed: !!u.ultimateUsed,
    ultimate: u.ultimate,
    battleSkill: u.battleSkill,
  };
}

/** 反查绝技在 SkillRegistry 中的 id */
function findUltimateRegistryId(u: BattleCardInstance): string | null {
  if (!u.ultimate) return null;
  const id = SkillRegistry.findIdByName(u.ultimate.name);
  if (!id) return null;
  const reg = SkillRegistry.get(id);
  return reg?.isActive ? id : null;
}

/** 瞄准态提示文案 */
function describeSelectorHint(kind: string): string {
  switch (kind) {
    case 'single_any_enemy':
      return '点击任意敌方单位为目标';
    case 'single_line_enemy':
      return '点击同行或同列的敌方单位为目标';
    case 'single_adjacent_enemy':
      return '点击相邻（上下左右）的敌方单位为目标';
    case 'single_any_character':
      return '点击任意单位为目标';
    case 'position_pick':
      return '点击棋盘任意空格子放置目标';
    default:
      return '点击目标';
  }
}

type SkillCheckResult = {
  hasCharges: boolean;
  interactable: boolean;
  isPassive: boolean;
  reason?: string;
};

/** 统一的技能可发动判定（按 S7B 成熟工具链） */
function getSkillCheck(
  unit: BattleCardInstance,
  skillType: 'battle' | 'ultimate',
  allUnits: BattleCardInstance[],
  playerFaction: BattleFaction,
): SkillCheckResult {
  const checkUnit = toSkillCheckUnit(unit, playerFaction);
  const allCheckUnits = allUnits.map((u) => toSkillCheckUnit(u, playerFaction));
  return checkSkillCastability(checkUnit, skillType, {
    skillUsedThisTurn: !!unit.skillUsedThisTurn,
    allUnits: allCheckUnits,
    hasAdjacentEnemy: hasAdjEnemyRaw(checkUnit, allCheckUnits),
    hasAnyEnemy: hasAnyEnemyRaw(checkUnit, allCheckUnits),
  });
}

// ==========================================================================
// 主组件
// ==========================================================================

export const S7D_Battle: React.FC = () => {
  const navigate = useNavigate();
  const returnToMenu = useReturnToMenu();

  // ---- gameStore ----
  const heroId = useGameStore((s) => s.heroId);
  const finalFaction = useGameStore((s) => s.finalFaction);
  const swingAssignment = useGameStore((s) => s.swingAssignment);
  const ownedCardIds = useGameStore((s) => s.ownedCardIds);
  const s7dDeployedCards = useGameStore((s) => s.s7dDeployedCards);
  const s7dStarters = useGameStore((s) => s.s7dStarters);
  const s7dAiLineups = useGameStore((s) => s.s7dAiLineups);
  const setS7DAiLineups = useGameStore((s) => s.setS7DAiLineups);
  const setS7DFinalResult = useGameStore((s) => s.setS7DFinalResult);
  const markPhaseDone = useGameStore((s) => s.markPhaseDone);

  // ---- battleStore ----
  const battleState = useS7DBattleStore((s) => s.state);
  const initBattle = useS7DBattleStore((s) => s.initBattle);
  const clearBattle = useS7DBattleStore((s) => s.clearBattle);
  const moveUnit = useS7DBattleStore((s) => s.moveUnit);
  const damageUnit = useS7DBattleStore((s) => s.damageUnit);
  const performAttackFn = useS7DBattleStore((s) => s.performAttack);
  const advanceActor = useS7DBattleStore((s) => s.advanceActor);
  const advanceSubRound = useS7DBattleStore((s) => s.advanceSubRound);
  const getReachableCells = useS7DBattleStore((s) => s.getReachableCells);
  const logFn = useS7DBattleStore((s) => s.log);
  const useBattleSkillFn = useS7DBattleStore((s) => s.useBattleSkill);
  const useUltimateFn = useS7DBattleStore((s) => s.useUltimate);
  const deployFromHand = useS7DBattleStore((s) => s.deployFromHand);
  const getAvailableSpawns = useS7DBattleStore((s) => s.getAvailableSpawns);

  // ---- 本地 UI ----
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hoverCell, setHoverCell] = useState<{ row: number; col: number } | null>(null);
  const [selectedUnitId, setSelectedUnitId] = useState<string | null>(null);
  /** 瞄准态（选择绝技/战技目标中） */
  const [ultimateTargeting, setUltimateTargeting] = useState<{
    kind: string;
    casterId: string;
    skillName: string;
    skillType: 'battle' | 'ultimate';
    candidateIds: string[];
  } | null>(null);
  /** 补位弹窗所处理的任务 */
  const [reinforceModal, setReinforceModal] = useState<{
    ownerId: BattleOwnerId;
    slot: 1 | 2;
    candidateInstanceIds: string[];
    reason: string;
  } | null>(null);
  /** 水晶结算过场（某大回合末刚发生水晶扣血） */
  const [crystalResolveFx, setCrystalResolveFx] = useState<{
    bigRound: number;
    dmgA: number;
    dmgB: number;
    occupantsA: Array<{ name: string }>;
    occupantsB: Array<{ name: string }>;
  } | null>(null);
  /** 骰子弹窗状态 */
  const [diceModal, setDiceModal] = useState<{
    attacker: BattleCardInstance;
    defender: BattleCardInstance | null; // null = 攻击水晶
    crystalFaction?: BattleFaction;
    result: S7DDiceResult | { damage: number };
  } | null>(null);
  /** 风属斗技 · 玩家可控选位 state */
  const [fengshuPick, setFengshuPick] = useState<{
    attackerId: string;
    defenderId: string;
    candidates: Array<{ row: number; col: number }>;
    /** ask = 弹窗询问；pick = 棋盘选位 */
    phase: 'ask' | 'pick';
  } | null>(null);
  const fengshuPickRef = useRef<typeof fengshuPick>(null);
  useEffect(() => {
    fengshuPickRef.current = fengshuPick;
  }, [fengshuPick]);
  /** AI 是否正在行动（阻止玩家操作） */
  const [aiBusy, setAiBusy] = useState(false);
  /** 是否显示胜负面板 */
  const [showResult, setShowResult] = useState(false);
  /** 手牌/弃牌 偷看弹窗 —— 仅展示玩家(ownerId='player') 自己的卡 */
  const [zonePeek, setZonePeek] = useState<'hand' | 'grave' | null>(null);
  /** 悬停的单位 ID（用于左下角技能面板预览） */
  const [hoveredUnitId, setHoveredUnitId] = useState<string | null>(null);

  /** 战斗规则弹窗显示开关（进入战场时默认弹一次） */
  const [showRule, setShowRule] = useState<boolean>(true);

  /**
   * 已揭示的敌方技能集合：key = `${unitId}_battle` / `${unitId}_ultimate`
   * 敌方未发动过的技能在左下面板隐藏 desc，只显示「效果未知」
   * 一经发动永久揭示，整个战斗内可见
   */
  const [revealedEnemySkills, setRevealedEnemySkills] = useState<Set<string>>(() => new Set());

  const mapData = useMemo<S7DTile[][]>(() => generateS7DMap(), []);

  // ============================================================
  // 地图拖动 & 缩放（移植自 S7B：直接操作 DOM transform，绕过 React 重渲染）
  // ============================================================
  const mapAreaRef = useRef<HTMLDivElement>(null);
  const mapViewportRef = useRef<HTMLDivElement>(null);
  const transformRef = useRef({ x: 0, y: 0, scale: 1 });
  const rafIdRef = useRef<number | null>(null);

  const applyTransform = useCallback(() => {
    if (rafIdRef.current != null) return;
    rafIdRef.current = requestAnimationFrame(() => {
      rafIdRef.current = null;
      const el = mapViewportRef.current;
      if (!el) return;
      const { x, y, scale } = transformRef.current;
      el.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${scale})`;
    });
  }, []);

  const dragState = useRef<{
    isDragging: boolean;
    hasMovedEnough: boolean;
    startX: number;
    startY: number;
    startOffsetX: number;
    startOffsetY: number;
  }>({ isDragging: false, hasMovedEnough: false, startX: 0, startY: 0, startOffsetX: 0, startOffsetY: 0 });

  // 滚轮缩放（以鼠标点为锚点；non-passive 以确保 preventDefault 生效）
  useEffect(() => {
    const el = mapAreaRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const t = transformRef.current;
      const delta = e.deltaY > 0 ? -0.1 : 0.1;
      const nextScale = Math.min(2, Math.max(0.4, t.scale + delta));
      if (nextScale === t.scale) return;
      const rect = el.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const ratio = nextScale / t.scale;
      t.x = mx - (mx - t.x) * ratio;
      t.y = my - (my - t.y) * ratio;
      t.scale = nextScale;
      applyTransform();
    };
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, [applyTransform]);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    const ds = dragState.current;
    ds.startX = e.clientX;
    ds.startY = e.clientY;
    ds.startOffsetX = transformRef.current.x;
    ds.startOffsetY = transformRef.current.y;
    ds.isDragging = true;
    ds.hasMovedEnough = false;
    (e.target as Element).setPointerCapture?.(e.pointerId);
  }, []);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    const ds = dragState.current;
    if (!ds.isDragging) return;
    const dx = e.clientX - ds.startX;
    const dy = e.clientY - ds.startY;
    if (!ds.hasMovedEnough && Math.abs(dx) + Math.abs(dy) < 4) return;
    ds.hasMovedEnough = true;
    transformRef.current.x = ds.startOffsetX + dx;
    transformRef.current.y = ds.startOffsetY + dy;
    applyTransform();
  }, [applyTransform]);

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    const ds = dragState.current;
    ds.isDragging = false;
    setTimeout(() => { ds.hasMovedEnough = false; }, 0);
    (e.target as Element).releasePointerCapture?.(e.pointerId);
  }, []);

  /** 拖动判定 —— 在 cell/unit 点击时调用，避免拖动时误触发点击 */
  const isDraggingNow = useCallback(() => dragState.current.hasMovedEnough, []);

  // ---- 战场初始化 ----
  useEffect(() => {
    let cancelled = false;
    async function doInit() {
      try {
        if (!heroId) {
          setError('尚未选择主角');
          setLoading(false);
          return;
        }
        const deployed = s7dDeployedCards ?? [];
        const starters = s7dStarters ?? [];
        if (deployed.length !== 5) {
          setError(`备战卡数量不对（当前 ${deployed.length} 张，应为 5 张）`);
          setLoading(false);
          return;
        }
        if (starters.length !== 2) {
          setError(`首发卡数量不对（当前 ${starters.length} 张，应为 2 张）`);
          setLoading(false);
          return;
        }

        if (battleState && battleState.playerHeroId === heroId) {
          setLoading(false);
          return;
        }

        const playerFaction: BattleFaction = finalFaction === 'B' ? 'B' : 'A';
        const playerHero = getHero(heroId);
        if (!playerHero) {
          setError(`主角数据缺失：${heroId}`);
          setLoading(false);
          return;
        }
        const playerMndFrozen = playerHero.battle_card.mnd;

        let aiLineups = s7dAiLineups;
        if (!aiLineups) {
          aiLineups = await generateAllAiLineups({
            playerHeroId: heroId,
            playerFaction,
            swingAssignment,
            ownedCardIds,
          });
          if (!cancelled) setS7DAiLineups(aiLineups);
        }
        if (cancelled) return;

        const aiLineupArr = Object.entries(aiLineups).map(([aiHeroId, lineup]) => {
          const aiHero = getHero(aiHeroId as HeroId);
          return {
            ownerId: aiOwnerIdOf(aiHeroId as HeroId),
            heroId: aiHeroId as HeroId,
            faction: lineup.faction as BattleFaction,
            deployedCards: lineup.deployedCards,
            starterCards: lineup.starterCards,
            mindFrozen: aiHero?.battle_card?.mnd ?? 3,
          };
        });

        await initBattle({
          playerHeroId: heroId,
          playerFaction,
          playerDeployedCards: deployed,
          playerStarterCards: starters,
          playerMindFrozen: playerMndFrozen,
          aiLineups: aiLineupArr,
        });

        if (!cancelled) setLoading(false);
      } catch (err) {
        console.error('[S7D_Battle] 初始化失败', err);
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setLoading(false);
        }
      }
    }
    doInit();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [heroId]);

  // ==========================================================================
  // 派生：当前行动信息
  // ==========================================================================
  const currentAction = battleState?.actionQueue[battleState.currentActorIdx];
  const currentActor = currentAction ? battleState!.units[currentAction.instanceId] : undefined;
  const isPlayerTurn = currentActor?.ownerId === 'player';
  const isBattleEnded = !!battleState?.winner;

  // ==========================================================================
  // 派生：当前可达格 / 可攻击目标
  //   规则 v2：水晶不可主动攻击，attackableCrystals 始终为空
  // ==========================================================================
  const { reachableKeys, attackableEnemyIds, attackableCrystals } = useMemo(() => {
    if (!battleState || !currentActor || !isPlayerTurn || isBattleEnded) {
      return {
        reachableKeys: new Set<string>(),
        attackableEnemyIds: new Set<string>(),
        attackableCrystals: [] as Crystal[],
      };
    }
    const reach = getReachableCells(currentActor.instanceId);
    const reachKeys = new Set(reach.map((p) => posKey(p.row, p.col)));
    const allUnits = Object.values(battleState.units);
    const enemies = getAttackableEnemies(currentActor, allUnits);
    const enemyIds = new Set(enemies.map((u) => u.instanceId));
    // 规则 v2：水晶不可主动攻击
    return {
      reachableKeys: reachKeys,
      attackableEnemyIds: enemyIds,
      attackableCrystals: [] as Crystal[],
    };
  }, [battleState, currentActor, isPlayerTurn, isBattleEnded, getReachableCells]);

  // ==========================================================================
  // 胜负监听
  // ==========================================================================
  useEffect(() => {
    if (battleState?.winner && !showResult) {
      setShowResult(true);
    }
  }, [battleState?.winner, showResult]);

  // ==========================================================================
  // 玩家操作：攻击敌方单位（Batch 2C：走 hook 引擎）
  // ==========================================================================
  const performAttackUnit = useCallback(
    (attackerId: string, defenderId: string) => {
      const s = useS7DBattleStore.getState().state;
      if (!s) return;
      const attacker = s.units[attackerId];
      const defender = s.units[defenderId];
      if (!attacker || !defender) return;
      const check = canAttackUnit(attacker, defender);
      if (!check.ok) {
        console.warn('[S7D_Battle] 攻击校验失败:', check.reason);
        return;
      }

      // ─── 风属斗技拦截：纳兰嫣然(玩家方)进攻 → 弹窗让玩家选位 ───
      const isPlayerSide = attacker.faction === s.playerFaction;
      const hasFengShu = (attacker.registrySkills ?? []).includes('sr_nalanyanran.battle');
      if (isPlayerSide && hasFengShu) {
        const candidates = useS7DBattleStore.getState().computeFengShuCandidates(attackerId, defenderId);
        if (candidates.length === 0) {
          logFn(`🌪 风属斗技无合法落点，${attacker.name} 放弃本次进攻`);
          return;
        }
        setFengshuPick({
          attackerId,
          defenderId,
          candidates,
          phase: 'ask',
        });
        return;
      }

      // 走引擎：hook + 伤害 + 觉醒一条龙
      const outcome = performAttackFn(attackerId, defenderId);
      if (!outcome) return;

      // 骰子弹窗（用引擎返回的真实骰）
      setDiceModal({
        attacker,
        defender,
        result: {
          attackerDice: outcome.attackerDice,
          defenderDice: outcome.defenderDice,
          attackerSum: outcome.attackerSum,
          defenderSum: outcome.defenderSum,
          baseDamage: Math.max(0, outcome.attackerSum - outcome.defenderSum),
          skillMod: 0,
          counterMod: outcome.counterMod,
          damage: outcome.damage,
        },
      });
    },
    [performAttackFn, logFn],
  );

  /** 风属斗技选位完成 — 用玩家选定的落点提交攻击 */
  const completeFengShuAttack = useCallback(
    (override: { row: number; col: number } | null) => {
      const pick = fengshuPickRef.current;
      if (!pick) return;
      const s = useS7DBattleStore.getState().state;
      if (!s) return;
      const attacker = s.units[pick.attackerId];
      const defender = s.units[pick.defenderId];
      if (!attacker || !defender) {
        setFengshuPick(null);
        return;
      }
      const outcome = performAttackFn(pick.attackerId, pick.defenderId, override);
      setFengshuPick(null);
      if (!outcome) return;
      setDiceModal({
        attacker,
        defender,
        result: {
          attackerDice: outcome.attackerDice,
          defenderDice: outcome.defenderDice,
          attackerSum: outcome.attackerSum,
          defenderSum: outcome.defenderSum,
          baseDamage: Math.max(0, outcome.attackerSum - outcome.defenderSum),
          skillMod: 0,
          counterMod: outcome.counterMod,
          damage: outcome.damage,
        },
      });
    },
    [performAttackFn],
  );

  // ==========================================================================
  // 玩家操作：攻击水晶（规则 v2 已废弃——水晶不可主动攻击）
  // ==========================================================================
  const performAttackCrystal = useCallback(
    (_attackerId: string, _crystalFaction: BattleFaction) => {
      logFn('⚠️ 水晶不可主动攻击，请占领水晶格等待大回合末结算');
    },
    [logFn],
  );

  // ==========================================================================
  // 玩家操作：移动到某格
  // ==========================================================================
  const performMove = useCallback(
    (unitId: string, to: GridPos) => {
      const s = useS7DBattleStore.getState().state;
      if (!s) return;
      const u = s.units[unitId];
      if (!u || !u.position) return;
      const steps = manhattan(u.position, to);
      moveUnit(unitId, to, steps);
    },
    [moveUnit],
  );

  // ==========================================================================
  // 玩家操作：使用技能（战技 / 绝技）
  // ==========================================================================
  // Batch 2A：简化版
  //   - 无目标（AOE / self / none）→ 直接调 useBattleSkill/useUltimate
  //   - 有目标（single_* / position_pick）→ 进入瞄准态
  //   - 不走引擎 hook，仅在战报记录（Batch 2B 会接入 SkillRegistry.run）
  const handleUseSkill = useCallback(
    (skillType: 'battle' | 'ultimate') => {
      const s = useS7DBattleStore.getState().state;
      if (!s) return;
      if (!currentActor || !isPlayerTurn) return;
      const meta = skillType === 'ultimate' ? currentActor.ultimate : currentActor.battleSkill;
      if (!meta) return;

      // 查 SkillRegistry 确定 targetSelector
      const regId = SkillRegistry.findIdByName(meta.name);
      const reg = regId ? SkillRegistry.get(regId) : undefined;
      const selectorKind = reg?.targetSelector?.kind;

      // 需要选目标的 selector → 进入瞄准态
      const NEEDS_TARGET: Record<string, boolean> = {
        single_any_enemy: true,
        single_line_enemy: true,
        single_adjacent_enemy: true,
        single_any_character: true,
        position_pick: true,
      };
      if (selectorKind && NEEDS_TARGET[selectorKind]) {
        // 计算候选集（按 selector 简单过滤）
        const allUnits = Object.values(s.units).filter(
          (u) => u.zone === 'field' && u.hp > 0,
        );
        let candidates: string[] = [];
        if (selectorKind === 'single_any_enemy') {
          candidates = allUnits.filter((u) => u.faction !== currentActor.faction).map((u) => u.instanceId);
        } else if (selectorKind === 'single_line_enemy') {
          candidates = allUnits
            .filter(
              (u) =>
                u.faction !== currentActor.faction &&
                (u.position?.row === currentActor.position?.row ||
                  u.position?.col === currentActor.position?.col),
            )
            .map((u) => u.instanceId);
        } else if (selectorKind === 'single_adjacent_enemy') {
          candidates = allUnits
            .filter(
              (u) =>
                u.faction !== currentActor.faction &&
                currentActor.position &&
                u.position &&
                Math.abs(u.position.row - currentActor.position.row) +
                  Math.abs(u.position.col - currentActor.position.col) ===
                  1,
            )
            .map((u) => u.instanceId);
        } else if (selectorKind === 'single_any_character') {
          candidates = allUnits.map((u) => u.instanceId);
        } else if (selectorKind === 'position_pick') {
          candidates = [];
        }

        setUltimateTargeting({
          kind: selectorKind,
          casterId: currentActor.instanceId,
          skillName: meta.name,
          skillType,
          candidateIds: candidates,
        });
        logFn(`🎯 【${meta.name}】进入目标选择（${describeSelectorHint(selectorKind)}） · ESC 取消`);
        return;
      }

      // 无需选目标 → 直接施放
      if (skillType === 'ultimate') {
        useUltimateFn(currentActor.instanceId, []);
      } else {
        useBattleSkillFn(currentActor.instanceId, []);
      }
    },
    [currentActor, isPlayerTurn, logFn, useBattleSkillFn, useUltimateFn],
  );

  /** 瞄准态：确认目标（点击某单位） */
  const handleAimConfirmUnit = useCallback(
    (targetId: string) => {
      const cur = ultimateTargeting;
      if (!cur) return;
      if (!cur.candidateIds.includes(targetId)) {
        logFn('⚠️ 非法目标：不在技能可选择范围内');
        return;
      }
      if (cur.skillType === 'ultimate') {
        useUltimateFn(cur.casterId, [targetId]);
      } else {
        useBattleSkillFn(cur.casterId, [targetId]);
      }
      setUltimateTargeting(null);
    },
    [ultimateTargeting, logFn, useBattleSkillFn, useUltimateFn],
  );

  /** 瞄准态：取消 */
  const handleAimCancel = useCallback(() => {
    if (!ultimateTargeting) return;
    logFn('🎯 取消目标选择');
    setUltimateTargeting(null);
  }, [ultimateTargeting, logFn]);

  // 键盘 ESC 取消瞄准
  useEffect(() => {
    if (!ultimateTargeting) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleAimCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ultimateTargeting, handleAimCancel]);

  // ==========================================================================
  // 补位弹窗：监听 reinforceQueue（玩家队伍的补位任务）
  // ==========================================================================
  useEffect(() => {
    if (!battleState) return;
    if (reinforceModal) return; // 已有弹窗中，等玩家处理
    const playerTask = battleState.reinforceQueue.find((t) => t.ownerId === 'player');
    if (playerTask) {
      setReinforceModal({
        ownerId: playerTask.ownerId,
        slot: playerTask.slot,
        candidateInstanceIds: playerTask.candidateInstanceIds.slice(),
        reason: playerTask.reason,
      });
    }
    // AI 玩家的补位由 AI 决策自动完成（见下方 useEffect）
  }, [battleState, reinforceModal]);

  // AI 自动补位：AI 玩家的 reinforceTask 立即从手牌选第 1 张填入默认出生点
  useEffect(() => {
    if (!battleState) return;
    const aiTasks = battleState.reinforceQueue.filter((t) => t.ownerId !== 'player');
    if (aiTasks.length === 0) return;
    for (const task of aiTasks) {
      if (task.candidateInstanceIds.length === 0) continue;
      const pickId = task.candidateInstanceIds[0];
      const spawns = getAvailableSpawns(task.ownerId);
      if (spawns.length === 0) continue;
      const to = spawns[0];
      const ret = deployFromHand(task.ownerId, pickId, task.slot, to);
      if (!ret.ok) {
        console.warn('[S7D_Battle] AI 自动补位失败:', ret.reason);
      }
    }
  }, [battleState?.reinforceQueue, deployFromHand, getAvailableSpawns]);

  /** 玩家确认补位 */
  const handleReinforceConfirm = useCallback(
    (pickedCardIds: string[]) => {
      if (!reinforceModal) return;
      if (!battleState) return;
      // pickedCardIds 是卡池 id（S7D_Lineup 用的），转换成 instanceId
      const candidates = reinforceModal.candidateInstanceIds
        .map((iid) => battleState.units[iid])
        .filter(Boolean);
      const picked = pickedCardIds[0];
      const target = candidates.find((u) => u.cardId === picked);
      if (!target) {
        logFn('⚠️ 补位失败：未找到对应的手牌卡');
        return;
      }
      const spawns = getAvailableSpawns('player');
      if (spawns.length === 0) {
        logFn('⚠️ 补位失败：己方出生点全部被占用');
        return;
      }
      // 选择离我方水晶较远（最靠前）的出生点作为默认
      const to = spawns[0];
      const ret = deployFromHand('player', target.instanceId, reinforceModal.slot, to);
      if (!ret.ok) {
        logFn(`⚠️ 补位失败：${ret.reason ?? '未知错误'}`);
        return;
      }
      setReinforceModal(null);
    },
    [reinforceModal, battleState, deployFromHand, getAvailableSpawns, logFn],
  );

  // ==========================================================================
  // 大回合末水晶结算过场：监听 damageLog 变化
  // ==========================================================================
  const lastCrystalLogLenRef = useRef({ a: 0, b: 0 });
  useEffect(() => {
    if (!battleState) return;
    const aLen = battleState.crystalA.damageLog.length;
    const bLen = battleState.crystalB.damageLog.length;
    const prevA = lastCrystalLogLenRef.current.a;
    const prevB = lastCrystalLogLenRef.current.b;
    if (aLen === prevA && bLen === prevB) return;
    lastCrystalLogLenRef.current = { a: aLen, b: bLen };

    const lastA = aLen > prevA ? battleState.crystalA.damageLog[aLen - 1] : null;
    const lastB = bLen > prevB ? battleState.crystalB.damageLog[bLen - 1] : null;
    if (!lastA && !lastB) return;

    // 只有相同大回合的结算才一起播放
    const bigRound = lastA?.bigRound ?? lastB?.bigRound ?? battleState.bigRound;
    const occupantsA = (lastA?.occupants ?? []).map((o) => ({
      name: battleState.units[o.instanceId]?.name ?? '?',
    }));
    const occupantsB = (lastB?.occupants ?? []).map((o) => ({
      name: battleState.units[o.instanceId]?.name ?? '?',
    }));

    setCrystalResolveFx({
      bigRound,
      dmgA: lastA?.damage ?? 0,
      dmgB: lastB?.damage ?? 0,
      occupantsA,
      occupantsB,
    });
    // 3 秒后自动关闭
    const timer = setTimeout(() => setCrystalResolveFx(null), 3000);
    return () => clearTimeout(timer);
  }, [battleState?.crystalA.damageLog.length, battleState?.crystalB.damageLog.length]);

  // 监听战报：敌方一旦发动技能，揭示其技能描述
  useEffect(() => {
    if (!battleState) return;
    const log = battleState.log;
    if (!log || log.length === 0) return;
    setRevealedEnemySkills((prev) => {
      let changed = false;
      const next = new Set(prev);
      for (const entry of log) {
        if (entry.kind !== 'skill_cast' || !entry.actorId) continue;
        const actor = battleState.units[entry.actorId];
        if (!actor) continue;
        // 仅对敌方单位做揭示标记（玩家方原本就可见）
        if (actor.faction === battleState.playerFaction) continue;
        const payload = entry.payload as { skillType?: 'battle' | 'ultimate' } | undefined;
        const skillType = payload?.skillType;
        const candidates: string[] = [];
        if (skillType === 'battle' || skillType === 'ultimate') {
          candidates.push(`${actor.instanceId}_${skillType}`);
        } else {
          // 兜底：未声明 skillType 时一并揭示战技/绝技（保险起见）
          candidates.push(`${actor.instanceId}_battle`, `${actor.instanceId}_ultimate`);
        }
        for (const k of candidates) {
          if (!next.has(k)) {
            next.add(k);
            changed = true;
          }
        }
      }
      return changed ? next : prev;
    });
  }, [battleState?.log.length]);

  // ==========================================================================
  // 回合推进
  // ==========================================================================
  const pendingEndTurn = useRef(false);
  const endCurrentActorTurn = useCallback(() => {
    const ret = advanceActor();
    if (ret === 'blocked') {
      // 补位未完成 → 标记"待结束"，等补位完成后自动重试
      pendingEndTurn.current = true;
      return;
    }
    if (ret === 'sub_round_end') {
      const subRet = advanceSubRound();
      if (subRet === 'blocked') {
        pendingEndTurn.current = true;
      }
    }
  }, [advanceActor, advanceSubRound]);

  // 补位完成后，若有待执行的 endTurn，则自动重试
  useEffect(() => {
    if (!battleState) return;
    if (pendingEndTurn.current && battleState.reinforceQueue.length === 0 && battleState.phase !== 'reinforce') {
      pendingEndTurn.current = false;
      endCurrentActorTurn();
    }
  }, [battleState, endCurrentActorTurn]);

  // ==========================================================================
  // 地图格子点击：
  //   - 可攻击格子里的敌人 → 攻击
  //   - 可达格 → 移动
  //   - 可攻击水晶格 → 攻击水晶
  // ==========================================================================
  const handleCellClick = useCallback(
    (row: number, col: number) => {
      if (isDraggingNow()) return; // 拖动中不触发点击
      if (!isPlayerTurn || isBattleEnded || aiBusy || !currentActor) return;
      const key = posKey(row, col);

      // 风属斗技 · 选位阶段拦截
      if (fengshuPick && fengshuPick.phase === 'pick') {
        const hit = fengshuPick.candidates.find((p) => p.row === row && p.col === col);
        if (!hit) {
          logFn('⚠️ 请点击青色高亮格作为传送目标');
          return;
        }
        completeFengShuAttack({ row: hit.row, col: hit.col });
        return;
      }


      // 瞄准态：点击格子 = 锁定格上单位为目标（或 position_pick 选空格）
      if (ultimateTargeting) {
        const occupant = Object.values(battleState!.units).find(
          (u) => u.zone === 'field' && u.hp > 0 && u.position?.row === row && u.position?.col === col,
        );
        if (ultimateTargeting.kind === 'position_pick') {
          if (occupant) {
            logFn('⚠️ 请选择空格子');
            return;
          }
          // 施放位置型绝技（Batch 2A：仅写战报）
          if (ultimateTargeting.skillType === 'ultimate') {
            useUltimateFn(ultimateTargeting.casterId, []);
          } else {
            useBattleSkillFn(ultimateTargeting.casterId, []);
          }
          logFn(`🎯 位置 (${row},${col}) 已选定`);
          setUltimateTargeting(null);
          return;
        }
        if (occupant) {
          handleAimConfirmUnit(occupant.instanceId);
        }
        return;
      }

      // 1. 看这格站的是不是可攻击敌人
      const occupant = Object.values(battleState!.units).find(
        (u) => u.zone === 'field' && u.hp > 0 && u.position?.row === row && u.position?.col === col,
      );
      if (occupant && attackableEnemyIds.has(occupant.instanceId)) {
        performAttackUnit(currentActor.instanceId, occupant.instanceId);
        return;
      }

      // 2. 规则 v2：水晶不可主动攻击，移除水晶攻击格点击分支
      //    （站到敌方水晶格上即可在大回合末结算扣血）

      // 3. 看是不是可达格 → 移动
      if (reachableKeys.has(key) && !occupant) {
        performMove(currentActor.instanceId, { row, col });
        return;
      }
    },
    [
      isPlayerTurn,
      isBattleEnded,
      aiBusy,
      currentActor,
      battleState,
      attackableEnemyIds,
      attackableCrystals,
      reachableKeys,
      performAttackUnit,
      performAttackCrystal,
      performMove,
      ultimateTargeting,
      handleAimConfirmUnit,
      logFn,
      useBattleSkillFn,
      useUltimateFn,
      fengshuPick,
      completeFengShuAttack,
    ],
  );

  // ==========================================================================
  // 点击棋子（选中用于展示详情；若点的是当前行动者则无副作用）
  // ==========================================================================
  const handleUnitClick = useCallback(
    (unit: BattleCardInstance) => {
      if (isDraggingNow()) return; // 拖动中不触发点击
      // 瞄准态：点击单位 = 锁定为目标
      if (ultimateTargeting) {
        handleAimConfirmUnit(unit.instanceId);
        return;
      }
      // 如果是可攻击敌人 → 攻击
      if (isPlayerTurn && !aiBusy && currentActor && attackableEnemyIds.has(unit.instanceId)) {
        performAttackUnit(currentActor.instanceId, unit.instanceId);
        return;
      }
      // 否则只是选中展示
      setSelectedUnitId((prev) => (prev === unit.instanceId ? null : unit.instanceId));
    },
    [isPlayerTurn, aiBusy, currentActor, attackableEnemyIds, performAttackUnit, ultimateTargeting, handleAimConfirmUnit],
  );

  // ==========================================================================
  // AI 自动行动
  // ==========================================================================
  const aiTurnInFlight = useRef(false);

  useEffect(() => {
    // 用 aiTurnInFlight.current 作为唯一的 gating（ref 比 state 更可靠）
    if (!battleState || isBattleEnded || aiTurnInFlight.current) return;
    if (!currentActor) return;
    if (isPlayerTurn) return;
    // 有任何补位任务未完成 → 暂停 AI 行动（玩家/AI 自己都阻塞）
    if (battleState.reinforceQueue.length > 0) return;
    // phase 为补位态也阻塞
    if (battleState.phase === 'reinforce') return;

    aiTurnInFlight.current = true;
    setAiBusy(true);

    const runAiTurn = async () => {
      await sleep(300);
      const s0 = useS7DBattleStore.getState().state;
      if (!s0 || !currentAction) {
        endCurrentActorTurn();
        setAiBusy(false);
        aiTurnInFlight.current = false;
        return;
      }
      const actorId = currentAction.instanceId;
      // 尝试最多 2 个动作：移动 + 攻击
      for (let step = 0; step < 2; step++) {
        const sNow = useS7DBattleStore.getState().state;
        if (!sNow || sNow.winner) break;
        const action = decideAiAction(sNow, actorId);
        if (action.kind === 'pass') break;
        if (action.kind === 'attack_unit') {
          performAttackUnit(actorId, action.targetInstanceId);
          await sleep(DICE_SHOW_DURATION + 200);
          setDiceModal(null);
          break;
        }
        // 规则 v2：水晶不可主动攻击，attack_crystal 分支已废弃
        if (action.kind === 'move_then_maybe_attack') {
          performMove(actorId, action.to);
          await sleep(AI_STEP_DELAY);
          // 继续下一步：看能不能攻击
          continue;
        }
      }
      // ⚠️ 关键：先释放 aiTurnInFlight 再调 endCurrentActorTurn
      // 因为 endCurrentActorTurn 会触发 React 重 render，新 render 时的 effect
      // 会读取 aiTurnInFlight.current —— 如果还是 true 则 return，导致死锁
      aiTurnInFlight.current = false;
      setAiBusy(false);
      endCurrentActorTurn();
    };

    runAiTurn();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [battleState?.currentActorIdx, battleState?.subRound, battleState?.bigRound, isBattleEnded]);

  // ==========================================================================
  // 渲染：loading / error
  // ==========================================================================
  if (loading) {
    return (
      <div className={styles.screen}>
        <BackButton onClick={returnToMenu} />
        <div className={styles.centerMsg}>
          <div className={styles.loadingSpinner}>⚔</div>
          <div>正在布置战场...</div>
        </div>
      </div>
    );
  }
  if (error) {
    return (
      <div className={styles.screen}>
        <BackButton onClick={returnToMenu} />
        <div className={styles.centerMsg}>
          <div className={styles.errorIcon}>⚠</div>
          <div className={styles.errorText}>{error}</div>
          <button className={styles.errorBtn} onClick={() => navigate('/s7d/lineup')}>
            返回首发登场页
          </button>
        </div>
      </div>
    );
  }
  if (!battleState) {
    return (
      <div className={styles.screen}>
        <BackButton onClick={returnToMenu} />
        <div className={styles.centerMsg}>战场尚未初始化</div>
      </div>
    );
  }

  // ==========================================================================
  // 派生渲染数据
  // ==========================================================================
  const fieldUnits: BattleCardInstance[] = Object.values(battleState.units).filter(
    (u) => u.zone === 'field' && u.hp > 0 && u.position,
  );
  /** 玩家自己的手牌（候补未上场） */
  const playerHandUnits: BattleCardInstance[] = Object.values(battleState.units).filter(
    (u) => u.ownerId === 'player' && u.zone === 'hand',
  );
  /** 玩家自己的弃牌（已阵亡） */
  const playerGraveUnits: BattleCardInstance[] = Object.values(battleState.units).filter(
    (u) => u.ownerId === 'player' && u.zone === 'grave',
  );

  return (
    <div className={styles.screen}>
      <BackButton onClick={returnToMenu} />

      {/* 顶栏 */}
      <TopBar
        battleState={battleState}
        currentActor={currentActor}
        isPlayerTurn={isPlayerTurn}
        onShowRule={() => setShowRule(true)}
      />

      {/* 主体 */}
      <div className={styles.body}>
        {/* 地图区 —— 外层固定容器（绑定 pointer/wheel 事件）
            注意：必须用普通 div，不能用 motion.div —— 否则 framer-motion 会干扰
            ref 挂载时机与 wheel 事件，导致鼠标滚轮缩放失效。 */}
        <div
          className={styles.mapArea}
          ref={mapAreaRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
        >
          {/* 内层可变换视口 —— transform 由 ref 直接操作 DOM，不触发 React 重渲染 */}
          <div
            ref={mapViewportRef}
            className={styles.mapWrap}
            style={
              {
                '--map-cols': S7D_MAP_COLS,
                '--map-rows': S7D_MAP_ROWS,
                '--cell-size': `${CELL_SIZE}px`,
                '--map-width': `${S7D_MAP_COLS * CELL_SIZE + (S7D_MAP_COLS - 1) * 2}px`,
                '--map-height': `${S7D_MAP_ROWS * CELL_SIZE + (S7D_MAP_ROWS - 1) * 2}px`,
                transform: 'translate3d(0,0,0) scale(1)',
                transformOrigin: '0 0',
                willChange: 'transform',
              } as React.CSSProperties
            }
          >
            <div className={styles.mapBgLayer} />
            <div className={styles.mapVignette} />

            {/* 瓦片网格 */}
            <div className={styles.mapGrid}>
              {mapData.map((row) =>
                row.map((cell) => {
                  const key = posKey(cell.row, cell.col);
                  const isReach = reachableKeys.has(key);
                  const isAttackableCrystalCell = attackableCrystals.some((cry) =>
                    cry.positions.some((p) => p.row === cell.row && p.col === cell.col),
                  );
                  const isFengShu =
                    !!fengshuPick &&
                    fengshuPick.phase === 'pick' &&
                    fengshuPick.candidates.some(
                      (p) => p.row === cell.row && p.col === cell.col,
                    );
                  return (
                    <MapCell
                      key={key}
                      cell={cell}
                      isHover={hoverCell?.row === cell.row && hoverCell?.col === cell.col}
                      isReachable={isReach}
                      isAttackableCrystal={isAttackableCrystalCell}
                      isFengShuPick={isFengShu}
                      onHoverIn={() => setHoverCell({ row: cell.row, col: cell.col })}
                      onHoverOut={() => setHoverCell(null)}
                      onClick={() => handleCellClick(cell.row, cell.col)}
                    />
                  );
                }),
              )}
            </div>

            {/* 棋子层 */}
            <div className={styles.unitLayer}>
              {fieldUnits.map((u) => {
                const isAttackable = attackableEnemyIds.has(u.instanceId);
                return (
                  <UnitPiece
                    key={u.instanceId}
                    unit={u}
                    cellSize={CELL_SIZE}
                    isCurrent={currentAction?.instanceId === u.instanceId}
                    isSelected={selectedUnitId === u.instanceId}
                    isPlayerFaction={u.faction === battleState.playerFaction}
                    isAttackable={isAttackable}
                    onClick={() => handleUnitClick(u)}
                    onHoverIn={() => setHoveredUnitId(u.instanceId)}
                    onHoverOut={() => setHoveredUnitId((cur) => (cur === u.instanceId ? null : cur))}
                  />
                );
              })}
            </div>
          </div>

          {/* 悬停提示（位于 mapArea 内但不在 viewport 内 → 不被缩放） */}
          {hoverCell && (
            <div className={styles.hoverInfo}>
              ({hoverCell.row}, {hoverCell.col}) ·{' '}
              {S7D_TILE_DESC[mapData[hoverCell.row][hoverCell.col].tile]}
            </div>
          )}

          {/* 单位技能信息面板（左下角；优先展示 selected，hover 仅在非选中时显示）—— S7B 同款
              展示规则（2026-05-10 调整）：
              - 我方"行动中棋子"（即 currentActor 且 ownerId='player'）：常驻显示
              - 我方/敌方非行动棋子：仅在 hover 时显示
              - 选中（点选）我方棋子：等同行动棋子展示
              - 敌方未发动过的技能：desc 显示「效果未知」遮蔽
              - 已揭示的敌方技能或全部我方技能：完整 desc */}
          {(() => {
            // 决定当前持续显示的"行动棋子"：玩家方 + 当前轮到 + 还在场上
            const isPlayerActorTurn = !!currentActor && currentActor.faction === battleState.playerFaction;
            const persistentId = isPlayerActorTurn && currentActor ? currentActor.instanceId : null;
            // 选中（点选）：仅当点选的就是"我方行动棋子"时才视为常驻
            // 其余被点选的棋子（敌方棋子、我方非行动棋子）一律不常驻，只靠 hover 显示
            const selectedIsCurrentActor =
              !!selectedUnitId && !!currentActor && selectedUnitId === currentActor.instanceId
              && currentActor.faction === battleState.playerFaction;
            const persistentOrSelectedId = persistentId ?? (selectedIsCurrentActor ? selectedUnitId : null);
            // 优先 hover，其次 行动/选中棋子
            const previewId = hoveredUnitId ?? persistentOrSelectedId;
            const previewUnit = previewId ? battleState.units[previewId] : null;
            if (!previewUnit) return null;
            const isHover = !!hoveredUnitId;
            const isEnemy = previewUnit.faction !== battleState.playerFaction;
            const isCurrentActor = !!currentActor && currentActor.instanceId === previewUnit.instanceId;
            // 敌方技能揭示状态
            const battleRevealed = revealedEnemySkills.has(`${previewUnit.instanceId}_battle`);
            const ultRevealed = revealedEnemySkills.has(`${previewUnit.instanceId}_ultimate`);
            // 步数显示（仅我方行动中棋子）
            const showStepBar = isCurrentActor && !isEnemy;
            const remainingSteps = showStepBar
              ? Math.max(0, previewUnit.mnd - previewUnit.stepsUsedThisTurn)
              : 0;
            // 技能可发动判定（仅我方且为当前行动棋子时有意义；否则只用作"被动"标识检测）
            const allFieldUnitsArr = Object.values(battleState.units).filter((u) => !!u.position);
            const showCastDot = !isEnemy && isCurrentActor;
            const bCheck = previewUnit.battleSkill
              ? getSkillCheck(previewUnit, 'battle', allFieldUnitsArr, battleState.playerFaction)
              : null;
            const uCheck = previewUnit.ultimate
              ? getSkillCheck(previewUnit, 'ultimate', allFieldUnitsArr, battleState.playerFaction)
              : null;
            return (
              <div
                className={styles.unitInfoPanel}
                onPointerDown={(e) => e.stopPropagation()}
              >
                <div className={styles.unitInfoName}>
                  {previewUnit.awakened && <span style={{ color: '#ffd966', marginRight: 4 }}>⚡</span>}
                  {previewUnit.name}
                  {isEnemy && <span style={{ marginLeft: 8, color: '#e87060', fontSize: 13 }}>【敌方】</span>}
                  {isHover && previewUnit.instanceId !== persistentOrSelectedId && (
                    <span style={{ marginLeft: 8, color: '#a09878', fontSize: 13 }}>（预览）</span>
                  )}
                </div>
                <div className={styles.unitInfoMeta}>
                  {previewUnit.type} · {previewUnit.rarity}
                </div>
                <div className={styles.unitInfoStats}>
                  <span>气血 {previewUnit.hp}/{previewUnit.hpMax}</span>
                  <span>修为 {previewUnit.atk}</span>
                  <span>心境 {previewUnit.mnd}</span>
                </div>

                {/* 行动棋子常驻：剩余步数条 */}
                {showStepBar && (
                  <div className={styles.stepBar}>
                    <div className={styles.stepBarLabel}>
                      可移动步数 <strong>{remainingSteps}</strong> / {previewUnit.mnd}
                      {previewUnit.attackedThisTurn && (
                        <span className={styles.stepLocked}>（已攻击，回合即将结束）</span>
                      )}
                    </div>
                    <div className={styles.stepBarTrack}>
                      {Array.from({ length: previewUnit.mnd }).map((_, i) => (
                        <span
                          key={i}
                          className={`${styles.stepDot} ${i < remainingSteps ? styles.stepDotLeft : styles.stepDotUsed}`}
                        />
                      ))}
                    </div>
                  </div>
                )}

                {previewUnit.battleSkill && (
                  <div className={styles.unitInfoSkill}>
                    <strong>
                      {showCastDot && bCheck && (
                        <span className={bCheck.hasCharges ? styles.skillDotGreen : styles.skillDotDim} />
                      )}
                      战 · {previewUnit.battleSkill.name}
                      {bCheck?.isPassive && (
                        <span style={{ opacity: .6, fontSize: 12, fontWeight: 'normal', marginLeft: 6 }}>
                          （被动 · 持续生效）
                        </span>
                      )}
                      {!isEnemy && previewUnit.skillUsedThisTurn && !bCheck?.isPassive && (
                        <span className={styles.unitInfoUltimateUsed}>（本回合已用技）</span>
                      )}
                      {!isEnemy && !previewUnit.skillUsedThisTurn && showCastDot && bCheck && !bCheck.isPassive && (
                        <span style={{
                          marginLeft: 6,
                          fontSize: 12,
                          fontWeight: 'normal',
                          color: bCheck.hasCharges ? '#7dd56f' : '#a09878',
                        }}>
                          （{bCheck.hasCharges ? '可发动' : (bCheck.reason || '条件未满足')}）
                        </span>
                      )}
                    </strong>
                    {isEnemy && !battleRevealed ? (
                      <em style={{ opacity: .55 }}>效果未知（该敌方单位尚未发动过此技能）</em>
                    ) : (
                      <em>{previewUnit.battleSkill.desc}</em>
                    )}
                  </div>
                )}
                {previewUnit.ultimate && (
                  <div className={styles.unitInfoUltimate}>
                    <strong>
                      {showCastDot && uCheck && (
                        <span className={uCheck.hasCharges ? styles.skillDotGreen : styles.skillDotDim} />
                      )}
                      绝 · {previewUnit.ultimate.name}
                      {uCheck?.isPassive && (
                        <span style={{ opacity: .6, fontSize: 12, fontWeight: 'normal', marginLeft: 6 }}>
                          （被动 · 持续生效）
                        </span>
                      )}
                      {previewUnit.ultimateUsed && (
                        <span className={styles.unitInfoUltimateUsed}>（已使用）</span>
                      )}
                      {!isEnemy && !previewUnit.ultimateUsed && showCastDot && uCheck && !uCheck.isPassive && (
                        <span style={{
                          marginLeft: 6,
                          fontSize: 12,
                          fontWeight: 'normal',
                          color: uCheck.hasCharges ? '#ffd98a' : '#a09878',
                        }}>
                          （{uCheck.hasCharges ? '可发动' : (uCheck.reason || '条件未满足')}）
                        </span>
                      )}
                    </strong>
                    {isEnemy && !ultRevealed ? (
                      <em style={{ opacity: .55 }}>效果未知（该敌方单位尚未发动过此绝技）</em>
                    ) : (
                      <em>{previewUnit.ultimate.desc}</em>
                    )}
                  </div>
                )}
                {!previewUnit.battleSkill && !previewUnit.ultimate && (
                  <div style={{ color: '#7a6c50', fontSize: 12, fontStyle: 'italic' }}>
                    此卡无可展示的技能
                  </div>
                )}
              </div>
            );
          })()}

          {/* 玩家回合提示 + 结束回合按钮（S7B 风格底部居中面板） */}
          {isPlayerTurn && !isBattleEnded && currentActor && (
            <div
              className={styles.actionPanel}
              onPointerDown={(e) => e.stopPropagation()}
            >
              <div className={styles.actionPanelInfo}>
                <span className={styles.turnBadge}>你的回合</span>
                <span className={styles.turnName}>{currentActor.name}</span>
                <span className={styles.turnHint}>
                  步 {currentActor.mnd - currentActor.stepsUsedThisTurn}/{currentActor.mnd}
                  {currentActor.attackedThisTurn ? ' · 已攻击' : ''}
                  {currentActor.skillUsedThisTurn ? ' · 已用技' : ''}
                </span>
              </div>
              <SkillButtonGroup
                actor={currentActor}
                allFieldUnits={Object.values(battleState.units).filter(
                  (u) => u.zone === 'field' && u.hp > 0,
                )}
                playerFaction={battleState.playerFaction}
                onUseSkill={handleUseSkill}
              />
              <button
                className={`${styles.actionBtn} ${styles.btnEnd}`}
                onClick={endCurrentActorTurn}
                disabled={battleState.phase === 'reinforce' || battleState.reinforceQueue.length > 0}
                title={
                  battleState.phase === 'reinforce' || battleState.reinforceQueue.length > 0
                    ? '等待补位完成...'
                    : '结束当前回合'
                }
              >
                结束回合 ▶
              </button>
            </div>
          )}
          {!isPlayerTurn && currentActor && !isBattleEnded && (
            <div
              className={styles.actionPanel}
              onPointerDown={(e) => e.stopPropagation()}
            >
              <div className={styles.actionPanelInfo}>
                <span className={styles.turnBadgeAi}>AI 行动中</span>
                <span className={styles.turnName}>{currentActor.name}</span>
              </div>
            </div>
          )}

          {/* 玩家手牌 / 弃牌入口（右下角，仅查看自己） */}
          <div
            className={styles.zoneButtons}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className={styles.zoneBtn}
              onClick={() => setZonePeek('hand')}
              title="查看我方手牌（候补未上场卡）"
            >
              🎴 手牌 <b>{playerHandUnits.length}</b>
            </button>
            <button
              type="button"
              className={`${styles.zoneBtn} ${styles.zoneBtnGrave}`}
              onClick={() => setZonePeek('grave')}
              title="查看我方弃牌（已阵亡卡）"
            >
              ⚰ 弃牌 <b>{playerGraveUnits.length}</b>
            </button>
          </div>
        </div>

        {/* 侧栏 */}
        <Sidebar
          battleState={battleState}
          selectedUnitId={selectedUnitId}
          onReturnMenu={() => {
            clearBattle();
            navigate('/menu');
          }}
        />
      </div>

      {/* 骰子弹窗 */}
      <AnimatePresence>
        {diceModal && (
          <DiceModal
            attacker={diceModal.attacker}
            defender={diceModal.defender}
            crystalFaction={diceModal.crystalFaction}
            result={diceModal.result}
            onClose={() => setDiceModal(null)}
          />
        )}
      </AnimatePresence>

      {/* 绝技/战技瞄准条 */}
      <AnimatePresence>
        {ultimateTargeting && (
          <AimBar
            skillName={ultimateTargeting.skillName}
            hint={describeSelectorHint(ultimateTargeting.kind)}
            candidateCount={ultimateTargeting.candidateIds.length}
            onCancel={handleAimCancel}
          />
        )}
      </AnimatePresence>

      {/* 水晶结算过场 */}
      <AnimatePresence>
        {crystalResolveFx && (
          <CrystalResolveFx
            bigRound={crystalResolveFx.bigRound}
            dmgA={crystalResolveFx.dmgA}
            dmgB={crystalResolveFx.dmgB}
            occupantsA={crystalResolveFx.occupantsA}
            occupantsB={crystalResolveFx.occupantsB}
            onClose={() => setCrystalResolveFx(null)}
          />
        )}
      </AnimatePresence>

      {/* 补位弹窗（玩家阵亡后需要从手牌补位） */}
      <AnimatePresence>
        {reinforceModal && battleState && (
          <ReinforceModal
            battleState={battleState}
            task={reinforceModal}
            onConfirm={handleReinforceConfirm}
          />
        )}
      </AnimatePresence>

      {/* 我方手牌/弃牌偷看弹窗 */}
      <AnimatePresence>
        {zonePeek && (
          <ZonePeekModal
            zone={zonePeek}
            units={zonePeek === 'hand' ? playerHandUnits : playerGraveUnits}
            onClose={() => setZonePeek(null)}
          />
        )}
      </AnimatePresence>

      {/* 风属斗技询问弹窗 */}
      <AnimatePresence>
        {fengshuPick && fengshuPick.phase === 'ask' && (() => {
          const s = battleState;
          if (!s) return null;
          const attackerU = s.units[fengshuPick.attackerId];
          const defenderU = s.units[fengshuPick.defenderId];
          if (!attackerU || !defenderU) return null;
          return (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              style={{
                position: 'fixed',
                inset: 0,
                background: 'rgba(0,0,0,0.55)',
                zIndex: 9000,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
              onClick={() => setFengshuPick(null)}
            >
              <motion.div
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.9, opacity: 0 }}
                onClick={(e) => e.stopPropagation()}
                style={{
                  background: 'linear-gradient(180deg, #2a1a3a 0%, #1a0e2a 100%)',
                  border: '2px solid #a384ff',
                  borderRadius: 12,
                  padding: '28px 36px',
                  minWidth: 420,
                  maxWidth: 540,
                  color: '#f0e9ff',
                  boxShadow: '0 8px 32px rgba(163, 132, 255, 0.4)',
                }}
              >
                <h2 style={{ margin: 0, fontSize: 22, color: '#d4b8ff', textAlign: 'center' }}>
                  🌪 风属斗技
                </h2>
                <p style={{ marginTop: 14, fontSize: 15, lineHeight: 1.7 }}>
                  <b style={{ color: '#ffd54f' }}>{attackerU.name}</b>{' '}
                  发起进攻 →{' '}
                  <b style={{ color: '#ff8a8a' }}>{defenderU.name}</b>
                </p>
                <p style={{ fontSize: 14, lineHeight: 1.7, color: '#c5b3ff' }}>
                  是否发动「风属斗技」？发动后可将敌方传送至自身相邻 2 格内任一位置。
                </p>
                <p style={{ fontSize: 13, color: '#9a87d0' }}>
                  当前可选落点：{fengshuPick.candidates.length} 个
                </p>
                <div style={{ display: 'flex', gap: 12, marginTop: 22, justifyContent: 'center' }}>
                  <button
                    style={{
                      padding: '10px 22px',
                      background: 'linear-gradient(180deg, #6b4ade, #4a2db5)',
                      color: '#fff',
                      border: '1px solid #a384ff',
                      borderRadius: 6,
                      cursor: 'pointer',
                      fontSize: 15,
                      fontWeight: 600,
                    }}
                    onClick={() => {
                      setFengshuPick((prev) => prev ? { ...prev, phase: 'pick' } : null);
                    }}
                  >
                    发动并选位
                  </button>
                  <button
                    style={{
                      padding: '10px 22px',
                      background: 'linear-gradient(180deg, #555, #333)',
                      color: '#ddd',
                      border: '1px solid #777',
                      borderRadius: 6,
                      cursor: 'pointer',
                      fontSize: 15,
                    }}
                    onClick={() => completeFengShuAttack(null)}
                  >
                    不发动
                  </button>
                </div>
              </motion.div>
            </motion.div>
          );
        })()}
      </AnimatePresence>

      {/* 风属斗技选位提示条（pick 阶段） */}
      {fengshuPick && fengshuPick.phase === 'pick' && (
        <div
          style={{
            position: 'fixed',
            top: 80,
            left: '50%',
            transform: 'translateX(-50%)',
            background: 'rgba(106, 74, 222, 0.92)',
            color: '#fff',
            padding: '8px 18px',
            borderRadius: 8,
            zIndex: 8000,
            fontSize: 14,
            boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
          }}
        >
          🌪 风属斗技：请点击青色高亮格，将{' '}
          <b>{battleState?.units[fengshuPick.defenderId]?.name}</b>{' '}
          传送至该位置
          <button
            style={{
              marginLeft: 14,
              padding: '4px 10px',
              background: '#444',
              color: '#fff',
              border: 'none',
              borderRadius: 4,
              cursor: 'pointer',
              fontSize: 12,
            }}
            onClick={() => setFengshuPick(null)}
          >
            取消
          </button>
        </div>
      )}

      {/* 胜负结果面板 */}
      <AnimatePresence>
        {showResult && battleState.winner && (
          <ResultPanel
            winner={battleState.winner}
            playerFaction={battleState.playerFaction}
            endReason={battleState.endReason}
            onEnterEnding={() => {
              // 写入决战结果 → S4 ch6 会据此渲染对应结局
              const isWin = battleState.winner === battleState.playerFaction;
              const isDraw = battleState.winner === 'draw';
              const outcome = isDraw ? 'draw' : isWin ? 'victory' : 'defeat';
              setS7DFinalResult({
                outcome,
                endReason: battleState.endReason ?? 'unknown',
                bigRoundAtEnd: battleState.bigRound,
              });
              // 标记第5章玩法阶段已完成，解锁第6章
              markPhaseDone(5);
              SaveSystem.save(1);
              clearBattle();
              // 跳转到剧情阅读页（第6章会自动进入）
              useGameStore.getState().setChapter(6);
              navigate('/story');
            }}
            onReplay={() => {
              // 再战一次：清空当前战场，回到首发登场页
              clearBattle();
              navigate('/s7d/lineup');
            }}
            onReturn={() => {
              clearBattle();
              navigate('/menu');
            }}
          />
        )}
      </AnimatePresence>

      {/* 战斗规则弹窗（进入战场默认弹一次；左上角按钮可随时唤起） */}
      <AnimatePresence>
        {showRule && (
          <RuleModal onClose={() => setShowRule(false)} />
        )}
      </AnimatePresence>
    </div>
  );
};

// ==========================================================================
// 子组件 · 战斗规则弹窗
// ==========================================================================
interface RuleModalProps {
  onClose: () => void;
}
const RuleModal: React.FC<RuleModalProps> = ({ onClose }) => {
  return (
    <motion.div
      className={styles.ruleOverlay}
      onClick={onClose}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <motion.div
        className={styles.rulePanel}
        onClick={(e) => e.stopPropagation()}
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
      >
        <h3 className={styles.ruleH}>📖 坠魔谷决战 · 战斗规则</h3>

        <div className={styles.ruleSec}>
          <h4>🎯 获胜目标</h4>
          <p>{`• 双方水晶各 6 滴血，水晶归 0 即落败；占领敌方水晶格在大回合末扣对方 1 滴血
• 击杀全部敌方场上角色`}</p>
        </div>

        <div className={styles.ruleSec}>
          <h4>🪖 备战上阵规则</h4>
          <p>{`• 首发 2 张，后备 4 张作补位`}</p>
        </div>

        <div className={styles.ruleSec}>
          <h4>⚔ 大回合 / 小轮次</h4>
          <p>{`• 大回合 = 小轮 1（各方卡一）+ 小轮 2（各方卡二）
• 普攻后立即结束行动轮；绝技不会`}</p>
        </div>

        <div className={styles.ruleSec}>
          <h4>🚶 移动规则</h4>
          <p>{`• 步数上限 = 心境（mnd）
• 仅上下左右四方向，每格 1 心境
• 我方/敌方棋子都视为障碍，不能跨越
• 障碍地形与河流非桥段阻挡`}</p>
        </div>

        <div className={styles.ruleSec}>
          <h4>🎲 攻击判定 & 克制</h4>
          <p>{`• 双方同时投二面骰（0/1/2），骰子数 = 修为
• 伤害 = 攻方和 − 守方和 + 技能/克制（最少 1）
• 克制：剑→妖→体→灵→法→剑（丹中立），克制方 +1`}</p>
        </div>

        <button className={styles.ruleClose} onClick={onClose}>关闭</button>
      </motion.div>
    </motion.div>
  );
};

// ==========================================================================
// 子组件 · 顶栏
// ==========================================================================

interface TopBarProps {
  battleState: ReturnType<typeof useS7DBattleStore.getState>['state'];
  currentActor: BattleCardInstance | undefined;
  isPlayerTurn: boolean;
  onShowRule: () => void;
}

const TopBar: React.FC<TopBarProps> = ({ battleState, currentActor, isPlayerTurn, onShowRule }) => {
  if (!battleState) return null;
  return (
    <motion.div
      className={styles.topBar}
      initial={{ opacity: 0, y: -16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
    >
      <div className={styles.topBarLeft}>
        {/* 战斗规则按钮：与回合UI水平对齐，紧挨左上角BackButton右侧 */}
        <button
          type="button"
          className={styles.ruleBtn}
          onClick={onShowRule}
          title="查看战斗规则（坠魔谷决战）"
        >
          📖 战斗规则
        </button>
        <div className={styles.roundInfo}>
          <span className={styles.roundLabel}>大回合</span>
          <span className={styles.roundValue}>
            {battleState.bigRound} / {battleState.bigRoundMax}
          </span>
          <span className={styles.subRoundLabel}>
            · 小轮次 {battleState.subRound}
            <span className={styles.slotHint}>
              （各方 {battleState.subRound === 1 ? '卡一' : '卡二'} 行动）
            </span>
          </span>
        </div>
      </div>

      <div className={styles.topBarCenter}>
        <CrystalBar
          label="A 方水晶（护道派）"
          hp={battleState.crystalA.hp}
          hpMax={battleState.crystalA.hpMax}
          faction="A"
        />
        <CrystalBar
          label="B 方水晶（弑道派）"
          hp={battleState.crystalB.hp}
          hpMax={battleState.crystalB.hpMax}
          faction="B"
        />
      </div>

      <div className={styles.topBarRight}>
        {currentActor && (
          <div className={styles.currentActor}>
            <span className={styles.currentActorLabel}>
              {isPlayerTurn
                ? `🎯 ${currentActor.name} 的回合 · 行动中`
                : `🤖 AI · ${currentActor.name} 行动中`}
            </span>
          </div>
        )}
      </div>
    </motion.div>
  );
};

// ==========================================================================
// 子组件 · 侧栏
// ==========================================================================

interface SidebarProps {
  battleState: NonNullable<ReturnType<typeof useS7DBattleStore.getState>['state']>;
  selectedUnitId: string | null;
  onReturnMenu: () => void;
}

const Sidebar: React.FC<SidebarProps> = ({ battleState, selectedUnitId, onReturnMenu }) => {
  // 战报筛选：'all' 显示全部 / number 显示指定大回合
  const [logFilter, setLogFilter] = useState<number | 'all'>('all');
  // 自动滚动锚点（与 S7B 一致：仅"全部"模式下追加新日志时滚到底）
  const logEndRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (logFilter === 'all') {
      logEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  }, [battleState.log.length, logFilter]);

  return (
    <motion.div
      className={styles.sidebar}
      initial={{ opacity: 0, x: 24 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.5, delay: 0.15 }}
    >
      {/* 行动队列面板 / 三区概览 / 选中单位详情 —— 已移除，
          右侧整列留给战报（参考 S7B 风格） */}

      {/* 战报（参考 S7B 风格：按 kind 分色 + 大字号 + 顶部表头 + 回合筛选 + 正序滚到底） */}
      <div className={styles.logPanel}>
        <div className={styles.logHeader}>
          <span className={styles.logTitle}>📜 战报</span>
          {(() => {
            const roundSet = new Set<number>();
            for (const l of battleState.log) roundSet.add(l.bigRound);
            const rounds = Array.from(roundSet).sort((a, b) => a - b);
            return (
              <div className={styles.logFilterBar}>
                <button
                  type="button"
                  className={`${styles.logFilterBadge} ${logFilter === 'all' ? styles.logFilterBadgeActive : ''}`}
                  onClick={() => setLogFilter('all')}
                  title="显示全部回合"
                >全部</button>
                {rounds.map((r) => (
                  <button
                    key={r}
                    type="button"
                    className={`${styles.logFilterBadge} ${logFilter === r ? styles.logFilterBadgeActive : ''}`}
                    onClick={() => setLogFilter(r)}
                    title={`只看第 ${r} 大回合`}
                  >R{r}</button>
                ))}
              </div>
            );
          })()}
        </div>
        <div className={styles.logList}>
          {battleState.log
            .filter((entry) => logFilter === 'all' || entry.bigRound === logFilter)
            .map((entry) => {
              // 按 kind 分类样式（与 S7B 相同的语义分色）
              const kindClass =
                entry.kind === 'attack' || entry.kind === 'damage' || entry.kind === 'crystal_damage' || entry.kind === 'crystal_broken'
                  ? styles.logDamage
                  : entry.kind === 'skill_cast' || entry.kind === 'heal'
                  ? styles.logSkill
                  : entry.kind === 'death'
                  ? styles.logKill
                  : entry.kind === 'move' || entry.kind === 'turn_start' || entry.kind === 'turn_end' || entry.kind === 'deploy'
                  ? styles.logAction
                  : styles.logSystem;
              return (
                <div key={entry.seq} className={`${styles.logItem} ${kindClass}`}>
                  <span className={styles.logRoundTag}>R{entry.bigRound}</span>
                  <span className={styles.logText}>{entry.text}</span>
                </div>
              );
            })}
          <div ref={logEndRef} />
        </div>
      </div>
    </motion.div>
  );
};

// ==========================================================================
// 子组件 · 单个瓦片
// ==========================================================================

interface MapCellProps {
  cell: S7DTile;
  isHover: boolean;
  isReachable: boolean;
  isAttackableCrystal: boolean;
  isFengShuPick?: boolean;
  onHoverIn: () => void;
  onHoverOut: () => void;
  onClick: () => void;
}

const TERRAIN_TILE_IMG: Partial<Record<string, string>> = {
  spring: asset('images/map/tile_spring.png'),
  atk_boost: asset('images/map/tile_atk_boost.png'),
  mnd_boost: asset('images/map/tile_mnd_boost.png'),
  miasma: asset('images/map/tile_miasma.png'),
};
const TERRAIN_TEXT_LABEL: Partial<Record<string, string>> = {
  spring: '生+1',
  atk_boost: '修+1',
  mnd_boost: '心+1',
  miasma: '血-1',
  river: '河',
  bridge: '桥',
};

const MapCell: React.FC<MapCellProps> = ({
  cell,
  isHover,
  isReachable,
  isAttackableCrystal,
  isFengShuPick = false,
  onHoverIn,
  onHoverOut,
  onClick,
}) => {
  const tileImg = TERRAIN_TILE_IMG[cell.tile];
  const textLabel = TERRAIN_TEXT_LABEL[cell.tile];

  const isSpawnACell = isSpawnA(cell.row, cell.col);
  const isSpawnBCell = isSpawnB(cell.row, cell.col);
  const isCrystalACell = isCrystalA(cell.row, cell.col);
  const isCrystalBCell = isCrystalB(cell.row, cell.col);

  // 风属斗技候选格 → 复用可达格高亮（青色光圈）
  const showReachable = isReachable || isFengShuPick;

  const cellClass = [
    styles.cell,
    styles[`cell_${cell.tile}`] ?? '',
    isHover ? styles.cellHover : '',
    showReachable ? styles.cellReachable : '',
    isAttackableCrystal ? styles.cellAttackableCrystal : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={cellClass} onMouseEnter={onHoverIn} onMouseLeave={onHoverOut} onClick={onClick}>
      {tileImg && (
        <div className={styles.cellTile} style={{ backgroundImage: `url(${tileImg})` }} />
      )}
      {(isCrystalACell || isCrystalBCell) && (
        <div
          className={[styles.crystalMark, isCrystalACell ? styles.crystalMarkA : styles.crystalMarkB].join(
            ' ',
          )}
        >
          <span className={styles.crystalIcon}>💎</span>
          <span className={styles.crystalText}>{isCrystalACell ? 'A 晶' : 'B 晶'}</span>
        </div>
      )}
            {(isSpawnACell || isSpawnBCell) && (
              <div className={[styles.spawnMark, isSpawnACell ? styles.spawnMarkA : styles.spawnMarkB].join(' ')}>
                <span className={styles.spawnText}>出生点</span>
        </div>
      )}
      {textLabel && !isSpawnACell && !isSpawnBCell && !isCrystalACell && !isCrystalBCell && (
        <span className={styles.cellTextLabel}>{textLabel}</span>
      )}
      {showReachable && <div className={styles.reachOverlay} />}
      {isAttackableCrystal && <div className={styles.attackCrystalOverlay}>⚔</div>}
    </div>
  );
};

// ==========================================================================
// 子组件 · 棋子
// ==========================================================================

interface UnitPieceProps {
  unit: BattleCardInstance;
  cellSize: number;
  isCurrent: boolean;
  isSelected: boolean;
  isPlayerFaction: boolean;
  isAttackable: boolean;
  onClick: () => void;
  onHoverIn?: () => void;
  onHoverOut?: () => void;
}

const UnitPiece: React.FC<UnitPieceProps> = ({
  unit,
  cellSize,
  isCurrent,
  isSelected,
  isPlayerFaction,
  isAttackable,
  onClick,
  onHoverIn,
  onHoverOut,
}) => {
  if (!unit.position) return null;
  const { row, col } = unit.position;
  const left = col * (cellSize + 2) + 2;
  const top = row * (cellSize + 2) + 2;
  const size = cellSize - 4;

  const classes = [
    styles.unitPiece,
    unit.faction === 'A' ? styles.unitPieceA : styles.unitPieceB,
    isPlayerFaction ? styles.unitPiecePlayer : styles.unitPieceEnemy,
    isCurrent ? styles.unitPieceCurrent : '',
    isSelected ? styles.unitPieceSelected : '',
    unit.isHero ? styles.unitPieceHero : '',
    isAttackable ? styles.unitPieceAttackable : '',
  ]
    .filter(Boolean)
    .join(' ');

  // 头像底图：优先 unit.portrait，缺失时用 getCachedImage(cardId) 兜底
  // 兼容主角卡（cardId 形如 hero_xiaoyan）和绑定卡（cardId 形如 bssr_yaochen）
  const portraitUrl =
    unit.portrait && !unit.portrait.startsWith('hero/')
      ? unit.portrait
      : getCachedImage(unit.isHero && unit.heroId ? unit.heroId : unit.cardId);
  const portraitStyle = portraitUrl
    ? { backgroundImage: `url(${portraitUrl})` }
    : undefined;

  return (
    <div
      className={classes}
      style={{
        left: `${left}px`,
        top: `${top}px`,
        width: `${size}px`,
        height: `${size}px`,
      }}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      onMouseEnter={onHoverIn}
      onMouseLeave={onHoverOut}
    >
      {/* 头像底图（S7B 风格：撑满方形棋子） */}
      <div className={styles.unitPieceAvatar} style={portraitStyle} />
      {/* 名字（左上角条），含觉醒⚡前缀 */}
      <div className={styles.unitPieceName}>
        {unit.awakened && <span style={{ color: '#ffd966', marginRight: 2 }}>⚡</span>}
        {unit.name}
      </div>
      {/* 槽位（右上角） */}
      <div className={styles.unitPieceSlot}>{unit.fieldSlot === 1 ? '一' : '二'}</div>
      {/* 属性条（修/境，叠在血条上方） */}
      <div className={styles.unitPieceStats}>
        <span className={`${styles.unitPieceStat} ${styles.unitPieceStatAtk}`} title="修为（骰数）">
          修{unit.atk}
        </span>
        <span className={`${styles.unitPieceStat} ${styles.unitPieceStatMnd}`} title="心境（步数）">
          境{unit.mnd}
        </span>
      </div>
      {/* 血条 */}
      <div className={styles.unitPieceHp}>
        <div
          className={`${styles.unitPieceHpFill} ${
            isPlayerFaction ? styles.unitPieceHpFillPlayer : styles.unitPieceHpFillEnemy
          }`}
          style={{ width: `${(unit.hp / unit.hpMax) * 100}%` }}
        />
        <span className={styles.unitPieceHpText}>
          {unit.hp}/{unit.hpMax}
        </span>
      </div>
      {isAttackable && <div className={styles.attackMark}>⚔</div>}
    </div>
  );
};

// ==========================================================================
// 子组件 · 水晶血条
// ==========================================================================

interface CrystalBarProps {
  label: string;
  hp: number;
  hpMax: number;
  faction: BattleFaction;
}
const CrystalBar: React.FC<CrystalBarProps> = ({ label, hp, hpMax, faction }) => {
  const pct = (hp / hpMax) * 100;
  return (
    <div className={styles.crystalBar}>
      <div className={styles.crystalBarLabel}>{label}</div>
      <div className={styles.crystalBarTrack}>
        <div
          className={[styles.crystalBarFill, faction === 'A' ? styles.crystalBarFillA : styles.crystalBarFillB].join(
            ' ',
          )}
          style={{ width: `${pct}%` }}
        />
        <span className={styles.crystalBarText}>
          {hp} / {hpMax}
        </span>
      </div>
    </div>
  );
};

// ==========================================================================
// 子组件 · 单位详情
// ==========================================================================

const UnitDetail: React.FC<{ unit: BattleCardInstance }> = ({ unit }) => {
  return (
    <div className={styles.unitDetail}>
      <div className={styles.unitDetailHead}>
        <span className={styles.unitDetailName}>{unit.name}</span>
        <span className={styles.unitDetailRarity}>{unit.rarity}</span>
      </div>
      <div className={styles.unitDetailMeta}>
        {unit.type} · {unit.faction} 方 · 卡{unit.fieldSlot === 1 ? '一' : '二'}
      </div>
      <div className={styles.unitDetailStats}>
        <span>
          ❤ {unit.hp}/{unit.hpMax}
        </span>
        <span>⚔ {unit.atk}</span>
        <span>💠 {unit.mnd}</span>
      </div>
      {unit.battleSkillId && (
        <div className={styles.unitDetailSkill}>
          <b>战技：</b>
          {unit.battleSkillId}
        </div>
      )}
      {unit.ultimateId && (
        <div className={styles.unitDetailSkill}>
          <b>绝技：</b>
          {unit.ultimateId} {unit.ultimateUsed ? '（已用）' : ''}
        </div>
      )}
    </div>
  );
};

// ==========================================================================
// 子组件 · 骰子弹窗
// ==========================================================================

interface DiceModalProps {
  attacker: BattleCardInstance;
  defender: BattleCardInstance | null;
  crystalFaction?: BattleFaction;
  result: S7DDiceResult | { damage: number };
  onClose: () => void;
}

const DiceModal: React.FC<DiceModalProps> = ({
  attacker,
  defender,
  crystalFaction,
  result,
  onClose,
}) => {
  const isCrystal = !defender;
  const full = result as S7DDiceResult;

  // 自动关闭：显示 DICE_SHOW_DURATION 后自动关闭
  useEffect(() => {
    const timer = setTimeout(() => onClose(), DICE_SHOW_DURATION);
    return () => clearTimeout(timer);
  }, [onClose]);

  return (
    <motion.div
      className={styles.diceOverlay}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <motion.div
        className={styles.dicePanel}
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.8, opacity: 0 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.diceTitle}>
          {attacker.name} ⚔ {isCrystal ? `${crystalFaction} 方水晶` : defender!.name}
        </div>

        {!isCrystal ? (
          <>
            <div className={styles.diceRow}>
              <div className={styles.diceLabel}>攻方</div>
              <div className={styles.diceValues}>
                {full.attackerDice.map((v, i) => (
                  <div key={i} className={`${styles.diceVal} ${styles.dicePlayer}`}>
                    {v}
                  </div>
                ))}
              </div>
              <div className={styles.diceSum} style={{ color: '#8ce0a0' }}>
                = {full.attackerSum}
              </div>
            </div>
            <div className={styles.diceRow}>
              <div className={styles.diceLabel}>防方</div>
              <div className={styles.diceValues}>
                {full.defenderDice.map((v, i) => (
                  <div key={i} className={`${styles.diceVal} ${styles.diceEnemy}`}>
                    {v}
                  </div>
                ))}
              </div>
              <div className={styles.diceSum} style={{ color: '#e89080' }}>
                = {full.defenderSum}
              </div>
            </div>
            <div className={styles.diceDamage}>
              💥 {full.attackerSum} − {full.defenderSum} = <strong>{full.damage}</strong> 点伤害
            </div>
          </>
        ) : (
          <div className={styles.diceDamage}>
            💎 水晶无防御！造成 <strong>{result.damage}</strong> 点伤害
          </div>
        )}

        <button className={styles.diceClose} onClick={onClose}>
          确认
        </button>
      </motion.div>
    </motion.div>
  );
};

// ==========================================================================
// 子组件 · 胜负结果面板
// ==========================================================================

interface ResultPanelProps {
  winner: BattleFaction | 'draw';
  playerFaction: BattleFaction;
  endReason: 'crystal_broken' | 'all_dead' | 'timeout' | null;
  onEnterEnding: () => void;
  onReplay: () => void;
  onReturn: () => void;
}

const ResultPanel: React.FC<ResultPanelProps> = ({ winner, playerFaction, endReason, onEnterEnding, onReplay, onReturn }) => {
  const isWin = winner === playerFaction;
  const isDraw = winner === 'draw';
  const title = isDraw ? '🤝 势均力敌' : isWin ? '🎉 决战告捷！' : '💀 功亏一篑';
  const subText = isDraw
    ? '双方激战 40 大回合，未分高下。'
    : isWin
    ? '我方大获全胜，荡平敌寇！'
    : '我方不敌，改日再战。';

  const reasonText =
    endReason === 'crystal_broken'
      ? '水晶破碎'
      : endReason === 'all_dead'
      ? '全员阵亡'
      : endReason === 'timeout'
      ? '40 大回合平局'
      : '—';

  return (
    <motion.div
      className={styles.resultOverlay}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <motion.div
        className={styles.resultPanel}
        initial={{ scale: 0.7, opacity: 0, y: 40 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 150, damping: 18 }}
      >
        <div className={styles.resultTitle}>{title}</div>
        <div className={styles.resultSubtitle}>{subText}</div>
        <div className={styles.resultReason}>结束原因：{reasonText}</div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 22, alignItems: 'stretch' }}>
          {/* 主按钮：进入结局剧情 */}
          <button className={styles.resultBtn} onClick={onEnterEnding}>
            {isDraw ? '📖 阅读平局结局' : isWin ? '📖 阅读胜利结局' : '📖 阅读失败结局'}
          </button>

          {/* 失败/平局：允许再战一次（重回首发页，保留主菜单返回） */}
          {!isWin && (
            <button
              className={styles.resultBtn}
              style={{ background: 'linear-gradient(135deg,#8a6b3a,#5a4324)' }}
              onClick={onReplay}
            >
              ⚔️ 再战一次
            </button>
          )}

          <button
            className={styles.resultBtn}
            style={{ background: 'rgba(60,40,20,0.85)', color: '#d8c9a3' }}
            onClick={onReturn}
          >
            返回主菜单
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
};

// ==========================================================================
// 辅助
// ==========================================================================

function getOwnerDisplay(
  state: ReturnType<typeof useS7DBattleStore.getState>['state'],
  ownerId: BattleOwnerId,
): string {
  if (!state) return ownerId;
  const p = state.players.find((pp) => pp.ownerId === ownerId);
  if (!p) return ownerId;
  return p.isHuman ? `${p.heroName}(你)` : p.heroName;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ==========================================================================
// 子组件 · 技能按钮组
// ==========================================================================

interface SkillButtonGroupProps {
  actor: BattleCardInstance;
  allFieldUnits: BattleCardInstance[];
  playerFaction: BattleFaction;
  onUseSkill: (type: 'battle' | 'ultimate') => void;
}

const SkillButtonGroup: React.FC<SkillButtonGroupProps> = ({
  actor,
  allFieldUnits,
  playerFaction,
  onUseSkill,
}) => {
  const battleCheck = actor.battleSkill
    ? getSkillCheck(actor, 'battle', allFieldUnits, playerFaction)
    : null;
  const ultimateCheck = actor.ultimate
    ? getSkillCheck(actor, 'ultimate', allFieldUnits, playerFaction)
    : null;

  return (
    <div className={styles.skillButtonGroup}>
      {/* 战技按钮 */}
      {actor.battleSkill && battleCheck && (
        <SkillButton
          kind="battle"
          name={actor.battleSkill.name}
          desc={actor.battleSkill.desc}
          check={battleCheck}
          onClick={() => onUseSkill('battle')}
        />
      )}
      {/* 绝技按钮 */}
      {actor.ultimate && ultimateCheck && (
        <SkillButton
          kind="ultimate"
          name={actor.ultimate.name}
          desc={actor.ultimate.desc}
          check={ultimateCheck}
          onClick={() => onUseSkill('ultimate')}
        />
      )}
    </div>
  );
};

interface SkillButtonProps {
  kind: 'battle' | 'ultimate';
  name: string;
  desc: string;
  check: SkillCheckResult;
  onClick: () => void;
}

const SkillButton: React.FC<SkillButtonProps> = ({ kind, name, desc, check, onClick }) => {
  const disabled = !check.interactable;
  const tip = check.interactable ? desc : check.reason ?? desc;
  // 对齐 S7B 文案：技能：xxx / 绝技：xxx
  const label = kind === 'battle' ? `技能：${name}` : `绝技：${name}`;
  const cls = [
    styles.actionBtn,
    kind === 'battle' ? styles.btnSkill : styles.btnUltimate,
    disabled && check.hasCharges ? styles.btnConditionUnmet : '',
  ]
    .filter(Boolean)
    .join(' ');
  // 被动技不渲染按钮（保持 S7B 行为）
  if (check.isPassive) return null;
  return (
    <button className={cls} title={tip} onClick={onClick} disabled={disabled}>
      <span className={check.hasCharges ? styles.skillDotGreen : styles.skillDotDim} />
      {label}
    </button>
  );
};

// ==========================================================================
// 子组件 · 瞄准条
// ==========================================================================

interface AimBarProps {
  skillName: string;
  hint: string;
  candidateCount: number;
  onCancel: () => void;
}

const AimBar: React.FC<AimBarProps> = ({ skillName, hint, candidateCount, onCancel }) => {
  return (
    <motion.div
      className={styles.aimBar}
      initial={{ opacity: 0, y: -20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
    >
      <span>🎯 【{skillName}】 · {hint}</span>
      <span className={styles.aimBarMeta}>
        合法目标 {candidateCount} 个 · 按 ESC 取消
      </span>
      <button className={styles.aimBarCancel} onClick={onCancel}>
        取消
      </button>
    </motion.div>
  );
};

// ==========================================================================
// 子组件 · 补位弹窗（嵌入 S7D_Lineup 的 reinforce 模式）
// ==========================================================================

interface ReinforceModalProps {
  battleState: NonNullable<ReturnType<typeof useS7DBattleStore.getState>['state']>;
  task: {
    ownerId: BattleOwnerId;
    slot: 1 | 2;
    candidateInstanceIds: string[];
    reason: string;
  };
  onConfirm: (pickedCardIds: string[]) => void;
}

const ReinforceModal: React.FC<ReinforceModalProps> = ({ battleState, task, onConfirm }) => {
  const playerInst = battleState.players.find((p) => p.ownerId === 'player');
  if (!playerInst) return null;

  // 战斗区锁定卡（cardId 列表）
  const lockedCards: string[] = [];
  if (playerInst.fieldSlots.slot1) {
    const u = battleState.units[playerInst.fieldSlots.slot1];
    if (u) lockedCards.push(u.cardId);
  }
  if (playerInst.fieldSlots.slot2) {
    const u = battleState.units[playerInst.fieldSlots.slot2];
    if (u) lockedCards.push(u.cardId);
  }

  // 弃牌区卡（cardId 列表）
  const graveCards: string[] = playerInst.instanceIds
    .map((iid) => battleState.units[iid])
    .filter((u) => u && u.zone === 'grave')
    .map((u) => u.cardId);

  // 队友场上（同阵营，除自己外）
  const allyOnField = battleState.players
    .filter(
      (p) =>
        p.ownerId !== 'player' && p.faction === battleState.playerFaction,
    )
    .map((p) => ({
      heroId: p.heroId,
      cardIds: [p.fieldSlots.slot1, p.fieldSlots.slot2]
        .filter(Boolean)
        .map((iid) => battleState.units[iid!]?.cardId)
        .filter(Boolean) as string[],
    }));

  return (
    <motion.div
      className={styles.reinforceOverlay}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <motion.div
        className={styles.reinforceBox}
        initial={{ scale: 0.96, y: 20, opacity: 0 }}
        animate={{ scale: 1, y: 0, opacity: 1 }}
        exit={{ scale: 0.96, opacity: 0 }}
      >
        <div className={styles.reinforceHeader}>
          <div className={styles.reinforceTitle}>
            ⚕ 阵亡补位 · 卡{task.slot === 1 ? '一' : '二'}
          </div>
          <div className={styles.reinforceSubtitle}>{task.reason} · 请从手牌选 1 张补充到战斗区</div>
        </div>
        <div className={styles.reinforceBody}>
          <S7D_Lineup
            mode="reinforce"
            pickSize={1}
            lockedCards={lockedCards}
            graveyardCards={graveCards}
            allyOnField={allyOnField}
            onReinforceConfirm={onConfirm}
          />
        </div>
      </motion.div>
    </motion.div>
  );
};

// ==========================================================================
// 子组件 · 水晶结算过场
// ==========================================================================

interface CrystalResolveFxProps {
  bigRound: number;
  dmgA: number;
  dmgB: number;
  occupantsA: Array<{ name: string }>;
  occupantsB: Array<{ name: string }>;
  onClose: () => void;
}

const CrystalResolveFx: React.FC<CrystalResolveFxProps> = ({
  bigRound,
  dmgA,
  dmgB,
  occupantsA,
  occupantsB,
  onClose,
}) => {
  return (
    <motion.div
      className={styles.crystalFxOverlay}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <motion.div
        className={styles.crystalFxPanel}
        initial={{ scale: 0.7, y: -40, opacity: 0 }}
        animate={{ scale: 1, y: 0, opacity: 1 }}
        exit={{ scale: 0.85, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 200, damping: 16 }}
      >
        <div className={styles.crystalFxTitle}>
          💎 第 {bigRound} 大回合 · 水晶结算
        </div>

        <div className={styles.crystalFxRows}>
          {dmgA > 0 && (
            <div className={styles.crystalFxRow + ' ' + styles.crystalFxRowA}>
              <div className={styles.crystalFxFaction}>A 方水晶</div>
              <div className={styles.crystalFxOccupants}>
                占领者：{occupantsA.map((o) => o.name).join('、') || '—'}
              </div>
              <div className={styles.crystalFxDmg}>
                −{dmgA}
              </div>
            </div>
          )}
          {dmgB > 0 && (
            <div className={styles.crystalFxRow + ' ' + styles.crystalFxRowB}>
              <div className={styles.crystalFxFaction}>B 方水晶</div>
              <div className={styles.crystalFxOccupants}>
                占领者：{occupantsB.map((o) => o.name).join('、') || '—'}
              </div>
              <div className={styles.crystalFxDmg}>
                −{dmgB}
              </div>
            </div>
          )}
          {dmgA === 0 && dmgB === 0 && (
            <div className={styles.crystalFxRow}>
              <div style={{ textAlign: 'center', color: '#9a8e76', padding: '8px 0' }}>
                本回合无人占领任何水晶
              </div>
            </div>
          )}
        </div>

        <div className={styles.crystalFxHint}>点击关闭 / 3 秒后自动消失</div>
      </motion.div>
    </motion.div>
  );
};

// ==========================================================================
// 子组件 · 我方手牌/弃牌 偷看弹窗
// ==========================================================================
interface ZonePeekModalProps {
  zone: 'hand' | 'grave';
  units: BattleCardInstance[];
  onClose: () => void;
}

const ZonePeekModal: React.FC<ZonePeekModalProps> = ({ zone, units, onClose }) => {
  const title = zone === 'hand' ? '🎴 我方手牌（候补未上场）' : '⚰ 我方弃牌（已阵亡）';
  const empty = zone === 'hand' ? '当前没有候补卡' : '当前没有阵亡卡';
  return (
    <motion.div
      className={styles.zonePeekMask}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <motion.div
        className={styles.zonePeekPanel}
        initial={{ scale: 0.92, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.zonePeekHeader}>
          <span className={styles.zonePeekTitle}>{title}</span>
          <span className={styles.zonePeekCount}>共 {units.length} 张</span>
          <button type="button" className={styles.zonePeekClose} onClick={onClose}>✕</button>
        </div>
        {units.length === 0 ? (
          <div className={styles.zonePeekEmpty}>{empty}</div>
        ) : (
          <div className={styles.zonePeekGrid}>
            {units.map((u) => (
              <div key={u.instanceId} className={`${styles.zonePeekCard} ${styles[`rarity_${u.rarity}`] ?? ''}`}>
                <div className={styles.zonePeekCardHead}>
                  {(() => {
                    const url =
                      u.portrait && !u.portrait.startsWith('hero/')
                        ? u.portrait
                        : getCachedImage(u.isHero && u.heroId ? u.heroId : u.cardId);
                    return url ? (
                      <div
                        className={styles.zonePeekAvatar}
                        style={{ backgroundImage: `url(${url})` }}
                      />
                    ) : null;
                  })()}
                  <div className={styles.zonePeekCardInfo}>
                    <div className={styles.zonePeekName}>
                      {u.name}
                      <span className={styles.zonePeekRarity}>{u.rarity}</span>
                    </div>
                    <div className={styles.zonePeekStats}>
                      <span>气血 <b>{u.hp}/{u.hpMax}</b></span>
                      <span>修为 <b>{u.atk}</b></span>
                      <span>心境 <b>{u.mnd}</b></span>
                    </div>
                  </div>
                </div>
                {u.battleSkill && (
                  <div className={styles.zonePeekSkill}>
                    <span className={styles.zonePeekSkillTag}>战</span>
                    <span className={styles.zonePeekSkillName}>{u.battleSkill.name}</span>
                    <span className={styles.zonePeekSkillDesc}>{u.battleSkill.desc}</span>
                  </div>
                )}
                {u.ultimate && (
                  <div className={styles.zonePeekSkill + ' ' + styles.zonePeekSkillUlt}>
                    <span className={styles.zonePeekSkillTag}>绝</span>
                    <span className={styles.zonePeekSkillName}>{u.ultimate.name}</span>
                    <span className={styles.zonePeekSkillDesc}>{u.ultimate.desc}</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
        <div className={styles.zonePeekHint}>点击外部 / ✕ 关闭</div>
      </motion.div>
    </motion.div>
  );
};

export default S7D_Battle;

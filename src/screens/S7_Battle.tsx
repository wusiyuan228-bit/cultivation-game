/**
 * S7_Battle — 合作清怪战
 * 4×10地图，玩家主角 + 1搭档 vs 6个AI妖兽
 * 8回合限制，按击杀数发放灵石和线索
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { asset } from '@/utils/assetPath';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { BackButton } from '@/components/BackButton';
import { MusicToggle } from '@/components/MusicToggle';
import { CommonHud } from '@/components/CommonHud';
import { useBattleStore, isCounter } from '@/stores/battleStore';
import type { BattleUnit, DiceResult } from '@/stores/battleStore';
import { useGameStore, SaveSystem } from '@/stores/gameStore';
import { getHeroById } from '@/hooks/useConfig';
import { getPoolCardById } from '@/systems/recruit/cardPoolLoader';
import { getCachedImage } from '@/utils/imageCache';
import { sortCardsForDisplay } from '@/utils/cardDisplayOrder';
import { TYPE_CHAR } from '@/data/heroConstants';
import type { HeroId, CultivationType } from '@/types/game';
import {
  checkSkillCastability,
  hasAdjacentEnemyOf,
  hasAnyLivingEnemyOf,
} from '@/systems/battle/skillCastability';
import styles from './S7_Battle.module.css';

/* ======== 地图格子尺寸常量 ======== */
const CELL_SIZE = 192; // 190px格子 + 2px gap（放大至1.5倍）
const UNIT_OFFSET = 20; // 单位在格子内的边距 (150 单位居中于 190 格子)

/* ======== 技能可发动判定（统一工具）========
 * 绿灯 = 剩余使用次数；可交互 = 条件是否满足（含距离）；被动技→常亮无按钮
 */
type SkillCheckResult = ReturnType<typeof checkSkillCastability>;

function getSkillCheck(
  unit: BattleUnit,
  skillType: 'battle' | 'ultimate',
  allUnits: BattleUnit[],
  skillUsedThisTurn: boolean,
): SkillCheckResult {
  return checkSkillCastability(unit as any, skillType, {
    skillUsedThisTurn,
    allUnits: allUnits as any,
    hasAdjacentEnemy: hasAdjacentEnemyOf(unit as any, allUnits as any),
    hasAnyEnemy: hasAnyLivingEnemyOf(unit as any, allUnits as any),
  });
}

/* ======== 技能可发动判定：见上方 getSkillCheck，委托给 @/systems/battle/skillCastability ======== */

/* ======== 阵容选择 ======== */

interface PartnerOption {
  id: string;
  name: string;
  type: CultivationType;
  hp: number;
  atk: number;
  mnd: number;
  battleSkill: { name: string; desc: string } | null;
  ultimate: { name: string; desc: string } | null;
  portrait: string;
}

function SelectPartner({
  options,
  onConfirm,
}: {
  options: PartnerOption[];
  onConfirm: (partnerId: string) => void;
}) {
  const [chosen, setChosen] = useState<string | null>(null);

  return (
    <div className={styles.selectOverlay}>
      <motion.div
        className={styles.selectPanel}
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
      >
        <div className={styles.selectTitle}>宗门追回物资任务</div>
        <div className={styles.selectSub}>在 8 个行动回合内击败数量越多的劫匪，追回宗门物资，将获得越多奖励。主角的属性值已提升至战斗状态。主角将自动上阵，还可选择另外 1 名搭档协同作战</div>
        <div className={styles.selectGrid}>
          {options.map((o) => (
            <div
              key={o.id}
              className={`${styles.selectCard} ${chosen === o.id ? styles.selectCardChosen : ''}`}
              onClick={() => setChosen(o.id)}
            >
              <div
                className={styles.selectPortrait}
                style={{ backgroundImage: `url(${o.portrait})` }}
              />
              <div className={styles.selectName}>{o.name}</div>
              <div className={styles.selectStats}>
                <span>气血{o.hp}</span>
                <span>修为{o.atk}</span>
                <span>心境{o.mnd}</span>
              </div>
              {o.battleSkill && (
                <div className={styles.selectSkill}>技能：{o.battleSkill.name}</div>
              )}
              {o.ultimate && (
                <div className={styles.selectSkill} style={{ color: '#ffd98a' }}>绝技：{o.ultimate.name}</div>
              )}
            </div>
          ))}
        </div>
        {options.length === 0 && (
          <div style={{ textAlign: 'center', color: '#a09878', padding: 20 }}>
            暂无可选搭档（N/R卡无战斗技能，但可作为纯数值棋子上阵）
          </div>
        )}
        <button
          className={styles.selectConfirm}
          disabled={!chosen}
          onClick={() => chosen && onConfirm(chosen)}
        >
          确认出战
        </button>
      </motion.div>
    </div>
  );
}

/* ======== 规则弹窗 ======== */

function RuleModal({ onClose }: { onClose: () => void }) {
  return (
    <div className={styles.ruleOverlay} onClick={onClose}>
      <motion.div
        className={styles.rulePanel}
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className={styles.ruleH}>战斗规则</h3>
        <div className={styles.ruleSec}>
          <h4>🎯 目标</h4>
          <p>8回合内击败尽可能多的劫匪
0→0灵石 | 1-2→15灵石+1线索 | 3-4→22灵石+2线索 | 5-6→30灵石+3线索</p>
        </div>
        <div className={styles.ruleSec}>
          <h4>🎲 伤害判定</h4>
          <p>双方投骰子，数量=修为值，每颗0/1/2
伤害 = 攻方点数和 − 守方点数和 + 技能/克制加成（最少1点）</p>
        </div>
        <div className={styles.ruleSec}>
          <h4>⚔ 行动与移动</h4>
          <p>心境值=本回合可移动格数；攻击距离固定=相邻1格
回合流程：技能→移动→攻击→结束；攻击后行动轮立即结束</p>
        </div>
        <div className={styles.ruleSec}>
          <h4>⚡ 克制加伤</h4>
          <p>剑→妖→体→灵→法→剑（丹修中立），克制时判定+1</p>
        </div>
        <div className={styles.ruleSec}>
          <h4>🗡 劫匪行为</h4>
          <p>劫匪据守不动，也不会反击——放心靠近、专心输出</p>
        </div>
        <div className={styles.ruleSec}>
          <h4>💧 地形</h4>
          <p>灵泉💧 / 灵脉⚔ / 悟道🧘：停留到下回合生效对应+1
魔气☠：踏入即各属性-1，停留额外扣血
裂缝⬛：不可通行</p>
        </div>
        <button className={styles.ruleClose} onClick={onClose}>关闭</button>
      </motion.div>
    </div>
  );
}

/* ======== 骰子动画弹窗 ======== */

function DiceModal({
  attacker,
  defender,
  result,
  onClose,
}: {
  attacker: BattleUnit;
  defender: BattleUnit;
  result: DiceResult;
  onClose: () => void;
}) {
  const counterText = result.counterMod > 0 ? ' + 克制1' : '';
  const skillText = result.skillMod > 0 ? ` + 技能${result.skillMod}` : '';

  return (
    <div className={styles.diceOverlay} onClick={onClose}>
      <motion.div
        className={styles.dicePanel}
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.diceTitle}>
          {attacker.name} ⚔ {defender.name}
        </div>
        {/* 攻方 */}
        <div className={styles.diceRow}>
          <div className={styles.diceLabel}>攻方</div>
          <div className={styles.diceValues}>
            {result.attackerDice.map((v, i) => (
              <div key={i} className={`${styles.diceVal} ${styles.dicePlayer}`}>{v}</div>
            ))}
          </div>
          <div className={`${styles.diceSum}`} style={{ color: '#8ce0a0' }}>
            = {result.attackerSum}
          </div>
        </div>
        {/* 防方 */}
        <div className={styles.diceRow}>
          <div className={styles.diceLabel}>防方</div>
          <div className={styles.diceValues}>
            {result.defenderDice.map((v, i) => (
              <div key={i} className={`${styles.diceVal} ${styles.diceEnemy}`}>{v}</div>
            ))}
          </div>
          <div className={`${styles.diceSum}`} style={{ color: '#e89080' }}>
            = {result.defenderSum}
          </div>
        </div>
        <div className={styles.diceDamage}>
          💥 {result.attackerSum} − {result.defenderSum}{skillText}{counterText} = <strong>{result.damage}</strong> 点伤害
        </div>
        <button className={styles.diceClose} onClick={onClose}>确认</button>
      </motion.div>
    </div>
  );
}

/* ======== 结算面板 ======== */

function ResultPanel({ killCount, onContinue }: { killCount: number; onContinue: () => void }) {
  const rewards = useMemo(() => {
    if (killCount === 0) return { stones: 8, clues: 0 };
    if (killCount <= 2) return { stones: 15, clues: 1 };
    if (killCount <= 4) return { stones: 22, clues: 2 };
    return { stones: 30, clues: 3 };
  }, [killCount]);

  return (
    <div className={styles.resultOverlay}>
      <motion.div
        className={styles.resultPanel}
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
      >
        <div className={styles.resultTitle}>🏆 宗门追回物资任务结算</div>
        <div className={styles.resultRow}>
          击败劫匪：<strong>{killCount}</strong> / 6
        </div>
        <div className={styles.resultRow}>
          追回物资：<strong>{killCount > 0 ? '成功' : '失败'}</strong>
        </div>
        <div className={styles.resultRow}>
          灵石奖励：<strong>◈ ×{rewards.stones}</strong>
        </div>
        <div className={styles.resultRow}>
          线索奖励：<strong>📜 ×{rewards.clues}</strong>
        </div>
        <button className={styles.resultBtn} onClick={onContinue}>
          继续旅程
        </button>
      </motion.div>
    </div>
  );
}

/* ======== 主组件 ======== */

export const S7_Battle: React.FC = () => {
  const navigate = useNavigate();
  const heroId = useGameStore((s) => s.heroId);
  const heroName = useGameStore((s) => s.heroName);
  const ownedCardIds = useGameStore((s) => s.ownedCardIds);
  const cardBonuses = useGameStore((s) => s.cardBonuses);
  const battleBonus = useGameStore((s) => s.battleBonus);
  const knowledgeBonus = useGameStore((s) => s.knowledgeBonus);
  const addSpiritStones = useGameStore((s) => s.addSpiritStones);
  const addClueEntry = useGameStore((s) => s.addClueEntry);
  const markPhaseDone = useGameStore((s) => s.markPhaseDone);
  const setBanditKillCount = useGameStore((s) => s.setBanditKillCount);

  const battle = useBattleStore();
  const logEndRef = useRef<HTMLDivElement>(null);

  const [showSelect, setShowSelect] = useState(true);
  const [showRule, setShowRule] = useState(false);
  const [showDice, setShowDice] = useState(false);
  const [diceAttacker, setDiceAttacker] = useState<BattleUnit | null>(null);
  const [diceDefender, setDiceDefender] = useState<BattleUnit | null>(null);
  const [pendingSkillMod, setPendingSkillMod] = useState(0);
  const [showResult, setShowResult] = useState(false);

  /* === 交互提示与路径预览 === */
  // hover 目标（用于显示 tooltip 和路径预览）
  // 额外记录 rect —— tooltip 用 Portal 渲染到 body，按格子屏幕坐标定位，保证在单位之上
  const [hoverCell, setHoverCell] = useState<{ row: number; col: number; mx: number; my: number; rect: { left: number; top: number; width: number; height: number } | null } | null>(null);
  const [hoverUnitId, setHoverUnitId] = useState<string | null>(null);
  const [mousePos, setMousePos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  // 移动动画状态
  const [movingPath, setMovingPath] = useState<Array<{ row: number; col: number }> | null>(null);
  // 战报筛选：'all' 显示全部 / number 显示指定回合
  const [logFilter, setLogFilter] = useState<number | 'all'>('all');
  // 敌方技能描述揭示集合 —— 目前还没实装技能引擎，暂时空集
  // 后续技能引擎 on_skill_cast 钩子触发时，往这个集合里加 unit.id+'_battle' / unit.id+'_ultimate'
  // 一经揭示则永久可见（同场战斗内）
  const [revealedEnemySkills] = useState<Set<string>>(() => new Set());

  /* === 地图拖动 & 缩放 —— 直接操作DOM，绕过React重渲染 === */
  const mapAreaRef = useRef<HTMLDivElement>(null);
  const mapViewportRef = useRef<HTMLDivElement>(null);
  // 用 ref 缓存当前变换，避免 setState 触发重渲染
  const transformRef = useRef({ x: 0, y: 0, scale: 1 });
  const rafIdRef = useRef<number | null>(null);

  // 将 ref 中的 transform 应用到 DOM（通过 rAF 合批）
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

  /* 滚轮缩放 — 以鼠标点为锚点（non-passive 以确保 preventDefault 生效）
     ⚠️ 依赖 showSelect：showSelect=false 时 mapArea 才挂载，需重新绑定 */
  useEffect(() => {
    if (showSelect) return; // 阵容选择期间地图未挂载
    const el = mapAreaRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const t = transformRef.current;
      const delta = e.deltaY > 0 ? -0.1 : 0.1;
      const nextScale = Math.min(2, Math.max(0.4, t.scale + delta));
      if (nextScale === t.scale) return;
      // 以鼠标位置为缩放中心，防止缩放时画面漂移
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
  }, [applyTransform, showSelect]);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    // 只响应鼠标左键/触屏/笔
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    const ds = dragState.current;
    ds.startX = e.clientX;
    ds.startY = e.clientY;
    ds.startOffsetX = transformRef.current.x;
    ds.startOffsetY = transformRef.current.y;
    ds.isDragging = true;
    ds.hasMovedEnough = false;
    // 捕获指针，这样即使移出区域也能接收事件
    (e.target as Element).setPointerCapture?.(e.pointerId);
  }, []);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    const ds = dragState.current;
    if (!ds.isDragging) return;
    const dx = e.clientX - ds.startX;
    const dy = e.clientY - ds.startY;
    // 4px 阈值才算"真正拖动"，以区分点击
    if (!ds.hasMovedEnough && Math.abs(dx) + Math.abs(dy) < 4) return;
    ds.hasMovedEnough = true;
    transformRef.current.x = ds.startOffsetX + dx;
    transformRef.current.y = ds.startOffsetY + dy;
    applyTransform();
  }, [applyTransform]);

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    const ds = dragState.current;
    ds.isDragging = false;
    // 延迟几ms清除，以阻止同步触发的点击
    setTimeout(() => { ds.hasMovedEnough = false; }, 0);
    (e.target as Element).releasePointerCapture?.(e.pointerId);
  }, []);

  // 拖动过程中不触发点击
  const isDragging = useCallback(() => dragState.current.hasMovedEnough, []);

  // 自动滚动日志（仅"全部"模式下滚到底，筛选指定回合时保持阅读位置不变）
  useEffect(() => {
    if (logFilter === 'all') {
      logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [battle.logs.length, logFilter]);

  // 战斗结束时弹出结算
  useEffect(() => {
    if (battle.battleOver && !showResult) {
      setTimeout(() => setShowResult(true), 800);
    }
  }, [battle.battleOver, showResult]);

  const hero = heroId ? getHeroById(heroId) : null;

  // 构建搭档选项
  const partnerOptions: PartnerOption[] = useMemo(() => {
    if (!heroId) return [];
    // 全局排序：主角置顶 → 稀有度降序 → 同稀有度保持收集顺序
    //   搭档列表排除主角自身，故 filter 放在排序后
    const resolver = (id: string) => {
      const h = getHeroById(id as HeroId);
      if (h) return h as any;
      const p = getPoolCardById(id);
      if (!p) return null;
      return { rarity: p.rarity } as any;
    };
    const sortedIds = sortCardsForDisplay(
      [heroId, ...ownedCardIds],
      heroId,
      resolver,
    );
    return sortedIds
      .filter((id) => id !== heroId)
      .map((id) => {
        const h = getHeroById(id as HeroId);
        const bonus = cardBonuses[id] ?? { hp: 0, atk: 0, mnd: 0, realmUps: 0 };
        if (h) {
          const bc = h.battle_card;
          return {
            id: h.id,
            name: h.name,
            type: h.type,
            hp: bc.hp + bonus.hp,
            atk: bc.atk + bonus.atk,
            mnd: bc.mnd + bonus.mnd,
            battleSkill: bc.skills.battle_skill ? { name: bc.skills.battle_skill.name, desc: bc.skills.battle_skill.desc } : null,
            ultimate: bc.skills.ultimate ? { name: bc.skills.ultimate.name, desc: bc.skills.ultimate.desc } : null,
            portrait: getCachedImage(h.id),
          };
        }
        // 非主角卡（R/N/SR/SSR）
        const poolCard = getPoolCardById(id);
        if (poolCard) {
          return {
            id: poolCard.id,
            name: poolCard.name,
            type: poolCard.type as CultivationType,
            hp: poolCard.hp + bonus.hp,
            atk: poolCard.atk + bonus.atk,
            mnd: poolCard.mnd + bonus.mnd,
            battleSkill: null,  // R/N卡暂无战斗技能
            ultimate: null,
            portrait: getCachedImage(poolCard.id),
          };
        }
        return null;
      })
      .filter(Boolean) as PartnerOption[];
  }, [heroId, ownedCardIds, cardBonuses]);

  // 确认搭档 → 初始化战斗
  const handleConfirmPartner = useCallback(
    (partnerId: string) => {
      if (!hero) return;
      const bonus = cardBonuses[heroId!] ?? { hp: 0, atk: 0, mnd: 0, realmUps: 0 };
      const bc = hero.battle_card;
      const heroUnit = {
        id: hero.id,
        name: heroName || hero.name,
        type: hero.type,
        hp: bc.hp + bonus.hp,
        maxHp: bc.hp + bonus.hp,
        atk: bc.atk + bonus.atk + battleBonus,
        mnd: bc.mnd + bonus.mnd + knowledgeBonus,
        isEnemy: false,
        row: 0,
        col: 0,
        battleSkill: bc.skills.battle_skill ? { name: bc.skills.battle_skill.name, desc: bc.skills.battle_skill.desc } : null,
        ultimate: bc.skills.ultimate ? { name: bc.skills.ultimate.name, desc: bc.skills.ultimate.desc } : null,
        portrait: getCachedImage(hero.id),
      };

      const partner = partnerOptions.find((o) => o.id === partnerId)!;
      const partnerUnit = {
        id: partner.id,
        name: partner.name,
        type: partner.type,
        hp: partner.hp,
        maxHp: partner.hp,
        atk: partner.atk,
        mnd: partner.mnd,
        isEnemy: false,
        row: 1,
        col: 0,
        battleSkill: partner.battleSkill,
        ultimate: partner.ultimate,
        portrait: partner.portrait,
      };

      battle.initBattle(heroUnit, partnerUnit);
      setShowSelect(false);
    },
    [hero, heroId, heroName, battleBonus, knowledgeBonus, cardBonuses, partnerOptions, battle],
  );

  // 获取当前选中的单位
  const selectedUnit = useMemo(
    () => battle.units.find((u) => u.id === battle.selectedUnitId),
    [battle.units, battle.selectedUnitId],
  );

  // === 派生状态：剩余步数/可否继续移动/可否攻击 ===
  // 剩余步数 = 心境值 - 本回合已用步数
  const remainingSteps = useMemo(
    () => (selectedUnit ? Math.max(0, selectedUnit.mnd - selectedUnit.stepsUsedThisTurn) : 0),
    [selectedUnit],
  );
  const canMove = !!selectedUnit && remainingSteps > 0 && !selectedUnit.attackedThisTurn && !selectedUnit.immobilized;
  const canAttack = !!selectedUnit && !selectedUnit.attackedThisTurn;

  // ====== 当前"轮到行动"的玩家角色（按心境降序、未行动、存活） ======
  const currentActorId = useMemo(() => {
    for (const id of battle.actionQueue) {
      const u = battle.units.find((x) => x.id === id);
      if (u && !u.acted && !u.dead && !u.isEnemy) return id;
    }
    return null;
  }, [battle.actionQueue, battle.units]);
  const currentActor = useMemo(
    () => battle.units.find((u) => u.id === currentActorId) || null,
    [battle.units, currentActorId],
  );

  // ====== 路径规划：从 selectedUnit 到 hoverCell 的最短路径（上下左右） ======
  // 规则：优先最短路径；若多条等长，根据鼠标在 hover 格子内象限决策（下/右 优先）
  const hoverPath = useMemo<Array<{ row: number; col: number }> | null>(() => {
    if (!selectedUnit || !canMove || !hoverCell) return null;
    // 只在 moveRange 内才显示路径
    if (!battle.moveRange.some((m) => m.row === hoverCell.row && m.col === hoverCell.col)) return null;

    const sr = selectedUnit.row;
    const sc = selectedUnit.col;
    const tr = hoverCell.row;
    const tc = hoverCell.col;
    if (sr === tr && sc === tc) return null;

    // BFS 寻路（所有最短路径）
    const canStand = (r: number, c: number): boolean => {
      if (r < 0 || r >= 4 || c < 0 || c >= 10) return false;
      if (battle.map[r][c].terrain === 'obstacle') return false;
      // 其他存活单位占位（自身除外）
      if (battle.units.some((u) => !u.dead && u.id !== selectedUnit.id && u.row === r && u.col === c)) return false;
      return true;
    };

    // 用 BFS 算出每格的最短步数
    const dist: number[][] = Array.from({ length: 4 }, () => Array(10).fill(Infinity));
    dist[sr][sc] = 0;
    const queue: Array<[number, number]> = [[sr, sc]];
    const DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    while (queue.length) {
      const [r, c] = queue.shift()!;
      for (const [dr, dc] of DIRS) {
        const nr = r + dr;
        const nc = c + dc;
        if (!canStand(nr, nc)) continue;
        if (dist[nr][nc] > dist[r][c] + 1) {
          dist[nr][nc] = dist[r][c] + 1;
          queue.push([nr, nc]);
        }
      }
    }
    if (!isFinite(dist[tr][tc])) return null;

    // 鼠标象限决策：返回首步方向偏好 [下,右,上,左] 的优先级
    // 象限规则：
    //  - 鼠标在格子左下1/2（col占左半，row占下半）→ 先竖直走（下），再横向
    //  - 鼠标在格子右上1/2 → 先横向（右），再竖直
    // 实际推广：
    //  - 根据 hoverCell 内的局部位置 mx∈[0,1], my∈[0,1] ，判断"更偏向水平还是垂直"
    const mx = hoverCell.mx;
    const my = hoverCell.my;
    const preferVertical = my > mx; // 鼠标偏左下对角线以下 → 优先垂直
    // 方向优先级：根据目标相对位置排序
    const dRow = Math.sign(tr - sr); // +1/-1/0
    const dCol = Math.sign(tc - sc);
    const vStep: [number, number] = [dRow || 1, 0];
    const hStep: [number, number] = [0, dCol || 1];
    const stepPriority: Array<[number, number]> = preferVertical ? [vStep, hStep] : [hStep, vStep];
    // 填充其他方向（回退用）
    for (const [dr, dc] of DIRS) {
      if (!stepPriority.some(([a, b]) => a === dr && b === dc)) stepPriority.push([dr, dc]);
    }

    // 从起点贪心：每步选 dist 最小且在优先方向的邻居，一直走到终点
    const path: Array<{ row: number; col: number }> = [];
    let cr = sr;
    let cc = sc;
    const maxSteps = dist[tr][tc];
    for (let step = 0; step < maxSteps; step++) {
      let chosen: [number, number] | null = null;
      for (const [dr, dc] of stepPriority) {
        const nr = cr + dr;
        const nc = cc + dc;
        if (nr < 0 || nr >= 4 || nc < 0 || nc >= 10) continue;
        if (!isFinite(dist[nr][nc])) continue;
        // 只能走"距离目标更近"的邻居（即 dist[nr][nc] === dist[cr][cc] - 1 是错的，应该是 从起点出发 dist 递增 且 到目标 dist 递减）
        // 条件：dist[nr][nc] === step + 1 AND 从 (nr,nc) 能到 (tr,tc) 且总步数=maxSteps
        if (dist[nr][nc] !== step + 1) continue;
        // 从该邻居到终点的曼哈顿距离必须 === maxSteps - (step+1)
        if (Math.abs(tr - nr) + Math.abs(tc - nc) > maxSteps - (step + 1)) continue;
        chosen = [nr, nc];
        break;
      }
      if (!chosen) break;
      cr = chosen[0];
      cc = chosen[1];
      path.push({ row: cr, col: cc });
    }

    return path.length === maxSteps ? path : null;
  }, [selectedUnit, hoverCell, battle.moveRange, battle.map, battle.units, canMove]);

  // 点击格子
  const handleCellClick = useCallback(
    (row: number, col: number) => {
      if (isDragging()) return; // 拖动中不触发点击
      if (!selectedUnit || battle.battleOver) return;
      if (movingPath) return; // 正在移动动画中

      // 检查是否可移动 —— 改为逐格动画移动
      if (canMove && battle.moveRange.some((r) => r.row === row && r.col === col)) {
        // 用 hoverPath（如果鼠标就停在目标格）或重新计算一条路径
        const path = hoverPath && hoverPath.length > 0 && hoverPath[hoverPath.length - 1].row === row && hoverPath[hoverPath.length - 1].col === col
          ? hoverPath
          : null;
        if (!path || path.length === 0) {
          // 保底：直接瞬移（会按曼哈顿计步）
          battle.moveUnit(selectedUnit.id, row, col);
          // 移动完成后重算范围（支持继续移动或攻击）
          setTimeout(() => {
            useBattleStore.getState().calcMoveRange(selectedUnit.id);
            useBattleStore.getState().calcAttackRange(selectedUnit.id);
          }, 0);
          return;
        }
        // 启动逐格移动：每 0.2s 推进一格
        setMovingPath(path);
        let i = 0;
        const tick = () => {
          if (i >= path.length) {
            setMovingPath(null);
            // 移动完成：重算移动范围（剩余步数）和攻击范围
            useBattleStore.getState().calcMoveRange(selectedUnit.id);
            useBattleStore.getState().calcAttackRange(selectedUnit.id);
            return;
          }
          const step = path[i];
          useBattleStore.getState().moveUnitStep(selectedUnit.id, step.row, step.col);
          i++;
          setTimeout(tick, 200);
        };
        tick();
        return;
      }

      // 检查是否可攻击
      if (canAttack) {
        const target = battle.units.find(
          (u) => !u.dead && u.row === row && u.col === col && u.isEnemy !== selectedUnit.isEnemy,
        );
        if (target && battle.attackRange.some((r) => r.row === row && r.col === col)) {
          setDiceAttacker(selectedUnit);
          setDiceDefender(target);
          battle.attack(selectedUnit.id, target.id, pendingSkillMod);
          // 标记攻击过（普通攻击后不再能走/再攻击，关闭骰子弹窗即结束回合）
          const updatedUnits = useBattleStore.getState().units.map((u) =>
            u.id === selectedUnit.id ? { ...u, attackedThisTurn: true } : u,
          );
          useBattleStore.setState({ units: updatedUnits });
          setShowDice(true);
          return;
        }
      }
    },
    [selectedUnit, battle, canMove, canAttack, pendingSkillMod, isDragging, hoverPath, movingPath],
  );

  // 选择单位
  const handleSelectUnit = useCallback(
    (unitId: string) => {
      if (isDragging()) return; // 拖动中不触发点击
      if (battle.battleOver) return;
      if (movingPath) return; // 移动动画中
      const unit = battle.units.find((u) => u.id === unitId);
      if (!unit || unit.dead || unit.isEnemy) return;

      // 关键约束：只能选择"当前行动者"
      if (unit.id !== currentActorId) return;

      if (battle.selectedUnitId === unitId) {
        // 取消选择
        battle.cancelSelect();
        setPendingSkillMod(0);
        return;
      }

      if (unit.acted) return;
      battle.selectUnit(unitId);
      setPendingSkillMod(0);
    },
    [battle, isDragging, currentActorId, movingPath],
  );

  // 使用技能（普通战斗技能 或 绝技）
  // 关键：技能/绝技均【不结束回合】，玩家仍可继续移动/进行普通攻击
  // 阶段一升级：绝技走 performUltimate（接入 SkillRegistry，112 条技能完整生效）
  const handleUseSkill = useCallback(
    (type: 'battle' | 'ultimate') => {
      if (!selectedUnit) return;
      // 攻击完就锁死了，不允许再放技能
      if (selectedUnit.attackedThisTurn) return;

      if (type === 'ultimate') {
        // —— 绝技：走 SkillRegistry 引擎 ——
        if (!selectedUnit.ultimate || selectedUnit.ultimateUsed) return;
        const pre = battle.ultimatePrecheck(selectedUnit.id);
        if (!pre.ok) {
          battle.addLog(`⚠ 无法发动【${selectedUnit.ultimate.name}】：${pre.reason ?? '条件不满足'}`, 'system');
          return;
        }
        // S7A 中所有绝技要么 self / aoe / 自动选目标，要么是十字AOE等无需玩家点选的形式
        // 直接调 performUltimate（targetIds 留空，由 selector 自行决定）
        const ok = battle.performUltimate(selectedUnit.id, []);
        if (!ok) {
          battle.addLog(`⚠ 【${selectedUnit.ultimate.name}】发动失败`, 'system');
          return;
        }
        // 绝技不再走"+2修正"兜底；真实效果由引擎施加
        setPendingSkillMod(0);
      } else {
        // —— 普通战斗技能：保留旧 useSkill 路径 ——
        // 大部分被动技能由 on_before_roll / on_after_hit hook 自动触发，
        // 这里只标记本回合已用技能并做轻量数值修正（用于无 hook 的简单技能）
        battle.useSkill(selectedUnit.id, type);
        const skill = selectedUnit.battleSkill;
        if (skill) {
          const match = skill.desc.match(/额外投(?:掷)?(\d+)颗骰子/);
          if (match) {
            setPendingSkillMod((prev) => prev + parseInt(match[1]));
          } else {
            setPendingSkillMod((prev) => prev + 2); // 默认+2修正（兜底）
          }
        }
      }
      // 技能使用后不结束回合，也不消耗步数；仅重算一下移动/攻击范围以刷新UI
      setTimeout(() => {
        useBattleStore.getState().calcMoveRange(selectedUnit.id);
        useBattleStore.getState().calcAttackRange(selectedUnit.id);
      }, 0);
    },
    [selectedUnit, battle],
  );

  // 结束回合（手动点击）
  const handleEndTurn = useCallback(() => {
    if (!selectedUnit) return;
    battle.endUnitTurn(selectedUnit.id);
    setPendingSkillMod(0);

    // 检查所有玩家是否都行动完
    setTimeout(() => {
      const updatedUnits = useBattleStore.getState().units;
      const playerAlive = updatedUnits.filter((u) => !u.isEnemy && !u.dead);
      const allActed = playerAlive.every((u) => u.acted);
      if (allActed) {
        battle.advanceAction();
      }
    }, 100);
  }, [selectedUnit, battle]);

  // 关闭骰子弹窗
  const handleCloseDice = useCallback(() => {
    setShowDice(false);
    // 普通攻击后自动结束该角色的回合
    if (selectedUnit) {
      battle.endUnitTurn(selectedUnit.id);
      setPendingSkillMod(0);

      setTimeout(() => {
        const updatedUnits = useBattleStore.getState().units;
        const playerAlive = updatedUnits.filter((u) => !u.isEnemy && !u.dead);
        const allActed = playerAlive.every((u) => u.acted);
        if (allActed) {
          battle.advanceAction();
        }
      }, 100);
    }
  }, [selectedUnit, battle]);

  // 结算确认
  const handleContinue = useCallback(() => {
    const rewards = battle.getRewards();
    addSpiritStones(rewards.stones);
    // 写入剿匪击杀数 → S6b 抽卡顺序排序用
    setBanditKillCount(battle.killCount);
    // 合作清怪线索：写入结构化线索库，便于 S8 密谈线索库显示
    const coopClueTexts: Array<{ title: string; summary: string }> = [
      { title: '宗门外围·妖兽异闻', summary: '劫匪之一的短剑刻有逆天宗暗纹——此地绝非寻常劫掠点。' },
      { title: '宗门外围·遗落信笺', summary: '劫匪身上有一封未送出的信，收信人代号"玄"，疑似长老院。' },
      { title: '宗门外围·残破令牌', summary: '从首领身上搜出一块令牌，纹饰与失踪数十年的一股势力相似。' },
    ];
    for (let i = 0; i < rewards.clues && i < coopClueTexts.length; i++) {
      addClueEntry({
        id: `coop_${i + 1}`,
        title: coopClueTexts[i].title,
        summary: coopClueTexts[i].summary,
        source: 'coop',
        fromHero: null,
        round: 0,
      });
    }
    markPhaseDone(3);
    SaveSystem.save(1);
    // S7A 合作清怪结束 → S8a 第一轮密谈
    navigate('/s8?round=1');
  }, [battle, addSpiritStones, addClueEntry, markPhaseDone, navigate, setBanditKillCount]);

  // === 渲染 ===

  if (showSelect) {
    return (
      <div className={styles.screen}>
        <div className={styles.bgOverlay} />
        <BackButton onClick={() => navigate('/story')} />
        <SelectPartner options={partnerOptions} onConfirm={handleConfirmPartner} />
      </div>
    );
  }

  return (
    <div className={styles.screen}>
      <div className={styles.bgOverlay} />
      {/* 4件套常驻控件：返回按钮 + 音乐切换 + 右下角 HUD（下方） */}
      <BackButton onClick={() => navigate(-1)} />
      <MusicToggle />

      {/* 战斗规则按钮（S7 专用，紧贴返回按钮下方，风格统一） */}
      <button className={styles.ruleBtn} onClick={() => setShowRule(true)}>
        📖 战斗规则
      </button>

      {/* 顶部中间 HUD：回合 + 追回物资 + 行动中 */}
      <div className={styles.topHud}>
        <div className={styles.roundBadge}>
          第 {battle.round} / {battle.maxRound} 回合
        </div>
        <div className={styles.killBadge}>
          追回物资 {battle.killCount} / 6
        </div>
        <div className={styles.turnInfo}>
          {selectedUnit
            ? `⚡ ${selectedUnit.name} 行动中 · 剩余${remainingSteps}步${selectedUnit.attackedThisTurn ? ' · 已攻击' : ''}`
            : (currentActor ? `⚡ ${currentActor.name} 行动中` : '等待敌方')}
        </div>
      </div>

      {/* 4×10 地图 */}
      <div
        className={styles.mapArea}
        ref={mapAreaRef}
        onPointerDown={handlePointerDown}
        onPointerMove={(e) => { handlePointerMove(e); setMousePos({ x: e.clientX, y: e.clientY }); }}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        <div
          className={styles.mapViewport}
          ref={mapViewportRef}
          style={{ transform: 'translate3d(0,0,0) scale(1)', transformOrigin: '0 0' }}
        >
        {/* 底图层：独立图层 + GPU合成，一次光栅化后常驻纹理，拖动缩放时零重绘 */}
        <div className={styles.mapBgLayer} aria-hidden="true" />
        {/* 氛围渐变层：替代原 inset box-shadow，零成本画面压暗 */}
        <div className={styles.mapVignette} aria-hidden="true" />
        <div className={styles.mapGrid}>
      {battle.map.map((row, r) =>
            row.map((cell, c) => {
              const isMovable = battle.moveRange.some((m) => m.row === r && m.col === c);
              const isAttackable = battle.attackRange.some((a) => a.row === r && a.col === c);
              const isSelected = selectedUnit && selectedUnit.row === r && selectedUnit.col === c;

              const terrainClass: Record<string, string> = {
                normal: styles.cellNormal,
                obstacle: styles.cellObstacle,
                spring: styles.cellSpring,
                atk_boost: styles.cellAtkBoost,
                mnd_boost: styles.cellMndBoost,
                miasma: styles.cellMiasma,
              };

              const cellClass = [
                styles.cell,
                terrainClass[cell.terrain] || styles.cellNormal,
                isMovable && canMove ? styles.cellMovable : '',
                isAttackable && canAttack ? styles.cellAttackable : '',
                isSelected ? styles.cellSelected : '',
              ]
                .filter(Boolean)
                .join(' ');

              const terrainLabel: Record<string, string> = {
                spring: '生命+1',
                atk_boost: '修为+1',
                mnd_boost: '心境+1',
                miasma: '生命-1',
                obstacle: '山石阻隔',
              };

              const terrainTile: Record<string, string> = {
                spring: asset('images/map/tile_spring.png'),
                atk_boost: asset('images/map/tile_atk_boost.png'),
                mnd_boost: asset('images/map/tile_mnd_boost.png'),
                miasma: asset('images/map/tile_miasma.png'),
                obstacle: asset('images/map/tile_obstacle.png'),
              };

              return (
                <div
                  key={`${r}-${c}`}
                  className={cellClass}
                  onClick={() => handleCellClick(r, c)}
                  onMouseMove={(e) => {
                    const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
                    const rectInfo = { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
                    if (cell.terrain !== 'normal') {
                      setHoverCell({ row: r, col: c, mx: 0, my: 0, rect: rectInfo });
                      setMousePos({ x: e.clientX, y: e.clientY });
                    }
                    if (!isMovable || !canMove) return;
                    const mx = (e.clientX - rect.left) / rect.width;
                    const my = (e.clientY - rect.top) / rect.height;
                    setHoverCell({ row: r, col: c, mx, my, rect: rectInfo });
                  }}
                  onMouseLeave={() => {
                    setHoverCell((prev) => (prev && prev.row === r && prev.col === c ? null : prev));
                  }}
                >
                  {/* 地形瓦片图 */}
                  {terrainTile[cell.terrain] && (
                    <div
                      className={styles.cellTile}
                      style={{ backgroundImage: `url(${terrainTile[cell.terrain]})` }}
                    />
                  )}
                  {/* 居中大文字标识地形 */}
                  {terrainLabel[cell.terrain] && (
                    <span className={styles.cellLabelCenter}>{terrainLabel[cell.terrain]}</span>
                  )}
                  {/* 地形hover气泡：用Portal渲染到body，位于所有层之上（见组件底部） */}
                </div>
              );
            }),
          )}
        </div>

        {/* 路径预览 SVG */}
        {selectedUnit && hoverPath && hoverPath.length > 0 && (
          <svg
            className={styles.pathSvg}
            width={10 * CELL_SIZE}
            height={4 * CELL_SIZE}
          >
            {(() => {
              // 路径点：从起点中心出发，经过每格中心
              const pts: Array<[number, number]> = [];
              const toXY = (r: number, c: number): [number, number] => [c * CELL_SIZE + CELL_SIZE / 2, r * CELL_SIZE + CELL_SIZE / 2];
              pts.push(toXY(selectedUnit.row, selectedUnit.col));
              for (const step of hoverPath) pts.push(toXY(step.row, step.col));
              const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p[0]} ${p[1]}`).join(' ');
              // 箭头尾指向
              const last = pts[pts.length - 1];
              const prev = pts[pts.length - 2] || last;
              const dx = last[0] - prev[0];
              const dy = last[1] - prev[1];
              const angle = Math.atan2(dy, dx);
              const arrowSize = 16;
              const ax = last[0];
              const ay = last[1];
              const a1x = ax - arrowSize * Math.cos(angle - Math.PI / 6);
              const a1y = ay - arrowSize * Math.sin(angle - Math.PI / 6);
              const a2x = ax - arrowSize * Math.cos(angle + Math.PI / 6);
              const a2y = ay - arrowSize * Math.sin(angle + Math.PI / 6);
              return (
                <>
                  <path className={styles.pathLine} d={d} />
                  <polygon
                    className={styles.pathArrowHead}
                    points={`${ax},${ay} ${a1x},${a1y} ${a2x},${a2y}`}
                  />
                </>
              );
            })()}
          </svg>
        )}

        {/* 单位渲染 — 用普通div + CSS transition，避免 framer-motion 每次重算 */}
        {battle.units.map((unit) => {
          if (unit.dead && unit.isEnemy) return null; // 死亡敌人不渲染
          const counterTarget = selectedUnit && !selectedUnit.isEnemy && unit.isEnemy
            ? isCounter(selectedUnit.type, unit.type)
            : false;

          // 玩家卡的状态分级
          let playerStateCls = '';
          if (!unit.isEnemy && !unit.dead) {
            if (battle.selectedUnitId === unit.id) {
              playerStateCls = styles.unitPlayerSelected;
            } else if (unit.id === currentActorId) {
              playerStateCls = styles.unitPlayerActive;
            } else if (unit.acted) {
              playerStateCls = styles.unitPlayerWaiting;
            } else {
              playerStateCls = styles.unitPlayerWaiting;
            }
          }

          // 敌人（劫匪）使用瓦片图渲染
          if (unit.isEnemy) {
            const isInAttackRange = canAttack && battle.attackRange.some((a) => a.row === unit.row && a.col === unit.col);
            return (
              <div
                key={unit.id}
                className={`${styles.unitEnemyTile} ${unit.dead ? styles.unitEnemyDying : ''} ${isInAttackRange ? styles.unitEnemyAttackable : ''}`}
                style={{
                  top: unit.row * CELL_SIZE + 4,
                  left: unit.col * CELL_SIZE + 4,
                }}
                onClick={() => {
                  if (isInAttackRange && selectedUnit) {
                    handleCellClick(unit.row, unit.col);
                  }
                }}
                onMouseEnter={() => {
                  if (isInAttackRange) setHoverUnitId(unit.id);
                }}
                onMouseLeave={() => {
                  setHoverUnitId((prev) => (prev === unit.id ? null : prev));
                }}
              >
                <div
                  className={styles.unitEnemyTileImg}
                  style={{ backgroundImage: `url(${unit.portrait})` }}
                />
                <div className={styles.unitEnemyName}>{unit.name}</div>
                <div className={styles.unitEnemyType}>{TYPE_CHAR[unit.type] || unit.type}</div>
                {counterTarget && <div className={styles.unitCounter}>克制!</div>}
                {/* 可被攻击时显示交叉刀图标 */}
                {isInAttackRange && hoverUnitId === unit.id && (
                  <div className={styles.attackIndicator}>⚔</div>
                )}
                <div className={styles.unitStatsOverlay}>
                  <span className={`${styles.unitStat} ${styles.unitStatAtk}`}>修{unit.atk}</span>
                  <span className={`${styles.unitStat} ${styles.unitStatMnd}`}>境{unit.mnd}</span>
                  <span className={`${styles.unitStat} ${styles.unitStatHp}`}>生{unit.hp}</span>
                </div>
                <div className={styles.unitHpBar}>
                  <div
                    className={`${styles.unitHpFill} ${styles.unitHpFillEnemy}`}
                    style={{ width: `${Math.max(0, (unit.hp / unit.maxHp) * 100)}%` }}
                  />
                </div>
              </div>
            );
          }

          return (
            <div
              key={unit.id}
              className={[
                styles.unit,
                unit.dead ? styles.unitDead : '',
                playerStateCls,
              ]
                .filter(Boolean)
                .join(' ')}
              style={{
                top: unit.row * CELL_SIZE + UNIT_OFFSET,
                left: unit.col * CELL_SIZE + UNIT_OFFSET,
              }}
              onClick={() => handleSelectUnit(unit.id)}
              onMouseEnter={(e) => {
                setHoverUnitId(unit.id);
                setMousePos({ x: e.clientX, y: e.clientY });
              }}
              onMouseMove={(e) => setMousePos({ x: e.clientX, y: e.clientY })}
              onMouseLeave={() => setHoverUnitId((prev) => (prev === unit.id ? null : prev))}
            >
              <div className={styles.unitName}>{unit.name}</div>
              <div
                className={styles.unitPortrait}
                style={{ backgroundImage: unit.portrait ? `url(${unit.portrait})` : undefined, backgroundColor: '#203a20' }}
              />
<div className={styles.unitType}>{TYPE_CHAR[unit.type] || unit.type}</div>
              {/* 常驻显示属性条 */}
              <div className={styles.unitStatsOverlay}>
                <span className={`${styles.unitStat} ${styles.unitStatAtk}`}>修{unit.atk}</span>
                <span className={`${styles.unitStat} ${styles.unitStatMnd}`}>境{unit.mnd}</span>
                <span className={`${styles.unitStat} ${styles.unitStatHp}`}>生{unit.hp}</span>
              </div>
              <div className={styles.unitHpBar}>
                <div
                  className={`${styles.unitHpFill} ${styles.unitHpFillPlayer}`}
                  style={{ width: `${Math.max(0, (unit.hp / unit.maxHp) * 100)}%` }}
                />
              </div>
            </div>
          );
        })}

        </div>
      </div>

      {/* === hover 鼠标跟随提示 === */}
      {/* 角色hover提示（只保留简短tip；完整技能信息显示在左下角unitInfoPanel） */}
      {hoverUnitId && (() => {
        const u = battle.units.find((x) => x.id === hoverUnitId);
        if (!u || u.dead) return null;

        // 敌人hover提示
        if (u.isEnemy) {
          const isInAttackRange = canAttack && battle.attackRange.some((a) => a.row === u.row && a.col === u.col);
          return (
            <div
              className={styles.hoverTip}
              style={{ left: mousePos.x + 16, top: mousePos.y + 16 }}
            >
              {isInAttackRange ? `点击攻击 ${u.name}` : `${u.name} · ${u.type} · 气血${u.hp}/${u.maxHp}`}
            </div>
          );
        }

        // 玩家角色hover提示
        const isActive = u.id === currentActorId;
        // 当前行动角色 → 展示技能名+使用次数绿灯（新语义）
        if (isActive) {
          const bCheck = u.battleSkill ? getSkillCheck(u, 'battle', battle.units, battle.skillUsedThisTurn) : null;
          const uCheck = u.ultimate ? getSkillCheck(u, 'ultimate', battle.units, battle.skillUsedThisTurn) : null;
          return (
            <div
              className={styles.hoverTip}
              style={{ left: mousePos.x + 16, top: mousePos.y + 16 }}
            >
              <div>点击可行动角色，进行移动</div>
              {u.battleSkill && bCheck && (
                <div style={{ marginTop: 4 }}>
                  <span className={bCheck.hasCharges ? styles.skillDotGreen : styles.skillDotDim} />
                  技能：{u.battleSkill.name}
                  {bCheck.isPassive
                    ? <span style={{ opacity: .6, marginLeft: 6 }}>（被动）</span>
                    : !bCheck.interactable && bCheck.reason
                      ? <span style={{ opacity: .6, marginLeft: 6 }}>（{bCheck.reason}）</span>
                      : null}
                </div>
              )}
              {u.ultimate && uCheck && (
                <div style={{ marginTop: 2 }}>
                  <span className={uCheck.hasCharges ? styles.skillDotGreen : styles.skillDotDim} />
                  绝技：{u.ultimate.name}
                  {!uCheck.interactable && uCheck.reason && (
                    <span style={{ opacity: .6, marginLeft: 6 }}>（{uCheck.reason}）</span>
                  )}
                </div>
              )}
            </div>
          );
        }
        // 非当前行动的我方角色
        return (
          <div
            className={styles.hoverTip}
            style={{ left: mousePos.x + 16, top: mousePos.y + 16 }}
          >
            {u.acted ? '该角色本回合已行动' : '暂未轮到此角色'}
          </div>
        );
      })()}

      {/* 左下角选中/悬停角色信息 —— hover 优先，移开回落到 selectedUnit */}
      {(() => {
        // 显示优先级：hoverUnitId > selectedUnit
        const hoveredUnit = hoverUnitId ? battle.units.find((x) => x.id === hoverUnitId && !x.dead) : null;
        const displayUnit = hoveredUnit || selectedUnit;
        if (!displayUnit) return null;
        const isEnemy = !!displayUnit.isEnemy;
        const isSelected = selectedUnit?.id === displayUnit.id;
        // 敌方技能描述是否已揭示（一经发动永久可见；当前版本暂无技能引擎，故默认遮蔽）
        const battleRevealed = revealedEnemySkills.has(`${displayUnit.id}_battle`);
        const ultRevealed = revealedEnemySkills.has(`${displayUnit.id}_ultimate`);
        // 可发动判定（仅我方 + 当前 selectedUnit 有意义）
        const showCastDot = !isEnemy && isSelected;
        const bCheck = showCastDot && displayUnit.battleSkill
          ? getSkillCheck(displayUnit, 'battle', battle.units, battle.skillUsedThisTurn)
          : null;
        const uCheck = showCastDot && displayUnit.ultimate
          ? getSkillCheck(displayUnit, 'ultimate', battle.units, battle.skillUsedThisTurn)
          : null;
        return (
          <div className={styles.unitInfoPanel}>
            <div className={styles.unitInfoName}>
              {displayUnit.name} {TYPE_CHAR[displayUnit.type]}
              {isEnemy && <span style={{ marginLeft: 8, color: '#e87060', fontSize: 13 }}>【敌方】</span>}
              {hoveredUnit && !isSelected && <span style={{ marginLeft: 8, color: '#a09878', fontSize: 13 }}>（预览）</span>}
            </div>
            <div className={styles.unitInfoType}>{displayUnit.type}</div>
            <div className={styles.unitInfoStats}>
              <span>气血 {displayUnit.hp}/{displayUnit.maxHp}</span>
              <span>修为 {displayUnit.atk}</span>
              <span>心境 {displayUnit.mnd}</span>
            </div>
            {/* 🚶 常驻步数条 — 只有 selectedUnit 显示，hover预览时不显示 */}
            {isSelected && !isEnemy && (
              <div className={styles.stepBar}>
                <div className={styles.stepBarLabel}>
                  可移动步数 <strong>{remainingSteps}</strong> / {displayUnit.mnd}
                  {displayUnit.attackedThisTurn && <span className={styles.stepLocked}>（已攻击，回合即将结束）</span>}
                </div>
                <div className={styles.stepBarTrack}>
                  {Array.from({ length: displayUnit.mnd }).map((_, i) => (
                    <span
                      key={i}
                      className={`${styles.stepDot} ${i < remainingSteps ? styles.stepDotLeft : styles.stepDotUsed}`}
                    />
                  ))}
                </div>
              </div>
            )}
            {/* 战斗技能 */}
            {displayUnit.battleSkill && (
              <div className={styles.unitInfoSkill}>
                <strong>
                  {bCheck && <span className={bCheck.hasCharges ? styles.skillDotGreen : styles.skillDotDim} />}
                  技能：{displayUnit.battleSkill.name}
                  {bCheck?.isPassive && <span style={{ opacity: .6, fontSize: 12, fontWeight: 'normal', marginLeft: 6 }}>（被动 · 持续生效）</span>}
                </strong>
                {isEnemy && !battleRevealed ? (
                  <em style={{ opacity: .55 }}>效果未知（该敌方单位尚未发动过此技能）</em>
                ) : (
                  <em>{displayUnit.battleSkill.desc}</em>
                )}
              </div>
            )}
            {/* 绝技（金黄色系） */}
            {displayUnit.ultimate && (
              <div className={styles.unitInfoUltimate}>
                <strong>
                  {uCheck && <span className={uCheck.hasCharges ? styles.skillDotGreen : styles.skillDotDim} />}
                  绝技：{displayUnit.ultimate.name}
                  {displayUnit.ultimateUsed && <span className={styles.unitInfoUltimateUsed}>（已使用）</span>}
                </strong>
                {isEnemy && !ultRevealed ? (
                  <em style={{ opacity: .55 }}>效果未知（该敌方单位尚未发动过此绝技）</em>
                ) : (
                  <em>{displayUnit.ultimate.desc}</em>
                )}
              </div>
            )}
          </div>
        );
      })()}

      {/* 底部操作面板 */}
      {selectedUnit && !battle.battleOver && (
        <div className={styles.actionPanel}>
          {/* 技能（被动技不渲染按钮） */}
          {selectedUnit.battleSkill && (() => {
            const chk = getSkillCheck(selectedUnit, 'battle', battle.units, battle.skillUsedThisTurn);
            if (chk.isPassive) return null;
            const disabled = !chk.interactable;
            const btnClass = [
              styles.actionBtn,
              styles.btnSkill,
              disabled && chk.hasCharges ? styles.btnConditionUnmet : '',
            ].filter(Boolean).join(' ');
            return (
              <button
                className={btnClass}
                onClick={() => { if (!disabled) handleUseSkill('battle'); }}
                disabled={disabled}
                title={chk.reason || ''}
              >
                <span className={chk.hasCharges ? styles.skillDotGreen : styles.skillDotDim} />
                技能：{selectedUnit.battleSkill.name}
              </button>
            );
          })()}
          {/* 绝技（用过后常显 · 灯灭 · 不可交互） */}
          {selectedUnit.ultimate && (() => {
            const chk = getSkillCheck(selectedUnit, 'ultimate', battle.units, battle.skillUsedThisTurn);
            const disabled = !chk.interactable;
            const btnClass = [
              styles.actionBtn,
              styles.btnUltimate,
              disabled && chk.hasCharges ? styles.btnConditionUnmet : '',
            ].filter(Boolean).join(' ');
            return (
              <button
                className={btnClass}
                onClick={() => { if (!disabled) handleUseSkill('ultimate'); }}
                disabled={disabled}
                title={chk.reason || ''}
              >
                <span className={chk.hasCharges ? styles.skillDotGreen : styles.skillDotDim} />
                绝技：{selectedUnit.ultimate.name}
              </button>
            );
          })()}
          {/* 提示 */}
          {pendingSkillMod > 0 && (
            <span style={{ color: '#ffd98a', fontSize: 15 }}>
              技能修正 +{pendingSkillMod}
            </span>
          )}
          {/* 结束回合 */}
          <button
            className={`${styles.actionBtn} ${styles.btnEnd}`}
            onClick={handleEndTurn}
          >
            结束行动
          </button>
        </div>
      )}

      {/* 战报面板 */}
      <div className={styles.logPanel}>
        <div className={styles.logHeader}>
          <div className={styles.logTitle}>📜 战报</div>
          {(() => {
            const roundSet = new Set<number>();
            for (const l of battle.logs) roundSet.add(l.round);
            const rounds = Array.from(roundSet).sort((a, b) => a - b);
            return (
              <div className={styles.logFilterBar}>
                <button
                  className={`${styles.logFilterBadge} ${logFilter === 'all' ? styles.logFilterBadgeActive : ''}`}
                  onClick={() => setLogFilter('all')}
                  title="显示全部回合"
                >全部</button>
                {rounds.map((r) => (
                  <button
                    key={r}
                    className={`${styles.logFilterBadge} ${logFilter === r ? styles.logFilterBadgeActive : ''}`}
                    onClick={() => setLogFilter(r)}
                    title={`只看第 ${r} 回合`}
                  >R{r}</button>
                ))}
              </div>
            );
          })()}
        </div>
        <div className={styles.logList}>
          {battle.logs
            .filter((log) => logFilter === 'all' || log.round === logFilter)
            .map((log, i) => (
            <div
              key={i}
              className={`${styles.logItem} ${
                log.type === 'action' ? styles.logAction
                : log.type === 'damage' ? styles.logDamage
                : log.type === 'skill' ? styles.logSkill
                : log.type === 'kill' ? styles.logKill
                : styles.logSystem
              }`}
            >
              <span className={styles.logRoundTag}>R{log.round}</span>
              {log.text}
            </div>
          ))}
          <div ref={logEndRef} />
        </div>
      </div>

      {/* 骰子弹窗 */}
      <AnimatePresence>
        {showDice && diceAttacker && diceDefender && battle.lastDice && (
          <DiceModal
            attacker={diceAttacker}
            defender={diceDefender}
            result={battle.lastDice}
            onClose={handleCloseDice}
          />
        )}
      </AnimatePresence>

      {/* 规则弹窗 */}
      <AnimatePresence>
        {showRule && <RuleModal onClose={() => setShowRule(false)} />}
      </AnimatePresence>

      {/* 右下角常驻 HUD（灵石 + 已收集角色）：与 S4 完全一致的4件套常驻控件 */}
      <CommonHud chapter={3} />

      {/* 地形hover气泡：Portal 挂到 body，永远在最顶层（不会被单位/瓦片遮挡） */}
      {hoverCell && hoverCell.rect && !hoverUnitId && (() => {
        const cell = battle.map[hoverCell.row]?.[hoverCell.col];
        if (!cell || cell.terrain === 'normal') return null;
        const terrainDesc: Record<string, string> = {
          spring: '停留至下回合开始时生效，气血+1',
          atk_boost: '停留至下回合开始时生效，修为+1',
          mnd_boost: '停留至下回合开始时生效，心境+1',
          miasma: '停留至下回合开始时生效，气血-1',
          obstacle: '空间裂缝 — 不可通行',
        };
        const desc = terrainDesc[cell.terrain];
        if (!desc) return null;
        // 用 stage 坐标系：把屏幕坐标 rect 换算到 1920x1080 基准画布
        // stage 已 transform:scale(scale) + 居中偏移，需要反向换算
        const stage = document.querySelector('.app-stage') as HTMLElement | null;
        const sRect = stage?.getBoundingClientRect();
        const scale = sRect && sRect.width > 0 ? sRect.width / 1920 : 1;
        const offsetX = sRect ? sRect.left : 0;
        const offsetY = sRect ? sRect.top : 0;
        const r = hoverCell.rect;
        // 将屏幕坐标转换回 stage 内坐标
        const cx = (r.left + r.width / 2 - offsetX) / scale;
        const topY = (r.top - offsetY) / scale;
        const bottomY = (r.top + r.height - offsetY) / scale;
        const preferTop = topY > 100;
        const y = preferTop ? topY - 10 : bottomY + 10;
        return (
          <div
            className={styles.cellTooltipFloat}
            style={{
              left: cx,
              top: y,
              transform: preferTop
                ? 'translate(-50%, -100%)'
                : 'translate(-50%, 0)',
            }}
          >
            {desc}
          </div>
        );
      })()}

      {/* 结算 */}
      <AnimatePresence>
        {showResult && (
          <ResultPanel killCount={battle.killCount} onContinue={handleContinue} />
        )}
      </AnimatePresence>
    </div>
  );
};

/**
 * S7B_Battle — 宗门比武（玩家 vs 带技能AI）
 * 6×5地图，玩家主角+1副卡 vs AI主角+1副卡
 * 一方全灭即胜，20回合未分胜负则平局
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { asset } from '@/utils/assetPath';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { BackButton } from '@/components/BackButton';
import { MusicToggle } from '@/components/MusicToggle';
import { CommonHud } from '@/components/CommonHud';
import { useS7BBattleStore, isCounter, MAP_ROWS, MAP_COLS } from '@/stores/s7bBattleStore';
import type { BattleUnit, DiceResult } from '@/stores/s7bBattleStore';
import { useGameStore, SaveSystem } from '@/stores/gameStore';
import { getHeroById } from '@/hooks/useConfig';
import { getPoolCardById } from '@/systems/recruit/cardPoolLoader';
import { getCachedImage } from '@/utils/imageCache';
import { sortCardsForDisplay } from '@/utils/cardDisplayOrder';
import { TYPE_CHAR } from '@/data/heroConstants';
import type { HeroId, CultivationType } from '@/types/game';
import { HEROES_DATA } from '@/data/heroesData';
import { runAiTurns } from '@/utils/s7bAI';
import { getSkillDef } from '@/data/skills_s7b';
import { SkillRegistry } from '@/systems/battle/skillRegistry';
import {
  checkSkillCastability,
  hasAdjacentEnemyOf,
  hasAnyLivingEnemyOf,
} from '@/systems/battle/skillCastability';
import styles from './S7_Battle.module.css';

/* ======== 地图格子尺寸常量 ======== */
const CELL_SIZE = 192; // 190px格子 + 2px gap（放大至1.5倍）
const UNIT_OFFSET = 20; // 单位在格子内的边距 (150 单位居中于 190 格子)

/* ======== 技能可发动判定（统一委托给 skillCastability 工具）======== */
type SkillCheckResult = {
  hasCharges: boolean;
  interactable: boolean;
  isPassive: boolean;
  reason?: string;
};

function getSkillCheck(
  unit: BattleUnit,
  skillType: 'battle' | 'ultimate',
  allUnits: BattleUnit[],
  skillUsedThisTurn: boolean,
): SkillCheckResult {
  return checkSkillCastability(unit, skillType, {
    skillUsedThisTurn,
    allUnits: allUnits as any,
    hasAdjacentEnemy: hasAdjacentEnemyOf(unit, allUnits),
    hasAnyEnemy: hasAnyLivingEnemyOf(unit, allUnits),
  });
}

/* ======== 技能可发动判定：已迁移到 @/systems/battle/skillCastability ======== */

/** 阶段 D · 按单位的 ultimate.name 反查 SkillRegistry 的技能 id。
 *  返回 null 表示该绝技未在新引擎中登记（仍可被 performUltimate 兜底处理）。 */
function findUltimateRegistryId(unit: BattleUnit): string | null {
  if (!unit.ultimate) return null;
  const id = SkillRegistry.findIdByName(unit.ultimate.name);
  if (!id) return null;
  const reg = SkillRegistry.get(id);
  return reg?.isActive ? id : null;
}

/** 瞄准态交互提示文案（P2：可根据候选集推断目标归属） */
function describeSelectorHint(
  kind: string,
  info?: { candidateIds?: string[]; units?: Array<{ id: string; isEnemy: boolean }>; casterId?: string },
): string {
  // P2：如果 candidateIds 存在，优先根据归属推断精确提示
  if (info?.candidateIds && info.units && info.casterId) {
    const caster = info.units.find((u) => u.id === info.casterId);
    if (caster) {
      const cands = info.candidateIds
        .map((id) => info.units!.find((u) => u.id === id))
        .filter(Boolean) as Array<{ id: string; isEnemy: boolean }>;
      const casterSide = caster.isEnemy;
      const allFriendly = cands.every((c) => c.isEnemy === casterSide);
      const allHostile = cands.every((c) => c.isEnemy !== casterSide);
      if (allFriendly && cands.length > 0) return '点击任意友军单位为目标';
      if (allHostile && cands.length > 0) return '点击任意敌方单位为目标';
    }
  }
  switch (kind) {
    case 'single_any_enemy':      return '点击任意敌方单位为目标';
    case 'single_line_enemy':     return '点击同行或同列的敌方单位为目标';
    case 'single_adjacent_enemy': return '点击相邻（上下左右）的敌方单位为目标';
    case 'single_any_character':  return '点击目标单位';
    case 'position_pick':         return '点击棋盘任意空格子放置障碍';
    default:                       return '点击目标';
  }
}

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
  partnerCount,
  title,
  subtitle,
  onConfirm,
}: {
  options: PartnerOption[];
  partnerCount: number;
  title: string;
  subtitle: string;
  onConfirm: (partnerIds: string[]) => void;
}) {
  const [chosen, setChosen] = useState<string[]>([]);

  const toggle = (id: string) => {
    setChosen((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= partnerCount) return prev; // 达到上限不再添加
      return [...prev, id];
    });
  };

  const ready = chosen.length === partnerCount;

  return (
    <div className={styles.selectOverlay}>
      <motion.div
        className={styles.selectPanel}
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
      >
        <div className={styles.selectTitle}>{title}</div>
        <div className={styles.selectSub}>{subtitle}</div>
        <div className={styles.selectGrid}>
          {options.map((o) => {
            const idx = chosen.indexOf(o.id);
            const isChosen = idx !== -1;
            return (
              <div
                key={o.id}
                className={`${styles.selectCard} ${isChosen ? styles.selectCardChosen : ''}`}
                onClick={() => toggle(o.id)}
              >
                {isChosen && partnerCount > 1 && (
                  <div
                    style={{
                      position: 'absolute',
                      top: 8,
                      right: 8,
                      width: 28,
                      height: 28,
                      borderRadius: '50%',
                      background: '#c08040',
                      color: '#1a1412',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 14,
                      fontWeight: 700,
                      zIndex: 2,
                    }}
                  >
                    {idx + 1}
                  </div>
                )}
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
            );
          })}
        </div>
        {options.length === 0 && (
          <div style={{ textAlign: 'center', color: '#a09878', padding: 20 }}>
            暂无可选搭档（N/R卡无战斗技能，但可作为纯数值棋子上阵）
          </div>
        )}
        {options.length < partnerCount && options.length > 0 && (
          <div style={{ textAlign: 'center', color: '#d89050', padding: '8px 0', fontSize: 14 }}>
            ⚠ 可选搭档不足 {partnerCount} 名，请先通过招募获取更多道友
          </div>
        )}
        <div style={{ textAlign: 'center', color: '#a8a090', fontSize: 13, marginTop: 6 }}>
          已选：{chosen.length} / {partnerCount}
        </div>
        <button
          className={styles.selectConfirm}
          disabled={!ready}
          onClick={() => ready && onConfirm(chosen)}
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
          <p>宗门比武，一方全灭即胜
20 回合内未分胜负则判为平局</p>
        </div>
        <div className={styles.ruleSec}>
          <h4>🎲 攻击判定</h4>
          <p>双方同时投掷骰子（数量=修为值，每颗0/1/2）
伤害 = 我方点数和 − 敌方点数和 + 技能修正 + 克制加伤（最少1点）</p>
        </div>
        <div className={styles.ruleSec}>
          <h4>🚶 移动</h4>
          <p>心境值 = 移动距离（格数）
攻击距离 = 固定相邻1格（上下左右）</p>
        </div>
        <div className={styles.ruleSec}>
          <h4>⚔ 行动轮流程</h4>
          <p>技能（可选）→ 移动（可选）→ 攻击（可选）→ 行动轮结束
一旦执行攻击，该角色的行动轮立即结束</p>
        </div>
        <div className={styles.ruleSec}>
          <h4>⚡ 克制关系</h4>
          <p>剑修→妖修→体修→灵修→法修→剑修（丹修中立）
克制时攻击方判定结果+1</p>
        </div>
        <div className={styles.ruleSec}>
          <h4>🤖 AI 对手行为</h4>
          <p>AI 对手按照心境值降序与我方轮流行动
AI 会主动推进、使用技能、选择最佳攻击目标（档位1规则式AI）</p>
        </div>
        <div className={styles.ruleSec}>
          <h4>💧 地形效果</h4>
          <p>灵泉💧：停留至下回合生效，气血+1
灵脉节点⚔：停留至下回合生效，修为+1（上限15）
悟道石台🧘：停留至下回合生效，心境+1（上限5）
魔气侵蚀☠：踏入立即各属性-1，停留每回合额外扣1气血
空间裂缝⬛：不可通行
※ 增益地形需停留至下回合才生效，路过不蹭增益</p>
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

function ResultPanel({
  battleResult,
  killCount,
  mode,
  match,
  rewardStones,
  onContinue,
}: {
  battleResult: 'win' | 'lose' | 'draw' | null;
  killCount: number;
  mode: 'test' | 'sect';
  match: 1 | 2;
  rewardStones: number;
  onContinue: () => void;
}) {
  const isSect = mode === 'sect';
  const isFinalWin = isSect && match === 2 && battleResult === 'win';
  const isFirstWin = isSect && match === 1 && battleResult === 'win';

  const title =
    battleResult === 'win'
      ? (isSect ? (match === 1 ? '🏆 宗门大比 · 首场告捷！' : '🏆 宗门大比 · 决胜夺魁！') : '🏆 宗门比武 · 胜利！')
      : battleResult === 'lose'
      ? (isSect ? '💀 宗门大比 · 折戟而归' : '💀 宗门比武 · 失败')
      : (isSect ? '⚖ 宗门大比 · 握手言和' : '⚖ 宗门比武 · 平局');

  const subText =
    battleResult === 'win'
      ? (isFinalWin
          ? '两场大比连胜，宗门高层刮目相看！'
          : (isFirstWin ? '首场胜利，正赛仍需再接再厉。' : '敌方全员倒下，恭喜取得胜利！'))
      : battleResult === 'lose'
      ? '我方全员倒下，挑战失败...'
      : '20 回合内未分胜负。';

  const btnText =
    isSect && battleResult === 'win'
      ? (match === 1 ? '迎战第二场（3v3）' : '领取奖励 · 进入精英招募')
      : isSect
      ? '返回主菜单'
      : '返回主菜单';

  return (
    <div className={styles.resultOverlay}>
      <motion.div
        className={styles.resultPanel}
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
      >
        <div className={styles.resultTitle}>{title}</div>
        <div className={styles.resultRow}>{subText}</div>
        <div className={styles.resultRow}>
          击败敌方：<strong>{killCount}</strong> 人
        </div>
        {isSect && battleResult === 'win' && rewardStones > 0 && (
          <div
            className={styles.resultRow}
            style={{
              marginTop: 12,
              padding: '12px 16px',
              border: '1px solid #c08040',
              background: 'rgba(192,128,64,0.12)',
              borderRadius: 8,
              fontSize: 18,
            }}
          >
            💎 本场奖励：<strong style={{ color: '#ffd98a' }}>+{rewardStones}</strong> 灵石
          </div>
        )}
        <button className={styles.resultBtn} onClick={onContinue}>
          {btnText}
        </button>
      </motion.div>
    </div>
  );
}

/* ======== 主组件 ======== */

export const S7B_Battle: React.FC = () => {
  const navigate = useNavigate();
  const heroId = useGameStore((s) => s.heroId);
  const heroName = useGameStore((s) => s.heroName);
  const ownedCardIds = useGameStore((s) => s.ownedCardIds);
  const cardBonuses = useGameStore((s) => s.cardBonuses);
  const battleBonus = useGameStore((s) => s.battleBonus);
  const knowledgeBonus = useGameStore((s) => s.knowledgeBonus);
  const setHero = useGameStore((s) => s.setHero);
  const addCard = useGameStore((s) => s.addCard);
  const addSpiritStones = useGameStore((s) => s.addSpiritStones);
  const markPhaseDone = useGameStore((s) => s.markPhaseDone);

  // ====== URL 参数解析：区分「单机测试 / 宗门大比」以及「第一场 2v2 / 第二场 3v3」 ======
  // 统一从 hash query 读取，兼容 HashRouter 场景
  // 为规避部分工具对 '&' 的限制，sect 模式额外支持简写：?sect1 / ?sect2
  // 订阅 hashchange，以便同一组件内切换 match 时重新解析参数
  const [hashStr, setHashStr] = useState(() => window.location.hash);
  useEffect(() => {
    const onHashChange = () => setHashStr(window.location.hash);
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);
  const urlParams = useMemo(() => {
    const qs = new URLSearchParams(hashStr.split('?')[1] || '');
    // 简写：?sect1 → mode=sect, match=1；?sect2 → mode=sect, match=2
    const isSectShort1 = qs.has('sect1');
    const isSectShort2 = qs.has('sect2');
    const modeParam = qs.get('mode');
    const matchParam = qs.get('match');
    const isSect = isSectShort1 || isSectShort2 || modeParam === 'sect';
    const match: 1 | 2 = isSectShort2 ? 2 : isSectShort1 ? 1 : (matchParam === '2' ? 2 : 1);
    return {
      isTest: modeParam === 'test',
      isSect,
      match,
    } as const;
  }, [hashStr]);
  const battleMode: 'test' | 'sect' = urlParams.isSect ? 'sect' : 'test';
  const matchNo: 1 | 2 = urlParams.match;
  /** 我方副卡需要数量（第一场2v2→1，第二场3v3→2；非宗门模式默认1） */
  const partnerCount = urlParams.isSect ? (matchNo === 2 ? 2 : 1) : 1;
  /** 每场比武的灵石奖励 */
  const sectReward = matchNo === 1 ? 10 : 20;

  // ====== 测试门：URL包含?mode=test或?mode=sect且无heroId，自动注入默认阵容 ======
  useEffect(() => {
    if ((urlParams.isTest || urlParams.isSect) && !heroId) {
      // 默认主角：塘散
      setHero('hero_tangsan' as HeroId, '塘散');
      // 默认拥有的其他主角卡（供阵容选择作为副卡候选）
      ['hero_xiaowu', 'hero_xiaoyan', 'hero_wanglin', 'hero_hanli', 'hero_xuner'].forEach((id) => addCard(id));
    }
  }, [heroId, setHero, addCard, urlParams.isTest, urlParams.isSect]);

  const battle = useS7BBattleStore();
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
  // 敌方技能描述揭示集合 —— AI 释放技能时通过 onUseSkill 回调写入
  // 一经揭示则永久可见（同场战斗内）
  const [revealedEnemySkills, setRevealedEnemySkills] = useState<Set<string>>(() => new Set());

  /* === 阶段 D · 绝技瞄准态（方案 A） === */
  // ultimateTargeting !== null 时，玩家正在给绝技选目标
  //   - kind：目标选择器种类，决定哪些格子高亮
  //   - casterId：施法者（从 state 快照）
  //   - candidateIds：合法目标 id 集合（precheck 返回）
  //   - regSkillId：注册表技能 id（用于描述/面板）
  const [ultimateTargeting, setUltimateTargeting] = useState<{
    kind:
      | 'single_any_enemy'
      | 'single_line_enemy'
      | 'single_adjacent_enemy'
      | 'single_any_character'
      | 'self_only'
      | 'position_pick';
    casterId: string;
    candidateIds: string[];
    regSkillId: string;
  } | null>(null);

  // ====== 敌方技能揭示订阅 ======
  // 监听 battle.lastSkillEvent：任何单位（不只AI）一旦释放技能就写入揭示集合，
  // 但面板在渲染时仅对"敌方单位"使用该集合 —— 我方单位不需要遮蔽。
  useEffect(() => {
    const evt = battle.lastSkillEvent;
    if (!evt) return;
    const unit = battle.units.find((u) => u.id === evt.unitId);
    if (!unit || !unit.isEnemy) return;
    const key = `${evt.unitId}_${evt.skillType}`;
    setRevealedEnemySkills((prev) => {
      if (prev.has(key)) return prev;
      const next = new Set(prev);
      next.add(key);
      return next;
    });
  }, [battle.lastSkillEvent, battle.units]);

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
        // 非主角卡（R/N/SR/SSR）—— 从 poolCard 读取战斗技能与绝技
        const poolCard = getPoolCardById(id);
        if (poolCard) {
          return {
            id: poolCard.id,
            name: poolCard.name,
            type: poolCard.type as CultivationType,
            hp: poolCard.hp + bonus.hp,
            atk: poolCard.atk + bonus.atk,
            mnd: poolCard.mnd + bonus.mnd,
            battleSkill: poolCard.battleSkill
              ? { name: poolCard.battleSkill.name, desc: poolCard.battleSkill.desc }
              : null,
            ultimate: poolCard.ultimate
              ? { name: poolCard.ultimate.name, desc: poolCard.ultimate.desc }
              : null,
            portrait: getCachedImage(poolCard.id),
          };
        }
        return null;
      })
      .filter(Boolean) as PartnerOption[];
  }, [heroId, ownedCardIds, cardBonuses]);

  // 确认搭档 → 初始化战斗（S7B/S7C：生成玩家阵容 + AI敌方阵容）
  const handleConfirmPartner = useCallback(
    (partnerIds: string[]) => {
      if (!hero) return;
      const bonus = cardBonuses[heroId!] ?? { hp: 0, atk: 0, mnd: 0, realmUps: 0 };
      const bc = hero.battle_card;

      // MVP 技能 ID 映射
      const SKILL_ID_MAP: Record<string, string> = {
        '蓝银囚笼': 'skill_blueSilverCage',
        '焚决·噬焰': 'skill_devourFlame',
        '邪灵诀·夺命': 'skill_lifeSteal',
      };

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
        skillId: bc.skills.battle_skill ? SKILL_ID_MAP[bc.skills.battle_skill.name] : undefined,
      };

      // === 玩家副卡单元：按 partnerIds 顺序全部生成 ===
      const partnerUnits = partnerIds.map((pid, idx) => {
        const partner = partnerOptions.find((o) => o.id === pid)!;
        return {
          id: partner.id,
          name: partner.name,
          type: partner.type,
          hp: partner.hp,
          maxHp: partner.hp,
          atk: partner.atk,
          mnd: partner.mnd,
          isEnemy: false,
          row: idx + 1, // 主角在row0，副卡顺次排在后方
          col: 0,
          battleSkill: partner.battleSkill,
          ultimate: partner.ultimate,
          portrait: partner.portrait,
          skillId: partner.battleSkill ? SKILL_ID_MAP[partner.battleSkill.name] : undefined,
        };
      });

      const playerUnits = [heroUnit, ...partnerUnits];
      /** AI 阵容需要的总人数（= 玩家阵容数，双方对等） */
      const aiUnitCount = playerUnits.length;

      // === AI 敌方阵容：从主角池随机挑选 aiUnitCount 个非玩家主角 ===
      const otherHeroes = HEROES_DATA.filter((h) => h.id !== hero.id);
      const shuffled = [...otherHeroes].sort(() => Math.random() - 0.5);

      const makeAiUnit = (h: typeof otherHeroes[0], idx: number) => {
        const bsc = h.battle_card;
        return {
          id: `ai_${h.id}_${idx}`,
          name: h.name,
          type: h.type,
          hp: bsc.hp,
          maxHp: bsc.hp,
          atk: bsc.atk,
          mnd: bsc.mnd,
          isEnemy: true,
          row: 0,
          col: 0,
          battleSkill: bsc.skills.battle_skill ? { name: bsc.skills.battle_skill.name, desc: bsc.skills.battle_skill.desc } : null,
          ultimate: bsc.skills.ultimate ? { name: bsc.skills.ultimate.name, desc: bsc.skills.ultimate.desc } : null,
          portrait: getCachedImage(h.id),
          skillId: bsc.skills.battle_skill ? SKILL_ID_MAP[bsc.skills.battle_skill.name] : undefined,
        };
      };

      const aiUnits = shuffled
        .slice(0, aiUnitCount)
        .map((h, i) => makeAiUnit(h, i));

      battle.initBattle(playerUnits, aiUnits);
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

  // ====== 当前"轮到行动"的任意一方角色（按心境降序、未行动、存活） ======
  const currentActorId = useMemo(() => {
    for (const id of battle.actionQueue) {
      const u = battle.units.find((x) => x.id === id);
      if (u && !u.acted && !u.dead) return id;
    }
    return null;
  }, [battle.actionQueue, battle.units]);
  const currentActor = useMemo(
    () => battle.units.find((u) => u.id === currentActorId) || null,
    [battle.units, currentActorId],
  );
  /** 只有当当前行动者是玩家方时，UI 才允许玩家选择单位 */
  const currentPlayerActorId = useMemo(
    () => (currentActor && !currentActor.isEnemy ? currentActor.id : null),
    [currentActor],
  );

  // ====== AI 驱动：当当前行动方为 AI 时，自动触发 AI 行动 ======
  useEffect(() => {
    if (battle.battleOver) return;
    if (showSelect) return;
    if (!currentActor) return;
    if (!currentActor.isEnemy) return;
    // AI 回合 —— 异步执行所有连续 AI 单位
    const timeout = setTimeout(() => {
      runAiTurns();
    }, 300);
    return () => clearTimeout(timeout);
  }, [currentActor?.id, currentActor?.isEnemy, battle.battleOver, showSelect]);

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
      if (r < 0 || r >= MAP_ROWS || c < 0 || c >= MAP_COLS) return false;
      if (battle.map[r][c].terrain === 'obstacle') return false;
      // 其他存活单位占位（自身除外）
      if (battle.units.some((u) => !u.dead && u.id !== selectedUnit.id && u.row === r && u.col === c)) return false;
      return true;
    };

    // 用 BFS 算出每格的最短步数
    const dist: number[][] = Array.from({ length: MAP_ROWS }, () => Array(MAP_COLS).fill(Infinity));
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
        if (nr < 0 || nr >= MAP_ROWS || nc < 0 || nc >= MAP_COLS) continue;
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

  /* ──────────── 阶段 D · 瞄准态：确认目标 & 取消 ──────────── */
  // 注意：定义提前于 handleCellClick / handleSelectUnit，因为后两者要调用
  const handleUltimateAim = useCallback(
    (targetId: string) => {
      const cur = ultimateTargeting;
      if (!cur) return;
      if (!cur.candidateIds.includes(targetId)) {
        battle.addLog('⚠️ 非法目标：不在技能可选择范围内', 'system');
        return;
      }
      const ok = battle.performUltimate(cur.casterId, [targetId]);
      setUltimateTargeting(null);
      if (ok) {
        setTimeout(() => {
          useS7BBattleStore.getState().calcMoveRange(cur.casterId);
          useS7BBattleStore.getState().calcAttackRange(cur.casterId);
        }, 0);
      }
    },
    [ultimateTargeting, battle],
  );

  const handleCancelAim = useCallback(() => {
    if (!ultimateTargeting) return;
    battle.addLog('🎯 取消目标选择', 'system');
    setUltimateTargeting(null);
  }, [ultimateTargeting, battle]);

  // 键盘 ESC 取消瞄准
  useEffect(() => {
    if (!ultimateTargeting) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleCancelAim();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ultimateTargeting, handleCancelAim]);

  // 点击格子
  const handleCellClick = useCallback(
    (row: number, col: number) => {
      if (isDragging()) return; // 拖动中不触发点击
      if (!selectedUnit || battle.battleOver) return;
      if (movingPath) return; // 正在移动动画中

      /* ──────────── D2 · 绝技瞄准态拦截 ──────────── */
      // 瞄准态下：点击格子 = 尝试锁定格子上的单位为目标；position_pick 则点空格子
      if (ultimateTargeting) {
        // position_pick 模式：点击空格子（非障碍、无存活单位）即 commit
        if (ultimateTargeting.kind === 'position_pick') {
          const cell = battle.map[row]?.[col];
          const occupied = battle.units.some(
            (u) => !u.dead && u.row === row && u.col === col,
          );
          if (!cell) {
            battle.addLog('⚠️ 越界格子', 'system');
            return;
          }
          if (cell.terrain === 'obstacle') {
            battle.addLog('⚠️ 该位置已是阻碍物，请选择空格', 'system');
            return;
          }
          if (occupied) {
            battle.addLog('⚠️ 该位置已有角色，请选择空格', 'system');
            return;
          }
          const casterId = ultimateTargeting.casterId;
          const ok = battle.performUltimate(casterId, [], { row, col });
          setUltimateTargeting(null);
          if (ok) {
            setTimeout(() => {
              useS7BBattleStore.getState().calcMoveRange(casterId);
              useS7BBattleStore.getState().calcAttackRange(casterId);
            }, 0);
          }
          return;
        }
        // 默认（单位选择）模式
        const target = battle.units.find(
          (u) => !u.dead && u.row === row && u.col === col,
        );
        if (target) handleUltimateAim(target.id);
        // 点击空格子不取消（右键或 ESC 才取消）
        return;
      }

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
            useS7BBattleStore.getState().calcMoveRange(selectedUnit.id);
            useS7BBattleStore.getState().calcAttackRange(selectedUnit.id);
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
            useS7BBattleStore.getState().calcMoveRange(selectedUnit.id);
            useS7BBattleStore.getState().calcAttackRange(selectedUnit.id);
            return;
          }
          const step = path[i];
          useS7BBattleStore.getState().moveUnitStep(selectedUnit.id, step.row, step.col);
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
          const updatedUnits = useS7BBattleStore.getState().units.map((u) =>
            u.id === selectedUnit.id ? { ...u, attackedThisTurn: true } : u,
          );
          useS7BBattleStore.setState({ units: updatedUnits });
          setShowDice(true);
          return;
        }
      }
    },
    [selectedUnit, battle, canMove, canAttack, pendingSkillMod, isDragging, hoverPath, movingPath, ultimateTargeting, handleUltimateAim],
  );

  // 选择单位
  const handleSelectUnit = useCallback(
    (unitId: string) => {
      if (isDragging()) return; // 拖动中不触发点击
      if (battle.battleOver) return;
      if (movingPath) return; // 移动动画中

      /* ──────────── D2 · 绝技瞄准态拦截 ──────────── */
      // 瞄准态下点击任何单位（含敌方）→ 当作目标确认
      if (ultimateTargeting) {
        handleUltimateAim(unitId);
        return;
      }

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
    [battle, isDragging, currentActorId, movingPath, ultimateTargeting, handleUltimateAim],
  );

  // 使用技能（普通战斗技能 或 绝技）
  // 关键：技能/绝技均【不结束回合】，玩家仍可继续移动/进行普通攻击
  //
  // 阶段 D 改造：
  //   - 战斗技（battle）：走老 useSkill 路径（攻击附加，MVP 三技能 + 文案解析兜底）
  //   - 绝技（ultimate）：走新 performUltimate 路径（新引擎实装的 11+ 条主动绝技）
  //     · 无需选目标的 selector（all_enemies / all_allies_incl_self / cross_adjacent_enemies /
  //       all_adjacent_enemies）→ 直接施放
  //     · 需要选目标的 selector（single_any_enemy / single_line_enemy / single_any_character）
  //       → 进入瞄准态 UI
  //     · 未登记到注册表的绝技 → 走 performUltimate 的兜底分支（只标记 ultimateUsed）
  const handleUseSkill = useCallback(
    (type: 'battle' | 'ultimate') => {
      if (!selectedUnit) return;
      // 攻击完就锁死了，不允许再放技能
      if (selectedUnit.attackedThisTurn) return;

      /* ──────────── 绝技分支（D2 新路径） ──────────── */
      if (type === 'ultimate') {
        const pre = battle.ultimatePrecheck(selectedUnit.id);
        if (!pre.ok) {
          battle.addLog(`⚠️ ${pre.reason ?? '绝技发动失败'}`, 'skill');
          return;
        }
        // 查 registry 获取 targetSelector
        const regId = findUltimateRegistryId(selectedUnit);
        const reg = regId ? SkillRegistry.get(regId) : undefined;
        const selectorKind = reg?.targetSelector?.kind;

        // 需要玩家选目标的类型 → 进入瞄准态
        const NEEDS_TARGET: Record<string, boolean> = {
          single_any_enemy: true,
          single_line_enemy: true,
          single_adjacent_enemy: true,
          single_any_character: true,
          position_pick: true,
        };
        if (selectorKind && NEEDS_TARGET[selectorKind]) {
          // precheck.candidateIds 已是合法目标（技能自己过滤过）
          setUltimateTargeting({
            kind: selectorKind as any,
            casterId: selectedUnit.id,
            candidateIds: pre.candidateIds ?? [],
            regSkillId: regId!,
          });
          const hintText = describeSelectorHint(selectorKind, {
            candidateIds: pre.candidateIds ?? [],
            units: battle.units,
            casterId: selectedUnit.id,
          });
          battle.addLog(
            `🎯 【${selectedUnit.ultimate?.name}】进入目标选择（${hintText}），按 ESC 或右键取消`,
            'system',
          );
          return;
        }

        // 无需选目标（AOE / 自动全场）→ 直接施放
        const ok = battle.performUltimate(selectedUnit.id, []);
        if (!ok) return;
        // UI 刷新
        setTimeout(() => {
          useS7BBattleStore.getState().calcMoveRange(selectedUnit.id);
          useS7BBattleStore.getState().calcAttackRange(selectedUnit.id);
        }, 0);
        return;
      }

      /* ──────────── 战斗技分支（保留老 useSkill 路径） ──────────── */
      const result = battle.useSkill(selectedUnit.id, type);
      if (!result) return;

      // ① 基于技能元数据计算 pendingSkillMod 增量
      //    MVP 三技能 diceMod=0，未登记的未实装技能走"文案解析兜底"
      const def = getSkillDef(result.skillId ?? undefined);
      if (def) {
        if (def.diceMod !== 0) {
          setPendingSkillMod((prev) => prev + def.diceMod);
        }
        // diceMod === 0 时不加修正（蓝银/焚决/夺命都是 0）
      } else {
        // 未实装技能兜底：从描述里提取"额外投N颗骰子"；提取不到则不加
        // 进入此分支说明 type === 'battle'（绝技已在上方分支 return）
        const skill = selectedUnit.battleSkill;
        if (skill) {
          const match = skill.desc.match(/额外投(?:掷)?(\d+)颗骰子/);
          if (match) {
            setPendingSkillMod((prev) => prev + parseInt(match[1]));
          }
          // 否则不加修正 —— 不再粗暴默认 +2
        }
      }

      // 技能使用后不结束回合，也不消耗步数；仅重算一下移动/攻击范围以刷新UI
      setTimeout(() => {
        useS7BBattleStore.getState().calcMoveRange(selectedUnit.id);
        useS7BBattleStore.getState().calcAttackRange(selectedUnit.id);
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
      const updatedUnits = useS7BBattleStore.getState().units;
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
        const updatedUnits = useS7BBattleStore.getState().units;
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
    if (battleMode === 'sect') {
      // === 宗门大比模式 ===
      const win = battle.battleResult === 'win';
      if (win) {
        // 胜利 → 发灵石 & 推进流程
        addSpiritStones(sectReward);
        SaveSystem.save(1);
        if (matchNo === 1) {
          // 第一场胜利 → 继续打第二场 3v3
          navigate('/s7c?sect2');
        } else {
          // 第二场胜利 → 标记第四章phase完成 → 进入 S6c 精英招募
          markPhaseDone(4);
          SaveSystem.save(1);
          navigate('/s6r?pool=3');
        }
      } else {
        // 宗门大比失败/平局 → 允许重试当前场次
        SaveSystem.save(1);
        navigate(matchNo === 1 ? '/s7c?sect1' : '/s7c?sect2');
        // 强制刷新让 S7B 重新初始化
        setTimeout(() => window.location.reload(), 50);
      }
      return;
    }
    // S7B 单机测试：返回主菜单
    SaveSystem.save(1);
    navigate('/menu');
  }, [navigate, battleMode, matchNo, battle.battleResult, addSpiritStones, sectReward, markPhaseDone]);

  // === 渲染 ===

  // 选人面板文案：根据模式/场次定制
  const selectTitle =
    battleMode === 'sect'
      ? (matchNo === 1 ? '宗门大比 · 首场 2 v 2' : '宗门大比 · 次场 3 v 3')
      : '宗门比武 · 出战阵容';
  const selectSubtitle =
    battleMode === 'sect'
      ? (matchNo === 1
          ? `主角必须上阵，另外请选择 1 名搭档协同作战。对手将派出同等数量的精英应战。胜利可获得 ${sectReward} 灵石，胜负关系到宗门排位。`
          : `宗门正赛！主角必须上阵，另外请选择 2 名搭档组成 3 人战阵。对手同样派出三人精英队。胜利可获得 ${sectReward} 灵石并直接开启精英招募（SSR 暗爆！）`)
      : '对手 AI 将随机选择主角+副卡出战，双方平等对线。主角必须上阵，另外请选择 1 名搭档协同作战。一方全灭即胜，20 回合未分胜负则平局。';

  if (showSelect) {
    return (
      <div className={styles.screen}>
        <div className={styles.bgOverlay} />
        {/* sect 模式（宗门大比）下若跳 /story，会因第四章已读完再次自动跳回 S7C，形成循环。
            因此 sect 模式统一跳 /menu；测试/比武模式保留跳 /story 的原行为 */}
        <BackButton onClick={() => navigate(battleMode === 'sect' ? '/menu' : '/story')} />
        <SelectPartner
          options={partnerOptions}
          partnerCount={partnerCount}
          title={selectTitle}
          subtitle={selectSubtitle}
          onConfirm={handleConfirmPartner}
        />
      </div>
    );
  }

  return (
    <div className={styles.screen}>
      <div className={styles.bgOverlay} />
      {/* 4件套常驻控件：返回按钮 + 音乐切换 + 右下角 HUD（下方） */}
      {/* sect 模式（宗门大比）下退回会触发"剧情-战斗"死循环，统一跳 /menu */}
      <BackButton onClick={() => {
        if (battleMode === 'sect') navigate('/menu');
        else navigate(-1);
      }} />
      <MusicToggle />

      {/* 战斗规则按钮（S7 专用，紧贴返回按钮下方，风格统一） */}
      <button className={styles.ruleBtn} onClick={() => setShowRule(true)}>
        📖 战斗规则
      </button>

      {/* 顶部中间 HUD：回合 + 击杀数 + 行动中 */}
      <div className={styles.topHud}>
        <div className={styles.roundBadge}>
          第 {battle.round} / {battle.maxRound} 回合
        </div>
        <div className={styles.killBadge}>
          击败敌方 {battle.killCount} / {partnerCount + 1}
        </div>
        <div className={styles.turnInfo}>
          {currentActor
            ? (currentActor.isEnemy
                ? `🤖 AI · ${currentActor.name} 行动中`
                : (selectedUnit
                    ? `⚡ ${selectedUnit.name} 行动中 · 剩余${remainingSteps}步${selectedUnit.attackedThisTurn ? ' · 已攻击' : ''}`
                    : `⚡ 请选择 ${currentActor.name} 行动`))
            : '回合推进中...'}
        </div>
      </div>

      {/* 6×5 地图 */}
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
          style={{
            transform: 'translate3d(0,0,0) scale(1)',
            transformOrigin: '0 0',
            // 动态地图尺寸变量 —— 供 mapBgLayer / mapVignette / mapGrid 使用
            ['--map-rows' as any]: MAP_ROWS,
            ['--map-cols' as any]: MAP_COLS,
            ['--map-width' as any]: `${MAP_COLS * 190 + (MAP_COLS - 1) * 2}px`,
            ['--map-height' as any]: `${MAP_ROWS * 190 + (MAP_ROWS - 1) * 2}px`,
          }}
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
              // P2 · 位置选瞄准态：所有空格子高亮可选
              const isPositionPickAim =
                !!ultimateTargeting &&
                ultimateTargeting.kind === 'position_pick' &&
                cell.terrain !== 'obstacle' &&
                !battle.units.some((u) => !u.dead && u.row === r && u.col === c);

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
                isPositionPickAim ? styles.cellMovable : '',
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
            width={MAP_COLS * CELL_SIZE}
            height={MAP_ROWS * CELL_SIZE}
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

          // 敌方角色（带完整技能的主角，不同于 S7A 的劫匪）
          if (unit.isEnemy) {
            const isInAttackRange = canAttack && battle.attackRange.some((a) => a.row === unit.row && a.col === unit.col);
            // D2 · 瞄准态：此单位是否为合法目标
            const isAimTarget = !!ultimateTargeting && ultimateTargeting.candidateIds.includes(unit.id);
            return (
              <div
                key={unit.id}
                className={`${styles.unitEnemyTile} ${unit.dead ? styles.unitEnemyDying : ''} ${isInAttackRange ? styles.unitEnemyAttackable : ''} ${isAimTarget ? styles.unitAimTarget : ''}`}
                style={{
                  top: unit.row * CELL_SIZE + 4,
                  left: unit.col * CELL_SIZE + 4,
                }}
                onClick={() => {
                  if (ultimateTargeting) {
                    // 瞄准态下 → 任何点击交给 handleUltimateAim 校验
                    handleUltimateAim(unit.id);
                    return;
                  }
                  if (isInAttackRange && selectedUnit) {
                    handleCellClick(unit.row, unit.col);
                  }
                }}
                onContextMenu={(e) => {
                  if (ultimateTargeting) {
                    e.preventDefault();
                    handleCancelAim();
                  }
                }}
                onMouseEnter={() => {
                  // 悬停敌人即触发左下角看板显示（不受"是否在攻击范围内"限制）
                  setHoverUnitId(unit.id);
                }}
                onMouseLeave={() => {
                  setHoverUnitId((prev) => (prev === unit.id ? null : prev));
                }}
              >
                <div
                  className={styles.unitEnemyTileImg}
                  style={{ backgroundImage: `url(${unit.portrait})` }}
                />
                <div className={styles.unitEnemyName}>
                  {unit.awakened && <span style={{ color: '#ffd966', marginRight: 2 }}>⚡</span>}
                  {unit.name}
                </div>
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
                ultimateTargeting && ultimateTargeting.candidateIds.includes(unit.id) ? styles.unitAimTarget : '',
              ]
                .filter(Boolean)
                .join(' ')}
              style={{
                top: unit.row * CELL_SIZE + UNIT_OFFSET,
                left: unit.col * CELL_SIZE + UNIT_OFFSET,
              }}
              onClick={() => handleSelectUnit(unit.id)}
              onContextMenu={(e) => {
                if (ultimateTargeting) {
                  e.preventDefault();
                  handleCancelAim();
                }
              }}
              onMouseEnter={(e) => {
                setHoverUnitId(unit.id);
                setMousePos({ x: e.clientX, y: e.clientY });
              }}
              onMouseMove={(e) => setMousePos({ x: e.clientX, y: e.clientY })}
              onMouseLeave={() => setHoverUnitId((prev) => (prev === unit.id ? null : prev))}
            >
              <div className={styles.unitName}>
                {unit.awakened && <span style={{ color: '#ffd966', marginRight: 2 }}>⚡</span>}
                {unit.name}
              </div>
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
        // 当前行动角色 → 展示技能名+使用次数绿灯（新语义：hasCharges=剩余次数）
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

      {/* 左下角选中/悬停角色信息
          显示优先级：
          1. 若"已选中我方" + "悬停的敌人在攻击范围内" → 保留显示我方（便于查看自己的技能/修为后再决定是否出击）
          2. 否则 hover 优先（可预览任何角色，包括未选中时悬停敌人）
          3. 都没有则回落到 selectedUnit */}
      {(() => {
        const hoveredUnit = hoverUnitId ? battle.units.find((x) => x.id === hoverUnitId && !x.dead) : null;
        // 判定 hover 目标是否处于"我方 selectedUnit 的可攻击范围内"
        const hoveredIsAttackableEnemy =
          !!hoveredUnit && !!selectedUnit && hoveredUnit.isEnemy &&
          battle.attackRange.some((a) => a.row === hoveredUnit.row && a.col === hoveredUnit.col);
        // 核心决策：要"瞄准攻击"时，看板锁定在我方
        const displayUnit = hoveredIsAttackableEnemy
          ? selectedUnit
          : (hoveredUnit || selectedUnit);
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
          {/* 技能（非被动技 → 渲染按钮；被动技 → 不渲染，靠左下角信息面板提示） */}
          {selectedUnit.battleSkill && (() => {
            const chk = getSkillCheck(selectedUnit, 'battle', battle.units, battle.skillUsedThisTurn);
            if (chk.isPassive) return null; // 被动技不渲染按钮
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
      <CommonHud chapter={4} />

      {/* 阶段 D · 绝技瞄准提示条 */}
      {ultimateTargeting && (() => {
        const caster = battle.units.find((x) => x.id === ultimateTargeting.casterId);
        const skillName = caster?.ultimate?.name ?? '绝技';
        const hint = describeSelectorHint(ultimateTargeting.kind, {
          candidateIds: ultimateTargeting.candidateIds,
          units: battle.units,
          casterId: ultimateTargeting.casterId,
        });
        return (
          <div className={styles.aimBar}>
            <span>🎯 【{skillName}】· {hint}</span>
            <span style={{ fontSize: 12, opacity: 0.8 }}>
              合法目标 {ultimateTargeting.candidateIds.length} 个｜ESC 或右键取消
            </span>
            <button className={styles.aimBarCancel} onClick={handleCancelAim}>取消</button>
          </div>
        );
      })()}
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
          <ResultPanel
            battleResult={battle.battleResult}
            killCount={battle.killCount}
            mode={battleMode}
            match={matchNo}
            rewardStones={sectReward}
            onContinue={handleContinue}
          />
        )}
      </AnimatePresence>
    </div>
  );
};

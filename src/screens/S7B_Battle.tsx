/**
 * S7B_Battle — 宗门比武（玩家 vs 带技能AI）
 * 6×5地图，玩家主角+1副卡 vs AI主角+1副卡
 * 一方全灭即胜，20回合未分胜负则平局
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { asset } from '@/utils/assetPath';
import { useNavigate, useLocation } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { BackButton } from '@/components/BackButton';
import { useReturnToMenu } from '@/hooks/useReturnToMenu';
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
import { effectiveStat, resolveStatSet } from '@/systems/battle/e2Helpers';
import { TurnStartChoiceModal } from '@/components/battle/TurnStartChoiceModal';
import { ReviveAllocateModal } from '@/components/battle/ReviveAllocateModal';
import { XiulianAmountModal, type XiulianPendingInfo } from '@/components/battle/XiulianAmountModal';
import { encodeXiulianTargets } from '@/systems/battle/skills/situnan_xiulian';
import { UltimateCastOverlay } from '@/components/battle/UltimateCastOverlay';
import { useUltimateCastOverlay } from '@/hooks/useUltimateCastOverlay';
import { getEffectiveHeroStats, getEffectiveCardStats } from '@/utils/heroStats';
import { getAiTargetRealmUps } from '@/data/aiProgression';
import styles from './S7_Battle.module.css';

/**
 * 🔧 2026-05-11 修复：觉醒后 portrait 兼容 imageCache key
 *
 * 背景：awakeningEngine 写入 unit.portrait 时塞的是 imageCache 的 key
 *   （如 'hero_tangsan_awaken'），而非 URL。直接当 URL 用会触发 404，
 *   表现为"觉醒后头像消失"。
 *
 * 规则（与 S7D_Battle.tsx::resolvePortrait 保持一致）：
 *   - 空值 → 用 heroId 兜底走 imageCache
 *   - 'hero/...' 历史前缀 → 视为 key，走 imageCache 兜底
 *   - URL（http(s):/blob:/data:/绝对路径/./）→ 直传
 *   - 其他 → 视为 imageCache key
 */
function resolvePortraitUrl(raw: string | undefined, heroId?: string): string {
  const fallback = heroId ? getCachedImage(heroId) : '';
  if (!raw) return fallback;
  if (raw.startsWith('hero/')) return fallback || raw;
  if (/^(https?:|blob:|data:|\/|\.)/.test(raw)) return raw;
  return getCachedImage(raw) || fallback || raw;
}

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
    case 'single_any_ally':       return '点击任意己方单位（含自身）为目标';
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
          <p>宗门比武，一方全灭即胜，20 回合内未分胜负判为平局</p>
        </div>
        <div className={styles.ruleSec}>
          <h4>⚔ 行动与移动</h4>
          <p>心境值=本回合可移动格数；攻击距离固定=相邻1格
攻击后行动轮立即结束；释放绝技不会立刻结束行动轮次</p>
        </div>
        <div className={styles.ruleSec}>
          <h4>⚡ 克制加伤</h4>
          <p>剑→妖→体→灵→法→剑（丹中立）；克制时攻击方判定+1</p>
        </div>
        <div className={styles.ruleSec}>
          <h4>🤖 AI 对手行为</h4>
          <p>AI 按心境值降序与我方轮流行动，会主动推进、释放技能、择优攻击</p>
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

interface ResultPanelProps {
  battleResult: 'win' | 'lose' | 'draw' | null;
  killCount: number;
  mode: 'test' | 'sect';
  match: 1 | 2;
  rewardStones: number;
  onContinue: () => void;
  onReturnMenu?: () => void;
}

function ResultPanel({
  battleResult,
  killCount,
  mode,
  match,
  rewardStones,
  onContinue,
  onReturnMenu,
}: ResultPanelProps) {
  const isSect = mode === 'sect';
  const isFinalWin = isSect && match === 2 && battleResult === 'win';
  const isFirstWin = isSect && match === 1 && battleResult === 'win';

  const title =
    battleResult === 'win'
      ? (isSect ? (match === 1 ? '🏆 宗门大比 · 首场告捷！' : '🏆 宗门大比 · 决胜夺魁！') : '🏆 宗门比武 · 胜利！')
      : battleResult === 'lose'
      ? (isSect ? `💀 宗门大比 · 第${match}场（${match === 1 ? '2v2' : '3v3'}）折戟而归` : '💀 宗门比武 · 失败')
      : (isSect ? `⚖ 宗门大比 · 第${match}场（${match === 1 ? '2v2' : '3v3'}）握手言和` : '⚖ 宗门比武 · 平局');

  const subText =
    battleResult === 'win'
      ? (isFinalWin
          ? '两场大比连胜，宗门高层刮目相看！'
          : (isFirstWin ? '首场胜利，正赛仍需再接再厉。' : '敌方全员倒下，恭喜取得胜利！'))
      : battleResult === 'lose'
      ? (isSect
          ? (match === 1
              ? '我方全员倒下！虽败犹荣，灵石奖励减半，但仍可继续征战次场 3v3 决赛。'
              : '我方全员倒下！次场失利，灵石奖励减半，宗门排位将受影响。')
          : '我方全员倒下，挑战失败...')
      : (isSect
          ? (match === 1
              ? '20 回合未分胜负，平局得部分灵石，可继续进入次场 3v3 决赛。'
              : '20 回合未分胜负，平局得部分灵石，宗门排位居中。')
          : '20 回合内未分胜负。');

  // 宗门大比无论胜负都会推进流程
  const btnText =
    isSect
      ? (match === 1
          ? (battleResult === 'win' ? '迎战次场（3v3）' : '继续 · 次场 3v3')
          : '领取奖励 · 进入精英招募')
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
        {isSect && rewardStones > 0 && (
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
            {battleResult !== 'win' && (
              <span style={{ marginLeft: 8, fontSize: 13, color: '#bbb' }}>
                （{battleResult === 'lose' ? '败北减半' : '平局减半'}）
              </span>
            )}
          </div>
        )}
        <button className={styles.resultBtn} onClick={onContinue}>
          {btnText}
        </button>
        {/* 失败/平局：增加次级"返回主菜单"按钮，给玩家退出口 */}
        {battleResult !== 'win' && onReturnMenu && (
          <button
            className={styles.resultBtn}
            onClick={onReturnMenu}
            style={{
              marginTop: 8,
              background: 'linear-gradient(180deg, rgba(50,50,50,0.85), rgba(30,30,30,0.95))',
              borderColor: '#666',
              color: '#bbb',
              fontSize: 15,
              padding: '8px 18px',
            }}
          >
            返回主菜单（保留当前进度）
          </button>
        )}
      </motion.div>
    </div>
  );
}

/* ======== 主组件 ======== */

/**
 * UI 显示辅助：返回应用了 modifier 之后的 effective atk
 *   优先级：stat_set > base + Σ stat_delta
 *   覆盖：镜像肠·复制（stat_set）、千刃雪天使圣剑（stat_delta this_attack）、
 *         古元天火阵 / 凝荣荣七宝加持 / 远古斗帝血脉 等 aura/群体 buff
 *   2026-05-13：UI 显示一直读 unit.atk 原值，导致镜像肠/七宝加持等 modifier
 *   只在掷骰时生效但棋子上的"修X"数字纹丝不动 → UI/数据脱节。
 */
function uiAtk(u: { id: string; atk: number }): number {
  const set = resolveStatSet(u.id, 'atk');
  if (set !== null) return set;
  return effectiveStat(u.id, u.atk, 'atk');
}
function uiMnd(u: { id: string; mnd: number }): number {
  const set = resolveStatSet(u.id, 'mnd');
  if (set !== null) return set;
  return effectiveStat(u.id, u.mnd, 'mnd');
}

export const S7B_Battle: React.FC = () => {
  const navigate = useNavigate();
  const returnToMenu = useReturnToMenu();
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
  /** ★ 2026-05-10：读取 S6a/S6b 后保存的 AI 招募快照，用于生成对手阵容 */
  const aiRecruitState = useGameStore((s) => s.aiRecruitState);

  // ====== URL 参数解析：区分「单机测试 / 宗门大比」以及「第一场 2v2 / 第二场 3v3」 ======
  // ★ 2026-05-10：改用 react-router 的 useLocation() 订阅 url 变化。
  //   原方案用 window.addEventListener('hashchange') 监听 hash 变化，
  //   但 navigate('/s7c?sect2') 走的是 react-router 内部 history.pushState，
  //   不会触发原生 hashchange 事件 → urlParams 不会重算 → 仍以为是首场 2v2。
  //   useLocation 直接订阅 router 内部的 location，路径或 search 变化都会重渲染。
  const location = useLocation();
  const urlParams = useMemo(() => {
    // HashRouter 模式下，location.search 即 hash 后面 ? 后的部分（如 "?sect2"）
    // 兼容一下旧路径直接拿 window.location.hash 的写法
    const searchStr = location.search || (window.location.hash.split('?')[1] ? '?' + window.location.hash.split('?')[1] : '');
    const qs = new URLSearchParams(searchStr.startsWith('?') ? searchStr.slice(1) : searchStr);
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
  }, [location.search, location.pathname]);
  const battleMode: 'test' | 'sect' = urlParams.isSect ? 'sect' : 'test';
  const matchNo: 1 | 2 = urlParams.match;
  /** 我方副卡需要数量（第一场2v2→1，第二场3v3→2；非宗门模式默认1） */
  const partnerCount = urlParams.isSect ? (matchNo === 2 ? 2 : 1) : 1;
  /** 每场比武的灵石基础奖励（胜利满额；败/平减半，向下取整最少 1） */
  const sectReward = matchNo === 1 ? 10 : 20;

  // ====== 测试门：仅 ?mode=test 显式开启时生效（开发自测专用）======
  // ★ 2026-05-10：移除 isSect 触发条件！正常宗门大比流程必有 heroId（来自 S3 选角），
  //   原条件 (isTest||isSect)&&!heroId 会在以下场景误触：
  //   ① 多 tab 打开同一 URL（zustand 是 tab 局部状态）
  //   ② 浏览器刷新但未及时恢复存档
  //   ③ 任何瞬间 heroId 为 null 的时机
  //   一旦触发就会把主角强制改写为"塘散"，导致用户开局选的小舞/萧炎等被覆盖。
  useEffect(() => {
    if (urlParams.isTest && !heroId) {
      // 仅显式 ?mode=test 测试入口才注入默认阵容
      setHero('hero_tangsan' as HeroId, '塘散');
      ['hero_xiaowu', 'hero_xiaoyan', 'hero_wanglin', 'hero_hanli', 'hero_xuner'].forEach((id) => addCard(id));
    }
    // 宗门大比模式但 heroId 为空 —— 数据异常，仅警告不改写主角
    if (urlParams.isSect && !heroId) {
      console.error(
        '[S7B] 进入宗门大比但 heroId 为空 —— 主角数据丢失。请回主菜单从存档载入或重新开始游戏。'
      );
    }
    // 同步 AI 主角的境界提升进度（按当前章节）—— 幂等
    useGameStore.getState().applyAiRealmUps(getAiTargetRealmUps(useGameStore.getState().chapter));
  }, [heroId, setHero, addCard, urlParams.isTest, urlParams.isSect]);

  const battle = useS7BBattleStore();
  const logEndRef = useRef<HTMLDivElement>(null);

  // 🎬 2026-05-17 · 绝技释放屏幕特效（订阅 store.lastSkillEvent）
  const ultimateCastEvent = useUltimateCastOverlay({
    lastSkillEvent: battle.lastSkillEvent,
    getUnit: (id) => {
      const u = battle.units.find((x) => x.id === id);
      if (!u) return undefined;
      return {
        id: u.id,
        name: u.name,
        heroId: u.heroId,
        portrait: u.portrait,
        ultimate: u.ultimate,
      };
    },
    durationMs: 1000,
  });

  const [showSelect, setShowSelect] = useState(true);
  const [showRule, setShowRule] = useState(false);
  const [showDice, setShowDice] = useState(false);
  const [diceAttacker, setDiceAttacker] = useState<BattleUnit | null>(null);
  const [diceDefender, setDiceDefender] = useState<BattleUnit | null>(null);
  const [pendingSkillMod, setPendingSkillMod] = useState(0);
  const [showResult, setShowResult] = useState(false);

  /* ──────── 风属斗技 · 玩家可控选位 state ──────── */
  type FengShuPick = {
    attackerId: string;
    defenderId: string;
    skillMod: number;
    candidates: Array<{ row: number; col: number }>;
    /** 阶段：'ask' = 询问是否发动；'pick' = 高亮选位；null = 无 */
    phase: 'ask' | 'pick';
  };
  const [fengshuPick, setFengshuPick] = useState<FengShuPick | null>(null);

  /* ★ 2026-05-10：当 matchNo 变化时（如首场→次场），不重新挂载组件而是重置内部状态。
   *   原方案使用 window.location.reload() 会清空 zustand 内存（heroId/ownedCardIds/aiRecruitState 全丢），
   *   导致 3v3 阵容选择面板备选列表错误（玩家招募卡丢失，AI 也回到兜底主角阵容）。
   *   现改为：matchNo 变化时仅重置 React state + battle store，保留 zustand 全局状态。 */
  useEffect(() => {
    // ★ 诊断日志 —— 帮助排查"宗门大比场次错乱"问题
    if (urlParams.isSect) {
      // eslint-disable-next-line no-console
      console.info(
        `[宗门大比] 进入第 ${matchNo} 场（${matchNo === 1 ? '2v2' : '3v3'}） | ` +
        `partnerCount=${partnerCount} | ` +
        `URL search="${location.search}" hash="${window.location.hash}" | ` +
        `isSect=${urlParams.isSect}`
      );
    }
    setShowSelect(true);
    setShowResult(false);
    battle.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchNo]);


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
    /** 'ultimate' = 绝技路径 / 'battle' = 主动战斗技路径（2026-05-10 新增） */
    skillSlot?: 'ultimate' | 'battle';
  } | null>(null);

  /* === 天逆珠·修炼 X 值选择弹窗（2026-05-16 新增） === */
  const [pendingXiulian, setPendingXiulian] = useState<XiulianPendingInfo | null>(null);

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
          // 招募来的"主角卡"也享受 AI 拜师加成（getEffectiveHeroStats 默认 includeMentor）
          const eff = getEffectiveHeroStats(h.id);
          const bc = h.battle_card;
          return {
            id: h.id,
            name: h.name,
            type: h.type,
            hp: eff.hp,
            atk: eff.atk,
            mnd: eff.mnd,
            battleSkill: bc.skills.battle_skill ? { name: bc.skills.battle_skill.name, desc: bc.skills.battle_skill.desc } : null,
            ultimate: bc.skills.ultimate ? { name: bc.skills.ultimate.name, desc: bc.skills.ultimate.desc } : null,
            portrait: getCachedImage(h.id),
          };
        }
        // 非主角卡（R/N/SR/SSR）—— 从 poolCard 读取战斗技能与绝技
        const poolCard = getPoolCardById(id);
        if (poolCard) {
          const cardEff = getEffectiveCardStats({ hp: poolCard.hp, atk: poolCard.atk, mnd: poolCard.mnd }, poolCard.id);
          return {
            id: poolCard.id,
            name: poolCard.name,
            type: poolCard.type as CultivationType,
            hp: cardEff.hp,
            atk: cardEff.atk,
            mnd: cardEff.mnd,
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
      const bc = hero.battle_card;
      // 单一属性方案：玩家主角 = 基础 + 境界提升 + 御敌堂/藏经阁拜师
      const heroEff = getEffectiveHeroStats(hero.id);

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
        hp: heroEff.hp,
        maxHp: heroEff.hp,
        atk: heroEff.atk,
        mnd: heroEff.mnd,
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

      // ═══════════════════════════════════════════════════════════
      // === AI 敌方阵容（2026-05-10 改造）：
      //     1) 随机选 1 名非玩家主角作为对手 AI
      //        ★ 2026-05-10 追加：宗门大比次场（3v3）需避开首场已用过的 AI，
      //          通过 sessionStorage 在两场之间传递「首场对手 id」。
      //     2) 该 AI 在 S6a/S6b 招募中获得的卡，挑 (aiUnitCount-1) 张作为搭档
      //        优先 SR > R > N（让对手强度更接近主战场期望）
      // ═══════════════════════════════════════════════════════════
      const SECT_FIRST_KEY = 'cardwar:sectFirstOpponentId';
      let candidateHeroes = HEROES_DATA.filter((h) => h.id !== hero.id);
      if (urlParams.isSect && matchNo === 2) {
        const firstId = sessionStorage.getItem(SECT_FIRST_KEY);
        if (firstId) {
          const filtered = candidateHeroes.filter((h) => h.id !== firstId);
          if (filtered.length > 0) candidateHeroes = filtered;
        }
      }
      const shuffledHeroes = [...candidateHeroes].sort(() => Math.random() - 0.5);
      const aiHero = shuffledHeroes[0]; // 随机抽 1 名作为对手 AI
      // 首场记录对手 id，供次场避开
      if (urlParams.isSect && matchNo === 1) {
        try { sessionStorage.setItem(SECT_FIRST_KEY, aiHero.id); } catch { /* ignore */ }
      }
      // ★ 2026-05-10：宗门大比所有场次对手id都记录到 sessionStorage，
      //   供 S6c（pool=3）招募阶段计算"宗门大比真实排名"使用
      if (urlParams.isSect) {
        try {
          const k = matchNo === 1 ? 'cardwar:sectOpp1Id' : 'cardwar:sectOpp2Id';
          sessionStorage.setItem(k, aiHero.id);
        } catch { /* ignore */ }
      }

      // 取该 AI 的招募卡牌（不含主角自身的战斗卡）
      const aiSnapshot = aiRecruitState[aiHero.id];
      const aiOwnedCardIds = aiSnapshot?.ownedCardIds ?? [];

      // 按稀有度排序：SR > R > N，从优挑选搭档
      const RARITY_RANK: Record<string, number> = { SSR: 4, SR: 3, R: 2, N: 1 };
      const aiPartnerCards = aiOwnedCardIds
        .map((cid) => getPoolCardById(cid))
        .filter((c): c is NonNullable<ReturnType<typeof getPoolCardById>> => !!c)
        .sort((a, b) => (RARITY_RANK[b.rarity] ?? 0) - (RARITY_RANK[a.rarity] ?? 0))
        .slice(0, aiUnitCount - 1);

      // ── 主角单元 ──
      const aiHeroBC = aiHero.battle_card;
      const aiEff = getEffectiveHeroStats(aiHero.id);
      const aiHeroUnit = {
        id: `ai_${aiHero.id}`,
        name: aiHero.name,
        type: aiHero.type,
        hp: aiEff.hp,
        maxHp: aiEff.hp,
        atk: aiEff.atk,
        mnd: aiEff.mnd,
        isEnemy: true,
        row: 0,
        col: 0,
        battleSkill: aiHeroBC.skills.battle_skill
          ? { name: aiHeroBC.skills.battle_skill.name, desc: aiHeroBC.skills.battle_skill.desc }
          : null,
        ultimate: aiHeroBC.skills.ultimate
          ? { name: aiHeroBC.skills.ultimate.name, desc: aiHeroBC.skills.ultimate.desc }
          : null,
        portrait: getCachedImage(aiHero.id),
        skillId: aiHeroBC.skills.battle_skill
          ? SKILL_ID_MAP[aiHeroBC.skills.battle_skill.name]
          : undefined,
      };

      // ── AI 搭档单元（来自其招募的卡） ──
      const aiPartnerUnits = aiPartnerCards.map((pc, i) => {
        const pcEff = getEffectiveCardStats({ hp: pc.hp, atk: pc.atk, mnd: pc.mnd }, pc.id);
        return {
          id: `ai_${aiHero.id}_partner_${pc.id}_${i}`,
          name: pc.name,
          type: (pc.type as CultivationType) ?? aiHero.type,
          hp: pcEff.hp,
          maxHp: pcEff.hp,
          atk: pcEff.atk,
          mnd: pcEff.mnd,
          isEnemy: true,
          row: 0,
          col: 0,
          battleSkill: pc.battleSkill
            ? { name: pc.battleSkill.name, desc: pc.battleSkill.desc }
            : null,
          ultimate: pc.ultimate
            ? { name: pc.ultimate.name, desc: pc.ultimate.desc }
            : null,
          portrait: getCachedImage(pc.id),
          skillId: pc.battleSkill ? SKILL_ID_MAP[pc.battleSkill.name] : undefined,
        };
      });

      const aiUnits = [aiHeroUnit, ...aiPartnerUnits];

      // 防御性：如果 AI 卡牌不够（理论上 S6 后一定够），用其他主角的战斗卡兜底
      while (aiUnits.length < aiUnitCount) {
        const fillHero = shuffledHeroes[aiUnits.length] ?? shuffledHeroes[0];
        const fbc = fillHero.battle_card;
        const fillEff = getEffectiveHeroStats(fillHero.id);
        aiUnits.push({
          id: `ai_fill_${fillHero.id}_${aiUnits.length}`,
          name: fillHero.name,
          type: fillHero.type,
          hp: fillEff.hp,
          maxHp: fillEff.hp,
          atk: fillEff.atk,
          mnd: fillEff.mnd,
          isEnemy: true,
          row: 0,
          col: 0,
          battleSkill: fbc.skills.battle_skill
            ? { name: fbc.skills.battle_skill.name, desc: fbc.skills.battle_skill.desc }
            : null,
          ultimate: fbc.skills.ultimate
            ? { name: fbc.skills.ultimate.name, desc: fbc.skills.ultimate.desc }
            : null,
          portrait: getCachedImage(fillHero.id),
          skillId: fbc.skills.battle_skill ? SKILL_ID_MAP[fbc.skills.battle_skill.name] : undefined,
        });
      }

      battle.initBattle(playerUnits, aiUnits);
      setShowSelect(false);
    },
    [hero, heroId, heroName, battleBonus, knowledgeBonus, cardBonuses, partnerOptions, battle, aiRecruitState, urlParams.isSect, matchNo],
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

      // ★ 2026-05-16：天逆珠·修炼专属拦截 —— 选定目标后弹"X 值选择"窗，
      //   玩家确认 X 后再调 performBattleSkillActive；与其他技能一刀切走默认路径不冲突。
      if (cur.regSkillId === 'bssr_situnan.battle' && cur.skillSlot === 'battle') {
        const caster = battle.units.find((u) => u.id === cur.casterId);
        const target = battle.units.find((u) => u.id === targetId);
        if (!caster || !target) {
          battle.addLog('⚠️ 天逆珠·修炼：单位不存在', 'system');
          setUltimateTargeting(null);
          return;
        }
        if (caster.hp < 2) {
          battle.addLog('⚠️ 天逆珠·修炼：司图楠当前气血过低（需 ≥2）', 'system');
          setUltimateTargeting(null);
          return;
        }
        // 弹窗 → 等玩家选 X
        setPendingXiulian({
          casterId: caster.id,
          casterName: caster.name,
          casterHp: caster.hp,
          targetId: target.id,
          targetName: target.name,
        });
        setUltimateTargeting(null); // 退出瞄准态（弹窗接管）
        return;
      }

      // ★ 2026-05-10：根据 skillSlot 走不同路径（默认 ultimate）
      const ok =
        cur.skillSlot === 'battle'
          ? battle.performBattleSkillActive(cur.casterId, [targetId])
          : battle.performUltimate(cur.casterId, [targetId]);
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

      /* ──────────── 风属斗技 · 选位阶段拦截 ──────────── */
      if (fengshuPick && fengshuPick.phase === 'pick') {
        const hit = fengshuPick.candidates.find((p) => p.row === row && p.col === col);
        if (!hit) {
          battle.addLog('⚠️ 请点击青色高亮格作为传送目标', 'system');
          return;
        }
        // 提交：用玩家选定的落点执行攻击
        const attackerUnit = battle.units.find((u) => u.id === fengshuPick.attackerId);
        const defenderUnit = battle.units.find((u) => u.id === fengshuPick.defenderId);
        if (attackerUnit && defenderUnit) {
          setDiceAttacker(attackerUnit);
          setDiceDefender(defenderUnit);
          const attackerId = fengshuPick.attackerId;
          battle.attack(
            attackerId,
            fengshuPick.defenderId,
            fengshuPick.skillMod,
            { row: hit.row, col: hit.col },
          );
          // 🔒 2026-05-11 普攻后立即结束行动轮
          const updatedUnits = useS7BBattleStore.getState().units.map((u) =>
            u.id === attackerId ? { ...u, attackedThisTurn: true } : u,
          );
          useS7BBattleStore.setState({ units: updatedUnits });
          if (!useS7BBattleStore.getState().battleOver) {
            battle.endUnitTurn(attackerId);
            setPendingSkillMod(0);
            setTimeout(() => {
              const us = useS7BBattleStore.getState().units;
              const aliveAll = us.filter((u) => !u.dead);
              if (aliveAll.length > 0 && aliveAll.every((u) => u.acted)) {
                battle.advanceAction();
              }
            }, 100);
          }
          setShowDice(true);
        }
        setFengshuPick(null);
        return;
      }


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
          /* ──── 风属斗技拦截：纳兰嫣然(玩家方)进攻时，弹窗让玩家选位 ──── */
          if ((selectedUnit.registrySkills ?? []).includes('sr_nalanyanran.battle')) {
            const candidates = battle.computeFengShuCandidates(selectedUnit.id, target.id);
            if (candidates.length === 0) {
              // 无落点 → 与原规则一致：放弃攻击
              battle.addLog(
                `🌪 风属斗技无合法落点，${selectedUnit.name} 放弃本次进攻`,
                'skill',
              );
              return;
            }
            // 弹询问窗
            setFengshuPick({
              attackerId: selectedUnit.id,
              defenderId: target.id,
              skillMod: pendingSkillMod,
              candidates,
              phase: 'ask',
            });
            return;
          }

          setDiceAttacker(selectedUnit);
          setDiceDefender(target);
          const attackerId = selectedUnit.id;
          battle.attack(attackerId, target.id, pendingSkillMod);
          // 🔒 2026-05-11 普攻后立即结束行动轮（不再依赖关骰子弹窗）
          //   先标记 attackedThisTurn=true 以维持 UI 即时反馈，再 endUnitTurn 推进 actor。
          //   endUnitTurn 已加幂等保护，即便 screen 关骰子时再调一次也是 no-op。
          const updatedUnits = useS7BBattleStore.getState().units.map((u) =>
            u.id === attackerId ? { ...u, attackedThisTurn: true } : u,
          );
          useS7BBattleStore.setState({ units: updatedUnits });
          if (!useS7BBattleStore.getState().battleOver) {
            battle.endUnitTurn(attackerId);
            setPendingSkillMod(0);
            // 立即检查回合切换（与 handleCloseDice 内逻辑一致）
            setTimeout(() => {
              const us = useS7BBattleStore.getState().units;
              const aliveAll = us.filter((u) => !u.dead);
              if (aliveAll.length > 0 && aliveAll.every((u) => u.acted)) {
                battle.advanceAction();
              }
            }, 100);
          }
          setShowDice(true);
          return;
        }
      }
    },
    [selectedUnit, battle, canMove, canAttack, pendingSkillMod, isDragging, hoverPath, movingPath, ultimateTargeting, handleUltimateAim, fengshuPick],
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
  //   - 战斗技（battle）：先尝试新引擎"主动战斗技"路径（如藤化原·天鬼搜身），否则走老 useSkill 路径
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
      if (selectedUnit.attackedThisTurn) {
        battle.addLog('⚠ 本回合已普攻，技能不可再发动（请下回合再用）', 'system');
        return;
      }

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
          single_any_ally: true,
          position_pick: true,
        };
        if (selectorKind && NEEDS_TARGET[selectorKind]) {
          // precheck.candidateIds 已是合法目标（技能自己过滤过）
          setUltimateTargeting({
            kind: selectorKind as any,
            casterId: selectedUnit.id,
            candidateIds: pre.candidateIds ?? [],
            regSkillId: regId!,
            skillSlot: 'ultimate',
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

      /* ──────────── 战斗技分支 ──────────── */
      // ★ 2026-05-10：先尝试"主动战斗技能"新路径（如藤化原·天鬼搜身）
      if (selectedUnit.battleSkill) {
        const regId = SkillRegistry.findIdByName(selectedUnit.battleSkill.name);
        const reg = regId ? SkillRegistry.get(regId) : undefined;
        if (reg && reg.isActive) {
          // 主动战斗技
          const pre = battle.battleSkillPrecheck(selectedUnit.id);
          if (!pre.ok) {
            battle.addLog(`⚠️ ${pre.reason ?? '战斗技能发动失败'}`, 'skill');
            return;
          }
          const selectorKind = reg.targetSelector?.kind;
          const NEEDS_TARGET: Record<string, boolean> = {
            single_any_enemy: true,
            single_line_enemy: true,
            single_adjacent_enemy: true,
            single_any_character: true,
            single_any_ally: true,
            position_pick: true,
          };
          if (selectorKind && NEEDS_TARGET[selectorKind]) {
            setUltimateTargeting({
              kind: selectorKind as any,
              casterId: selectedUnit.id,
              candidateIds: pre.candidateIds ?? [],
              regSkillId: regId!,
              skillSlot: 'battle',
            });
            const hintText = describeSelectorHint(selectorKind, {
              candidateIds: pre.candidateIds ?? [],
              units: battle.units,
              casterId: selectedUnit.id,
            });
            battle.addLog(
              `🎯 【${selectedUnit.battleSkill.name}】进入目标选择（${hintText}），按 ESC 或右键取消`,
              'system',
            );
            return;
          }
          // 无需选目标
          const ok = battle.performBattleSkillActive(selectedUnit.id, []);
          if (!ok) return;
          setTimeout(() => {
            useS7BBattleStore.getState().calcMoveRange(selectedUnit.id);
            useS7BBattleStore.getState().calcAttackRange(selectedUnit.id);
          }, 0);
          return;
        }
      }

      /* ──────────── 老战斗技分支（保留） ──────────── */
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
  //   2026-05-11 简化：普攻已在攻击点立即 endUnitTurn + advanceAction，
  //   关骰子只是关 UI，无副作用。
  const handleCloseDice = useCallback(() => {
    setShowDice(false);
  }, []);

  // 结算确认
  const handleContinue = useCallback(() => {
    if (battleMode === 'sect') {
      // === 宗门大比模式 ===
      // ★ 2026-05-10 规则修正：流程固定为「1 场 2v2 → 1 场 3v3」，
      //   无论胜负都推进到下一阶段，仅奖励灵石数有差异：
      //   - 胜利：满额（首场 10、次场 20）
      //   - 失败/平局：减半（向下取整，最少 1）
      const win = battle.battleResult === 'win';
      const actualReward =
        win ? sectReward : Math.max(1, Math.floor(sectReward / 2));

      // 记录每场胜负到 sessionStorage，供 S6c 招募阶段计算"宗门大比真实排名"
      try {
        const k = matchNo === 1 ? 'cardwar:sectMatch1Win' : 'cardwar:sectMatch2Win';
        sessionStorage.setItem(k, win ? '1' : '0');
      } catch { /* ignore */ }

      // 发放奖励（哪怕失败也给减半灵石）
      addSpiritStones(actualReward);
      SaveSystem.save(1);

      if (matchNo === 1) {
        // 首场结束（胜/负/平）→ 一律进入次场 3v3
        navigate('/s7c?sect2');
      } else {
        // 次场结束（胜/负/平）→ 一律标记第四章完成，进入精英招募
        markPhaseDone(4);
        SaveSystem.save(1);
        try { sessionStorage.removeItem('cardwar:sectFirstOpponentId'); } catch { /* ignore */ }
        navigate('/s6r?pool=3');
      }
      return;
    }
    // S7B 单机测试：返回主菜单
    SaveSystem.save(1);
    navigate('/menu');
  }, [navigate, battleMode, matchNo, battle, addSpiritStones, sectReward, markPhaseDone]);

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
          : `宗门正赛！主角必须上阵，另外请选择 2 名搭档组成 3 人战阵。对手同样派出三人精英队。胜利可获得 ${sectReward} 灵石并直接开启精英招募。`)
      : '对手 AI 将随机选择主角+副卡出战，双方平等对线。主角必须上阵，另外请选择 1 名搭档协同作战。一方全灭即胜，20 回合未分胜负则平局。';

  if (showSelect) {
    return (
      <div className={styles.screen}>
        <div className={styles.bgOverlay} />
        {/* sect 模式（宗门大比）下若跳 /story，会因第四章已读完再次自动跳回 S7C，形成循环。
            因此 sect 模式统一跳 /menu；测试/比武模式保留跳 /story 的原行为 */}
        <BackButton onClick={returnToMenu} />
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
      {/* 统一行为：返回主菜单并自动存档（slot=0） */}
      <BackButton onClick={returnToMenu} />
      <MusicToggle />

      {/* 战斗规则按钮（S7 专用，紧贴返回按钮下方，风格统一） */}
      <button className={styles.ruleBtn} onClick={() => setShowRule(true)}>
        📖 战斗规则
      </button>

      {/* 顶部中间 HUD：场次（仅宗门大比） + 回合 + 击杀数 + 行动中 */}
      <div className={styles.topHud}>
        {battleMode === 'sect' && (
          <div
            className={styles.roundBadge}
            style={{
              background: matchNo === 1
                ? 'linear-gradient(135deg, rgba(80,160,80,.85), rgba(40,100,40,.85))'
                : 'linear-gradient(135deg, rgba(200,80,80,.85), rgba(140,40,40,.85))',
              borderColor: matchNo === 1 ? 'rgba(120,200,120,.9)' : 'rgba(220,120,120,.9)',
            }}
            title={matchNo === 1
              ? '宗门大比 · 首场（2v2，主角+1副卡）'
              : '宗门大比 · 次场（3v3，主角+2副卡）'}
          >
            🏆 宗门大比 · 第 {matchNo} 场（{matchNo === 1 ? '2v2' : '3v3'}）
          </div>
        )}
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
              // 风属斗技 · 候选格高亮
              const isFengShuCandidate =
                !!fengshuPick &&
                fengshuPick.phase === 'pick' &&
                fengshuPick.candidates.some((p) => p.row === r && p.col === c);

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
                isFengShuCandidate ? styles.cellMovable : '',
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
                spring: asset('images/map/tile_spring.webp'),
                atk_boost: asset('images/map/tile_atk_boost.webp'),
                mnd_boost: asset('images/map/tile_mnd_boost.webp'),
                miasma: asset('images/map/tile_miasma.webp'),
                obstacle: asset('images/map/tile_obstacle.webp'),
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
                  style={{ backgroundImage: `url(${resolvePortraitUrl(unit.portrait, unit.heroId)})` }}
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
                  <span className={`${styles.unitStat} ${styles.unitStatAtk}`}>修{uiAtk(unit)}</span>
                  <span className={`${styles.unitStat} ${styles.unitStatMnd}`}>境{uiMnd(unit)}</span>
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
                style={{ backgroundImage: unit.portrait ? `url(${resolvePortraitUrl(unit.portrait, unit.heroId)})` : undefined, backgroundColor: '#203a20' }}
              />
<div className={styles.unitType}>{TYPE_CHAR[unit.type] || unit.type}</div>
              {/* 常驻显示属性条 */}
              <div className={styles.unitStatsOverlay}>
                <span className={`${styles.unitStat} ${styles.unitStatAtk}`}>修{uiAtk(unit)}</span>
                <span className={`${styles.unitStat} ${styles.unitStatMnd}`}>境{uiMnd(unit)}</span>
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
              <span>修为 {uiAtk(displayUnit)}</span>
              <span>心境 {uiMnd(displayUnit)}</span>
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
                {/* 🔧 2026-05-14：被动技永不遮蔽 desc。
                    被动技在战斗中持续生效（如小舞无敌金身被攻击时自动生效），
                    战报会反复显示效果，遮蔽 desc 反而误导玩家。
                    主动技仍按"是否释放过"决定是否揭示。 */}
                {isEnemy && !battleRevealed && !bCheck?.isPassive ? (
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
                {isEnemy && !ultRevealed && !uCheck?.isPassive ? (
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

      {/* 风属斗技询问弹窗 */}
      <AnimatePresence>
        {fengshuPick && fengshuPick.phase === 'ask' && (() => {
          const attackerU = battle.units.find((u) => u.id === fengshuPick.attackerId);
          const defenderU = battle.units.find((u) => u.id === fengshuPick.defenderId);
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
                    onClick={() => {
                      // 不发动 → 直接攻击（fengshuOverride=null 表示放弃）
                      const a = battle.units.find((u) => u.id === fengshuPick.attackerId);
                      const d = battle.units.find((u) => u.id === fengshuPick.defenderId);
                      if (a && d) {
                        setDiceAttacker(a);
                        setDiceDefender(d);
                        const attackerId = fengshuPick.attackerId;
                        battle.attack(
                          attackerId,
                          fengshuPick.defenderId,
                          fengshuPick.skillMod,
                          null,
                        );
                        // 🔒 2026-05-11 普攻后立即结束行动轮
                        const updatedUnits = useS7BBattleStore.getState().units.map((u) =>
                          u.id === attackerId ? { ...u, attackedThisTurn: true } : u,
                        );
                        useS7BBattleStore.setState({ units: updatedUnits });
                        if (!useS7BBattleStore.getState().battleOver) {
                          battle.endUnitTurn(attackerId);
                          setPendingSkillMod(0);
                          setTimeout(() => {
                            const us = useS7BBattleStore.getState().units;
                            const aliveAll = us.filter((u) => !u.dead);
                            if (aliveAll.length > 0 && aliveAll.every((u) => u.acted)) {
                              battle.advanceAction();
                            }
                          }, 100);
                        }
                        setShowDice(true);
                      }
                      setFengshuPick(null);
                    }}
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
          <b>{battle.units.find((u) => u.id === fengshuPick.defenderId)?.name}</b>{' '}
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
            rewardStones={
              battle.battleResult === 'win'
                ? sectReward
                : Math.max(1, Math.floor(sectReward / 2))
            }
            onContinue={handleContinue}
            onReturnMenu={() => {
              SaveSystem.save(1);
              returnToMenu();
            }}
          />
        )}
      </AnimatePresence>

      {/* ─── 玩家可控的 turn-start 技能弹窗（云鹊子/凝荣荣/顾河/天云子/雅妃 等）─── */}
      <TurnStartChoiceModal
        pending={battle.pendingTurnStartChoice}
        resolveUnit={(id) => {
          const u = battle.units.find((x) => x.id === id);
          if (!u) return null;
          return {
            id: u.id,
            name: u.name,
            hp: u.hp,
            hpMax: u.maxHp,
            atk: u.atk,
            mnd: u.mnd,
            isEnemy: u.isEnemy,
          };
        }}
        onConfirm={(targetId, stat) =>
          battle.confirmTurnStartChoice(targetId, stat)
        }
        onCancel={() => battle.cancelTurnStartChoice()}
      />

      {/* ─── 玩家可控的 turn-end 技能弹窗（大香肠 等，2026-05-13）─── */}
      <TurnStartChoiceModal
        pending={battle.pendingTurnEndChoice}
        resolveUnit={(id) => {
          const u = battle.units.find((x) => x.id === id);
          if (!u) return null;
          return {
            id: u.id,
            name: u.name,
            hp: u.hp,
            hpMax: u.maxHp,
            atk: u.atk,
            mnd: u.mnd,
            isEnemy: u.isEnemy,
          };
        }}
        onConfirm={(targetId, stat) =>
          battle.confirmTurnEndChoice(targetId, stat)
        }
        onCancel={() => battle.cancelTurnEndChoice()}
      />

      {/* ─── 玩家可控的复活分配弹窗（徐立国 · 天罡元婴·重塑）─── */}
      <ReviveAllocateModal
        pending={battle.pendingRevive}
        onConfirm={(payload) => battle.confirmReviveAllocate(payload)}
        onCancel={() => battle.cancelReviveAllocate()}
      />

      {/* 🎬 绝技释放屏幕特效 — 1 秒动画，pointer-events:none */}
      <UltimateCastOverlay event={ultimateCastEvent} />

      {/* ─── 司图楠 · 天逆珠·修炼 · X 值选择（2026-05-16）─── */}
      <XiulianAmountModal
        pending={pendingXiulian}
        onConfirm={(X) => {
          if (!pendingXiulian) return;
          const { casterId, targetId } = pendingXiulian;
          const ok = battle.performBattleSkillActive(
            casterId,
            encodeXiulianTargets(targetId, X),
          );
          setPendingXiulian(null);
          if (ok) {
            setTimeout(() => {
              useS7BBattleStore.getState().calcMoveRange(casterId);
              useS7BBattleStore.getState().calcAttackRange(casterId);
            }, 0);
          }
        }}
        onCancel={() => {
          battle.addLog('🎯 取消天逆珠·修炼', 'system');
          setPendingXiulian(null);
        }}
      />
    </div>
  );
};

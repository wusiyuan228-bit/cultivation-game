/**
 * S6 抽卡界面 — 招募道友（NR 池）
 *
 * 2026-04-27 重构版：
 *   - 顶栏 6 元素对齐：返回/标题/卡池/暂停/倍速/音乐
 *   - 座位 2×3 横排，立绘随代理卡切换
 *   - 座位右侧 1 秒"抽到卡"闪现位
 *   - 中央非模态操作面板，不遮挡其他 UI
 *   - 战报底部可折叠，展开 z 级最高
 */
import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useGameStore, SaveSystem } from '@/stores/gameStore';
import { useAudioStore } from '@/stores/audioStore';
import { useRecruitStore } from '@/stores/recruitStore';
import { loadRecruitPool1, loadRecruitPool2, loadRecruitPool3, countByRarity } from '@/systems/recruit/cardPoolLoader';
import { createParticipants } from '@/systems/recruit/participantFactory';
import {
  decideSkip,
  decideSwitchActiveCard,
  decideUsePreDrawSkill,
  decideUsePostDrawSkill,
  aiPickFromCandidates,
  aiPickDesignatedCard,
} from '@/systems/recruit/aiDecisionMaker';
import {
  execPreview,
  execExtraDrawPaid,
  execGuaranteeHighest,
  execDesignatePaid,
  execSameIpFirst,
  execPreferGender,
  execFreeDrawOnce,
  getSkillTiming,
} from '@/systems/recruit/runSkillEngine';
import type { PoolCard, Participant } from '@/types/recruit';
import { getCachedImage } from '@/utils/imageCache';
import { ParticipantSeat } from './S6_Recruit/ParticipantSeat';
import { CardPoolDisplay } from './S6_Recruit/CardPoolDisplay';
import { DrawLogPanel } from './S6_Recruit/DrawLogPanel';
import { CandidatePickModal } from './S6_Recruit/CandidatePickModal';
import { DesignatePickModal } from './S6_Recruit/DesignatePickModal';
import { CardRevealAnimation } from './S6_Recruit/CardRevealAnimation';
import { SwitchCardModal } from './S6_Recruit/SwitchCardModal';
import { ViewDeckModal } from './S6_Recruit/ViewDeckModal';
import styles from './S6_Recruit.module.css';

const BASE_COST = 5;

// ===== AI 步骤基础延迟（单位 ms），倍速 1x=原值，2x=一半 =====
// 2026-05-09 调整：目标 AI 每步约 0.8s，保证玩家能看清每步变化，整体提速 ~30%
const AI_DELAY = {
  TURN_START: 800,       // 回合开始后 → 决策（玩家需看到高亮切换）
  AFTER_SKIP: 600,       // 跳过后 → 下一回合（信息量少，可稍快）
  AFTER_SWITCH: 800,     // 替换后 → 抽卡（切立绘需要看清）
  AFTER_NORMAL_DRAW: 800,// 抽卡后 → post_draw 判断
  AFTER_SKILL: 800,      // 技能后 → post_draw
  AFTER_POST_DRAW: 800,  // 保留/放回后 → 下一回合
  CANDIDATE_PICK: 800,   // AI 挑候选卡
  // —— 玩家操作后推进延迟（也跟随倍速） ——
  PLAYER_AFTER_SKIP: 500,
  PLAYER_AFTER_PICK: 700,
  PLAYER_AFTER_POSTDRAW: 500,
  PLAYER_AUTO_KEEP: 900, // 玩家抽完无需决策时自动保留的延迟
};

export const S6_Recruit: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  /** 卡池轮次：'1' 默认招募1（NR+4SR彩蛋），'2' 招募2（SR独立池），'3' 招募3（非绑定SSR） */
  const poolRaw = searchParams.get('pool');
  const poolRound: 1 | 2 | 3 = poolRaw === '2' ? 2 : poolRaw === '3' ? 3 : 1;

  // ===== gameStore =====
  const playerHeroId = useGameStore((s) => s.heroId);
  const playerName = useGameStore((s) => s.heroName);
  const storeSpiritStones = useGameStore((s) => s.spiritStones);
  const storeOwnedCardIds = useGameStore((s) => s.ownedCardIds);
  const lastBanditKillCount = useGameStore((s) => s.lastBanditKillCount);
  const pool2RemainingSr = useGameStore((s) => s.pool2RemainingSr);
  const aiRecruitStateStore = useGameStore((s) => s.aiRecruitState);
  const addSpiritStones = useGameStore((s) => s.addSpiritStones);
  const addCard = useGameStore((s) => s.addCard);
  const markPhaseDone = useGameStore((s) => s.markPhaseDone);
  const markRecruitDone = useGameStore((s) => s.markRecruitDone);
  const setChapter = useGameStore((s) => s.setChapter);
  const setSegmentIndex = useGameStore((s) => s.setSegmentIndex);
  const setPool2RemainingSr = useGameStore((s) => s.setPool2RemainingSr);
  const setAiRecruitState = useGameStore((s) => s.setAiRecruitState);

  // ===== audioStore（仅占位，未来接入 BGM） =====
  const bgmEnabled = useAudioStore((s) => s.bgmEnabled);
  const toggleBgm = useAudioStore((s) => s.toggleBgm);

  // ===== recruitStore =====
  const phase = useRecruitStore((s) => s.phase);
  const recruitmentStarted = useRecruitStore((s) => s.recruitmentStarted);
  const participants = useRecruitStore((s) => s.participants);
  const drawOrder = useRecruitStore((s) => s.drawOrder);
  const currentTurnIndex = useRecruitStore((s) => s.currentTurnIndex);
  const bigRound = useRecruitStore((s) => s.bigRound);
  const pool = useRecruitStore((s) => s.pool);
  const initialPoolSize = useRecruitStore((s) => s.initialPoolSize);
  const autoPlay = useRecruitStore((s) => s.autoPlay);
  const log = useRecruitStore((s) => s.log);
  const pendingReveal = useRecruitStore((s) => s.pendingReveal);
  const candidates = useRecruitStore((s) => s.candidates);
  const lastDrawnCard = useRecruitStore((s) => s.lastDrawnCard);
  const {
    initialize, setAutoPlay,
    getCurrentParticipant, getActiveSkill, getEffectiveCost,
    switchActiveCard, startRecruitment,
    startTurn, performNormalDraw, applySkillExecResult,
    pickFromCandidates, postDrawReturn, postDrawKeep,
    performSkip, advanceTurn,
  } = useRecruitStore.getState();

  const [loading, setLoading] = useState(true);
  const [hoveredParticipantId, setHoveredParticipantId] = useState<string | null>(null);
  const [showPoolDetail, setShowPoolDetail] = useState(false);
  const [showCandidatePick, setShowCandidatePick] = useState(false);
  const [showDesignatePick, setShowDesignatePick] = useState(false);
  const [showSwitchModal, setShowSwitchModal] = useState(false);
  const [viewDeckOf, setViewDeckOf] = useState<Participant | null>(null);

  // 倍速（1x / 2x / 4x）
  const [speed, setSpeed] = useState<1 | 2 | 4>(1);
  const speedRef = useRef(speed);
  useEffect(() => { speedRef.current = speed; }, [speed]);
  const aiDelay = (base: number) => Math.max(100, Math.round(base / speedRef.current));

  // ===== 玩家操作锁（防止快速双击重复触发） =====
  // 点击任一操作按钮后立即上锁，直到 advanceTurn 完成后自动解锁
  const [playerActionLock, setPlayerActionLock] = useState(false);
  const unlockTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lockPlayerAction = useCallback((unlockAfterMs: number) => {
    setPlayerActionLock(true);
    if (unlockTimerRef.current) clearTimeout(unlockTimerRef.current);
    unlockTimerRef.current = setTimeout(() => {
      setPlayerActionLock(false);
      unlockTimerRef.current = null;
    }, unlockAfterMs + 150); // 比推进延迟多 150ms 作保险
  }, []);
  // 回合切换时强制解锁（防止异常卡死）
  useEffect(() => {
    setPlayerActionLock(false);
    if (unlockTimerRef.current) {
      clearTimeout(unlockTimerRef.current);
      unlockTimerRef.current = null;
    }
  }, [currentTurnIndex, bigRound]);
  useEffect(() => {
    return () => {
      if (unlockTimerRef.current) clearTimeout(unlockTimerRef.current);
    };
  }, []);

  // 每个座位的"最近抽到闪现卡"（1 秒后清空）
  const [recentFlash, setRecentFlash] = useState<Record<string, PoolCard | null>>({});
  const flashTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const showFlash = useCallback((participantId: string, card: PoolCard) => {
    // 清掉同一人的旧定时器
    if (flashTimers.current[participantId]) {
      clearTimeout(flashTimers.current[participantId]);
    }
    setRecentFlash((m) => ({ ...m, [participantId]: card }));
    flashTimers.current[participantId] = setTimeout(() => {
      setRecentFlash((m) => ({ ...m, [participantId]: null }));
      delete flashTimers.current[participantId];
    }, 1000);
  }, []);

  // 订阅 recruitStore 的抽到/保留/放回事件 → 驱动闪现
  // 监听 lastDrawnCard 变化：只要它被设为新卡，就对当前参与者触发闪现
  const lastFlashKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (!lastDrawnCard) return;
    const s = useRecruitStore.getState();
    const p = s.getCurrentParticipant();
    if (!p) return;
    // 用 "参与者id + 卡id + bigRound + turnIndex" 作为去重 key，避免同一张卡重复闪两次
    const key = `${p.id}:${lastDrawnCard.id}:${s.bigRound}:${s.currentTurnIndex}`;
    if (lastFlashKeyRef.current === key) return;
    lastFlashKeyRef.current = key;
    showFlash(p.id, lastDrawnCard);
  }, [lastDrawnCard, showFlash]);

  const orderIndexById = useMemo(() => {
    const map: Record<string, number> = {};
    drawOrder.forEach((id, i) => (map[id] = i));
    return map;
  }, [drawOrder]);

  const currentParticipant = getCurrentParticipant();

  // ====== 初始化 ======
  useEffect(() => {
    if (!playerHeroId) {
      navigate('/');
      return;
    }
    (async () => {
      try {
        const poolCards =
          poolRound === 3 ? await loadRecruitPool3(pool2RemainingSr) :
          poolRound === 2 ? await loadRecruitPool2() :
          await loadRecruitPool1();
        const list = createParticipants(
          playerHeroId,
          playerName || '玩家',
          storeSpiritStones,
          // S6b/S6c（pool=2/3）使用玩家真实击杀数作为排序主键（S6c 暂复用剿匪名次）；
          // S6a（pool=1）传 -1 → 回落到心境排序
          poolRound >= 2 ? lastBanditKillCount : -1,
          poolCards,
          storeOwnedCardIds,
          aiRecruitStateStore,
        );
        initialize({ participants: list, pool: poolCards });
        setLoading(false);
      } catch (e) {
        console.error(`[S6] 加载卡池(pool_${poolRound})失败`, e);
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ====== AI 定时器管理 ======
  const aiTimers = useRef<Array<ReturnType<typeof setTimeout>>>([]);
  const aiProcessingTurnId = useRef<string | null>(null);

  const scheduleAi = (fn: () => void, delay: number) => {
    const t = setTimeout(() => {
      aiTimers.current = aiTimers.current.filter((x) => x !== t);
      const s = useRecruitStore.getState();
      if (!s.autoPlay) return;
      if (s.phase === 'ended') return;
      fn();
    }, delay);
    aiTimers.current.push(t);
    return t;
  };

  const killAiChain = () => {
    aiTimers.current.forEach((t) => clearTimeout(t));
    aiTimers.current = [];
    aiProcessingTurnId.current = null;
  };

  // 组件卸载清理
  useEffect(() => {
    return () => {
      killAiChain();
      // 清理闪现定时器
      Object.values(flashTimers.current).forEach((t) => clearTimeout(t));
      flashTimers.current = {};
    };
  }, []);

  // 顺序展示 → 等待玩家点击"开始招募"按钮；不再自动进入
  // （由 recruitStore.startRecruitment 驱动 startTurn）

  // 回合开始 → 玩家 / AI 分流
  useEffect(() => {
    if (phase !== 'turn_start') return;
    const s = useRecruitStore.getState();
    const p = s.getCurrentParticipant();
    if (!p) return;

    if (p.isPlayer) {
      killAiChain();
      return;
    }

    const turnId = `${s.bigRound}-${s.currentTurnIndex}-${p.id}`;
    if (aiProcessingTurnId.current === turnId) return;
    if (!s.autoPlay) return;

    killAiChain();
    aiProcessingTurnId.current = turnId;
    scheduleAi(() => aiRunTurn(turnId), aiDelay(AI_DELAY.TURN_START));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, currentTurnIndex, currentParticipant?.id]);

  // autoPlay 切换 —— 恢复时根据当前 phase 精准续接 AI 链路
  useEffect(() => {
    if (!autoPlay) {
      killAiChain();
      return;
    }
    // 恢复播放：判断当前是否是 AI 回合且需要恢复
    const s = useRecruitStore.getState();
    const p = s.getCurrentParticipant();
    if (!p || p.isPlayer) return;
    if (s.phase === 'ended' || s.phase === 'init' || s.phase === 'order_reveal') return;
    if (!s.recruitmentStarted) return;

    // 已经有链路在跑就不重复启动
    if (aiProcessingTurnId.current !== null) return;

    const turnId = `${s.bigRound}-${s.currentTurnIndex}-${p.id}`;
    aiProcessingTurnId.current = turnId;

    // 根据当前 phase 从断点续接
    switch (s.phase) {
      case 'turn_start':
      case 'skill_prompt':
        // 回合刚开始或等技能决策，从头跑
        scheduleAi(() => aiRunTurn(turnId), aiDelay(400));
        break;

      case 'drawing':
      case 'post_draw_skill':
        // 已经抽到卡了，从 postDraw 继续
        scheduleAi(() => aiPostDraw(turnId), aiDelay(400));
        break;

      case 'candidate_pick': {
        // 在候选选择阶段，让 AI 立即做选择
        scheduleAi(() => {
          const latest = useRecruitStore.getState();
          if (latest.candidates.length > 0) {
            const picked = aiPickFromCandidates(latest.candidates);
            pickFromCandidates(picked.id);
          }
          scheduleAi(() => aiPostDraw(turnId), aiDelay(AI_DELAY.AFTER_SKILL));
        }, aiDelay(400));
        break;
      }

      case 'turn_end':
        // 该轮已结束，直接推进下一回合
        scheduleAi(() => {
          aiProcessingTurnId.current = null;
          advanceTurn();
        }, aiDelay(200));
        break;

      default:
        // 其他未知状态，安全地从头开始
        scheduleAi(() => aiRunTurn(turnId), aiDelay(400));
        break;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoPlay]);

  // ====== AI 抽卡主流程 ======
  const aiRunTurn = useCallback((turnId: string) => {
    const s = useRecruitStore.getState();
    const p = s.getCurrentParticipant();
    if (!p || p.isPlayer) return;
    const curTurnId = `${s.bigRound}-${s.currentTurnIndex}-${p.id}`;
    if (curTurnId !== turnId) return;

    const latestPool = s.pool;
    const latestSkill = s.getActiveSkill(p);

    if (decideSkip(p, BASE_COST, latestSkill, latestPool)) {
      performSkip();
      scheduleAi(() => aiFinishTurn(turnId), aiDelay(AI_DELAY.AFTER_SKIP));
      return;
    }

    const switchTo = decideSwitchActiveCard(p, latestPool, BASE_COST);
    if (switchTo) {
      switchActiveCard(p.id, switchTo);
      scheduleAi(() => aiPerformDraw(turnId), aiDelay(AI_DELAY.AFTER_SWITCH));
      return;
    }

    aiPerformDraw(turnId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const aiPerformDraw = useCallback((turnId: string) => {
    const s = useRecruitStore.getState();
    const p = s.getCurrentParticipant();
    if (!p) return;
    const curTurnId = `${s.bigRound}-${s.currentTurnIndex}-${p.id}`;
    if (curTurnId !== turnId) return;

    const skill = s.getActiveSkill(p);
    const effectiveCost = s.getEffectiveCost(p);
    const latestPool = s.pool;

    if (p.gems < effectiveCost) {
      performSkip();
      scheduleAi(() => aiFinishTurn(turnId), aiDelay(AI_DELAY.AFTER_SKIP));
      return;
    }

    if (skill && decideUsePreDrawSkill(p, latestPool, BASE_COST, skill)) {
      aiExecuteSkill(skill, turnId);
      return;
    }

    performNormalDraw();
    scheduleAi(() => aiPostDraw(turnId), aiDelay(AI_DELAY.AFTER_NORMAL_DRAW));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const aiExecuteSkill = useCallback((skill: any, turnId: string) => {
    const s = useRecruitStore.getState();
    const p = s.getCurrentParticipant();
    if (!p) return;
    const latestPool = s.pool;
    const ctx = { participant: p, pool: latestPool, baseCost: BASE_COST };
    let res: any = null;

    switch (skill.category) {
      case 'preview_2':
      case 'preview_3':
        res = execPreview(ctx, skill);
        applySkillExecResult(res);
        scheduleAi(() => {
          const picked = aiPickFromCandidates(useRecruitStore.getState().candidates);
          pickFromCandidates(picked.id);
          scheduleAi(() => aiPostDraw(turnId), aiDelay(AI_DELAY.AFTER_SKILL));
        }, aiDelay(AI_DELAY.CANDIDATE_PICK));
        break;

      case 'extra_draw_paid':
        res = execExtraDrawPaid(ctx, skill);
        applySkillExecResult(res);
        scheduleAi(() => aiPostDraw(turnId), aiDelay(AI_DELAY.AFTER_SKILL));
        break;

      case 'guarantee_highest':
        res = execGuaranteeHighest(ctx, skill);
        applySkillExecResult(res);
        scheduleAi(() => aiPostDraw(turnId), aiDelay(AI_DELAY.AFTER_SKILL));
        break;

      case 'designate_paid': {
        const target = aiPickDesignatedCard(latestPool);
        if (!target) {
          performNormalDraw();
          scheduleAi(() => aiPostDraw(turnId), aiDelay(AI_DELAY.AFTER_NORMAL_DRAW));
          return;
        }
        res = execDesignatePaid(ctx, skill, target.id);
        applySkillExecResult(res);
        scheduleAi(() => aiPostDraw(turnId), aiDelay(AI_DELAY.AFTER_SKILL));
        break;
      }

      case 'same_ip_first':
        res = execSameIpFirst(ctx, skill);
        applySkillExecResult(res);
        scheduleAi(() => aiPostDraw(turnId), aiDelay(AI_DELAY.AFTER_SKILL));
        break;

      case 'prefer_female':
      case 'prefer_male':
        res = execPreferGender(ctx, skill);
        applySkillExecResult(res);
        scheduleAi(() => aiPostDraw(turnId), aiDelay(AI_DELAY.AFTER_SKILL));
        break;

      case 'free_draw_once':
        res = execFreeDrawOnce(ctx, skill);
        applySkillExecResult(res);
        scheduleAi(() => aiPostDraw(turnId), aiDelay(AI_DELAY.AFTER_SKILL));
        break;

      default:
        performNormalDraw();
        scheduleAi(() => aiPostDraw(turnId), aiDelay(AI_DELAY.AFTER_NORMAL_DRAW));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const aiPostDraw = useCallback((turnId: string) => {
    const s = useRecruitStore.getState();
    const p = s.getCurrentParticipant();
    if (!p) return;
    const curTurnId = `${s.bigRound}-${s.currentTurnIndex}-${p.id}`;
    if (curTurnId !== turnId) return;

    const skill = s.getActiveSkill(p);
    const last = s.lastDrawnCard;

    if (last && skill && decideUsePostDrawSkill(p, last, skill)) {
      postDrawReturn();
    } else if (last) {
      postDrawKeep();
    }
    scheduleAi(() => aiFinishTurn(turnId), aiDelay(AI_DELAY.AFTER_POST_DRAW));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const aiFinishTurn = useCallback((turnId: string) => {
    const s = useRecruitStore.getState();
    const p = s.getCurrentParticipant();
    if (!p) return;
    const curTurnId = `${s.bigRound}-${s.currentTurnIndex}-${p.id}`;
    if (curTurnId !== turnId) return;
    aiProcessingTurnId.current = null;
    advanceTurn();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ====== 玩家操作 ======
  const isPlayerTurn = currentParticipant?.isPlayer;
  const playerActiveSkill = isPlayerTurn ? getActiveSkill(currentParticipant!) : null;
  const playerSkillTiming = playerActiveSkill ? getSkillTiming(playerActiveSkill) : 'none';
  const playerEffectiveCost = currentParticipant ? getEffectiveCost(currentParticipant) : BASE_COST;

  const handlePlayerDraw = () => {
    if (!isPlayerTurn || !currentParticipant) return;
    if (playerActionLock) return;
    if (currentParticipant.gems < playerEffectiveCost) return;
    // 抽卡后续推进由 drawing phase 的 useEffect 处理，这里只锁到那时
    lockPlayerAction(aiDelay(AI_DELAY.PLAYER_AUTO_KEEP));
    performNormalDraw();
  };

  const handlePlayerUseSkill = () => {
    if (!isPlayerTurn || !playerActiveSkill) return;
    if (playerActionLock) return;
    const ctx = { participant: currentParticipant!, pool, baseCost: BASE_COST };
    const skill = playerActiveSkill;

    switch (skill.category) {
      case 'preview_2':
      case 'preview_3': {
        if (currentParticipant!.gems < playerEffectiveCost) return;
        lockPlayerAction(1500); // 预览弹窗打开到玩家二次选择前，锁定所有其他按钮
        applySkillExecResult(execPreview(ctx, skill));
        setShowCandidatePick(true);
        break;
      }
      case 'extra_draw_paid': {
        const total = playerEffectiveCost + (skill.params?.extraCost ?? 5);
        if (currentParticipant!.gems < total) return;
        lockPlayerAction(aiDelay(AI_DELAY.PLAYER_AUTO_KEEP));
        applySkillExecResult(execExtraDrawPaid(ctx, skill));
        break;
      }
      case 'guarantee_highest': {
        const total = playerEffectiveCost + (skill.params?.extraCost ?? 3);
        if (currentParticipant!.gems < total) return;
        lockPlayerAction(aiDelay(AI_DELAY.PLAYER_AUTO_KEEP));
        applySkillExecResult(execGuaranteeHighest(ctx, skill));
        break;
      }
      case 'designate_paid': {
        const cost = skill.params?.extraCost ?? 20;
        if (currentParticipant!.gems < cost) return;
        lockPlayerAction(1500);
        setShowDesignatePick(true);
        break;
      }
      case 'same_ip_first': {
        if (currentParticipant!.gems < playerEffectiveCost) return;
        lockPlayerAction(aiDelay(AI_DELAY.PLAYER_AUTO_KEEP));
        applySkillExecResult(execSameIpFirst(ctx, skill));
        break;
      }
      case 'prefer_female':
      case 'prefer_male': {
        if (currentParticipant!.gems < playerEffectiveCost) return;
        lockPlayerAction(aiDelay(AI_DELAY.PLAYER_AUTO_KEEP));
        applySkillExecResult(execPreferGender(ctx, skill));
        break;
      }
      case 'free_draw_once': {
        // 整个招募环节仅限使用1次
        if (currentParticipant!.usedOneshotSkills.includes(skill.name)) return;
        lockPlayerAction(aiDelay(AI_DELAY.PLAYER_AUTO_KEEP));
        applySkillExecResult(execFreeDrawOnce(ctx, skill));
        break;
      }
    }
  };

  const handlePlayerSkip = () => {
    if (!isPlayerTurn) return;
    if (playerActionLock) return;
    if (currentParticipant!.skipUsed >= currentParticipant!.skipLimit) return;
    const delay = aiDelay(AI_DELAY.PLAYER_AFTER_SKIP);
    lockPlayerAction(delay);
    performSkip();
    setTimeout(() => advanceTurn(), delay);
  };

  const handlePlayerPickCandidate = (cardId: string) => {
    if (playerActionLock && !showCandidatePick) return; // 候选弹窗打开时本身就是锁定，允许通过
    const delay = aiDelay(AI_DELAY.PLAYER_AFTER_PICK);
    lockPlayerAction(delay);
    pickFromCandidates(cardId);
    setShowCandidatePick(false);
    // 玩家选完候选后没有后续操作 → 自动进入下一回合（延迟让闪现卡飘起来）
    setTimeout(() => advanceTurn(), delay);
  };

  const handlePlayerDesignate = (cardId: string) => {
    const delay = aiDelay(AI_DELAY.PLAYER_AFTER_PICK);
    lockPlayerAction(delay);
    const skill = playerActiveSkill!;
    const ctx = { participant: currentParticipant!, pool, baseCost: BASE_COST };
    applySkillExecResult(execDesignatePaid(ctx, skill, cardId));
    setShowDesignatePick(false);
    setTimeout(() => advanceTurn(), delay);
  };

  const handlePlayerAfterDraw = (action: 'return' | 'keep') => {
    if (playerActionLock) return;
    const delay = aiDelay(AI_DELAY.PLAYER_AFTER_POSTDRAW);
    lockPlayerAction(delay);
    if (action === 'return') postDrawReturn();
    else postDrawKeep();
    setTimeout(() => advanceTurn(), delay);
  };

  const handlePlayerSwitch = (newCardId: string) => {
    switchActiveCard(currentParticipant!.id, newCardId);
    setShowSwitchModal(false);
  };

  // ====== 结束环节 ======
  const handleFinishRecruit = () => {
    const player = participants.find((p) => p.isPlayer);
    if (player) {
      player.ownedCards
        .filter((c) => !c.isHeroBattleCard)
        .forEach((c) => addCard(c.id));
      // 玩家灵石来源 = 战斗考核 + 理论考核 + 拜师奖励（即 gameStore.spiritStones）
      // 招募过程中灵石变化 = player.gems - storeSpiritStones
      const delta = player.gems - storeSpiritStones;
      addSpiritStones(delta);
    }
    // ★ pool=2 (S6b) 结束时：把未抽走的 SR 列表保存起来，供 S6c(pool=3) 合并
    if (poolRound === 2) {
      try {
        const rs = useRecruitStore.getState();
        const leftoverSr = rs.pool
          .filter((c) => (c.rarity || '').toUpperCase() === 'SR')
          .map((c) => c.id);
        setPool2RemainingSr(leftoverSr);
      } catch (e) {
        console.warn('[S6b] 写入剩余SR失败', e);
      }
    }

    // ★ 写入 AI 道友快照（灵石 + 持卡），供下一轮招募继承使用
    try {
      const nextSnapshot: Record<string, { gems: number; ownedCardIds: string[]; s7aRewardGranted?: boolean }> = {};
      participants.forEach((p) => {
        if (p.isPlayer) return;
        nextSnapshot[p.id] = {
          gems: Math.max(0, p.gems),
          ownedCardIds: p.ownedCards
            .filter((c) => !c.isHeroBattleCard)
            .map((c) => c.id),
          // 一旦玩家进过剿匪（即 poolRound>=2 的那一轮），本轮已给 AI 补发过剿匪奖励
          // 标记为 true，防止下一轮（如 S6c）重复发奖
          s7aRewardGranted: poolRound >= 2 || !!(aiRecruitStateStore[p.id] as any)?.s7aRewardGranted,
        };
      });
      setAiRecruitState(nextSnapshot);
    } catch (e) {
      console.warn('[S6] 写入AI招募快照失败', e);
    }

    markRecruitDone();
    // pool=1 → 第二章招募完成；pool=2 → 第三章招募完成；pool=3 → 第四章招募完成
    markPhaseDone(poolRound === 3 ? 4 : poolRound === 2 ? 3 : 2);
    SaveSystem.save(1);
    // 招募3（S6c）完成 → 进入二次密谈 S8?round=2
    // 招募2（S6b）完成 → 切换到第四章并回到筹备页（而非直接跳剧情）
    // 招募1（S6a）完成 → 回筹备页 S6
    if (poolRound === 3) {
      SaveSystem.save(1);
      navigate('/s8?round=2');
    } else if (poolRound === 2) {
      setChapter(4);
      setSegmentIndex(0);
      SaveSystem.save(1);
      navigate('/s6');
    } else {
      navigate('/s6');
    }
  };

  // ====== 实时同步：玩家每抽到一张新卡，立刻回写到 gameStore.ownedCardIds
  //        这样无论玩家通过"返回筹备阶段"按钮还是其他方式离开，
  //        已抽到的卡都能在筹备阶段的"已收集"/"提升境界"界面正确显示 ======
  useEffect(() => {
    const player = participants.find((p) => p.isPlayer);
    if (!player) return;
    player.ownedCards
      .filter((c) => !c.isHeroBattleCard)
      .forEach((c) => addCard(c.id));
  }, [participants, addCard]);

  // 判断玩家是否应显示pre_draw技能按钮
  // - free_draw_once：检查是否已在usedOneshotSkills中（整个招募环节仅1次）
  // - preview_2/3：每个抽卡回合只能用一次（使用后phase立即变为candidate_pick，不会再显示）
  // - 其他pre_draw技能：检查灵石是否足够即可
  const shouldShowPreDrawSkillPrompt = useMemo(() => {
    if (!isPlayerTurn || phase !== 'turn_start' || playerSkillTiming !== 'pre_draw') return false;
    if (!playerActiveSkill || !currentParticipant) return false;

    // free_draw_once 类型：整个招募环节仅限1次
    if (playerActiveSkill.category === 'free_draw_once') {
      return !currentParticipant.usedOneshotSkills.includes(playerActiveSkill.name);
    }

    return true;
  }, [isPlayerTurn, phase, playerSkillTiming, playerActiveSkill, currentParticipant]);

  const shouldShowPostDrawSkillPrompt =
    isPlayerTurn && phase === 'drawing' && lastDrawnCard && playerSkillTiming === 'post_draw' &&
    playerActiveSkill?.category === 'return_for_gem' &&
    (currentParticipant?.returnForGemUsedThisBigRound ?? 0) < 3;

  // 玩家是否已离场（hasLeft=true）
  const playerParticipant = participants.find((p) => p.isPlayer);
  const playerHasLeft = !!playerParticipant?.hasLeft;

  // 玩家已离场时的正确语义：
  //   - 不再直接 set phase=ended（那会让 AI 全部停摆）
  //   - 改为：拉高倍速到 4x + 强制 autoPlay=true，让剩余 AI 快速跑完流程
  //   - 等 AI 自然触发所有人 hasLeft/灵石耗尽 → store 自己会 phase='ended'
  // 这样玩家能看到剩余 AI 抽完卡后的最终结算（公平也透明）
  const handleLeaveEarly = useCallback(() => {
    setSpeed(4);
    setAutoPlay(true);
    useRecruitStore.getState().pushLog({
      type: 'system',
      actor: 'system',
      text: '玩家选择提前离场，其余道友将快速抽完剩余回合……',
    });
  }, [setAutoPlay]);

  // ====== 玩家 drawing phase 自动推进 ======
  // 玩家若没有 post_draw 技能响应需求（非塘散"放回换灵石"场景），抽完自动进入下一回合
  // **关键**：必须先 postDrawKeep() 将卡牌加到 ownedCards，否则卡牌丢失！
  useEffect(() => {
    if (phase !== 'drawing') return;
    if (!isPlayerTurn) return;
    if (shouldShowPostDrawSkillPrompt) return;
    if (showCandidatePick || showDesignatePick) return;
    if (!lastDrawnCard) return;
    const t = setTimeout(() => {
      postDrawKeep();   // ← 先保留卡牌到 ownedCards
      advanceTurn();
    }, aiDelay(AI_DELAY.PLAYER_AUTO_KEEP));
    return () => clearTimeout(t);
  }, [phase, isPlayerTurn, shouldShowPostDrawSkillPrompt, showCandidatePick, showDesignatePick, lastDrawnCard, advanceTurn]);

  if (loading) {
    return (
      <div className={styles.screen}>
        <div className={styles.loading}>载入卡池中…</div>
      </div>
    );
  }

  const rarityCounts = countByRarity(pool);

  return (
    <div className={styles.screen}>
      <div className={styles.bg} />
      <div className={styles.bgVeil} />

      {/* ==================== 顶栏 6 元素 ==================== */}
      <div className={styles.topBar}>
        {/* 1. 返回（未来改为"设置"） */}
        <button
          className={styles.topIconBtn}
          onClick={handleFinishRecruit}
          title="返回"
          aria-label="返回"
        >
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12H5" />
            <path d="M12 19l-7-7 7-7" />
          </svg>
        </button>

        {/* 2. 阶段标题：按轮次区分（S6a=首轮/S6b=第二轮/S6c=精英轮） */}
        <div className={styles.topTitle}>
          {poolRound === 3 ? '招募 · 第三轮 · 神灵降世' :
           poolRound === 2 ? '招募 · 第二轮 · 群英荟萃' :
           '招募 · 第一轮 · 灵缘初现'}
        </div>

        {/* 占位 spacer：吃掉标题右侧所有剩余空间，把后 3 个按钮推到最右 */}
        <div className={styles.topSpacer} />

        {/* 3. 卡池信息（absolute 居中，不参与 flex） */}
        <div className={styles.topPoolSlot}>
          <CardPoolDisplay
            remaining={pool.length}
            total={initialPoolSize}
            rarityCounts={rarityCounts}
            onClick={() => setShowPoolDetail(true)}
          />
        </div>

        {/* 4. 暂停/播放 */}
        <button
          className={`${styles.topIconBtn} ${autoPlay ? '' : styles.active}`}
          onClick={() => setAutoPlay(!autoPlay)}
          title={autoPlay ? '暂停 AI 自动抽卡' : '继续 AI 自动抽卡'}
          aria-label="暂停/播放"
        >
          {autoPlay ? (
            <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
              <rect x="6" y="5" width="4" height="14" rx="1" />
              <rect x="14" y="5" width="4" height="14" rx="1" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
              <path d="M8 5v14l11-7z" />
            </svg>
          )}
        </button>

        {/* 5. 倍速 */}
        <button
          className={styles.topSpeedBtn}
          onClick={() => setSpeed((s) => (s === 1 ? 2 : s === 2 ? 4 : 1))}
          title={`当前 ${speed}x 倍速,点击切换`}
          aria-label="倍速切换"
        >
          ⏩ {speed}x
        </button>

        {/* 6. 音乐开关（占位） */}
        <button
          className={`${styles.topIconBtn} ${bgmEnabled ? '' : styles.active}`}
          onClick={toggleBgm}
          title={bgmEnabled ? '关闭音乐' : '开启音乐'}
          aria-label="音乐开关"
        >
          {bgmEnabled ? (
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 18V5l12-2v13" />
              <circle cx="7" cy="18" r="2" />
              <circle cx="19" cy="16" r="2" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 18V5l12-2v13" />
              <circle cx="7" cy="18" r="2" />
              <circle cx="19" cy="16" r="2" />
              <line x1="3" y1="3" x2="21" y2="21" />
            </svg>
          )}
        </button>
      </div>

      {/* ==================== 6 人座位 ==================== */}
      <div className={styles.seatsContainer}>
        {(() => {
          const playerIdx = drawOrder.findIndex((id) => {
            const p = participants.find((x) => x.id === id);
            return p?.isPlayer;
          });
          return drawOrder.map((id) => {
            const p = participants.find((x) => x.id === id);
            if (!p) return null;
            const isCurrent = currentParticipant?.id === p.id;
            const orderIdx = orderIndexById[p.id];
            let seatIndex = 0;
            if (!p.isPlayer) {
              const rel = (orderIdx - playerIdx + drawOrder.length) % drawOrder.length;
              seatIndex = rel;
            }
            return (
              <ParticipantSeat
                key={p.id}
                participant={p}
                orderIndex={orderIdx + 1}
                seatIndex={seatIndex}
                isCurrent={isCurrent}
                isHovered={hoveredParticipantId === p.id}
                flashCard={recentFlash[p.id] || null}
                onHoverStart={() => setHoveredParticipantId(p.id)}
                onHoverEnd={() => setHoveredParticipantId(null)}
                onOpenDeck={() => setViewDeckOf(p)}
              />
            );
          });
        })()}
      </div>

      {/* ==================== 中央 · 开始招募（仅首次）==================== */}
      {phase === 'order_reveal' && !recruitmentStarted && (
        <motion.div
          className={styles.startOverlay}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <div className={styles.startPanel}>
            <div className={styles.startMainTitle}>
              {poolRound === 3 ? '第三轮招募说明' :
               poolRound === 2 ? '第二轮招募说明' : '招募说明'}
            </div>
            <div className={styles.startIntro}>
              {poolRound === 3 ? (
                <>
                  宗门大比落幕，各位的实力被宗门高层看在眼里，灵石奖励落袋为安。
                  <br />
                  本轮卡池以十二张非绑定 SSR 为主，辅以上一轮未抽完的 SR 剩余
                  {pool2RemainingSr.length > 0 ? `（共 ${pool2RemainingSr.length} 张）` : '（本轮为 0 张）'}。
                  SSR 爆率远超以往，此乃最后一次大规模招募良机——为即将到来的决战打磨阵容吧。
                </>
              ) : poolRound === 2 ? (
                <>
                  经过宗门剿匪的历练，灵石储备得以扩充，如今开启第二轮招募。
                  <br />
                  本轮卡池汇聚各方 SR 道友（首轮 4 张彩蛋 SR 已除外），每张 SR 皆身怀战斗技能，阵容深度将决定宗门大比的胜负。
                </>
              ) : (
                <>
                  本轮卡池包含N/R卡，R卡拥有招募技能但无战斗技能，灵活运用R卡替换主角进行招募，能有效减少灵石消耗。
                  <br />
                  招募道友同时也记得储备一些灵石呀！
                </>
              )}
            </div>
            <div className={styles.startDivider} />
            <div className={styles.startTitle}>
              {poolRound === 3 ? '本轮按"宗门大比排名"排序（暂沿用剿匪战表现）' :
               poolRound === 2 ? '本轮按"宗门剿匪击杀数"排序（同数按心境值）' :
               '本轮根据"心境值高低"顺序依次抽卡'}
            </div>
            <div className={styles.startOrderRow}>
              {drawOrder.map((id, i) => {
                const p = participants.find((x) => x.id === id);
                return (
                  <div key={id} className={styles.startOrderChip}>
                    <span className={styles.startOrderNum}>{i + 1}</span>
                    <span className={styles.startOrderName}>{p?.name}</span>
                    {poolRound >= 2 && p && p.s7aKill >= 0 && (
                      <span className={styles.startOrderKill}>剿匪{p.s7aKill}</span>
                    )}
                  </div>
                );
              })}
            </div>
            <button
              className={styles.startBtn}
              onClick={() => startRecruitment()}
            >
              开始招募
            </button>
          </div>
        </motion.div>
      )}

      {/* ==================== 中央 · 玩家操作面板（非模态） ==================== */}
      {isPlayerTurn && phase === 'turn_start' && (
        <motion.div
          className={styles.actionPanel}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
        >
          <div className={styles.actionHeader}>
            <span className={styles.actionTitle}>轮到你了</span>
            <span className={styles.actionGems}>
              灵石 <strong>{currentParticipant?.gems}</strong>
            </span>
          </div>
          <div className={styles.actionButtons}>
            <button
              className={styles.actionBtn}
              onClick={() => setShowSwitchModal(true)}
              disabled={
                playerActionLock ||
                currentParticipant?.hasSwitchedThisTurn ||
                (participants.find((p) => p.id === currentParticipant?.id)?.ownedCards.length ?? 0) < 2
              }
            >
              {currentParticipant?.hasSwitchedThisTurn ? '本轮已替换' : '替换抽卡角色'}
            </button>
            {shouldShowPreDrawSkillPrompt && playerActiveSkill && (
              <button
                className={`${styles.actionBtn} ${styles.actionBtnSkill} ${styles.hasTooltip}`}
                onClick={handlePlayerUseSkill}
                disabled={playerActionLock}
                data-tooltip={`【${playerActiveSkill.name}】${playerActiveSkill.desc}`}
              >
                使用技能：{playerActiveSkill.name}
              </button>
            )}
            <button
              className={`${styles.actionBtn} ${styles.actionBtnDraw}`}
              onClick={handlePlayerDraw}
              disabled={playerActionLock || !currentParticipant || currentParticipant.gems < playerEffectiveCost}
            >
              抽卡（{playerEffectiveCost} 灵石）
            </button>
            <button
              className={`${styles.actionBtn} ${styles.hasTooltip}`}
              onClick={handlePlayerSkip}
              disabled={playerActionLock || !currentParticipant || currentParticipant.skipUsed >= currentParticipant.skipLimit}
              data-tooltip="保留灵石，给未来更多选择"
            >
              跳过（{currentParticipant?.skipUsed ?? 0}/{currentParticipant?.skipLimit ?? 3}）
            </button>
          </div>
        </motion.div>
      )}

      {/* ==================== 战报 ==================== */}
      <DrawLogPanel log={log} />

      {/* ==================== 玩家已离场 · 提前离场按钮 ==================== */}
      {playerHasLeft && phase !== 'ended' && (
        <motion.button
          className={styles.leaveEarlyBtn}
          onClick={handleLeaveEarly}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.3 }}
          title="直接进入结算界面"
        >
          提前离场 · 查看结算
        </motion.button>
      )}

      {/* ==================== 抽卡揭示（仅 AI 或玩家非 post_draw 回合展示）==================== */}
      {/* 注：目前用闪现位替代抽到后的大卡动画，这里只在玩家需要 post_draw 决策时显示大卡 */}
      <CardRevealAnimation
        card={pendingReveal}
        visible={phase === 'drawing' && !!pendingReveal && !!shouldShowPostDrawSkillPrompt}
        canDismiss={false}
        onFinish={() => {}}
      />

      {/* ==================== 中央 · post_draw 技能响应（塘散） ==================== */}
      <AnimatePresence>
        {shouldShowPostDrawSkillPrompt && lastDrawnCard && (
          <motion.div
            className={styles.postDrawPanel}
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
          >
            <div className={styles.postDrawTitle}>
              抽到【{lastDrawnCard.rarity} · {lastDrawnCard.name}】
            </div>

            {/* 卡牌详情：立绘 + 三维 + 技能 */}
            <div className={styles.postDrawCardDetail}>
              <div
                className={styles.postDrawPortrait}
                style={{ backgroundImage: `url(${getCachedImage(lastDrawnCard.id)})` }}
              />
              <div className={styles.postDrawCardInfo}>
                <div className={styles.postDrawCardStats}>
                  <span>修为 <strong>{lastDrawnCard.atk}</strong></span>
                  <span>心境 <strong>{lastDrawnCard.mnd}</strong></span>
                  <span>生命 <strong>{lastDrawnCard.hp}</strong></span>
                </div>
                <div className={styles.postDrawCardMeta}>
                  {lastDrawnCard.ip} · {lastDrawnCard.type} · {lastDrawnCard.realm}
                </div>
                {lastDrawnCard.runSkill && (
                  <div className={styles.postDrawCardSkill}>
                    <span className={styles.postDrawSkillName}>【{lastDrawnCard.runSkill.name}】</span>
                    <span className={styles.postDrawSkillDesc}>{lastDrawnCard.runSkill.desc}</span>
                  </div>
                )}
                {lastDrawnCard.battleSkill && (
                  <div className={styles.postDrawBattleSkill}>
                    <span className={styles.postDrawBattleSkillName}>【战斗·{lastDrawnCard.battleSkill.name}】</span>
                    <span className={styles.postDrawBattleSkillDesc}>{lastDrawnCard.battleSkill.desc}</span>
                  </div>
                )}
                {lastDrawnCard.ultimate && (
                  <div className={styles.postDrawUltimate}>
                    <span className={styles.postDrawUltimateName}>【绝技·{lastDrawnCard.ultimate.name}】</span>
                    <span className={styles.postDrawUltimateDesc}>{lastDrawnCard.ultimate.desc}</span>
                  </div>
                )}
              </div>
            </div>

            <div className={styles.postDrawDesc}>
              是否使用【{playerActiveSkill!.name}】？{playerActiveSkill!.desc}
（本次招募剩余 {3 - (currentParticipant?.returnForGemUsedThisBigRound ?? 0)} 次）
            </div>
            <div className={styles.postDrawGems}>
              当前灵石 <strong>{currentParticipant?.gems}</strong>
            </div>
            <div className={styles.postDrawActions}>
              <button
                className={styles.postDrawBtnOk}
                onClick={() => handlePlayerAfterDraw('return')}
                disabled={playerActionLock}
              >
                放回换 {playerActiveSkill!.params?.reward ?? 7} 灵石
              </button>
              <button
                className={styles.postDrawBtnSkip}
                onClick={() => handlePlayerAfterDraw('keep')}
                disabled={playerActionLock}
              >
                保留此卡
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ==================== 候选卡选择 ==================== */}
      <CandidatePickModal
        open={showCandidatePick}
        candidates={candidates}
        onPick={handlePlayerPickCandidate}
      />

      {/* ==================== 指定抽弹窗 ==================== */}
      <DesignatePickModal
        open={showDesignatePick}
        pool={pool}
        onPick={handlePlayerDesignate}
        onClose={() => setShowDesignatePick(false)}
      />

      {/* ==================== 替换抽卡角色弹窗 ==================== */}
      {currentParticipant && (
        <SwitchCardModal
          open={showSwitchModal}
          participant={currentParticipant}
          onPick={handlePlayerSwitch}
          onClose={() => setShowSwitchModal(false)}
        />
      )}

      {/* ==================== 查看他人持卡册 ==================== */}
      <ViewDeckModal
        open={!!viewDeckOf}
        participant={viewDeckOf}
        onClose={() => setViewDeckOf(null)}
      />

      {/* ==================== 卡池详情弹窗 ==================== */}
      <AnimatePresence>
        {showPoolDetail && (
          <motion.div
            className={styles.poolDetailOverlay}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setShowPoolDetail(false)}
          >
            <motion.div
              className={styles.poolDetailPanel}
              initial={{ scale: 0.85 }}
              animate={{ scale: 1 }}
              onClick={(e) => e.stopPropagation()}
            >
              <h2>卡池剩余</h2>
              <div className={styles.poolDetailStats}>
                {rarityCounts.SSR > 0 && <div><span style={{ color: '#ffd65e' }}>SSR</span>：{rarityCounts.SSR} 张</div>}
                {rarityCounts.SR > 0 && <div><span style={{ color: '#b47bff' }}>SR</span>：{rarityCounts.SR} 张</div>}
                {rarityCounts.R > 0 && <div><span style={{ color: '#8ac7ff' }}>R</span>：{rarityCounts.R} 张</div>}
                {rarityCounts.N > 0 && <div><span style={{ color: '#a7c9a0' }}>N</span>：{rarityCounts.N} 张</div>}
              </div>
              <div className={styles.poolDetailTotal}>共 {pool.length} 张</div>
              <button className={styles.poolDetailClose} onClick={() => setShowPoolDetail(false)}>
                关闭
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ==================== 结束覆盖层 ==================== */}
      {phase === 'ended' && (
        <div className={styles.endOverlay}>
          <div className={styles.endPanel}>
            <h1>
              {poolRound === 3 ? '第三轮招募结束' :
               poolRound === 2 ? '第二轮招募结束' : '本轮招募结束'}
            </h1>
            <div className={styles.endStats}>
              {participants.map((p) => (
                <div key={p.id} className={styles.endRow}>
                  <span>{p.name}</span>
                  <span>收集 {p.ownedCards.length - 1} 张</span>
                  <span>剩余 {p.gems} 灵石</span>
                </div>
              ))}
            </div>
            <button className={styles.finishBtn} onClick={handleFinishRecruit}>
              {poolRound === 3 ? '进入二次密谈' :
               poolRound === 2 ? '返回筹备阶段' : '返回筹备阶段'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default S6_Recruit;

/**
 * 抽卡系统状态管理（独立 zustand store）
 * 只在 S6 抽卡场景中使用，结束后数据回流到 gameStore
 */
import { create } from 'zustand';
import type {
  RecruitState,
  Participant,
  PoolCard,
  DrawLogEntry,
  RecruitPhase,
  RunSkillDef,
} from '@/types/recruit';
import type { HeroId } from '@/types/game';
import { shuffle, drawTopN } from '@/systems/recruit/cardPoolLoader';
import {
  calcDrawCost,
  getSkillTiming,
  execReturnForGem,
  execRerollIfNRarity,
  execBonusByType,
  execSkipReward,
  checkAccumReward,
} from '@/systems/recruit/runSkillEngine';

interface RecruitStore extends RecruitState {
  // === 初始化 ===
  initialize: (params: {
    participants: Participant[];
    pool: PoolCard[];
  }) => void;
  reset: () => void;

  // === 阶段控制 ===
  setPhase: (phase: RecruitPhase) => void;
  setAutoPlay: (v: boolean) => void;
  /** 玩家点击"开始招募"按钮后调用，启动第一个回合 */
  startRecruitment: () => void;

  // === 查询 ===
  getCurrentParticipant: () => Participant | null;
  getActiveSkill: (p?: Participant) => RunSkillDef | null;
  getEffectiveCost: (p?: Participant) => number;

  // === 参与者操作 ===
  updateParticipant: (id: string, patch: Partial<Participant>) => void;
  switchActiveCard: (participantId: string, newCardId: string) => void;

  // === 抽卡流程 ===
  startTurn: () => void;
  performNormalDraw: () => PoolCard | null;
  applySkillExecResult: (res: {
    gemDelta: number;
    pool: PoolCard[];
    gainedCards: PoolCard[];
    candidates?: PoolCard[];
    logText: string;
  }) => void;
  pickFromCandidates: (pickedId: string) => void;
  postDrawReturn: () => void;   // 塘散等 return_for_gem
  postDrawKeep: () => void;     // 默认保留抽到的卡
  performSkip: () => void;
  advanceTurn: () => void;

  // === 战报 ===
  pushLog: (entry: Omit<DrawLogEntry, 'id' | 'timestamp'>) => void;
}

const initialState: RecruitState = {
  phase: 'init',
  recruitmentStarted: false,
  participants: [],
  drawOrder: [],
  currentTurnIndex: 0,
  bigRound: 1,
  pool: [],
  initialPoolSize: 0,
  autoPlay: true,
  log: [],
  pendingReveal: null,
  candidates: [],
  lastDrawnCard: null,
};

let logIdCounter = 1;

export const useRecruitStore = create<RecruitStore>((set, get) => ({
  ...initialState,

  initialize: ({ participants, pool }) => {
    // 抽卡顺序排序主键（从高到低）：
    //   1) s7aKill  — 宗门剿匪击杀数（仅 S6b 有效，S6a 全员 -1 回落到下一键）
    //   2) baseMnd  — 心境值（击杀数相同或未剿匪时使用）
    //   3) baseAtk  — 修为值（兜底平手）
    const drawOrder = participants
      .slice()
      .sort((a, b) => {
        if (b.s7aKill !== a.s7aKill) return b.s7aKill - a.s7aKill;
        if (b.baseMnd !== a.baseMnd) return b.baseMnd - a.baseMnd;
        return b.baseAtk - a.baseAtk;
      })
      .map((p) => p.id);
    set({
      ...initialState,
      participants,
      drawOrder,
      pool: shuffle(pool),
      initialPoolSize: pool.length,
      phase: 'order_reveal',
      log: [],
    });
    logIdCounter = 1;
  },

  reset: () => set({ ...initialState }),

  setPhase: (phase) => set({ phase }),

  setAutoPlay: (v) => set({ autoPlay: v }),

  startRecruitment: () => {
    const s = get();
    if (s.recruitmentStarted) return;
    set({ recruitmentStarted: true });
    get().pushLog({
      type: 'system',
      actor: 'system',
      text: '—— 招募环节开始 ——',
    });
    get().startTurn();
  },

  getCurrentParticipant: () => {
    const s = get();
    const id = s.drawOrder[s.currentTurnIndex];
    return s.participants.find((p) => p.id === id) ?? null;
  },

  getActiveSkill: (p) => {
    const participant = p ?? get().getCurrentParticipant();
    if (!participant) return null;
    const active = participant.ownedCards.find((c) => c.id === participant.activeCardId);
    return active?.runSkill ?? null;
  },

  getEffectiveCost: (p) => {
    const s = get();
    const baseCost = 5;  // NR 池基础费用
    const skill = s.getActiveSkill(p);
    return calcDrawCost(baseCost, skill);
  },

  updateParticipant: (id, patch) =>
    set((s) => ({
      participants: s.participants.map((p) => (p.id === id ? { ...p, ...patch } : p)),
    })),

  switchActiveCard: (participantId, newCardId) =>
    set((s) => {
      const p = s.participants.find((x) => x.id === participantId);
      if (!p) return s;
      const newCard = p.ownedCards.find((c) => c.id === newCardId);
      if (!newCard) return s;
      const prevCard = p.ownedCards.find((c) => c.id === p.activeCardId);

      // 推送日志
      const log: DrawLogEntry = {
        id: `log-${logIdCounter++}`,
        timestamp: Date.now(),
        type: 'switch',
        actor: participantId,
        text: `${p.name} 将抽卡角色从 ${prevCard?.name ?? '?'} 换成 ${newCard.name}`,
      };

      return {
        participants: s.participants.map((x) =>
          x.id === participantId
            ? { ...x, activeCardId: newCardId, hasSwitchedThisTurn: true }
            : x,
        ),
        log: [...s.log, log],
      };
    }),

  startTurn: () => {
    const s = get();
    const p = s.getCurrentParticipant();
    if (!p) return;
    // 重置本轮替换状态
    get().updateParticipant(p.id, {
      hasSwitchedThisTurn: false,
    });
    get().pushLog({
      type: 'system',
      actor: p.id,
      text: `—— 轮到 ${p.name} 抽卡（顺位 ${s.currentTurnIndex + 1}）——`,
    });
    if (s.phase !== 'turn_start') set({ phase: 'turn_start' });
  },

  performNormalDraw: () => {
    const s = get();
    const p = s.getCurrentParticipant();
    if (!p || s.pool.length === 0) return null;

    const cost = s.getEffectiveCost(p);
    if (p.gems < cost) return null;

    const { drawn, remaining } = drawTopN(s.pool, 1);
    const card = drawn[0];
    if (!card) return null;

    set({
      pool: remaining,
      pendingReveal: card,
      lastDrawnCard: card,
      phase: 'drawing',
    });
    // 扣灵石
    get().updateParticipant(p.id, {
      gems: p.gems - cost,
    });
    get().pushLog({
      type: 'draw',
      actor: p.id,
      text: `${p.name} 消耗 ${cost} 灵石抽到 [${card.rarity}] ${card.name}`,
    });

    // 触发 T3·on_draw 类技能（bonus_by_type）
    const skill = s.getActiveSkill(p);
    if (skill && skill.category === 'bonus_by_type') {
      const bonus = execBonusByType(skill, card);
      if (bonus.gemDelta > 0) {
        const p2 = get().getCurrentParticipant()!;
        get().updateParticipant(p.id, { gems: p2.gems + bonus.gemDelta });
        get().pushLog({ type: 'reward', actor: p.id, text: bonus.logText });
      }
    }

    return card;
  },

  applySkillExecResult: (res) => {
    const s = get();
    const p = s.getCurrentParticipant();
    if (!p) return;

    set({
      pool: res.pool,
      candidates: res.candidates ?? [],
    });

    get().updateParticipant(p.id, {
      gems: p.gems + res.gemDelta,
      ownedCards: [...p.ownedCards, ...res.gainedCards],
      rCardsDrawnThisTurn: [
        ...p.rCardsDrawnThisTurn,
        ...res.gainedCards.filter((c) => c.rarity === 'R').map((c) => c.id),
      ],
    });

    get().pushLog({ type: 'skill', actor: p.id, text: res.logText });

    // 记录技能使用
    const skill = s.getActiveSkill(p);
    if (skill) {
      const p2 = get().getCurrentParticipant()!;
      const newCount = (p2.skillUseCount[skill.name] ?? 0) + 1;
      get().updateParticipant(p.id, {
        skillUseCount: { ...p2.skillUseCount, [skill.name]: newCount },
      });

      // 一次性技能标记
      if (skill.category === 'free_draw_once') {
        get().updateParticipant(p.id, {
          usedOneshotSkills: [...p2.usedOneshotSkills, skill.name],
        });
      }

      // 检查累计奖励
      const accum = checkAccumReward(get().getCurrentParticipant()!, skill);
      if (accum.triggered) {
        const p3 = get().getCurrentParticipant()!;
        get().updateParticipant(p.id, {
          gems: p3.gems + accum.gemDelta,
          usedOneshotSkills: [...p3.usedOneshotSkills, skill.name],
        });
        get().pushLog({ type: 'reward', actor: p.id, text: accum.logText });
      }
    }

    if (res.candidates && res.candidates.length > 0) {
      set({ phase: 'candidate_pick' });
    } else if (res.gainedCards.length > 0) {
      set({ phase: 'drawing', pendingReveal: res.gainedCards[res.gainedCards.length - 1], lastDrawnCard: res.gainedCards[res.gainedCards.length - 1] });
    }
  },

  pickFromCandidates: (pickedId) => {
    const s = get();
    const p = s.getCurrentParticipant();
    if (!p) return;
    const picked = s.candidates.find((c) => c.id === pickedId);
    if (!picked) return;
    const discarded = s.candidates.filter((c) => c.id !== pickedId);

    // 未选中的卡放回池底
    set({
      pool: [...s.pool, ...discarded],
      candidates: [],
      pendingReveal: picked,
      lastDrawnCard: picked,
      phase: 'drawing',
    });

    get().updateParticipant(p.id, {
      ownedCards: [...p.ownedCards, picked],
      rCardsDrawnThisTurn: picked.rarity === 'R'
        ? [...p.rCardsDrawnThisTurn, picked.id]
        : p.rCardsDrawnThisTurn,
    });

    get().pushLog({
      type: 'draw',
      actor: p.id,
      text: `${p.name} 从候选中保留 [${picked.rarity}] ${picked.name}，放回 ${discarded.length} 张`,
    });
  },

  postDrawReturn: () => {
    const s = get();
    const p = s.getCurrentParticipant();
    if (!p || !s.lastDrawnCard) return;
    const skill = s.getActiveSkill(p);
    if (!skill || skill.category !== 'return_for_gem') return;

    // 每大轮限制使用 3 次（文案上称为"单轮限3次"）
    if (p.returnForGemUsedThisBigRound >= 3) {
      get().pushLog({ type: 'system', actor: p.id, text: `【${skill.name}】单轮已使用3次，无法再使用` });
      return;
    }

    const res = execReturnForGem(skill, s.lastDrawnCard, s.pool);
    set({ pool: res.pool, lastDrawnCard: null, pendingReveal: null });
    get().updateParticipant(p.id, {
      gems: p.gems + res.gemDelta,
      ownedCards: p.ownedCards.filter((c) => c.id !== s.lastDrawnCard!.id),
      rCardsDrawnThisTurn: p.rCardsDrawnThisTurn.filter((id) => id !== s.lastDrawnCard!.id),
      returnForGemUsedThisBigRound: p.returnForGemUsedThisBigRound + 1,
    });
    get().pushLog({ type: 'skill', actor: p.id, text: `${res.logText}（单轮${p.returnForGemUsedThisBigRound + 1}/3）` });
  },

  postDrawKeep: () => {
    const s = get();
    const p = s.getCurrentParticipant();
    if (!p || !s.lastDrawnCard) return;

    // 将抽到的卡加到 owned（normalDraw 时只扣灵石没加 owned）
    const alreadyOwned = p.ownedCards.some((c) => c.id === s.lastDrawnCard!.id);
    if (!alreadyOwned) {
      get().updateParticipant(p.id, {
        ownedCards: [...p.ownedCards, s.lastDrawnCard],
        rCardsDrawnThisTurn: s.lastDrawnCard.rarity === 'R'
          ? [...p.rCardsDrawnThisTurn, s.lastDrawnCard.id]
          : p.rCardsDrawnThisTurn,
      });
    }

    // 检查 reroll_n 技能（柳二龙/海波东）
    const skill = s.getActiveSkill(p);
    if (skill && skill.category === 'reroll_n') {
      const reroll = execRerollIfNRarity(skill, s.lastDrawnCard, s.pool);
      if (reroll.triggered && reroll.card) {
        // 移除刚保留的卡，加入新抽到的
        set({ pool: reroll.pool, lastDrawnCard: reroll.card, pendingReveal: reroll.card });
        const p2 = get().getCurrentParticipant()!;
        get().updateParticipant(p.id, {
          ownedCards: [
            ...p2.ownedCards.filter((c) => c.id !== s.lastDrawnCard!.id),
            reroll.card,
          ],
          rCardsDrawnThisTurn: reroll.card.rarity === 'R'
            ? [...p2.rCardsDrawnThisTurn.filter((id) => id !== s.lastDrawnCard!.id), reroll.card.id]
            : p2.rCardsDrawnThisTurn.filter((id) => id !== s.lastDrawnCard!.id),
        });
        get().pushLog({ type: 'skill', actor: p.id, text: reroll.logText });
      }
    }
  },

  performSkip: () => {
    const s = get();
    const p = s.getCurrentParticipant();
    if (!p) return;

    // 扣跳过次数
    const newSkipUsed = p.skipUsed + 1;
    const leftNow = newSkipUsed >= p.skipLimit;
    get().updateParticipant(p.id, {
      skipUsed: newSkipUsed,
      hasLeft: leftNow ? true : p.hasLeft,
    });

    // 触发 skip_reward
    const skill = s.getActiveSkill(p);
    if (skill && skill.category === 'skip_reward') {
      const reward = execSkipReward(skill);
      const p2 = get().getCurrentParticipant()!;
      get().updateParticipant(p.id, { gems: p2.gems + reward.gemDelta });
      get().pushLog({ type: 'reward', actor: p.id, text: reward.logText });
    }

    get().pushLog({
      type: 'skip',
      actor: p.id,
      text: `${p.name} 主动跳过本轮抽卡（已用 ${newSkipUsed}/${p.skipLimit}）`,
    });

    if (leftNow) {
      get().pushLog({
        type: 'system',
        actor: p.id,
        text: `${p.name} 招募结束，已离场。`,
      });
    }
  },

  advanceTurn: () => {
    const s = get();

    // 查找下一位还在场的参与者（跳过 hasLeft=true 的）
    let nextIndex = s.currentTurnIndex;
    let nextBigRound = s.bigRound;
    let loops = 0;
    const total = s.drawOrder.length;

    while (loops < total) {
      nextIndex = (nextIndex + 1) % total;
      if (nextIndex === 0) nextBigRound += 1;
      const nextId = s.drawOrder[nextIndex];
      const nextP = s.participants.find((p) => p.id === nextId);
      if (nextP && !nextP.hasLeft) break;
      loops += 1;
    }

    // 检查结束条件：全员已离场 / 全员无法继续 / 卡池空
    const allOut = s.participants.every((p) => {
      if (p.hasLeft) return true;
      const skill = p.ownedCards.find((c) => c.id === p.activeCardId)?.runSkill ?? null;
      const cost = calcDrawCost(5, skill);
      return p.gems < cost || p.skipUsed >= p.skipLimit;
    });
    if (allOut || s.pool.length === 0 || loops >= total) {
      set({ phase: 'ended', lastDrawnCard: null, pendingReveal: null, candidates: [] });
      get().pushLog({
        type: 'system',
        actor: 'system',
        text: s.pool.length === 0
          ? `卡池已抽空，抽卡环节结束。`
          : `全员已无法继续抽卡，抽卡环节结束。`,
      });
      return;
    }

    // 进入新大轮，清空本轮 R 卡记录（上轮抽到的 R 卡下轮可用）
    // 注意：returnForGemUsedThisBigRound 不在此处重置，"单轮"指整个招募环节（共3次）
    if (nextBigRound > s.bigRound) {
      set((st) => ({
        participants: st.participants.map((p) => ({
          ...p,
          rCardsDrawnThisTurn: [],
          hasSwitchedThisTurn: false,
        })),
      }));
    }

    // 先 set 成 turn_end 哨兵相位，确保 useEffect 能监听到 phase 变化
    set({
      phase: 'turn_end',
      currentTurnIndex: nextIndex,
      bigRound: nextBigRound,
      lastDrawnCard: null,
      pendingReveal: null,
      candidates: [],
    });
    // 下一 tick 进入 turn_start，避免相同 phase 导致 useEffect 不触发
    // 并同时调用 startTurn()，写入 "—— 轮到 XX 抽卡（顺位 N）——" 头日志
    setTimeout(() => {
      get().startTurn();
    }, 50);
  },

  pushLog: (entry) =>
    set((s) => ({
      log: [
        ...s.log,
        {
          ...entry,
          id: `log-${logIdCounter++}`,
          timestamp: Date.now(),
        },
      ],
    })),
}));

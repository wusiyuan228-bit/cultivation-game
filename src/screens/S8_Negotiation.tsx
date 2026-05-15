/**
 * S8 密谈环节 — v2（按用户口述规则重写）
 *
 * 规则：
 *  - 密谈次数 = ⌈主角心境（含 cardBonuses.mnd + 藏经阁拜师加成）÷ 2⌉
 *  - 我 ≥ 对方 心境 → 必得对方已知线索池中的一条（未重复）
 *  - 对方 > 我 心境 → 50% 真话 / 50% 伪造假线索
 *
 * 右上角仍提供"已知线索"库按钮，支持 ?round=1|2|3 复用。
 *
 * 2026-05-01 v2 重写：改用 /config/events/npc_dialogues.json 作为问答源
 *   · 移除坦诚度设计
 *   · 心境值改为 getEffectiveHeroStats(id, { includeMentor: id===玩家heroId }).mnd
 */
import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { BackButton } from '@/components/BackButton';
import { useReturnToMenu } from '@/hooks/useReturnToMenu';
import { PrimaryButton } from '@/components/PrimaryButton';
import { MusicToggle } from '@/components/MusicToggle';
import { CommonHud } from '@/components/CommonHud';
import { useGameStore, SaveSystem } from '@/stores/gameStore';
import type { ClueEntry } from '@/stores/gameStore';
import { getHeroById } from '@/hooks/useConfig';
import { HEROES_S1S2_ORDER } from '@/data/heroConstants';
import { HEROES_DATA } from '@/data/heroesData';
import type { HeroId } from '@/types/game';
import {
  loadNpcDialogues,
  findDialogueGroup,
  getAccumulatedClueTitles,
  judgeNegotiation,
  calcNegotiationCount,
  isSpecialPair,
  type NpcDialogueQuestion,
  type NpcDialoguesFile,
  type NegotiationResult,
} from '@/data/s8NegotiationData';
import { ensureBindCardsLoaded } from '@/systems/recruit/cardPoolLoader';
import { getEffectiveHeroStats } from '@/utils/heroStats';
import styles from './S8_Negotiation.module.css';

type Stage = 'intro' | 'pickHero' | 'pickTopic' | 'answer' | 'allDone';

/** 计算某主角的心境（含境界提升 + 玩家自己时叠加藏经阁拜师加成） */
function useBattleMnd(heroId: HeroId | null): number {
  const cardBonuses = useGameStore((s) => s.cardBonuses);
  const knowledgeBonus = useGameStore((s) => s.knowledgeBonus);
  const playerHeroId = useGameStore((s) => s.heroId);
  return useMemo(() => {
    if (!heroId) return 0;
    // 单一属性方案：取统一基础值 + 境界提升 + (是玩家本人时)藏经阁加成
    const eff = getEffectiveHeroStats(heroId, { includeMentor: heroId === playerHeroId });
    return eff.mnd;
    // 依赖 cardBonuses/knowledgeBonus 仅为驱动 useMemo 重算
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [heroId, cardBonuses, knowledgeBonus, playerHeroId]);
}

export const S8_Negotiation: React.FC = () => {
  const navigate = useNavigate();
  const returnToMenu = useReturnToMenu();
  const [searchParams] = useSearchParams();
  const round = (Number(searchParams.get('round')) || 1) as 1 | 2 | 3;

  const heroId = useGameStore((s) => s.heroId);
  const heroName = useGameStore((s) => s.heroName);
  const clueEntries = useGameStore((s) => s.clueEntries);
  const askedTopics = useGameStore((s) => s.negotiationAskedTopics);
  const addClueEntry = useGameStore((s) => s.addClueEntry);
  const markTopicAsked = useGameStore((s) => s.markTopicAsked);
  const recordNegotiationWith = useGameStore((s) => s.recordNegotiationWith);
  const markPhaseDone = useGameStore((s) => s.markPhaseDone);
  const setChapter = useGameStore((s) => s.setChapter);
  const setSegmentIndex = useGameStore((s) => s.setSegmentIndex);
  const setFinalFaction = useGameStore((s) => s.setFinalFaction);

  const myMnd = useBattleMnd(heroId);

  // JSON 配置加载
  const [dialoguesFile, setDialoguesFile] = useState<NpcDialoguesFile | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  useEffect(() => {
    loadNpcDialogues()
      .then(setDialoguesFile)
      .catch((e) => setLoadErr(e?.message ?? '加载失败'));
    // ★ 双保险：第五章发放的绑定 SSR/SR 需通过 getPoolCardById 解析，
    //   在 S8 密谈页面挂载时补一次加载，避免从存档直跳 S8 时缓存未就绪。
    ensureBindCardsLoaded();
  }, []);

  const maxCount = useMemo(() => calcNegotiationCount(myMnd), [myMnd]);
  const [usedCount, setUsedCount] = useState(0);

  // 流程状态
  const [stage, setStage] = useState<Stage>('intro');
  const [selectedHero, setSelectedHero] = useState<HeroId | null>(null);
  const [selectedQuestion, setSelectedQuestion] = useState<NpcDialogueQuestion | null>(null);
  const [lastResult, setLastResult] = useState<NegotiationResult | null>(null);

  const [showClueLib, setShowClueLib] = useState(false);

  /** 其他 5 位主角（排除自己） */
  const otherHeroes = useMemo(
    () => HEROES_S1S2_ORDER.filter((h) => h.id !== heroId),
    [heroId],
  );

  /** 选中对象对应的对话组 + 可问问题（过滤已问过） */
  const selectedGroup = useMemo(() => {
    if (!dialoguesFile || !selectedHero || !heroId) return undefined;
    return findDialogueGroup(dialoguesFile, heroId, selectedHero);
  }, [dialoguesFile, selectedHero, heroId]);

  const availableQuestions = useMemo<NpcDialogueQuestion[]>(() => {
    if (!selectedGroup) return [];
    return selectedGroup.questions.filter((q) => !askedTopics.includes(q.id));
  }, [selectedGroup, askedTopics]);

  // ====== 流程处理 ======

  const handleStart = () => setStage('pickHero');

  const handlePickHero = (hid: HeroId) => {
    setSelectedHero(hid);
    setStage('pickTopic');
  };

  const handlePickQuestion = (q: NpcDialogueQuestion) => {
    if (!selectedHero || !heroId) return;

    const targetHero = HEROES_DATA.find((h) => h.id === selectedHero);
    // 对方是 AI 主角，自动叠加其 AI 拜师加成（getEffectiveHeroStats 默认 includeMentor: true）
    const targetMnd = targetHero
      ? getEffectiveHeroStats(selectedHero).mnd
      : 0;

    const targetKnown = getAccumulatedClueTitles(selectedHero, round);
    const myOwned = clueEntries.map((e) => e.title);

    const result = judgeNegotiation({
      myMnd,
      targetMnd,
      targetKnownClues: targetKnown,
      myOwnedClueTitles: myOwned,
      honestAnswer: q.honest_answer,
      evasiveAnswer: q.evasive_answer,
      hiddenInfo: q.hidden_info,
      askerIsXiaowu: heroId === 'hero_xiaowu',
      askerIsXuner: heroId === 'hero_xuner',
      specialPair: isSpecialPair(heroId, selectedHero),
    });

    // 结果写入
    if (result.kind === 'truth' || result.kind === 'truth_luck') {
      addClueEntry({
        id: `clue_${result.clueTitle}`,   // 标题即唯一id
        title: result.clueTitle,
        summary:
          result.kind === 'truth'
            ? `${result.honestAnswer}（来自 ${targetHero?.name} 的密谈）`
            : `${result.honestAnswer}（来自 ${targetHero?.name} 的密谈，心境劣势仍获真言）`,
        source: 'negotiation',
        fromHero: selectedHero,
        round,
      });
      // 薰儿·古族血脉感应：额外再入一条
      if (result.bonusClueTitle) {
        addClueEntry({
          id: `clue_${result.bonusClueTitle}`,
          title: result.bonusClueTitle,
          summary: `（薰儿·古族血脉感应 额外洞察）来自 ${targetHero?.name} 的隐情`,
          source: 'negotiation',
          fromHero: selectedHero,
          round,
        });
      }
    } else if (result.kind === 'fake') {
      // 伪线索：标注 fake，便于线索库区分
      addClueEntry({
        id: `fake_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        title: '【存疑情报】',
        summary: `${result.fakeClueText}（来自 ${targetHero?.name}，心境劣势下情报真伪存疑）`,
        source: 'negotiation',
        fromHero: selectedHero,
        round,
      });
    }

    markTopicAsked(q.id);
    recordNegotiationWith(selectedHero);

    setSelectedQuestion(q);
    setLastResult(result);
    setStage('answer');
  };

  const handleFinishTalk = () => {
    const newUsed = usedCount + 1;
    setUsedCount(newUsed);
    setSelectedHero(null);
    setSelectedQuestion(null);
    setLastResult(null);
    if (newUsed >= maxCount) setStage('allDone');
    else setStage('pickHero');
  };

  /** S8c 站边弹窗显示状态（仅 round=3 使用） */
  const [showFactionPick, setShowFactionPick] = useState(false);

  const handleEndEarly = () => setStage('allDone');

  const handleConfirmEnd = () => {
    if (round === 1) {
      // S8a 结束 → 第三章 phase 完成（S7A+S8a 打通）
      // 注：S7A 结束时也会 markPhaseDone(3)，这里重复标记为防御性补齐，
      //     避免玩家通过测试入口直接进入 S8a 时 phase 3 漏标
      markPhaseDone(3);
      SaveSystem.save(1);
      navigate('/s6r?pool=2');
    } else if (round === 2) {
      // S8b 结束 → 切换到第五章剧情起点
      markPhaseDone(4);
      setChapter(5);
      setSegmentIndex(0);
      SaveSystem.save(1);
      navigate('/story');
    } else {
      // S8c 结束 → 判断主角是否为"摇摆位"（寒立 / 旺林）
      //   - 摇摆位：弹出"阵容站边"选择弹窗，由玩家二选一
      //   - 非摇摆位（塘散/小舞儿/萧焱/薰儿）：阵营由 heroesData 固定，跳过弹窗直接跳转
      const mainHero = HEROES_DATA.find((h) => h.id === heroId);
      const isSwing = mainHero?.faction === '摇摆';
      if (isSwing) {
        setShowFactionPick(true);
      } else {
        // 非摇摆位：按 heroesData 的 faction 字段直接写入（A/B），跳过弹窗
        //   setFinalFaction 内部会自动随机分配寒立/旺林到两端
        const fixedFaction = (mainHero?.faction === 'B' ? 'B' : 'A') as 'A' | 'B';
        setFinalFaction(fixedFaction);
        markPhaseDone(5);
        SaveSystem.save(1);
        navigate('/s7d');
      }
    }
  };

  /** S8c 站边确认回调：玩家选择阵营后写入 gameStore 并跳转备战/主菜单 */
  const handleConfirmFaction = (faction: 'A' | 'B') => {
    setFinalFaction(faction);
    markPhaseDone(5);
    SaveSystem.save(1);
    navigate('/s7d');
  };

  // ====== 渲染 ======

  const roundTitle = '密谈环节';

  if (loadErr) {
    return (
      <div className={styles.screen}>
        <BackButton onClick={returnToMenu} />
        <div className={styles.container}>
          <div className={styles.panel}>
            <div className={styles.panelTitle}>配置加载失败</div>
            <div className={styles.doneDesc}>{loadErr}</div>
          </div>
        </div>
      </div>
    );
  }
  if (!dialoguesFile) {
    return (
      <div className={styles.screen}>
        <div className={styles.container}>
          <div className={styles.panel}>
            <div className={styles.panelTitle}>密谈配置加载中…</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.screen}>
      <div className={styles.bgOverlay} />
      <BackButton onClick={returnToMenu} />
      <MusicToggle />
      <CommonHud chapter={round === 1 ? 3 : round === 2 ? 4 : 5} />

      <div className={styles.topBar}>
        <div className={styles.topTitle}>{roundTitle}</div>
        <div className={styles.topInfo}>
          <span className={styles.infoChip}>
            <b>{heroName || '—'}</b> · 心境 <b>{myMnd}</b>
          </span>
          {heroId === 'hero_xiaowu' && (
            <span className={`${styles.infoChip} ${styles.skillChipXiaowu}`}>
              🦊 妖力感知
            </span>
          )}
          {heroId === 'hero_xuner' && (
            <span className={`${styles.infoChip} ${styles.skillChipXuner}`}>
              🌸 古族血脉感应
            </span>
          )}
          <span className={styles.infoChip}>
            剩余次数 <b>{Math.max(0, maxCount - usedCount)}</b> / {maxCount}
          </span>
        </div>
      </div>

      {/* 左下角：已知线索按钮（避开右下 CommonHud 与右上 MusicToggle） */}
      <button className={styles.clueLibBtn} onClick={() => setShowClueLib(true)}>
        📜 已知线索 <span className={styles.clueLibCount}>{clueEntries.length}</span>
      </button>

      <div className={styles.container}>
        <AnimatePresence mode="wait">
          {stage === 'intro' && (
            <IntroPanel
              key="intro"
              myMnd={myMnd}
              maxCount={maxCount}
              cluesOwned={clueEntries.length}
              heroId={heroId}
              onStart={handleStart}
            />
          )}

          {stage === 'pickHero' && (
            <PickHeroPanel
              key="pickHero"
              heroes={otherHeroes}
              myMnd={myMnd}
              askerHeroId={heroId}
              onPick={handlePickHero}
              onEndEarly={handleEndEarly}
              remaining={maxCount - usedCount}
              round={round}
              myOwnedTitles={clueEntries.map((e) => e.title)}
            />
          )}

          {stage === 'pickTopic' && selectedHero && (
            <PickTopicPanel
              key="pickTopic"
              hid={selectedHero}
              questions={availableQuestions}
              onPick={handlePickQuestion}
              onBack={() => { setSelectedHero(null); setStage('pickHero'); }}
            />
          )}

          {stage === 'answer' && selectedHero && selectedQuestion && lastResult && (
            <AnswerPanel
              key="answer"
              hid={selectedHero}
              question={selectedQuestion}
              result={lastResult}
              onContinue={handleFinishTalk}
            />
          )}

          {stage === 'allDone' && (
            <AllDonePanel
              key="allDone"
              round={round}
              used={usedCount}
              maxCount={maxCount}
              onConfirm={handleConfirmEnd}
            />
          )}
        </AnimatePresence>
      </div>

      <AnimatePresence>
        {showClueLib && (
          <ClueLibraryModal
            entries={clueEntries}
            onClose={() => setShowClueLib(false)}
          />
        )}
        {showFactionPick && round === 3 && (
          <FactionPickModal
            onPick={handleConfirmFaction}
          />
        )}
      </AnimatePresence>
    </div>
  );
};

export default S8_Negotiation;

// ==============================================================
// 子组件
// ==============================================================

const IntroPanel: React.FC<{
  myMnd: number;
  maxCount: number;
  cluesOwned: number;
  heroId: HeroId | null;
  onStart: () => void;
}> = ({ myMnd, maxCount, cluesOwned, heroId, onStart }) => (
  <motion.div
    className={styles.panel}
    initial={{ opacity: 0, y: 20 }}
    animate={{ opacity: 1, y: 0 }}
    exit={{ opacity: 0, y: -20 }}
  >
        <div className={styles.panelTitle}>规则说明</div>
    <ul className={styles.ruleList}>
          <li>本次密谈可进行 <b>{maxCount}</b> 次（心境 {myMnd} ÷ 2）</li>
      <li>每次选一位其他主角密谈，从其预设话题中选一题发问</li>
      <li>
<b style={{ color: '#a8e6c4' }}>你心境 &gt; 对方</b>：必从对方已获线索中得一条真话
      </li>
      <li>
        <b style={{ color: '#ffb86a' }}>对方心境 &gt; 你</b>：50% 真话 / 50% <b>错误线索</b>（需谨慎甄别！）
      </li>
      <li>已问过的话题不会重复出现；线索库可随时在右上角查看</li>
      <li>目前已持有 <b>{cluesOwned}</b> 条线索</li>
    </ul>
    {heroId === 'hero_xiaowu' && (
      <div className={`${styles.skillBanner} ${styles.skillBannerXiaowu}`}>
        <div className={styles.skillBannerIcon}>🦊</div>
        <div className={styles.skillBannerText}>
          <b>妖力感知 · 被动激活</b>
          <div>小舞儿的妖族血脉能直接感知对方真意 —— 即使心境劣势，也<b>必得真话</b>，无视 50% 假情报风险。</div>
        </div>
      </div>
    )}
    {heroId === 'hero_xuner' && (
      <div className={`${styles.skillBanner} ${styles.skillBannerXuner}`}>
        <div className={styles.skillBannerIcon}>🌸</div>
        <div className={styles.skillBannerText}>
          <b>古族血脉感应 · 被动激活</b>
          <div>薰儿的古族血脉能洞穿人心 —— 每次获得真线索时，<b>额外再抽一条</b>对方的未知隐情。</div>
        </div>
      </div>
    )}
    <div className={styles.panelBtns}>
      <PrimaryButton label="开始密谈" onClick={onStart} />
    </div>
  </motion.div>
);

const PickHeroPanel: React.FC<{
  heroes: typeof HEROES_S1S2_ORDER;
  myMnd: number;
  askerHeroId: HeroId | null;
  onPick: (hid: HeroId) => void;
  onEndEarly: () => void;
  remaining: number;
  round: 1 | 2 | 3;
  myOwnedTitles: string[];
}> = ({ heroes, myMnd, askerHeroId, onPick, onEndEarly, remaining, round, myOwnedTitles }) => {
  const cardBonuses = useGameStore((s) => s.cardBonuses);
  const isXiaowu = askerHeroId === 'hero_xiaowu';
  return (
    <motion.div
      className={styles.panel}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
    >
      <div className={styles.panelTitle}>选择密谈对象（剩余 {remaining} 次）</div>
      <div className={styles.heroGrid}>
        {heroes.map((h) => {
          const full = HEROES_DATA.find((x) => x.id === h.id);
          // AI 主角自带其拜师加成（getEffectiveHeroStats 默认开启 includeMentor）
          const targetMnd = full
            ? getEffectiveHeroStats(h.id).mnd
            : 0;
          const isPair = isSpecialPair(askerHeroId, h.id);
          // 该 NPC 当前可问的"剩余真线索数" = NPC 累积线索池 - 玩家已持有
          const npcPool = getAccumulatedClueTitles(h.id, round);
          const remainingClues = npcPool.filter((c) => !myOwnedTitles.includes(c)).length;
          let advantage: { text: string; cls: string };
          if (isPair) {
            advantage = { text: '💞 心心相印 · 必得真言', cls: styles.advHigh };
          } else if (myMnd > targetMnd) {
            advantage = { text: '心境占优 · 必得真言', cls: styles.advHigh };
          } else if (myMnd === targetMnd) {
            advantage = { text: '心境持平 · 50% 可能假情报', cls: styles.advLow };
          } else if (isXiaowu) {
            advantage = { text: '🦊 妖力感知覆盖 · 必得真言', cls: styles.advHigh };
          } else {
            advantage = { text: '心境劣势 · 50% 可能假情报', cls: styles.advLow };
          }
          return (
            <div key={h.id} className={styles.heroCard} onClick={() => onPick(h.id)}>
              <div
                className={styles.heroPortrait}
                style={{ backgroundImage: `url(${h.portrait})` }}
              />
              <div className={styles.heroName}>{h.name}</div>
              <div className={styles.heroCandor}>
                心境 <b>{targetMnd}</b>
                <span className={styles.heroClueRest}>
                  ｜余 <b>{remainingClues}</b> 条线索
                </span>
              </div>
              <div className={`${styles.advBadge} ${advantage.cls}`}>
                {advantage.text}
              </div>
            </div>
          );
        })}
      </div>
      <div className={styles.panelBtns}>
        <button className={styles.secondaryBtn} onClick={onEndEarly}>
          结束本轮密谈
        </button>
      </div>
    </motion.div>
  );
};

const PickTopicPanel: React.FC<{
  hid: HeroId;
  questions: NpcDialogueQuestion[];
  onPick: (q: NpcDialogueQuestion) => void;
  onBack: () => void;
}> = ({ hid, questions, onPick, onBack }) => {
  const heroVisual = HEROES_S1S2_ORDER.find((h) => h.id === hid);
  return (
    <motion.div
      className={styles.panel}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
    >
      <div className={styles.talkHeader}>
        <div
          className={styles.talkPortrait}
          style={{ backgroundImage: `url(${heroVisual?.portrait ?? ''})` }}
        />
        <div className={styles.talkHeaderText}>
          <div className={styles.panelTitle}>与 {heroVisual?.name} 密谈</div>
          <div className={styles.talkSub}>选一个问题发问</div>
        </div>
      </div>

      <div className={styles.topicList}>
        {questions.length === 0 && (
          <div className={styles.emptyTopic}>
            你与 <b>{heroVisual?.name}</b> 的预设话题都已问过，换一位道友吧。
          </div>
        )}
        {questions.map((q) => (
          <div key={q.id} className={styles.topicItem} onClick={() => onPick(q)}>
            <span className={styles.topicQ}>「{q.text}」</span>
            <span className={styles.topicHint}>点击提问</span>
          </div>
        ))}
      </div>

      <div className={styles.panelBtns}>
        <button className={styles.secondaryBtn} onClick={onBack}>
          ← 换一位道友
        </button>
      </div>
    </motion.div>
  );
};

const AnswerPanel: React.FC<{
  hid: HeroId;
  question: NpcDialogueQuestion;
  result: NegotiationResult;
  onContinue: () => void;
}> = ({ hid, question, result, onContinue }) => {
  const heroVisual = HEROES_S1S2_ORDER.find((h) => h.id === hid);

  let depthTag = '';
  let depthClass = '';
  let answerText = '';
  let resultBlock: React.ReactNode = null;

  if (result.kind === 'truth') {
    depthTag = '🌟 心境占优 · 必得真言';
    depthClass = styles.depthDeep;
    answerText = result.honestAnswer;
    resultBlock = (
      <motion.div
        className={styles.clueGainTip}
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: 0.6 }}
      >
        📜 获得线索：<b>{result.clueTitle}</b>
        {result.skillTag && (
          <div className={styles.skillActivateTip}>{result.skillTag}</div>
        )}
        {result.bonusClueTitle && (
          <div className={styles.bonusClueTip}>
            🌸 额外洞察：<b>{result.bonusClueTitle}</b>
          </div>
        )}
      </motion.div>
    );
  } else if (result.kind === 'truth_luck') {
    depthTag = '✨ 心境劣势 · 幸运得真言';
    depthClass = styles.depthTruth;
    answerText = result.honestAnswer;
    resultBlock = (
      <motion.div
        className={styles.clueGainTip}
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: 0.6 }}
      >
        📜 获得线索：<b>{result.clueTitle}</b>
        <div className={styles.clueGainDesc}>（心境劣势下 50% 概率得到真话，这次运气不错）</div>
        {result.bonusClueTitle && (
          <div className={styles.bonusClueTip}>
            🌸 古族血脉感应 · 额外洞察：<b>{result.bonusClueTitle}</b>
          </div>
        )}
      </motion.div>
    );
  } else if (result.kind === 'fake') {
    depthTag = '⚠ 心境劣势 · 情报存疑';
    depthClass = styles.depthVague;
    answerText = result.evasiveAnswer;
    resultBlock = (
      <motion.div
        className={styles.clueFakeTip}
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: 0.6 }}
      >
        🚨 对方「透露」的额外情报：<br />
        <span className={styles.fakeQuote}>「{result.fakeClueText}」</span>
        <div className={styles.clueGainDesc}>
          此情报已存入线索库，标记为 <b>【存疑情报】</b>——心境劣势下对方有可能说谎，请结合其他线索判断。
        </div>
      </motion.div>
    );
  } else {
    depthTag = '🌫 对方无新情报';
    depthClass = styles.depthVague;
    answerText = result.evasiveAnswer;
    resultBlock = (
      <motion.div
        className={styles.clueFailTip}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.6 }}
      >
        ⚠ 这次没问到新情报。<br />
        <span style={{ fontSize: '12px', opacity: 0.8, display: 'block', marginTop: '6px', lineHeight: 1.6 }}>
          可能原因：对方对此话题不知情，或你的心境劣势导致无法套话。<br />
          💡 心境占优 / 心心相印（如塘散 × 小舞、萧炎 × 薰儿）可必得真言。
        </span>
      </motion.div>
    );
  }

  return (
    <motion.div
      className={styles.panel}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
    >
      <div className={styles.talkHeader}>
        <div
          className={styles.talkPortrait}
          style={{ backgroundImage: `url(${heroVisual?.portrait ?? ''})` }}
        />
        <div className={styles.talkHeaderText}>
          <div className={styles.panelTitle}>{heroVisual?.name} 的回答</div>
          <div className={`${styles.talkDepthBadge} ${depthClass}`}>{depthTag}</div>
        </div>
      </div>

      <div className={styles.questionBubble}>
        你问：「{question.text}」
      </div>
      <motion.div
        className={`${styles.answerBubble} ${depthClass}`}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.25 }}
      >
        {answerText}
      </motion.div>

      {resultBlock}

      <div className={styles.panelBtns}>
        <PrimaryButton label="继续" onClick={onContinue} />
      </div>
    </motion.div>
  );
};

const AllDonePanel: React.FC<{
  round: 1 | 2 | 3;
  used: number;
  maxCount: number;
  onConfirm: () => void;
}> = ({ round, used, maxCount, onConfirm }) => {
  const nextText =
    round === 1 ? '前往新一轮招募道友环节' :
    round === 2 ? '前往新一轮剧情阅读' :
    '前往决战准备';
  return (
    <motion.div
      className={styles.panel}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
    >
      <div className={styles.panelTitle}>本轮密谈结束</div>
      <div className={styles.doneInfo}>
        共进行 <b>{used}</b> / {maxCount} 次密谈
      </div>
      <div className={styles.doneDesc}>
        所得情报已归入"已知线索"。下一次密谈时，心境占优就能拿到更多真话——<br/>
        也记得甄别标记为【存疑情报】的线索，它们可能是对方在劣势时扔来的烟雾弹。
      </div>
      <div className={styles.panelBtns}>
        <PrimaryButton label={nextText} onClick={onConfirm} />
      </div>
    </motion.div>
  );
};

const ClueLibraryModal: React.FC<{
  entries: ClueEntry[];
  onClose: () => void;
}> = ({ entries, onClose }) => (
  <motion.div
    className={styles.modalBackdrop}
    initial={{ opacity: 0 }}
    animate={{ opacity: 1 }}
    exit={{ opacity: 0 }}
    onClick={onClose}
  >
    <motion.div
      className={styles.modalPanel}
      initial={{ scale: 0.95, y: 30 }}
      animate={{ scale: 1, y: 0 }}
      exit={{ scale: 0.95, y: 30 }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className={styles.modalHeader}>
        <div className={styles.modalTitle}>📜 已知线索库（{entries.length}）</div>
        <button className={styles.modalClose} onClick={onClose}>✕</button>
      </div>

      {entries.length === 0 ? (
        <div className={styles.emptyClue}>尚无线索。完成合作清怪或密谈即可收集情报。</div>
      ) : (
        <div className={styles.clueList}>
          {entries.map((c) => {
            const fromName = c.fromHero
              ? HEROES_S1S2_ORDER.find((h) => h.id === c.fromHero)?.name ?? '—'
              : '合作清怪';
            const isFake = c.title === '【存疑情报】';
            return (
              <div
                key={c.id}
                className={`${styles.clueItem} ${isFake ? styles.clueItemFake : ''}`}
              >
                <div className={styles.clueItemHead}>
                  <span className={styles.clueItemTitle}>{c.title}</span>
                  <span className={styles.clueItemMeta}>
                    {c.source === 'coop'
                      ? '🗡 ' + fromName
                      : `🗣 第${c.round}轮密谈·${fromName}`}
                  </span>
                </div>
                <div className={styles.clueItemBody}>{c.summary}</div>
              </div>
            );
          })}
        </div>
      )}
    </motion.div>
  </motion.div>
);

// ==============================================================
// 🎭 FactionPickModal：最终密谈结束后的"阵容站边"选择弹窗
//   - 只在 round === 3 (S8c) 结束时出现，且只对摇摆位主角（寒立 / 旺林）生效
//   - 玩家二选一：A 护道派 / B 弑道派
//   - 摇摆位无默认归属：玩家选 X，另一位摇摆者自动反阵（对称规则）
//   - 选择结果写入 gameStore.finalFaction，决定决战时的敌对方
// ==============================================================
const FactionPickModal: React.FC<{
  onPick: (faction: 'A' | 'B') => void;
}> = ({ onPick }) => {
  const [chosen, setChosen] = useState<'A' | 'B' | null>(null);

  return (
    <motion.div
      className={styles.modalBackdrop}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <motion.div
        className={styles.modalPanel}
        style={{ maxWidth: 760 }}
        initial={{ scale: 0.95, y: 30 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.95, y: 30 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.modalHeader}>
          <div className={styles.modalTitle}>⚔ 道别之时 · 抉择立场</div>
        </div>

        <div style={{ padding: '14px 20px', color: '#c9bfa3', lineHeight: 1.75, fontSize: 15 }}>
          三轮密谈落幕，宗门内暗流涌动已成燎原之势。线索拼凑出真相——
          一派主张 <b style={{ color: '#f0d98a' }}>护道</b> 以心剑斩魔咎，
          一派主张 <b style={{ color: '#f0a080' }}>弑道</b> 以极端破旧局。
          你与另一位摇摆者，将分执两端，势不两立。
          <br /><br />
          坠魔谷大战在即，道友意决——站向何方？
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: 16,
            padding: '0 20px 16px',
          }}
        >
          <FactionCard
            faction="A"
            title="A · 护道派"
            leader="守道之志"
            tone="cold"
            desc="护道心剑如磐石，以一己性命斩断魔咎。选 A 后，另一位摇摆者将自动站入弑道派，与你为敌。"
            chosen={chosen === 'A'}
            onClick={() => setChosen('A')}
          />
          <FactionCard
            faction="B"
            title="B · 弑道派"
            leader="破局之念"
            tone="fire"
            desc="以极端换真理，以一剑破千年门规。选 B 后，另一位摇摆者将自动站入护道派，与你为敌。"
            chosen={chosen === 'B'}
            onClick={() => setChosen('B')}
          />
        </div>

        <div style={{ padding: '4px 20px 18px', textAlign: 'center' }}>
          <button
            disabled={!chosen}
            style={{
              background: chosen ? 'linear-gradient(180deg,#c08040,#8a5a28)' : '#555',
              border: '1px solid #d4a060',
              color: '#1a1412',
              padding: '10px 24px',
              fontSize: 15,
              fontWeight: 700,
              borderRadius: 6,
              opacity: chosen ? 1 : 0.45,
              cursor: chosen ? 'pointer' : 'not-allowed',
              minWidth: 240,
              letterSpacing: 1.5,
            }}
            onClick={() => chosen && onPick(chosen)}
          >
            {chosen ? `确认站向【${chosen === 'A' ? '护道派' : '弑道派'}】` : '请先选择立场'}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
};

const FactionCard: React.FC<{
  faction: 'A' | 'B';
  title: string;
  leader: string;
  tone: 'cold' | 'fire';
  desc: string;
  chosen: boolean;
  onClick: () => void;
}> = ({ title, leader, tone, desc, chosen, onClick }) => {
  const borderColor = chosen ? (tone === 'cold' ? '#7ab9ff' : '#ff9a66') : 'rgba(200,180,140,0.25)';
  const bgColor = chosen
    ? (tone === 'cold' ? 'rgba(100,160,220,0.14)' : 'rgba(220,120,80,0.14)')
    : 'rgba(30,24,20,0.45)';
  return (
    <div
      onClick={onClick}
      style={{
        border: `2px solid ${borderColor}`,
        borderRadius: 10,
        padding: '16px 18px',
        background: bgColor,
        cursor: 'pointer',
        transition: 'all 0.18s ease',
        boxShadow: chosen ? `0 0 20px ${tone === 'cold' ? 'rgba(122,185,255,0.35)' : 'rgba(255,154,102,0.35)'}` : 'none',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 8 }}>
        <div style={{ fontSize: 20, fontWeight: 700, color: tone === 'cold' ? '#cfe3ff' : '#ffd0a8' }}>{title}</div>
        <div style={{ fontSize: 13, color: '#a09878' }}>首领：{leader}</div>
      </div>
      <div style={{ fontSize: 14, color: '#c9bfa3', lineHeight: 1.65 }}>{desc}</div>
      {chosen && (
        <div style={{ marginTop: 10, fontSize: 13, color: tone === 'cold' ? '#7ab9ff' : '#ff9a66' }}>
          ✓ 已选择此立场
        </div>
      )}
    </div>
  );
};

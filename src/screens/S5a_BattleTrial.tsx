/**
 * S5a 入门战斗考核（双骰子钟 + 2 轮 AI 对手 + 规则说明）
 *
 * 玩法（v2.0 骰子判定制，见 rules_text.json + 视觉规范 §4.4）：
 *   - 双方骰子数量 = 各自修为值
 *   - 每颗骰子 0/1/2 三面
 *   - 伤害 = max(1, 己方点数和 − 敌方点数和)
 *   - 本界面为教学，忽略距离与技能；每场进行 N 回合直到一方 HP 归零或完成教学
 *
 * 流程（v3 调整）：
 *   ① 首次进入 → 显示 S_RULE 入门测试规则弹窗
 *   ② 弹窗关闭 → 直接 idle（可点投掷），不再有 intro 按钮
 *   ③ 玩家投掷 → 展示我方伤害 → 点击"继续，敌人回合" → 敌方反击
 *   ④ 本场结算（胜/负） → 记录到 store → 进入对手 2
 *   ⑤ 两场完成后跳转 /s5b（入门理综考核）
 *
 * 新增：
 *   - 我方使用卡牌小图立绘，敌方使用 SVG 占位立绘（examiner_jia/yi.svg）
 *   - 右下角战报：记录每回合伤害（可滚动）
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { BackButton } from '@/components/BackButton';
import { useReturnToMenu } from '@/hooks/useReturnToMenu';
import { MusicToggle } from '@/components/MusicToggle';
import { CommonHud } from '@/components/CommonHud';
import { RuleModal } from '@/components/RuleModal';
import { DiceClock } from '@/components/DiceClock';
import { getHeroById } from '@/hooks/useConfig';
import { useGameStore, SaveSystem } from '@/stores/gameStore';
import {
  S5_BATTLE_OPPONENTS,
  S5_BATTLE_REWARDS,
  S5A_BANNER_TEXT,
  S5A_RULE_LINE1,
  S5A_RULE_LINE2,
} from '@/data/s5Data';
import { HEROES_S1S2_ORDER, TYPE_TOKEN } from '@/data/heroConstants';
import type { CultivationType } from '@/types/game';
import styles from './S5a_BattleTrial.module.css';

type Phase =
  | 'rule'
  | 'idle'           // 等待玩家投掷
  | 'rolling'        // 我方骰子滚动中
  | 'playerResolved' // 我方伤害已展示，等待点击"继续"
  | 'enemyRolling'   // 敌方骰子滚动中
  | 'enemyResolved'  // 敌方伤害已展示，待下一回合
  | 'matchEnd';

interface BattleLogEntry {
  id: number;
  turn: number;
  side: 'player' | 'enemy' | 'system';
  text: string;
}

/** 投掷 count 颗三面骰（0/1/2），返回点数数组 */
function rollDice(count: number): number[] {
  return Array.from({ length: count }, () => Math.floor(Math.random() * 3));
}

export const S5a_BattleTrial: React.FC = () => {
  const navigate = useNavigate();
  const returnToMenu = useReturnToMenu();
  const heroId = useGameStore((s) => s.heroId);
  const heroName = useGameStore((s) => s.heroName);
  const addSpiritStones = useGameStore((s) => s.addSpiritStones);
  const recordBattleResult = useGameStore((s) => s.recordBattleResult);
  const s5Progress = useGameStore((s) => s.s5);
  const battleBonus = useGameStore((s) => s.battleBonus);
  const knowledgeBonus = useGameStore((s) => s.knowledgeBonus);
  const cardBonuses = useGameStore((s) => s.cardBonuses);

  const hero = heroId ? getHeroById(heroId) : null;
  // 主角立绘（从HEROES_S1S2_ORDER获取）
  const heroPortrait = useMemo(() => {
    const v = HEROES_S1S2_ORDER.find((h) => h.id === heroId);
    return v?.portrait ?? '';
  }, [heroId]);

  // 当前进行的对手索引（0 / 1）
  const [matchIdx, setMatchIdx] = useState(0);
  const opponent = S5_BATTLE_OPPONENTS[matchIdx];

  // 主角卡的属性加成
  const mainBonus = heroId ? (cardBonuses[heroId] ?? { hp: 0, atk: 0, mnd: 0, realmUps: 0 }) : { hp: 0, atk: 0, mnd: 0, realmUps: 0 };
  const baseHp = (hero?.run_card.hp ?? 10) + mainBonus.hp;

  // 双方气血动态
  const [playerHp, setPlayerHp] = useState(baseHp);
  const [enemyHp, setEnemyHp] = useState(opponent?.hp ?? 4);

  // 本场状态
  const [phase, setPhase] = useState<Phase>('rule');
  const [showRule, setShowRule] = useState(true);
  const [turn, setTurn] = useState(1);
  const [playerDice, setPlayerDice] = useState<number[]>([]);
  const [enemyDice, setEnemyDice] = useState<number[]>([]);
  /** 骰子是否正在摇动（独立于phase，保证values赋值瞬间停止） */
  const [diceRolling, setDiceRolling] = useState(false);
  const [damageLog, setDamageLog] = useState<string | null>(null);
  const [floatDmg, setFloatDmg] = useState<{ target: 'player' | 'enemy'; value: number } | null>(null);
  const [matchResult, setMatchResult] = useState<'win' | 'lose' | null>(null);
  const [rewardMsg, setRewardMsg] = useState<string | null>(null);

  // 战报：每回合伤害记录
  const [battleLogs, setBattleLogs] = useState<BattleLogEntry[]>([]);
  const logIdRef = useRef(0);
  const logListRef = useRef<HTMLDivElement | null>(null);

  const playerAtk = (hero?.run_card.atk ?? 3) + mainBonus.atk + battleBonus;
  const playerMnd = (hero?.run_card.mnd ?? 3) + mainBonus.mnd + knowledgeBonus;

  // 无主角 → 回选角
  useEffect(() => {
    if (!heroId) navigate('/select');
  }, [heroId, navigate]);

  // 切换对手时重置状态
  useEffect(() => {
    if (!opponent || !hero) return;
    setPlayerHp(baseHp);
    setEnemyHp(opponent.hp);
    setTurn(1);
    setPlayerDice([]);
    setEnemyDice([]);
    setDiceRolling(false);
    setDamageLog(null);
    setFloatDmg(null);
    setMatchResult(null);
    setRewardMsg(null);
    setBattleLogs([]);
    logIdRef.current = 0;
    setPhase(showRule ? 'rule' : 'idle');
  }, [matchIdx, hero, opponent, showRule]);

  // 战报自动滚动到底部
  useEffect(() => {
    if (logListRef.current) {
      logListRef.current.scrollTop = logListRef.current.scrollHeight;
    }
  }, [battleLogs]);

  const appendLog = useCallback((entry: Omit<BattleLogEntry, 'id'>) => {
    setBattleLogs((prev) => [...prev, { ...entry, id: ++logIdRef.current }]);
  }, []);

  const handleRuleClose = useCallback(() => {
    setShowRule(false);
    setPhase('idle');
  }, []);

  /** 玩家掷骰攻击 → 展示结果 → 等待玩家点击继续 */
  const handleRoll = useCallback(() => {
    if (phase !== 'idle') return;

    setPhase('rolling');
    setDiceRolling(true);
    setPlayerDice([]);
    setEnemyDice([]);
    setDamageLog(null);
    setFloatDmg(null);

    // 0.5s 摇骰 + 0.5s 结算展示（总约1s）
    setTimeout(() => {
      const pDice = rollDice(playerAtk);
      const eDice = rollDice(opponent.atk);
      setPlayerDice(pDice);
      setEnemyDice(eDice);
      // 骰子定格瞬间立刻停止滚动动画，确保"总和数字"与"骰子停转"同步出现
      setDiceRolling(false);

      const pSum = pDice.reduce((a, b) => a + b, 0);
      const eSum = eDice.reduce((a, b) => a + b, 0);
      const rawDmg = pSum - eSum;
      const dmg = Math.max(1, rawDmg);
      const isSafe = rawDmg <= 0;

      const logText = `我方 ${pSum} − 敌方 ${eSum} = ${rawDmg}${isSafe ? '（保底）' : ''}，造成 ${dmg} 点伤害`;
      setDamageLog(
        `我方点数 ${pSum} − 敌方点数 ${eSum} = ${rawDmg}${isSafe ? '（保底 1 点）' : ''}，造成 ${dmg} 点伤害！`
      );

      // 延迟 220ms 后再飘字 + 扣血（让战斗结果文字先淡入完成，避免飘字过早）
      setTimeout(() => {
        setFloatDmg({ target: 'enemy', value: dmg });
        const nextEnemyHp = Math.max(0, enemyHp - dmg);
        setEnemyHp(nextEnemyHp);
        appendLog({ turn, side: 'player', text: logText });

        // 飘字动画自行播放约 500ms 后清空
        setTimeout(() => {
          setFloatDmg(null);
          if (nextEnemyHp <= 0) {
            setMatchResult('win');
            setPhase('matchEnd');
          } else {
            setPhase('playerResolved');
          }
        }, 500);
      }, 220);
    }, 500);
  }, [phase, playerAtk, opponent, enemyHp, turn, appendLog]);

  /** 玩家点击"继续，敌人回合" → 敌方反击 */
  const handleEnemyTurn = useCallback(() => {
    if (phase !== 'playerResolved') return;

    setPhase('enemyRolling');
    setDiceRolling(true);
    setPlayerDice([]);
    setEnemyDice([]);
    setDamageLog('敌方反击中…');
    setFloatDmg(null);

    setTimeout(() => {
      const eDice = rollDice(opponent.atk);
      const pDice = rollDice(playerAtk);
      setEnemyDice(eDice);
      setPlayerDice(pDice);
      // 骰子定格瞬间立刻停止滚动动画
      setDiceRolling(false);

      const eSum = eDice.reduce((a, b) => a + b, 0);
      const pSum = pDice.reduce((a, b) => a + b, 0);
      const rawDmg = eSum - pSum;
      const dmg = Math.max(1, rawDmg);
      const isSafe = rawDmg <= 0;

      const logText = `敌方 ${eSum} − 我方 ${pSum} = ${rawDmg}${isSafe ? '（保底）' : ''}，我方受到 ${dmg} 点伤害`;
      setDamageLog(
        `敌方点数 ${eSum} − 我方点数 ${pSum} = ${rawDmg}${isSafe ? '（保底 1 点）' : ''}，我方受到 ${dmg} 点伤害！`
      );

      // 延迟 220ms 后再飘字 + 扣血（让战斗结果文字先淡入完成）
      setTimeout(() => {
        setFloatDmg({ target: 'player', value: dmg });
        const nextPlayerHp = Math.max(0, playerHp - dmg);
        setPlayerHp(nextPlayerHp);
        appendLog({ turn, side: 'enemy', text: logText });

        setTimeout(() => {
          setFloatDmg(null);
          if (nextPlayerHp <= 0) {
            setMatchResult('lose');
            setPhase('matchEnd');
          } else {
            // 敌方伤害展示后，稍作停顿再进入下一回合
            // 注意：damageLog 常驻显示到玩家下次点「掷骰」时才清空
            setPhase('enemyResolved');
            setTimeout(() => {
              setTurn((t) => t + 1);
              setPhase('idle');
            }, 500);
          }
        }, 500);
      }, 220);
    }, 500);
  }, [phase, opponent, playerAtk, playerHp, turn, appendLog]);

  /** 本场结算 → 记录+发奖 */
  useEffect(() => {
    if (phase !== 'matchEnd' || !matchResult) return;
    const won = matchResult === 'win';
    const reward = won ? S5_BATTLE_REWARDS.win : S5_BATTLE_REWARDS.lose;
    recordBattleResult(won);
    addSpiritStones(reward);
    // 精简小结文案（用于按钮下方展示 + 战报）
    const shortMsg = won
      ? `胜 · 获得灵石 ×${reward}`
      : `负 · 获得保底灵石 ×${reward}`;
    setRewardMsg(shortMsg);
    // 注意：不再覆盖 damageLog —— 中央战斗结果描述保留最后一次伤害内容，供玩家回溯
    setFloatDmg(null);
    // 战报中记录一份（便于回溯）
    appendLog({
      turn,
      side: 'system',
      text: `【本场结束】${shortMsg}`,
    });
    SaveSystem.save(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, matchResult]);

  /** 下一场 / 完成全部考核 */
  const handleNextMatch = useCallback(() => {
    if (matchIdx + 1 < S5_BATTLE_OPPONENTS.length) {
      setMatchIdx(matchIdx + 1);
    } else {
      // 完成全部战斗考核 → 进入理综考核
      navigate('/s5b');
    }
  }, [matchIdx, navigate]);

  if (!hero || !opponent) return null;

  const enemyTypeColor = TYPE_TOKEN[opponent.type as CultivationType];
  const playerTypeColor = TYPE_TOKEN[hero.type as CultivationType];

  return (
    <div className={styles.screen}>
      <div className={styles.bg} />
      <div className={styles.bgVeil} />

      <BackButton onClick={returnToMenu} />
      <MusicToggle />
      <CommonHud chapter={2} />

      {/* 教学横幅 */}
      <div className={styles.banner}>
        <span className={styles.bannerTitle}>入门战斗考核（教学 {matchIdx + 1}/{S5_BATTLE_OPPONENTS.length} 场）</span>
        {S5A_BANNER_TEXT && <span className={styles.bannerText}>{S5A_BANNER_TEXT}</span>}
      </div>
      <div className={styles.ruleNote}>
        <div className={styles.ruleLine1}>{S5A_RULE_LINE1}</div>
        <div className={styles.ruleLine2}>{S5A_RULE_LINE2}</div>
      </div>

      {/* 进度条：已去除「回合/已通过」面板（标题已显示教学场次，避免信息重复）*/}

      {/* 双方角色信息 */}
      <div className={styles.arena}>
        {/* 玩家方 */}
        <div className={styles.side}>
          <div
            className={styles.portrait}
            style={{
              borderColor: playerTypeColor,
              backgroundImage: heroPortrait ? `url(${heroPortrait})` : undefined,
            }}
          >
            {!heroPortrait && (
              <div className={styles.portraitLetter}>{heroName?.[0] ?? '玩'}</div>
            )}
          </div>
          <div className={styles.charName}>{heroName || hero.name}（我方）</div>
          <div className={styles.statsRow}>
            <span className={styles.atkTag}>修为 {playerAtk}</span>
            <span className={styles.mndTag}>心境 {playerMnd}</span>
          </div>
          <div className={styles.hpBar}>
                <div className={styles.hpFill} style={{ width: `${(playerHp / baseHp) * 100}%` }} />
                <div className={styles.hpText}>气血 {playerHp} / {baseHp}</div>
          </div>

          <AnimatePresence>
            {floatDmg?.target === 'player' && (
              <motion.div
                className={styles.floatDmg}
                initial={{ opacity: 0, y: 0, scale: 0.8 }}
                animate={{ opacity: 1, y: -60, scale: 1.2 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.6, ease: 'easeOut' }}
              >
                -{floatDmg.value}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* 中央对战区 */}
        <div className={styles.center}>
          {/* 骰子钟 x2 */}
          <div className={styles.diceZone}>
            <DiceClock
              side="left"
              label={`我方 · 修为 ${playerAtk}`}
              count={playerAtk}
              rolling={diceRolling}
              values={playerDice}
            />
            <div className={styles.vs}>VS</div>
            <DiceClock
              side="right"
              label={`敌方 · 修为 ${opponent.atk}`}
              count={opponent.atk}
              rolling={diceRolling}
              values={enemyDice}
            />
          </div>

          {/* 结果区 */}
          <div className={styles.resultArea}>
            <AnimatePresence mode="wait">
              {damageLog && (
                <motion.div
                  key={damageLog}
                  className={styles.damageLog}
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 10 }}
                >
                  {damageLog}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* 操作按钮 */}
          <div className={styles.actionBar}>
            {phase === 'idle' && (
              <button className={styles.ctaBtn} onClick={handleRoll}>
                掷骰，我方进攻
              </button>
            )}
            {(phase === 'rolling' || phase === 'enemyRolling' || phase === 'enemyResolved') && (
              <button className={styles.ctaBtn} disabled>
                {phase === 'enemyRolling' ? '敌方行动中…' : '判定中…'}
              </button>
            )}
            {phase === 'playerResolved' && (
              <button className={`${styles.ctaBtn} ${styles.ctaBtnAlt}`} onClick={handleEnemyTurn}>
                继续 · 敌人回合 →
              </button>
            )}
            {phase === 'matchEnd' && (
              <button className={styles.ctaBtn} onClick={handleNextMatch}>
                {matchIdx + 1 < S5_BATTLE_OPPONENTS.length ? '进入下一场' : '进入理论考核 →'}
              </button>
            )}
          </div>

          {/* 本场结算小结（按钮下方，不占用战斗结果描述位置） */}
          <AnimatePresence>
            {phase === 'matchEnd' && rewardMsg && (
              <motion.div
                className={`${styles.matchSummary} ${matchResult === 'win' ? styles.matchSummaryWin : styles.matchSummaryLose}`}
                initial={{ opacity: 0, y: 10, scale: 0.92 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.35, ease: 'easeOut' }}
              >
                <span className={styles.matchSummaryLabel}>【本场结束】</span>
                <span>{rewardMsg}</span>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* 敌方 */}
        <div className={`${styles.side} ${styles.sideRight}`}>
          <div
            className={styles.portrait}
            style={{
              borderColor: enemyTypeColor,
              backgroundImage: opponent.portrait ? `url(${opponent.portrait})` : undefined,
            }}
          >
            {!opponent.portrait && (
              <div className={styles.portraitLetter}>{opponent.name[opponent.name.length - 1]}</div>
            )}
          </div>
          <div className={styles.charName}>{opponent.name}</div>
          <div className={styles.statsRow}>
            <span className={styles.atkTag}>修为 {opponent.atk}</span>
            <span className={styles.mndTag}>心境 {opponent.mnd}</span>
          </div>
          <div className={styles.hpBar}>
            <div className={styles.hpFill} style={{ width: `${(enemyHp / opponent.hp) * 100}%` }} />
            <div className={styles.hpText}>气血 {enemyHp} / {opponent.hp}</div>
          </div>

          <AnimatePresence>
            {floatDmg?.target === 'enemy' && (
              <motion.div
                className={styles.floatDmg}
                initial={{ opacity: 0, y: 0, scale: 0.8 }}
                animate={{ opacity: 1, y: -60, scale: 1.2 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.6, ease: 'easeOut' }}
              >
                -{floatDmg.value}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* 对手 intro 提示（仅胜场结算前展示） */}
      {phase === 'idle' && turn === 1 && opponent.intro && (
        <div className={styles.introTip}>{opponent.intro}</div>
      )}

      {/* 右下角战报面板 */}
      <div className={styles.battleLog}>
          <div className={styles.battleLogHeader}>战 报</div>
        <div className={styles.battleLogList} ref={logListRef}>
          {battleLogs.length === 0 ? (
            <div className={styles.battleLogEmpty}>等待第一次出手…</div>
          ) : (
            battleLogs.map((log) => (
              <div
                key={log.id}
                className={`${styles.battleLogItem} ${
                  log.side === 'player'
                    ? styles.logPlayer
                    : log.side === 'enemy'
                    ? styles.logEnemy
                    : styles.logSystem
                }`}
              >
                <span className={styles.logTurn}>T{log.turn}</span>
                <span className={styles.logSide}>
                  {log.side === 'player' ? '我' : log.side === 'enemy' ? '敌' : '结'}
                </span>
                <span className={styles.logText}>{log.text}</span>
              </div>
            ))
          )}
        </div>
      </div>

      {/* 本场结算：不再弹窗遮挡，奖励已写入战报，CTA按钮在下方操作区 */}

      <RuleModal
        open={showRule}
        ruleKey="s5_entry"
        onClose={handleRuleClose}
      />
    </div>
  );
};

/**
 * S5c 拜师入门（三选一：御敌堂 / 藏经阁 / 炼丹堂）
 *
 * v3.0 流程（开包仪式 + AI拜师可见化 + 师父立绘）：
 *   ① 首次进入 → 居中欢迎弹窗「接下来，各部门负责人将前来挑选新弟子...」
 *   ② 弹窗关闭 → 显示 3 张部门卡（含师父立绘 + 招徒台词）
 *      - 卡片中央显示师父半身立绘（缺图时回退为色块印章）
 *      - 选中后右侧浮现师父招徒台词气泡
 *   ③ 玩家选中某卡 → 底部「确认拜师」按钮高亮
 *   ④ 点击确认拜师 → 进入"开包仪式"序列：
 *        a. 屏幕全屏暗化 + 中央门派印记从天而降（旋转+砸下）
 *        b. 印记触地震屏 + 金光迸发
 *        c. 奖励数字滚动揭示（修为/心境/灵石 tween）
 *        d. 师父留话气泡展开（独门台词）
 *        e. 关闭仪式 → 回到主画面，部门卡显示已确认状态
 *   ⑤ AI拜师可见化：右侧依次飞入 6 位 AI 头像 + 加入门派标签
 *   ⑥ 全部入场后浮现「进入下一阶段 →」
 */
import React, { useCallback, useMemo, useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { BackButton } from '@/components/BackButton';
import { useReturnToMenu } from '@/hooks/useReturnToMenu';
import { MusicToggle } from '@/components/MusicToggle';
import { CommonHud } from '@/components/CommonHud';
import { useGameStore, SaveSystem } from '@/stores/gameStore';
import { getHeroById } from '@/hooks/useConfig';
import { MENTORSHIP_OPTIONS, S5C_TITLE } from '@/data/s5Data';
import { AI_MENTORSHIP_TABLE } from '@/data/aiProgression';
import { HEROES_S1S2_ORDER } from '@/data/heroConstants';
import type { MentorshipOption, MentorshipId, HeroId } from '@/types/game';
import styles from './S5c_MentorshipChoice.module.css';

/** 数字滚动组件 —— 0.6s 内 tween 到目标值 */
const TweenNumber: React.FC<{ from: number; to: number; duration?: number }> = ({ from, to, duration = 0.6 }) => {
  const [val, setVal] = useState(from);
  useEffect(() => {
    const start = performance.now();
    const dur = duration * 1000;
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / dur);
      const eased = 1 - Math.pow(1 - t, 3); // easeOutCubic
      setVal(Math.round(from + (to - from) * eased));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [from, to, duration]);
  return <>{val}</>;
};

export const S5c_MentorshipChoice: React.FC = () => {
  const navigate = useNavigate();
  const returnToMenu = useReturnToMenu();
  const heroId = useGameStore((s) => s.heroId);
  const heroName = useGameStore((s) => s.heroName);
  const battleBonus = useGameStore((s) => s.battleBonus);
  const knowledgeBonus = useGameStore((s) => s.knowledgeBonus);
  const cardBonuses = useGameStore((s) => s.cardBonuses);
  const addSpiritStones = useGameStore((s) => s.addSpiritStones);
  const setMentorship = useGameStore((s) => s.setMentorship);
  const applyAiMentorships = useGameStore((s) => s.applyAiMentorships);
  const setChapter = useGameStore((s) => s.setChapter);
  const setStorySubChapter = useGameStore((s) => s.setStorySubChapter);
  const setSegmentIndex = useGameStore((s) => s.setSegmentIndex);

  const hero = heroId ? getHeroById(heroId) : null;

  /** 欢迎弹窗 */
  const [showWelcome, setShowWelcome] = useState(true);
  /** 当前预选（未确认） */
  const [selected, setSelected] = useState<MentorshipId | null>(null);
  /** 已确认拜师 */
  const [confirmed, setConfirmed] = useState<MentorshipOption | null>(null);
  /** 开包仪式播放阶段：null 不显示；'falling' 印记下落；'impact' 触地震屏；'reveal' 奖励揭示；'quote' 师父留话 */
  const [ceremonyPhase, setCeremonyPhase] = useState<null | 'falling' | 'impact' | 'reveal' | 'quote'>(null);
  /** AI 拜师可见化：当前已显示几位 AI（控制依次入场） */
  const [aiRevealedCount, setAiRevealedCount] = useState(0);
  /** 屏幕震屏 */
  const [shake, setShake] = useState(false);
  /** 立绘加载失败标记（每个 master 一份） */
  const [portraitFailed, setPortraitFailed] = useState<Record<string, boolean>>({});
  const ceremonyTimers = useRef<number[]>([]);

  // 守卫
  useEffect(() => {
    if (!heroId) navigate('/select');
  }, [heroId, navigate]);

  // 卸载时清理定时器
  useEffect(() => {
    return () => {
      ceremonyTimers.current.forEach((t) => window.clearTimeout(t));
      ceremonyTimers.current = [];
    };
  }, []);

  const handleCloseWelcome = useCallback(() => setShowWelcome(false), []);

  const handleSelect = useCallback(
    (id: MentorshipId) => {
      if (confirmed) return;
      setSelected(id);
    },
    [confirmed]
  );

  /** 开包仪式状态机：falling(0.6s) → impact(0.4s 震屏) → reveal(1.2s 数字滚) → quote(常驻直至关闭) */
  const playCeremony = useCallback((opt: MentorshipOption) => {
    setCeremonyPhase('falling');
    const t1 = window.setTimeout(() => {
      setCeremonyPhase('impact');
      setShake(true);
      const t1a = window.setTimeout(() => setShake(false), 350);
      ceremonyTimers.current.push(t1a);
    }, 600);
    const t2 = window.setTimeout(() => setCeremonyPhase('reveal'), 1000);
    const t3 = window.setTimeout(() => setCeremonyPhase('quote'), 2300);
    ceremonyTimers.current.push(t1, t2, t3);
  }, []);

  const handleConfirm = useCallback(() => {
    if (!selected || confirmed) return;
    const opt = MENTORSHIP_OPTIONS.find((o) => o.id === selected);
    if (!opt) return;
    setMentorship(opt.id);
    applyAiMentorships();
    addSpiritStones(opt.reward.spiritStones);
    setConfirmed(opt);
    SaveSystem.save(1);
    // 启动开包仪式
    playCeremony(opt);
  }, [selected, confirmed, setMentorship, applyAiMentorships, addSpiritStones, playCeremony]);

  /** 关闭仪式覆盖层 → 回到主画面 → 启动 AI 拜师入场 */
  const handleCloseCeremony = useCallback(() => {
    setCeremonyPhase(null);
    // 依次入场 6 位 AI（每位间隔 600ms）
    HEROES_S1S2_ORDER.forEach((_, idx) => {
      const t = window.setTimeout(() => {
        setAiRevealedCount((c) => Math.max(c, idx + 1));
      }, 400 + idx * 600);
      ceremonyTimers.current.push(t);
    });
  }, []);

  const handleAdvance = useCallback(() => {
    setChapter(2);
    setStorySubChapter('b');
    setSegmentIndex(0);
    SaveSystem.save(1);
    navigate('/story');
  }, [navigate, setChapter, setStorySubChapter, setSegmentIndex]);

  /** 角色属性 */
  const mainBonus = heroId ? (cardBonuses[heroId] ?? { hp: 0, atk: 0, mnd: 0, realmUps: 0 }) : { hp: 0, atk: 0, mnd: 0, realmUps: 0 };
  const heroAtk = (hero?.run_card.atk ?? 0) + battleBonus + mainBonus.atk;
  const heroMnd = (hero?.run_card.mnd ?? 0) + knowledgeBonus + mainBonus.mnd;
  const heroHp = (hero?.run_card.hp ?? 0) + mainBonus.hp;
  const displayName = heroName || hero?.name || '主角';

  /** 渲染奖励区（已确认 → 真实奖励，未确认 → ?悬念） */
  const renderReward = useCallback(
    (opt: MentorshipOption) => {
      const revealed = confirmed && confirmed.id === opt.id;
      if (!revealed) {
        return (
          <>
            <div className={styles.rewardLine}>
              <span className={styles.rewardIcon}>?</span>
              <span className={styles.rewardMystery}>???</span>
            </div>
            <div className={styles.rewardLine}>
              <span className={styles.rewardIcon}>?</span>
              <span className={styles.rewardMystery}>???</span>
            </div>
          </>
        );
      }
      const { spiritStones: s, atkBonus, mndBonus } = opt.reward;
      return (
        <>
          <motion.div className={styles.rewardLine} initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}>
            <span className={styles.rewardIcon}>◈</span>
            <span>灵石 ×{s}</span>
          </motion.div>
          {atkBonus && (
            <motion.div className={styles.rewardLine} initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}>
              <span className={styles.rewardIcon}>⚔</span>
              <span>修为 +{atkBonus}</span>
            </motion.div>
          )}
          {mndBonus && (
            <motion.div className={styles.rewardLine} initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}>
              <span className={styles.rewardIcon}>☯</span>
              <span>心境 +{mndBonus}</span>
            </motion.div>
          )}
        </>
      );
    },
    [confirmed]
  );

  /** 师父立绘 / fallback 色块 */
  const renderMaster = useCallback((opt: MentorshipOption) => {
    const failed = portraitFailed[opt.id];
    if (opt.masterPortrait && !failed) {
      return (
        <div className={styles.masterPortraitWrap}>
          <img
            className={styles.masterPortrait}
            src={opt.masterPortrait}
            alt={opt.master}
            onError={() => setPortraitFailed((p) => ({ ...p, [opt.id]: true }))}
          />
          <div className={styles.masterPortraitVeil} style={{ background: `linear-gradient(180deg, transparent 60%, ${opt.accent}40 100%)` }} />
        </div>
      );
    }
    // fallback：色块印章
    return (
      <div className={styles.cardSeal} style={{ background: opt.accent }}>
        <span>{opt.name[0]}</span>
      </div>
    );
  }, [portraitFailed]);

  // 右下角角色卡（仅在确认拜师后显示）
  const statBadge = useMemo(() => {
    if (!hero) return null;
    const atkChanged = battleBonus + mainBonus.atk > 0;
    const mndChanged = knowledgeBonus + mainBonus.mnd > 0;
    const hpChanged = mainBonus.hp > 0;
    return (
      <div className={styles.heroCardPanel}>
        <div className={styles.heroCardTitle}>{displayName}</div>
        <div className={styles.heroCardStats}>
          <div className={styles.statItem}>
            <span className={styles.statLabel}>修为</span>
            <span className={`${styles.statValue} ${atkChanged ? styles.statHi : ''}`}>
              {heroAtk}
              {atkChanged && <span className={styles.statDelta}>+{battleBonus + mainBonus.atk}</span>}
            </span>
          </div>
          <div className={styles.statItem}>
            <span className={styles.statLabel}>心境</span>
            <span className={`${styles.statValue} ${mndChanged ? styles.statHi : ''}`}>
              {heroMnd}
              {mndChanged && <span className={styles.statDelta}>+{knowledgeBonus + mainBonus.mnd}</span>}
            </span>
          </div>
          <div className={styles.statItem}>
            <span className={styles.statLabel}>气血</span>
            <span className={`${styles.statValue} ${hpChanged ? styles.statHi : ''}`}>
              {heroHp}
              {hpChanged && <span className={styles.statDelta}>+{mainBonus.hp}</span>}
            </span>
          </div>
        </div>
      </div>
    );
  }, [hero, heroAtk, heroMnd, heroHp, battleBonus, knowledgeBonus, mainBonus, displayName]);

  // AI 拜师列表（按 HEROES_S1S2_ORDER 排序，排除玩家自己）
  const aiList = useMemo(() => {
    return HEROES_S1S2_ORDER.filter((h) => h.id !== heroId).map((h) => {
      const mid = AI_MENTORSHIP_TABLE[h.id as HeroId];
      const dept = MENTORSHIP_OPTIONS.find((o) => o.id === mid)!;
      return { hero: h, dept };
    });
  }, [heroId]);

  // 仪式期间所有 AI 都没入场，仪式后逐个入场
  const allAiRevealed = aiRevealedCount >= aiList.length;

  return (
    <div className={`${styles.screen} ${shake ? styles.screenShake : ''}`}>
      <div className={styles.bg} />
      <div className={styles.bgVeil} />

      <BackButton onClick={returnToMenu} />
      <MusicToggle />
      <CommonHud chapter={2} />

      <div className={styles.header}>
        <h1 className={styles.title}>{S5C_TITLE}</h1>
      </div>

      {/* 三张部门卡 */}
      {!showWelcome && (
        <div className={styles.cardsRow}>
          {MENTORSHIP_OPTIONS.map((opt) => {
            const isSelected = selected === opt.id;
            const isDisabled = !!confirmed && confirmed.id !== opt.id;
            const isConfirmed = confirmed && confirmed.id === opt.id;
            return (
              <motion.button
                key={opt.id}
                type="button"
                className={[
                  styles.card,
                  isSelected ? styles.cardSelected : '',
                  isDisabled ? styles.cardDisabled : '',
                ].filter(Boolean).join(' ')}
                style={{ ['--accent' as any]: opt.accent }}
                onClick={() => handleSelect(opt.id)}
                disabled={isDisabled}
                whileHover={{ y: confirmed ? 0 : -6 }}
                animate={isSelected ? { y: -8 } : { y: 0 }}
              >
                {renderMaster(opt)}
                <div className={styles.cardName}>{opt.name}</div>
                <div className={styles.cardMaster}>
                  {opt.mastertTitle}·{opt.master}
                </div>
                <div className={styles.cardDivider} />
                <div className={styles.rewardBlock}>{renderReward(opt)}</div>

                {isSelected && !confirmed && <div className={styles.selectedBadge}>已选择</div>}
                {isConfirmed && <div className={styles.confirmedBadge}>✓ 已拜师</div>}
              </motion.button>
            );
          })}
        </div>
      )}

      {/* 选中卡时浮现师父招徒台词气泡（位于卡片下方） */}
      <AnimatePresence>
        {!showWelcome && !confirmed && selected && (() => {
          const opt = MENTORSHIP_OPTIONS.find((o) => o.id === selected);
          if (!opt?.masterQuote) return null;
          return (
            <motion.div
              key={selected}
              className={styles.quoteBubble}
              style={{ ['--accent' as any]: opt.accent }}
              initial={{ opacity: 0, y: 12, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 12, scale: 0.96 }}
              transition={{ duration: 0.3 }}
            >
              <div className={styles.quoteHeader}>「{opt.master}」{opt.mastertTitle} 临前留言</div>
              <div className={styles.quoteText}>{opt.masterQuote}</div>
            </motion.div>
          );
        })()}
      </AnimatePresence>

      {/* 底部操作栏 */}
      {!showWelcome && (
        <div className={styles.actionBar}>
          {!confirmed ? (
            <>
              <div className={styles.hintText}>
                {selected
                  ? `已选「${MENTORSHIP_OPTIONS.find((o) => o.id === selected)?.name}」— 确认后将揭晓奖励，且不可更改`
                  : '请从三大部门中选择一个拜入'}
              </div>
              <button type="button" className={styles.ctaBtn} onClick={handleConfirm} disabled={!selected}>
                确 认 拜 师
              </button>
            </>
          ) : (
            <>
              <motion.div className={styles.confirmedHint} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
                🎉 已加入「{confirmed.name}」！{confirmed.bonus}
              </motion.div>
              <button
                type="button"
                className={styles.ctaBtn}
                onClick={handleAdvance}
                disabled={!allAiRevealed}
                style={!allAiRevealed ? { opacity: 0.45 } : undefined}
              >
                {allAiRevealed ? '进入下一阶段 →' : `等待入门通报… (${aiRevealedCount}/${aiList.length})`}
              </button>
            </>
          )}
        </div>
      )}

      {/* 角色属性 Badge —— 仅在确认拜师后显示 */}
      {confirmed && statBadge && (
        <motion.div
          className={styles.hudPanel}
          initial={{ opacity: 0, x: 40 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.4 }}
        >
          {statBadge}
        </motion.div>
      )}

      {/* AI 拜师可见化：左侧滚动通知列 */}
      {confirmed && (
        <div className={styles.aiNotifyColumn}>
          <div className={styles.aiNotifyTitle}>同门入门通报</div>
          <AnimatePresence>
            {aiList.slice(0, aiRevealedCount).map(({ hero: h, dept }) => (
              <motion.div
                key={h.id}
                className={styles.aiNotifyItem}
                style={{ ['--accent' as any]: dept.accent }}
                initial={{ opacity: 0, x: -40 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.4 }}
              >
                <img className={styles.aiAvatar} src={h.portrait} alt={h.name} />
                <div className={styles.aiText}>
                  <div className={styles.aiName}>{h.name}</div>
                  <div className={styles.aiDept}>
                    加入了 <span style={{ color: dept.accent, fontWeight: 700 }}>{dept.name}</span>
                  </div>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}

      {/* 居中欢迎弹窗 */}
      <AnimatePresence>
        {showWelcome && (
          <motion.div className={styles.welcomeOverlay} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <motion.div
              className={styles.welcomeCard}
              initial={{ scale: 0.85, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.85, y: 20, opacity: 0 }}
              transition={{ duration: 0.35, ease: 'easeOut' }}
            >
              <div className={styles.welcomeText}>
                接下来，各部门负责人将前来挑选新弟子...
              </div>
              <button type="button" className={styles.ctaBtn} onClick={handleCloseWelcome}>
                进 入 拜 师 选 择 →
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ===== 开包仪式覆盖层 ===== */}
      <AnimatePresence>
        {ceremonyPhase && confirmed && (
          <motion.div
            className={styles.ceremonyOverlay}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
            style={{ ['--accent' as any]: confirmed.accent }}
          >
            {/* 中央门派印记 */}
            <motion.div
              className={styles.ceremonySeal}
              style={{ background: confirmed.accent }}
              initial={{ y: -600, scale: 0.4, rotate: -180, opacity: 0 }}
              animate={
                ceremonyPhase === 'falling'
                  ? { y: 0, scale: 1, rotate: 0, opacity: 1 }
                  : { y: 0, scale: 1, rotate: 0, opacity: 1 }
              }
              transition={{ type: 'spring', stiffness: 220, damping: 18 }}
            >
              <span>{confirmed.name[0]}</span>
            </motion.div>

            {/* 触地金光迸发 */}
            {(ceremonyPhase === 'impact' || ceremonyPhase === 'reveal' || ceremonyPhase === 'quote') && (
              <motion.div
                className={styles.ceremonyBurst}
                initial={{ scale: 0, opacity: 0.9 }}
                animate={{ scale: 4, opacity: 0 }}
                transition={{ duration: 0.8, ease: 'easeOut' }}
              />
            )}

            {/* 部门名 */}
            {(ceremonyPhase === 'reveal' || ceremonyPhase === 'quote') && (
              <motion.div
                className={styles.ceremonyDeptName}
                initial={{ opacity: 0, y: 30 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5 }}
              >
                {confirmed.name}
              </motion.div>
            )}

            {/* 奖励数字滚动 */}
            {(ceremonyPhase === 'reveal' || ceremonyPhase === 'quote') && (
              <motion.div
                className={styles.ceremonyRewards}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.2 }}
              >
                <div className={styles.ceremonyRewardItem}>
                  <span className={styles.ceremonyRewardIcon}>◈</span>
                  <span className={styles.ceremonyRewardLabel}>灵石</span>
                  <span className={styles.ceremonyRewardValue}>
                    +<TweenNumber from={0} to={confirmed.reward.spiritStones} />
                  </span>
                </div>
                {confirmed.reward.atkBonus && (
                  <div className={styles.ceremonyRewardItem}>
                    <span className={styles.ceremonyRewardIcon}>⚔</span>
                    <span className={styles.ceremonyRewardLabel}>修为</span>
                    <span className={styles.ceremonyRewardValue}>
                      +<TweenNumber from={0} to={confirmed.reward.atkBonus} />
                    </span>
                  </div>
                )}
                {confirmed.reward.mndBonus && (
                  <div className={styles.ceremonyRewardItem}>
                    <span className={styles.ceremonyRewardIcon}>☯</span>
                    <span className={styles.ceremonyRewardLabel}>心境</span>
                    <span className={styles.ceremonyRewardValue}>
                      +<TweenNumber from={0} to={confirmed.reward.mndBonus} />
                    </span>
                  </div>
                )}
              </motion.div>
            )}

            {/* 师父留话气泡 */}
            {ceremonyPhase === 'quote' && confirmed.masterQuote && (
              <motion.div
                className={styles.ceremonyQuote}
                initial={{ opacity: 0, y: 30 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5 }}
              >
                <div className={styles.ceremonyQuoteHeader}>
                  「{confirmed.master}」{confirmed.mastertTitle} 临前留言
                </div>
                <div className={styles.ceremonyQuoteText}>{confirmed.masterQuote}</div>
                <button
                  type="button"
                  className={styles.ceremonyCloseBtn}
                  onClick={handleCloseCeremony}
                >
                  拜 师 礼 成 →
                </button>
              </motion.div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

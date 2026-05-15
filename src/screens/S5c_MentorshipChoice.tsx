/**
 * S5c 拜师入门（三选一：御敌堂 / 藏经阁 / 炼丹堂）
 *
 * v2.0 流程（加强悬念+即时反馈）：
 *   ① 首次进入 → 居中欢迎弹窗「接下来，各部门负责人将前来挑选新弟子...」+「进入拜师选择 →」
 *   ② 弹窗关闭 → 显示 3 张部门卡（奖励区显示 "?" 未知，保持悬念）
 *   ③ 玩家选中某卡 → 底部「确认拜师」按钮高亮
 *   ④ 点击确认拜师 → 揭示奖励（修为+1 / 心境+1 / 灵石 +N）
 *        · 应用到角色卡（修为/心境实时刷新）
 *        · 右下角显示「已获得灵石 / 已收集角色」
 *        · 其他两个部门卡锁定不可再选
 *   ⑤ 再点击「进入下一阶段 →」→ 回主流程
 */
import React, { useCallback, useMemo, useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { BackButton } from '@/components/BackButton';
import { useReturnToMenu } from '@/hooks/useReturnToMenu';
import { MusicToggle } from '@/components/MusicToggle';
import { CommonHud } from '@/components/CommonHud';
import { useGameStore, SaveSystem } from '@/stores/gameStore';
import { getHeroById } from '@/hooks/useConfig';
import { MENTORSHIP_OPTIONS, S5C_TITLE } from '@/data/s5Data';
import type { MentorshipOption, MentorshipId } from '@/types/game';
import styles from './S5c_MentorshipChoice.module.css';

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
  // 2026-05-13：拜师确认后插入"第二章后篇·入门余波"剧情阅读
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

  // 守卫
  useEffect(() => {
    if (!heroId) navigate('/select');
  }, [heroId, navigate]);

  const handleCloseWelcome = useCallback(() => setShowWelcome(false), []);

  const handleSelect = useCallback(
    (id: MentorshipId) => {
      if (confirmed) return;
      setSelected(id);
    },
    [confirmed]
  );

  const handleConfirm = useCallback(() => {
    if (!selected || confirmed) return;
    const opt = MENTORSHIP_OPTIONS.find((o) => o.id === selected);
    if (!opt) return;
    setMentorship(opt.id);
    // 玩家拜师的同时，6 位 AI 主角也按 AI_MENTORSHIP_TABLE 同步获得拜师加成
    applyAiMentorships();
    addSpiritStones(opt.reward.spiritStones);
    setConfirmed(opt);
    SaveSystem.save(1);
  }, [selected, confirmed, setMentorship, applyAiMentorships, addSpiritStones]);

  const handleAdvance = useCallback(() => {
    // 2026-05-13 流程调整：拜师完成 →（先读"第二章后篇·入门余波"）→ 筹备阶段（S6）
    //   - 设定 chapter=2 + storySubChapter='b' + segmentIndex=0，使 S4 阅读 ch2b
    //   - S4 阅读完 ch2b 后会自行清空 storySubChapter 并 navigate('/s6')
    //   - 章节进度的 markPhaseDone 推迟到 S6 结束时再调用
    //
    // ⚠️ 路由路径修正（2026-05-13）：S4_StoryReading 注册的 path 是 '/story' 而非 '/s4'，
    // 之前误写成 navigate('/s4') 会被 path="*" 通配符兜底重定向到 '/' → S1_Loading → '/menu'，
    // 表现为"读完拜师后会自动弹回主菜单"
    setChapter(2);
    setStorySubChapter('b');
    setSegmentIndex(0);
    SaveSystem.save(1);
    navigate('/story');
  }, [navigate, setChapter, setStorySubChapter, setSegmentIndex]);

  /** 角色属性（含拜师后的加成 + 境界提升加成） */
  const mainBonus = heroId ? (cardBonuses[heroId] ?? { hp: 0, atk: 0, mnd: 0, realmUps: 0 }) : { hp: 0, atk: 0, mnd: 0, realmUps: 0 };
  const heroAtk = (hero?.run_card.atk ?? 0) + battleBonus + mainBonus.atk;
  const heroMnd = (hero?.run_card.mnd ?? 0) + knowledgeBonus + mainBonus.mnd;
  const heroHp = (hero?.run_card.hp ?? 0) + mainBonus.hp;

  const displayName = heroName || hero?.name || '主角';

  /** 渲染奖励区：未确认前 "?" 悬念，确认后真实奖励 */
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
      // 已确认 → 真实奖励
      const { spiritStones: s, atkBonus, mndBonus } = opt.reward;
      return (
        <>
          <motion.div
            className={styles.rewardLine}
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.1 }}
          >
            <span className={styles.rewardIcon}>◈</span>
            <span>灵石 ×{s}</span>
          </motion.div>
          {atkBonus && (
            <motion.div
              className={styles.rewardLine}
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.25 }}
            >
              <span className={styles.rewardIcon}>⚔</span>
              <span>修为 +{atkBonus}</span>
            </motion.div>
          )}
          {mndBonus && (
            <motion.div
              className={styles.rewardLine}
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.25 }}
            >
              <span className={styles.rewardIcon}>☯</span>
              <span>心境 +{mndBonus}</span>
            </motion.div>
          )}
        </>
      );
    },
    [confirmed]
  );

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

  return (
    <div className={styles.screen}>
      <div className={styles.bg} />
      <div className={styles.bgVeil} />

      <BackButton onClick={returnToMenu} />
      <MusicToggle />
      <CommonHud chapter={2} />

      {/* 顶部标题：仅"拜师入门"，无副标题 */}
      <div className={styles.header}>
        <h1 className={styles.title}>{S5C_TITLE}</h1>
      </div>

      {/* 三张部门卡（欢迎弹窗关闭后显示） */}
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
                <div className={styles.cardSeal} style={{ background: opt.accent }}>
                  <span>{opt.name[0]}</span>
                </div>
                <div className={styles.cardName}>{opt.name}</div>
                <div className={styles.cardMaster}>
                  {opt.mastertTitle}·{opt.master}
                </div>
                <div className={styles.cardDivider} />
                <div className={styles.rewardBlock}>
                  {renderReward(opt)}
                </div>

                {isSelected && !confirmed && (
                  <div className={styles.selectedBadge}>已选择</div>
                )}
                {isConfirmed && (
                  <div className={styles.confirmedBadge}>✓ 已拜师</div>
                )}
              </motion.button>
            );
          })}
        </div>
      )}

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
              <button
                type="button"
                className={styles.ctaBtn}
                onClick={handleConfirm}
                disabled={!selected}
              >
                确 认 拜 师
              </button>
            </>
          ) : (
            <>
              <motion.div
                className={styles.confirmedHint}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
              >
                🎉 已加入「{confirmed.name}」！{confirmed.bonus}
              </motion.div>
              <button type="button" className={styles.ctaBtn} onClick={handleAdvance}>
                进入筹备阶段 →
              </button>
            </>
          )}
        </div>
      )}

      {/* 右下角 HUD：已获得灵石 / 已收集角色 — 由 CommonHud 统一提供（4件套常驻） */}
      {/* 独立展示角色属性 Badge —— 仅在确认拜师后显示 */}
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

      {/* 居中欢迎弹窗 */}
      <AnimatePresence>
        {showWelcome && (
          <motion.div
            className={styles.welcomeOverlay}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
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
              <button
                type="button"
                className={styles.ctaBtn}
                onClick={handleCloseWelcome}
              >
                进 入 拜 师 选 择 →
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

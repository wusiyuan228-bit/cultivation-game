/**
 * S5b 理论考核（四选一问答，从 quiz_questions.json 加载）
 *
 * 玩法：
 *   - 从 /config/events/quiz_questions.json 随机抽 N 道题（N = S5_QUIZ_COUNT）
 *   - 心境值决定提示等级：
 *       心境 1-2：无提示
 *       心境 3-4：排除 1 项错误选项
 *       心境 5+ ：排除 2 项错误选项
 *   - 答对：灵石×5；答错：保底灵石×2（不奖励线索）
 *   - 全部答完 → 跳转 /s5c（拜师入门欢迎弹窗由 S5c 承担）
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { asset } from '@/utils/assetPath';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { BackButton } from '@/components/BackButton';
import { useReturnToMenu } from '@/hooks/useReturnToMenu';
import { MusicToggle } from '@/components/MusicToggle';
import { CommonHud } from '@/components/CommonHud';
import { getHeroById } from '@/hooks/useConfig';
import { useGameStore, SaveSystem } from '@/stores/gameStore';
import {
  S5_QUIZ_COUNT,
  S5_QUIZ_REWARDS,
  S5B_TITLE,
  S5B_SUBTITLE,
} from '@/data/s5Data';
import type { QuizQuestion, QuizQuestionsData } from '@/types/game';
import styles from './S5b_QuizTrial.module.css';

/** 从题库随机抽 N 道（不重复） */
function pickQuestions(all: QuizQuestion[], n: number): QuizQuestion[] {
  const shuffled = [...all].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, Math.min(n, all.length));
}

export const S5b_QuizTrial: React.FC = () => {
  const navigate = useNavigate();
  const returnToMenu = useReturnToMenu();
  const heroId = useGameStore((s) => s.heroId);
  const knowledgeBonus = useGameStore((s) => s.knowledgeBonus);
  const cardBonuses = useGameStore((s) => s.cardBonuses);
  const addSpiritStones = useGameStore((s) => s.addSpiritStones);
  const recordQuizResult = useGameStore((s) => s.recordQuizResult);

  const hero = heroId ? getHeroById(heroId) : null;
  // 策划：心境值 = 主角跑团卡心境 + knowledgeBonus + 境界提升加成
  const mainMndBonus = heroId ? (cardBonuses[heroId]?.mnd ?? 0) : 0;
  const effectiveMnd = (hero?.run_card.mnd ?? 1) + knowledgeBonus + mainMndBonus;

  const [allQuestions, setAllQuestions] = useState<QuizQuestion[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [picked, setPicked] = useState<QuizQuestion[]>([]);
  const [idx, setIdx] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [showResult, setShowResult] = useState(false);
  const [lastFeedback, setLastFeedback] = useState<string | null>(null);

  // 加载题库
  useEffect(() => {
    let canceled = false;
    fetch(asset('config/events/quiz_questions.json'))
      .then((r) => (r.ok ? r.json() : null))
      .then((data: QuizQuestionsData | null) => {
        if (canceled) return;
        if (!data) {
          setLoadError('题库加载失败');
          return;
        }
        setAllQuestions(data.questions);
      })
      .catch(() => {
        if (!canceled) setLoadError('题库加载失败');
      });
    return () => { canceled = true; };
  }, []);

  // 抽题（仅首次）
  useEffect(() => {
    if (allQuestions.length === 0) return;
    setPicked(pickQuestions(allQuestions, S5_QUIZ_COUNT));
  }, [allQuestions]);

  // 守卫：无主角回选角
  useEffect(() => {
    if (!heroId) navigate('/select');
  }, [heroId, navigate]);

  const current = picked[idx];

  /** 根据心境值确定被排除的选项索引集合 */
  const excludedSet = useMemo(() => {
    if (!current) return new Set<number>();
    const s = new Set<number>();
    if (effectiveMnd >= 5 && current.exclude_5) {
      current.exclude_5.forEach((i) => s.add(i));
    } else if (effectiveMnd >= 3 && current.exclude_34) {
      current.exclude_34.forEach((i) => s.add(i));
    }
    return s;
  }, [current, effectiveMnd]);

  const hintText = useMemo(() => {
    if (effectiveMnd >= 5) return `心境 ${effectiveMnd} ☯ 可排除 2 项错误选项`;
    if (effectiveMnd >= 3) return `心境 ${effectiveMnd} ☯ 可排除 1 项错误选项`;
    return `心境 ${effectiveMnd} ☯ 无提示`;
  }, [effectiveMnd]);

  const handleSelect = useCallback(
    (i: number) => {
      if (showResult || !current) return;
      if (excludedSet.has(i)) return;
      setSelected(i);
    },
    [showResult, current, excludedSet]
  );

  const handleConfirm = useCallback(() => {
    if (!current || selected === null) return;
    const correct = selected === current.answer;
    recordQuizResult(correct);
    const reward = correct ? S5_QUIZ_REWARDS.correct : S5_QUIZ_REWARDS.wrong;
    addSpiritStones(reward);
    setShowResult(true);
    setLastFeedback(
      correct
        ? `✓ 答对！获得灵石×${reward}`
        : `✗ 答错。正确答案是「${current.options[current.answer]}」，获得保底灵石×${reward}`
    );
    SaveSystem.save(1);
  }, [current, selected, recordQuizResult, addSpiritStones]);

  const handleNext = useCallback(() => {
    if (!picked.length) return;
    if (idx + 1 < picked.length) {
      setIdx(idx + 1);
      setSelected(null);
      setShowResult(false);
      setLastFeedback(null);
    } else {
      // 全部答完 → 跳 S5c
      navigate('/s5c');
    }
  }, [idx, picked, navigate]);

  if (!hero) return null;

  if (loadError) {
    return (
      <div className={styles.screen}>
        <div className={styles.bg} />
        <BackButton onClick={returnToMenu} />
        <div className={styles.errorBox}>{loadError}</div>
      </div>
    );
  }

  if (!current) {
    return (
      <div className={styles.screen}>
        <div className={styles.bg} />
        <BackButton onClick={returnToMenu} />
        <div className={styles.loadingBox}>长老备题中...</div>
      </div>
    );
  }

  return (
    <div className={styles.screen}>
      <div className={styles.bg} />
      <div className={styles.bgVeil} />

      <BackButton onClick={returnToMenu} />
      <MusicToggle />
      <CommonHud chapter={2} />

      <div className={styles.header}>
        <h1 className={styles.title}>{S5B_TITLE}</h1>
        <div className={styles.sub}>{S5B_SUBTITLE}</div>
      </div>

      {/* 题目区 */}
      <div className={styles.questionCard}>
        <div className={styles.qMeta}>
          <span className={styles.qIdx}>第 {idx + 1} / {picked.length} 题</span>
          <span className={styles.mndTag}>{hintText}</span>
        </div>

        <AnimatePresence mode="wait">
          <motion.div
            key={current.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.25 }}
          >
            <div className={styles.qText}>{current.text}</div>

            <div className={styles.optList}>
              {current.options.map((opt, i) => {
                const excluded = excludedSet.has(i);
                const isSelected = selected === i;
                const isCorrect = showResult && i === current.answer;
                const isWrongSelected = showResult && isSelected && i !== current.answer;
                return (
                  <button
                    key={i}
                    type="button"
                    className={[
                      styles.optBtn,
                      excluded ? styles.optExcluded : '',
                      isSelected && !showResult ? styles.optSelected : '',
                      isCorrect ? styles.optCorrect : '',
                      isWrongSelected ? styles.optWrong : '',
                    ].filter(Boolean).join(' ')}
                    disabled={excluded || showResult}
                    onClick={() => handleSelect(i)}
                  >
                    <span className={styles.optBadge}>{String.fromCharCode(65 + i)}</span>
                    <span className={styles.optText}>{opt}</span>
                    {excluded && <span className={styles.excludedTag}>已排除</span>}
                    {isCorrect && <span className={styles.correctTag}>✓ 正确</span>}
                  </button>
                );
              })}
            </div>
          </motion.div>
        </AnimatePresence>

        {/* 反馈 + 操作 */}
        <div className={styles.actionBar}>
          <AnimatePresence>
            {lastFeedback && (
              <motion.div
                className={`${styles.feedback} ${lastFeedback.startsWith('✓') ? styles.fbOk : styles.fbBad}`}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
              >
                {lastFeedback}
              </motion.div>
            )}
          </AnimatePresence>

          {!showResult ? (
            <button
              className={styles.ctaBtn}
              onClick={handleConfirm}
              disabled={selected === null}
            >
              确 认 作 答
            </button>
          ) : (
            <button className={styles.ctaBtn} onClick={handleNext}>
              {idx + 1 < picked.length ? '下 一 题 →' : '完成考核 →'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

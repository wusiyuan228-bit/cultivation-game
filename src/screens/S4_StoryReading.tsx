import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { BackButton } from '@/components/BackButton';
import { useReturnToMenu } from '@/hooks/useReturnToMenu';
import { MusicToggle } from '@/components/MusicToggle';
import { useStory, getHeroById } from '@/hooks/useConfig';
import { getPoolCardById } from '@/systems/recruit/cardPoolLoader';
import { getCachedImage, getCachedCardFull, prefetchCardFull } from '@/utils/imageCache';
import { getDisplayCardList } from '@/utils/cardDisplayOrder';
import { useGameStore, SaveSystem, CHAPTER_PREREQ_DESC, getRealmAfterUps } from '@/stores/gameStore';
import { useAudioStore } from '@/stores/audioStore';
import { HEROES_S1S2_ORDER, TYPE_TOKEN } from '@/data/heroConstants';
import type { HeroId, CultivationType } from '@/types/game';
import styles from './S4_StoryReading.module.css';

/** 稀有度颜色 */
const RARITY_COLOR: Record<string, string> = {
  N: '#8a8a8a',
  R: '#4a9a6a',
  SR: '#b47bff',
  SSR: '#ffd65e',
  UR: '#a83b3b',
};

/** 五行克制环：剑→妖→体→灵→法→剑，丹修中立 */
const COUNTER_MAP: Record<CultivationType, { beats: string; beatenBy: string } | null> = {
  剑修: { beats: '妖修', beatenBy: '法修' },
  法修: { beats: '剑修', beatenBy: '灵修' },
  体修: { beats: '灵修', beatenBy: '妖修' },
  灵修: { beats: '法修', beatenBy: '体修' },
  妖修: { beats: '体修', beatenBy: '剑修' },
  丹修: null,
};

/** 章节标题映射（统一格式："第X章·XXXXX"） */
const CHAPTER_DISPLAY: Record<number, string> = {
  1: '天渊初见',
  2: '暗流涌动',
  3: '宗门比斗',
  4: '风云变幻',
  5: '坠魔谷深',
  6: '命运终章',
};

/** 第二章拆分后的子章节标题（2026-05-13） */
const CHAPTER2_SUB_DISPLAY: Record<'a' | 'b', string> = {
  a: '山门初见',
  b: '入门余波',
};

export const S4_StoryReading: React.FC = () => {
  const navigate = useNavigate();
  const returnToMenu = useReturnToMenu();
  const heroId = useGameStore((s) => s.heroId);
  const heroName = useGameStore((s) => s.heroName);
  const chapter = useGameStore((s) => s.chapter);
  const storySubChapter = useGameStore((s) => s.storySubChapter);
  const segmentIndex = useGameStore((s) => s.segmentIndex);
  const spiritStones = useGameStore((s) => s.spiritStones);
  const ownedCardIds = useGameStore((s) => s.ownedCardIds);
  const setChapter = useGameStore((s) => s.setChapter);
  const setStorySubChapter = useGameStore((s) => s.setStorySubChapter);
  const setSegmentIndex = useGameStore((s) => s.setSegmentIndex);
  const markStoryDone = useGameStore((s) => s.markStoryDone);
  const canEnterChapter = useGameStore((s) => s.canEnterChapter);
  const battleBonus = useGameStore((s) => s.battleBonus);
  const knowledgeBonus = useGameStore((s) => s.knowledgeBonus);
  const cardBonuses = useGameStore((s) => s.cardBonuses);
  const addCard = useGameStore((s) => s.addCard);
  const playBgm = useAudioStore((s) => s.playBgm);

  const [simplified, setSimplified] = useState(false);
  /** ch5 末尾：绑定卡奖励弹窗显示状态（已领取后关闭并跳转 /s8?round=3） */
  const [showBoundReward, setShowBoundReward] = useState(false);
  const [pageKey, setPageKey] = useState(0);
  const [showCardModal, setShowCardModal] = useState(false);
  const [detailCardId, setDetailCardId] = useState<string | null>(null);
  const [cardFlipped, setCardFlipped] = useState(false);
  const [chapterEndMsg, setChapterEndMsg] = useState<string | null>(null);
  const { story, error, loading, reload } = useStory(heroId, chapter, storySubChapter);
  /** S7D 决战最终结果：ch6 会根据此字段决定渲染哪一段 endings */
  const s7dFinalResult = useGameStore((s) => s.s7dFinalResult);

  /**
   * ch6 三态结局切换：根据 s7dFinalResult.outcome 从 story.endings 里选对应段落。
   * 若 ch6 但尚无结局（未进决战）→ 回退到 segments（兼容）。
   * 若非 ch6 → 直接用 segments。
   */
  const activeSegments = useMemo(() => {
    if (!story) return undefined;
    if (chapter !== 6) return story.segments;
    const outcome = s7dFinalResult?.outcome;
    if (outcome && story.endings && story.endings[outcome]?.segments?.length) {
      return story.endings[outcome]!.segments;
    }
    // 未进决战或结局JSON未提供对应分支 → 回退到 segments（默认胜利）
    return story.segments;
  }, [story, chapter, s7dFinalResult]);

  const activeChapterTitleSub = useMemo<string | null>(() => {
    if (!story) return null;
    if (chapter !== 6) return story.chapter_title ?? null;
    const outcome = s7dFinalResult?.outcome;
    if (outcome && story.endings && story.endings[outcome]?.title) {
      return story.endings[outcome]!.title;
    }
    return story.chapter_title ?? null;
  }, [story, chapter, s7dFinalResult]);

  useEffect(() => {
    playBgm(`story_ch${chapter}`);
  }, [chapter, playBgm]);

  // 打开详情时预取大图，进入翻面近乎瞬时
  useEffect(() => {
    if (detailCardId) {
      prefetchCardFull(detailCardId);
      setCardFlipped(false); // 切换角色时回到正面
    }
  }, [detailCardId]);

  // 字数统计
  const wordStats = useMemo(() => {
    if (!story || !activeSegments) return { current: 0, total: 0 };
    const total = activeSegments.reduce(
      (acc, s) => acc + ((simplified ? s.simplified : s.text)?.length ?? s.text?.length ?? 0),
      0,
    );
    const current = activeSegments
      .slice(0, Math.min(segmentIndex + 1, activeSegments.length))
      .reduce((acc, s) => {
        const t = simplified && s.simplified ? s.simplified : s.text;
        return acc + (t?.length ?? 0);
      }, 0);
    return { current, total };
  }, [story, activeSegments, segmentIndex, simplified]);

  const currentSegment = activeSegments?.[segmentIndex];

  /** 章节标题：优先用 endings.title（ch6 三态），其次JSON中的 chapter_title，回退用本地映射 */
  const chapterTitle = useMemo(() => {
    // 第二章拆分版：用子章节标题（"山门初见" / "入门余波"），主标题保持"第二章"
    if (chapter === 2 && (storySubChapter === 'a' || storySubChapter === 'b')) {
      const sub = activeChapterTitleSub
        ?? CHAPTER2_SUB_DISPLAY[storySubChapter]
        ?? CHAPTER_DISPLAY[2];
      return `第二章·${sub}`;
    }
    const sub = activeChapterTitleSub ?? CHAPTER_DISPLAY[chapter] ?? '';
    return `第${chapter === 1 ? '一' : chapter === 2 ? '二' : chapter === 3 ? '三' : chapter === 4 ? '四' : chapter === 5 ? '五' : '六'}章·${sub}`;
  }, [activeChapterTitleSub, chapter, storySubChapter]);

  const goNext = useCallback(() => {
    if (!story || !activeSegments) return;
    if (segmentIndex + 1 < activeSegments.length) {
      // 还有下一段
      setSegmentIndex(segmentIndex + 1);
      setPageKey((k) => k + 1);
      SaveSystem.save(1);
    } else {
      // 本章剧情读完 → 标记storyDone
      markStoryDone(chapter);
      SaveSystem.save(1);

      if (chapter >= 6) {
        // 最终章结束
        navigate('/menu');
        return;
      }

      // ★ 第二章拆分版（2026-05-13）：
      //   - ch2a（山门初见，测试前阅读）读完 → 进入入门测试 S5a
      //   - ch2b（入门余波，拜师后阅读）读完 → 进入筹备界面 S6
      //   - 旧 ch2（兼容老存档，subChapter=''）读完 → 仍走 S5a
      if (chapter === 2) {
        if (storySubChapter === 'b') {
          // 后篇阅读完 → 清空子章节标识，进入筹备
          setStorySubChapter('');
          SaveSystem.save(1);
          navigate('/s6');
          return;
        }
        // 前篇阅读完（或无子章节标识的旧版） → 进入入门测试
        navigate('/s5a');
        return;
      }

      // ★ 第三章剧情读完 → 进入合作清怪战（S7）
      if (chapter === 3) {
        navigate('/s7');
        return;
      }

      // ★ 第四章剧情读完 → 进入宗门大比第一场 2v2（S7C）
      if (chapter === 4) {
        navigate('/s7c?sect1');
        return;
      }

      // ★ 第五章剧情读完 → 弹出"绑定卡奖励"弹窗（不立即跳转，发放完成后由 handleClaimBoundReward 跳 S8c）
      if (chapter === 5) {
        setShowBoundReward(true);
        return;
      }

      // 校验下一章是否可进入
      const nextCh = chapter + 1;
      if (canEnterChapter(nextCh)) {
        setChapter(nextCh);
        // 第一章读完进入第二章 → 自动定位到前篇（ch2a · 山门初见）
        if (nextCh === 2) {
          setStorySubChapter('a');
        }
        setSegmentIndex(0);
        setPageKey((k) => k + 1);
        setChapterEndMsg(null);
        SaveSystem.save(1);
      } else {
        // 前置流程未完成 → 显示提示，不自动进入下一章
        setChapterEndMsg(
          `第${chapter === 1 ? '一' : chapter === 2 ? '二' : chapter === 3 ? '三' : chapter === 4 ? '四' : '五'}章剧情已读完。\n${CHAPTER_PREREQ_DESC[nextCh] ?? '完成当前章节所有环节后开启下一章。'}`
        );
      }
    }
  }, [story, activeSegments, segmentIndex, setSegmentIndex, chapter, storySubChapter, setChapter, setStorySubChapter, navigate, markStoryDone, canEnterChapter]);

  const goPrev = useCallback(() => {
    if (segmentIndex > 0) {
      setSegmentIndex(segmentIndex - 1);
      setPageKey((k) => k + 1);
    }
  }, [segmentIndex, setSegmentIndex]);

  // 键盘快捷键
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === ' ' || e.code === 'Space') {
        e.preventDefault();
        goNext();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        goPrev();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [goNext, goPrev]);

  // 角色未设置 → 回选角
  useEffect(() => {
    if (!heroId) navigate('/select');
  }, [heroId, navigate]);

  // 2026-05-13：第二章拆分兼容守卫
  // 老存档或外部入口（如 storyDone 后 setChapter(2)）若 storySubChapter 为空，自动定位到前篇 'a'。
  // 拜师后已主动设置 'b'，不会被这里覆盖。
  useEffect(() => {
    if (chapter === 2 && storySubChapter === '') {
      setStorySubChapter('a');
    }
  }, [chapter, storySubChapter, setStorySubChapter]);

  if (!heroId) return null;

  return (
    <div className={styles.screen}>
      {/* 水墨背景 — 使用缓存的blob URL */}
      <div className={styles.bg} style={{ backgroundImage: `url(${getCachedImage('s3_bg')})` }} />
      <div className={styles.bgVeil} />

      <BackButton onClick={returnToMenu} />
      <MusicToggle />

      {/* 书卷 */}
      <div className={styles.scroll}>
        <div className={styles.rod} data-side="left" />

        <div className={styles.paper}>
          {loading ? (
            <div className={styles.statusMsg}>卷轴展开中...</div>
          ) : error ? (
            <div className={styles.statusMsg}>
              <div className={styles.errorText}>加载失败</div>
              <div className={styles.errorDetail}>{error}</div>
              <button
                onClick={reload}
                style={{
                  marginTop: 24,
                  padding: '10px 28px',
                  background: 'linear-gradient(180deg, #d4b170 0%, #a8895a 100%)',
                  border: '1px solid #6e5a3a',
                  borderRadius: 6,
                  color: '#2d1f10',
                  fontFamily: 'inherit',
                  fontSize: 16,
                  fontWeight: 700,
                  letterSpacing: 2,
                  cursor: 'pointer',
                  boxShadow: '0 2px 6px rgba(0,0,0,0.3)',
                }}
              >
                重新加载
              </button>
              <div style={{ marginTop: 14, fontSize: 12, color: '#8a7148' }}>
                若多次重试仍失败，请检查网络连接，或退出重新进入。
              </div>
            </div>
          ) : chapterEndMsg ? (
            <div className={styles.chapterEndBox}>
              <h1 className={styles.chapterTitle}>{chapterTitle}</h1>
              <div className={styles.divider} />
              <div className={styles.chapterEndText}>{chapterEndMsg}</div>
              <div className={styles.chapterEndHint}>请完成后续流程环节，剧情将自动继续。</div>
            </div>
          ) : story && currentSegment ? (
            <>
              {/* 章节标题：楷体居中大字深墨色 */}
              <h1 className={styles.chapterTitle}>{chapterTitle}</h1>
              <div className={styles.divider} />


              <AnimatePresence mode="wait">
                <motion.div
                  key={pageKey}
                  className={styles.textArea}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2 }}
                >
                  {currentSegment.speaker && (
                    <div className={styles.speaker}>【{currentSegment.speaker}】</div>
                  )}
                  <p className={styles.bodyText}>
                    {simplified && currentSegment.simplified
                      ? currentSegment.simplified
                      : currentSegment.text}
                  </p>
                </motion.div>
              </AnimatePresence>
            </>
          ) : null}
        </div>

        <div className={styles.rod} data-side="right" />
      </div>

      {/* 底部控制栏 */}
      <div className={styles.controlBar}>
        <div className={styles.leftCtrl}>
          <div className={styles.wordCount}>
            已阅 {wordStats.current}/{wordStats.total} 字
          </div>
          <label className={styles.toggle}>
            <input
              type="checkbox"
              checked={simplified}
              onChange={(e) => setSimplified(e.target.checked)}
            />
            <span className={styles.toggleKnob} />
            <span className={styles.toggleLabel}>
              {simplified ? '简化版' : '完整版'}
            </span>
          </label>
        </div>

        <div className={styles.pagingCtrl}>
          <button
            className={styles.pageBtn}
            onClick={goPrev}
            disabled={segmentIndex === 0}
          >
            ← 上一页
          </button>
          <span className={styles.pageIndicator}>
            {activeSegments ? `${segmentIndex + 1} / ${activeSegments.length}` : '—'}
          </span>
          <button className={styles.pageBtn} onClick={goNext}>
            下一页 →
          </button>
        </div>

        <div className={styles.rightCtrl}>
          <div className={styles.spiritStones}>
            已获得灵石: <strong>{spiritStones}</strong>
          </div>
          <button className={styles.collectionBtn} onClick={() => setShowCardModal(true)}>
            已收集角色: <strong>{(heroId ? 1 : 0) + ownedCardIds.filter((id) => id !== heroId).length}</strong>
          </button>
        </div>
      </div>

      {/* 角色卡牌收集Modal */}
      <AnimatePresence>
        {showCardModal && (
          <motion.div
            className={styles.modalOverlay}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => {
              // 详情视图点外部 → 回列表；列表视图点外部 → 关闭
              if (detailCardId) {
                setDetailCardId(null);
              } else {
                setShowCardModal(false);
              }
            }}
          >
            {detailCardId ? (
              /* ============================================================
                 详情 Modal —— 3:4 比例卡牌容器，支持 3D 翻转
                 点击卡面任意位置或右上翻转按钮均可翻面
              ============================================================ */
              (() => {
                const hero = getHeroById(detailCardId as HeroId);
                const poolCard = !hero ? getPoolCardById(detailCardId) : null;
                if (!hero && !poolCard) return null;

                // NR卡详情面板（简化版，无battle_card等字段）
                if (poolCard) {
                  const counters = COUNTER_MAP[poolCard.type as CultivationType];
                  const rarityColor = RARITY_COLOR[poolCard.rarity] ?? '#888';
                  const toggleFlip = () => setCardFlipped((f) => !f);
                  const cardBonus = cardBonuses[detailCardId] ?? { hp: 0, atk: 0, mnd: 0, realmUps: 0 };
                  const displayHp = poolCard.hp + cardBonus.hp;
                  const displayAtk = poolCard.atk + cardBonus.atk;
                  const displayMnd = poolCard.mnd + cardBonus.mnd;
                  const currentRealm = getRealmAfterUps(poolCard.realm, cardBonus.realmUps);
                  return (
                    <motion.div
                      className={styles.detailModal}
                      initial={{ scale: 0.88, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      exit={{ scale: 0.88, opacity: 0 }}
                      transition={{ duration: 0.25 }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div
                        className={`${styles.flipContainer} ${cardFlipped ? styles.isFlipped : ''}`}
                        onClick={toggleFlip}
                      >
                        {/* ========== 正面：NR卡详情页 ========== */}
                        <div
                          className={`${styles.cardFace} ${styles.cardFaceFront}`}
                          style={{ borderColor: rarityColor }}
                        >
                          <span className={styles.flipHint}>点击翻面看立绘</span>
                          <button
                            className={styles.flipBtn}
                            onClick={(e) => { e.stopPropagation(); toggleFlip(); }}
                            title="翻面查看立绘"
                          >⇋</button>
                          <div
                            className={styles.detailView}
                            onClick={(e) => e.stopPropagation()}
                          >
                            <button className={styles.backBtn} onClick={() => setDetailCardId(null)}>← 返回列表</button>
                            <div className={styles.detailHeader}>
                              <div className={styles.detailPortrait} style={{ backgroundImage: `url(${getCachedImage(detailCardId)})`, borderColor: rarityColor }} />
                              <div className={styles.detailMeta}>
                                <div className={styles.detailName}>{poolCard.name}</div>
                                <div className={styles.detailRarity} style={{ color: rarityColor }}>{poolCard.rarity} · {poolCard.type}</div>
                                <div className={styles.detailRealm}>境界：{currentRealm}</div>
                                <div className={styles.statsBlock}>
                                  <div className={styles.statsLabel}>跑团卡属性</div>
                                  <div className={styles.detailStats}>
                                    <span>生命 {displayHp}{cardBonus.hp > 0 ? <em style={{ color: '#5be05b', fontSize: 12, marginLeft: 2 }}>(+{cardBonus.hp})</em> : null}</span>
                                    <span>修为 {displayAtk}{cardBonus.atk > 0 ? <em style={{ color: '#5be05b', fontSize: 12, marginLeft: 2 }}>(+{cardBonus.atk})</em> : null}</span>
                                    <span>心境 {displayMnd}{cardBonus.mnd > 0 ? <em style={{ color: '#5be05b', fontSize: 12, marginLeft: 2 }}>(+{cardBonus.mnd})</em> : null}</span>
                                  </div>
                                </div>
                              </div>
                            </div>
                            <div className={styles.detailDivider} />
                            <div className={styles.detailSection}>
                              <h3 className={styles.sectionTitle}>招募技能</h3>
                              {poolCard.runSkill ? (
                                <div className={styles.skillRow}>
                                  <span className={styles.skillName}>{poolCard.runSkill.name}</span>
                                  <span className={styles.skillDesc}>{poolCard.runSkill.desc}</span>
                                </div>
                              ) : <div className={styles.skillNone}>无</div>}
                            </div>
                            <div className={styles.detailSection}>
                              <h3 className={styles.sectionTitle}>战斗技能</h3>
                              {((poolCard.rarity as string) === 'N' || (poolCard.rarity as string) === 'R') ? (
                                <div className={styles.skillNone}>此卡无战斗技能（仅数值上阵）</div>
                              ) : chapter < 3 ? (
                                <div className={styles.awakeningHidden}>
                                  <span className={styles.lockIcon}>🔒</span>
                                  <span>战斗环节揭晓</span>
                                </div>
                              ) : (
                                <>
                                  {poolCard.battleSkill ? (
                                    <div className={styles.skillRow}>
                                      <span className={styles.skillName}>{poolCard.battleSkill.name}</span>
                                      <span className={styles.skillDesc}>{poolCard.battleSkill.desc}</span>
                                    </div>
                                  ) : <div className={styles.skillNone}>无</div>}
                                  {poolCard.ultimate && (
                                    <div className={styles.skillRow}>
                                      <span className={styles.skillName}>绝技：{poolCard.ultimate.name}</span>
                                      <span className={styles.skillDesc}>{poolCard.ultimate.desc}（单场战斗仅限释放1次）</span>
                                    </div>
                                  )}
                                </>
                              )}
                            </div>
                            <div className={styles.detailDivider} />
                            <div className={styles.detailSection}>
                              <h3 className={styles.sectionTitle}>克制关系</h3>
                              <div className={styles.counterInfo}>
                                {counters ? (
                                  <>
                                    <span className={styles.counterWin}>克制 <strong>{counters.beats}</strong></span>
                                    <span className={styles.counterLose}>被 <strong>{counters.beatenBy}</strong> 克制</span>
                                  </>
                                ) : (
                                  <span className={styles.counterNeutral}>丹修 · 中立，不参与克制循环</span>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* ========== 反面：整屏立绘大图 ========== */}
                        <div
                          className={`${styles.cardFace} ${styles.cardFaceBack}`}
                          style={{ borderColor: rarityColor }}
                        >
                          <div
                            className={styles.cardFullImg}
                            style={{ backgroundImage: `url(${getCachedCardFull(detailCardId)})` }}
                          />
                          <button
                            className={styles.flipBtn}
                            onClick={(e) => { e.stopPropagation(); toggleFlip(); }}
                            title="翻回详情"
                          >⇋</button>
                          <div className={styles.cardFullMeta}>
                            <div className={styles.cardFullName}>{poolCard.name}</div>
                            <div className={styles.cardFullTags}>
                              <span style={{ color: rarityColor, borderLeft: `3px solid ${rarityColor}`, paddingLeft: 10 }}>{poolCard.rarity}</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  );
                }

                // 主角卡详情面板（原有逻辑）— 走到这里 hero 一定存在
                const h = hero!;
                const counters = COUNTER_MAP[h.type as CultivationType];
                const rarityLabel = h.rarity === '主角' ? 'SSR' : h.rarity;
                const rarityColor = RARITY_COLOR[rarityLabel] ?? '#888';
                const toggleFlip = () => setCardFlipped((f) => !f);

                // 主角卡属性 = 基础值 + 游戏过程中的加成
                const isMainHero = detailCardId === heroId;
                const cardBonus = cardBonuses[detailCardId] ?? { hp: 0, atk: 0, mnd: 0, realmUps: 0 };
                const displayAtk = h.run_card.atk + cardBonus.atk + (isMainHero ? battleBonus : 0);
                const displayMnd = h.run_card.mnd + cardBonus.mnd + (isMainHero ? knowledgeBonus : 0);
                const displayHp = h.run_card.hp + cardBonus.hp;
                const totalAtkBonus = cardBonus.atk + (isMainHero ? battleBonus : 0);
                const totalMndBonus = cardBonus.mnd + (isMainHero ? knowledgeBonus : 0);
                const totalHpBonus = cardBonus.hp;
                const currentRealm = getRealmAfterUps(h.realm, cardBonus.realmUps);
                return (
                  <motion.div
                    className={styles.detailModal}
                    initial={{ scale: 0.88, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.88, opacity: 0 }}
                    transition={{ duration: 0.25 }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div
                      className={`${styles.flipContainer} ${cardFlipped ? styles.isFlipped : ''}`}
                      onClick={toggleFlip}
                    >
                      {/* ========== 正面：详情页 ========== */}
                      <div
                        className={`${styles.cardFace} ${styles.cardFaceFront}`}
                        style={{ borderColor: rarityColor }}
                      >
                        <span className={styles.flipHint}>点击翻面看立绘</span>
                        <button
                          className={styles.flipBtn}
                          onClick={(e) => { e.stopPropagation(); toggleFlip(); }}
                          title="翻面查看立绘"
                        >⇋</button>
                        <div
                          className={styles.detailView}
                          /* 详情内部滚动/交互区，不触发翻面 */
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button className={styles.backBtn} onClick={() => setDetailCardId(null)}>← 返回列表</button>
                          <div className={styles.detailHeader}>
                            <div className={styles.detailPortrait} style={{ backgroundImage: `url(${getCachedImage(detailCardId)})`, borderColor: rarityColor }} />
                            <div className={styles.detailMeta}>
                              <div className={styles.detailName}>{h.name}</div>
                              <div className={styles.detailRarity} style={{ color: rarityColor }}>{rarityLabel} · {h.type}</div>
                              <div className={styles.detailRealm}>境界：{currentRealm}</div>
                              <div className={styles.statsBlock}>
                                <div className={styles.statsLabel}>属性</div>
                                <div className={styles.detailStats}>
                                  <span>生命 {displayHp}{totalHpBonus > 0 ? <em style={{ color: '#5be05b', fontSize: 12, marginLeft: 2 }}>(+{totalHpBonus})</em> : null}</span>
                                  <span>修为 {displayAtk}{totalAtkBonus > 0 ? <em style={{ color: '#5be05b', fontSize: 12, marginLeft: 2 }}>(+{totalAtkBonus})</em> : null}</span>
                                  <span>心境 {displayMnd}{totalMndBonus > 0 ? <em style={{ color: '#5be05b', fontSize: 12, marginLeft: 2 }}>(+{totalMndBonus})</em> : null}</span>
                                </div>
                              </div>
                            </div>
                          </div>
                          <div className={styles.detailDivider} />
                          {chapter < 5 && (
                            <>
                              <div className={styles.detailSection}>
                                <h3 className={styles.sectionTitle}>招募技能</h3>
                                {h.battle_card.skills.run_skill ? (
                                  <div className={styles.skillRow}>
                                    <span className={styles.skillName}>{h.battle_card.skills.run_skill.name}</span>
                                    <span className={styles.skillDesc}>{h.battle_card.skills.run_skill.desc}</span>
                                  </div>
                                ) : <div className={styles.skillNone}>无</div>}
                              </div>
                            </>
                          )}
                          <div className={styles.detailSection}>
                            <h3 className={styles.sectionTitle}>战斗技能</h3>
                            {chapter < 3 ? (
                              <div className={styles.awakeningHidden}>
                                <span className={styles.lockIcon}>🔒</span>
                                <span>战斗环节揭晓</span>
                              </div>
                            ) : (
                              <>
                                {h.battle_card.skills.battle_skill ? (
                                  <div className={styles.skillRow}>
                                    <span className={styles.skillName}>{h.battle_card.skills.battle_skill.name}</span>
                                    <span className={styles.skillDesc}>{h.battle_card.skills.battle_skill.desc}</span>
                                  </div>
                                ) : <div className={styles.skillNone}>无</div>}
                                {h.battle_card.skills.ultimate && (
                                  <div className={styles.skillRow}>
                                    <span className={styles.skillName}>绝技：{h.battle_card.skills.ultimate.name}</span>
                                    <span className={styles.skillDesc}>{h.battle_card.skills.ultimate.desc}（单场战斗仅限释放1次）</span>
                                  </div>
                                )}
                              </>
                            )}
                          </div>
                          {h.awakening && (
                            <div className={styles.detailSection}>
                              <h3 className={styles.sectionTitle}>觉醒技能</h3>
                              <div className={styles.awakeningHidden}>
                                <span className={styles.lockIcon}>🔒</span>
                                <span>觉醒条件与技能效果未知，需在战斗中满足特定条件后揭晓</span>
                              </div>
                            </div>
                          )}
                          <div className={styles.detailDivider} />
                          <div className={styles.detailSection}>
                            <h3 className={styles.sectionTitle}>克制关系</h3>
                            <div className={styles.counterInfo}>
                              {counters ? (
                                <>
                                  <span className={styles.counterWin}>克制 <strong>{counters.beats}</strong></span>
                                  <span className={styles.counterLose}>被 <strong>{counters.beatenBy}</strong> 克制</span>
                                </>
                              ) : (
                                <span className={styles.counterNeutral}>丹修 · 中立，不参与克制循环</span>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* ========== 反面：整屏立绘大图 ========== */}
                      <div
                        className={`${styles.cardFace} ${styles.cardFaceBack}`}
                        style={{ borderColor: rarityColor }}
                      >
                        <div
                          className={styles.cardFullImg}
                          style={{ backgroundImage: `url(${getCachedCardFull(detailCardId)})` }}
                        />
                        <button
                          className={styles.flipBtn}
                          onClick={(e) => { e.stopPropagation(); toggleFlip(); }}
                          title="翻回详情"
                        >⇋</button>
                        <div className={styles.cardFullMeta}>
                          <div className={styles.cardFullName}>{h.name}</div>
                          <div className={styles.cardFullTags}>
                            <span style={{ color: rarityColor, borderLeft: `3px solid ${rarityColor}`, paddingLeft: 10 }}>{rarityLabel}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </motion.div>
                );
              })()
            ) : (
              /* ============================================================
                 列表 Modal —— 缩略图网格
              ============================================================ */
              <motion.div
                className={styles.cardModal}
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.9, opacity: 0 }}
                onClick={(e) => e.stopPropagation()}
              >
                <h2 className={styles.modalTitle}>已收集角色</h2>
                <div className={styles.thumbGrid}>
                  {/* 全局统一排序：主角置顶 → 稀有度降序（SSR→SR→R→N）→ 同稀有度保持收集顺序 */}
                  {(() => {
                    // 为排序工具提供一个返回 rarity 的 resolver（兼容主角 & 卡池卡）
                    const resolver = (id: string) => {
                      const h = getHeroById(id as HeroId);
                      if (h) return h as any;
                      const p = getPoolCardById(id);
                      if (!p) return null;
                      return { rarity: p.rarity } as any;
                    };
                    return getDisplayCardList(heroId, ownedCardIds as readonly string[], resolver);
                  })().map((cardId) => {
                    // 优先从主角数据查找
                    const hero = getHeroById(cardId as HeroId);
                    if (hero) {
                      const rarityLabel = hero.rarity === '主角' ? 'SSR' : hero.rarity;
                      const rarityColor = RARITY_COLOR[rarityLabel] ?? '#888';
                      return (
                        <div
                          key={cardId}
                          className={styles.thumbCard}
                          style={{ borderColor: rarityColor }}
                          onClick={() => setDetailCardId(cardId as HeroId)}
                        >
                          <div className={styles.thumbPortrait} style={{ backgroundImage: `url(${getCachedImage(cardId)})` }} />
                          <div className={styles.thumbTopVeil} />
                          <div className={styles.thumbBottomVeil} />
                          <div className={styles.thumbRarity} style={{ background: rarityColor }}>{rarityLabel}</div>
                          <div className={styles.thumbRealm}>{getRealmAfterUps(hero.realm, (cardBonuses[cardId]?.realmUps ?? 0))}</div>
                          <div className={styles.thumbName}>{hero.name}</div>
                          <div className={styles.thumbType} style={{ background: TYPE_TOKEN[hero.type as CultivationType] }}>{hero.type}</div>
                        </div>
                      );
                    }
                    // 非主角卡：从卡池数据查找
                    const poolCard = getPoolCardById(cardId);
                    if (poolCard) {
                      const rarityColor = RARITY_COLOR[poolCard.rarity] ?? '#888';
                      return (
                        <div
                          key={cardId}
                          className={styles.thumbCard}
                          style={{ borderColor: rarityColor }}
                          onClick={() => setDetailCardId(cardId)}
                        >
                          <div className={styles.thumbPortrait} style={{ backgroundImage: `url(${getCachedImage(cardId)})` }} />
                          <div className={styles.thumbTopVeil} />
                          <div className={styles.thumbBottomVeil} />
                          <div className={styles.thumbRarity} style={{ background: rarityColor }}>{poolCard.rarity}</div>
                          <div className={styles.thumbName}>{poolCard.name}</div>
                          <div className={styles.thumbType}>{poolCard.type}</div>
                        </div>
                      );
                    }
                    return null;
                  })}
                </div>
                <button className={styles.modalClose} onClick={() => setShowCardModal(false)}>关闭</button>
              </motion.div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* ★ 第五章结束弹窗：绑定 SSR + 绑定 SR 奖励发放 */}
      <AnimatePresence>
        {showBoundReward && (
          <BoundRewardModal
            heroId={heroId}
            onClaim={() => {
              // 为 6 位主角发放对应的绑定 SSR 和 绑定 SR（不进卡池，直接进 ownedCardIds）
              // 数据来源：card_pools.json bindings 映射
              const BOUND_MAP: Record<string, { ssr: string; sr: string }> = {
                hero_tangsan:  { ssr: 'bssr_tanghao',    sr: 'bsr_tangya' },
                hero_xiaowu:   { ssr: 'bssr_erming',     sr: 'bsr_wangdonger' },
                hero_xiaoyan:  { ssr: 'bssr_yaochen',    sr: 'bsr_xiaozhan' },
                hero_xuner:    { ssr: 'bssr_guyuan',     sr: 'bsr_xiaoyixian' },
                hero_hanli:    { ssr: 'bssr_nangongwan', sr: 'bsr_yinyue' },
                hero_wanglin:  { ssr: 'bssr_situnan',    sr: 'bsr_limuwan' },
              };
              const mine = heroId ? BOUND_MAP[heroId] : null;
              if (mine) {
                addCard(mine.ssr);
                addCard(mine.sr);
              }
              setShowBoundReward(false);
              SaveSystem.save(1);
              navigate('/s8?round=3');
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
};

// ==============================================================
// 🎁 BoundRewardModal：第五章剧情结束后的"绑定卡奖励"弹窗
//   - 每位主角获得 1 张绑定 SSR + 1 张绑定 SR
//   - 不进卡池，直接加入 ownedCardIds
//   - 点击「领取」后关闭弹窗并跳转 /s8?round=3（最终密谈）
// ==============================================================
const BOUND_REWARD_MAP: Record<string, { ssrId: string; ssrName: string; srId: string; srName: string }> = {
  hero_tangsan:  { ssrId: 'bssr_tanghao',    ssrName: '塘昊',   srId: 'bsr_tangya',      srName: '塘雅' },
  hero_xiaowu:   { ssrId: 'bssr_erming',     ssrName: '尔铭',   srId: 'bsr_wangdonger',  srName: '汪冬儿' },
  hero_xiaoyan:  { ssrId: 'bssr_yaochen',    ssrName: '曜尘',   srId: 'bsr_xiaozhan',    srName: '霄战' },
  hero_xuner:    { ssrId: 'bssr_guyuan',     ssrName: '顾元',   srId: 'bsr_xiaoyixian',  srName: '小忆仙' },
  hero_hanli:    { ssrId: 'bssr_nangongwan', ssrName: '南宫宛', srId: 'bsr_yinyue',      srName: '隐月' },
  hero_wanglin:  { ssrId: 'bssr_situnan',    ssrName: '司图楠', srId: 'bsr_limuwan',     srName: '黎慕婉' },
};

const BoundRewardModal: React.FC<{
  heroId: HeroId | null;
  onClaim: () => void;
}> = ({ heroId, onClaim }) => {
  const reward = heroId ? BOUND_REWARD_MAP[heroId] : null;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(10,8,6,0.82)',
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <motion.div
        initial={{ scale: 0.9, y: 30 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.9, y: 30 }}
        style={{
          width: 560,
          maxWidth: '92vw',
          background: 'linear-gradient(180deg,#1f1a14 0%,#15110d 100%)',
          border: '2px solid #c8a14b',
          borderRadius: 12,
          boxShadow: '0 0 40px rgba(200,161,75,0.5)',
          padding: '28px 32px 22px',
        }}
      >
        <div style={{ textAlign: 'center', marginBottom: 14 }}>
          <div style={{ fontSize: 24, fontWeight: 700, color: '#ffe08a', letterSpacing: 2 }}>
            ⚡ 血脉觉醒 · 绑定卡现世
          </div>
          <div style={{ fontSize: 14, color: '#a09878', marginTop: 6 }}>
            坠魔谷大战在即，师门隐秘随主角的觉醒而浮现
          </div>
        </div>

        <div style={{ textAlign: 'center', color: '#c9bfa3', fontSize: 14, lineHeight: 1.75, padding: '8px 12px 14px' }}>
          修行路上，命运早已为你埋下伏笔——
          <br />
          两张象征血脉与道心的<strong style={{ color: '#f0d98a' }}>绑定卡</strong>自虚空显现，
          <br />
          唯你可驭，不可流转。
        </div>

        {reward ? (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, padding: '10px 0 18px' }}>
            <RewardCardBlock id={reward.ssrId} name={reward.ssrName} rarity="SSR" color="#ffd65e" />
            <RewardCardBlock id={reward.srId} name={reward.srName} rarity="SR" color="#b47bff" />
          </div>
        ) : (
          <div style={{ color: '#c08080', textAlign: 'center', padding: 18 }}>
            未找到当前主角的绑定卡配置
          </div>
        )}

        <div style={{ textAlign: 'center', marginTop: 6 }}>
          <button
            onClick={onClaim}
            style={{
              background: 'linear-gradient(180deg,#e4b65e,#a27020)',
              border: '1px solid #f0d98a',
              color: '#1a1412',
              padding: '12px 32px',
              fontSize: 16,
              fontWeight: 700,
              borderRadius: 6,
              cursor: 'pointer',
              letterSpacing: 2,
              boxShadow: '0 2px 12px rgba(200,161,75,0.4)',
            }}
          >
            领取并进入最终密谈
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
};

const RewardCardBlock: React.FC<{ id: string; name: string; rarity: string; color: string }> = ({ id, name, rarity, color }) => (
  <div
    style={{
      border: `2px solid ${color}`,
      borderRadius: 10,
      padding: 10,
      background: 'rgba(30,24,18,0.65)',
      textAlign: 'center',
    }}
  >
    <div
      style={{
        width: '100%',
        aspectRatio: '3/4',
        backgroundImage: `url(${getCachedImage(id)})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center top',
        borderRadius: 6,
        marginBottom: 8,
      }}
    />
    <div style={{ fontSize: 16, color: '#f0d98a', fontWeight: 700, marginBottom: 2 }}>{name}</div>
    <div style={{ fontSize: 12, color, letterSpacing: 1 }}>{rarity} · 绑定</div>
  </div>
);


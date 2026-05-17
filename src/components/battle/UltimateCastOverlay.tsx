/**
 * UltimateCastOverlay — 绝技释放屏幕特效（v3 · 2026-05-17）
 *
 * v3 改动：
 *   ① 把 [绝技标签 + 立绘 + 横幅] 封装为单个内部组件 CastCard
 *   ② overlay 用 flex 居中（参照 HeroRevealCutscene 的仙缘卡居中方案）
 *   ③ 立绘宽度 380px（用户要求）
 *   ④ 整张 CastCard 一起做滑入/淡出动画，内部相对位置永远固定
 *
 * 总时长：1000ms
 */
import { useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { getCachedCardFull, getCachedImage } from '@/utils/imageCache';
import { getHeroTheme } from '@/data/heroThemeColors';
import styles from './UltimateCastOverlay.module.css';

export interface UltimateCastEvent {
  ts: number;
  unitId: string;
  heroId?: string;
  /** 卡牌 id（imageCache key），如 'sr_daimubai'。当 heroId 为空时用作立绘解析的 fallback */
  cardId?: string;
  heroName: string;
  ultimateName: string;
  portrait?: string;
}

interface Props {
  event: UltimateCastEvent | null;
  durationMs?: number;
}

/**
 * 立绘解析优先级：
 *   1) heroId → 主角大图（含觉醒态）
 *   2) cardId → 通用卡牌大图（sr_/ssr_/r_/n_/bsr_/bssr_ 等所有非主角棋子）
 *   3) portrait → 已是 URL/blob 直接用；是 imageCache key 走小图兜底
 *   4) 全部失败 → 返回空，触发 portraitFallback（首字占位）
 *
 * 注：getCachedCardFull 不挑前缀，直接拼 images/cards_full/{id}.jpg；
 *     CARD_IDS 内已声明的资源都存在于 public/images/cards_full/ 下。
 */
function resolveFullPortrait(
  heroId: string | undefined,
  cardId: string | undefined,
  portrait: string | undefined,
): string {
  // 1) 主角
  if (heroId) {
    const full = getCachedCardFull(heroId);
    if (full) return full;
    const small = getCachedImage(heroId);
    if (small) return small;
  }
  // 2) 非主角棋子：用 cardId 取 cards_full 大图
  if (cardId) {
    const full = getCachedCardFull(cardId);
    if (full) return full;
    const small = getCachedImage(cardId);
    if (small) return small;
  }
  // 3) portrait 字段兜底（可能是 blob URL / asset 路径 / imageCache key）
  if (!portrait) return '';
  if (/^(https?:|blob:|data:|\/|\.)/.test(portrait)) return portrait;
  // 形如 'hero/hero_xxx' 的占位 key —— 提取末段当 cardId 再试
  if (portrait.startsWith('hero/')) {
    const key = portrait.slice('hero/'.length);
    const full = getCachedCardFull(key);
    if (full) return full;
  }
  return getCachedImage(portrait) || '';
}

const PARTICLE_COUNT = 8;

/**
 * 内部组件：演出卡 —— 绝技标签 + 立绘 + 横幅 三件套
 * 作为 overlay 的唯一 flex 子项，自动屏幕正中
 */
function CastCard({
  event,
  portraitUrl,
  durationS,
  particleEmoji,
}: {
  event: UltimateCastEvent;
  portraitUrl: string;
  durationS: number;
  particleEmoji: string;
}) {
  return (
    <motion.div
      className={styles.castCard}
      initial={{ opacity: 0, y: 50, scale: 0.9 }}
      animate={{
        opacity: [0, 1, 1, 0],
        y: [50, 0, 0, -12],
        scale: [0.9, 1, 1, 1.04],
      }}
      transition={{
        // v4 (2026-05-17): 立绘提前到 15% 完全显现, 88% 才开始淡出
        // 完全可见时长 730ms (相比 v3 的 480ms 提升 52%)
        // 让立绘成为视觉主角，光效作为节奏陪衬
        duration: durationS,
        times: [0, 0.15, 0.88, 1],
        ease: [0.16, 1, 0.3, 1],
      }}
    >
      {/* 顶部"绝 技"小标签 */}
      <div className={styles.tag}>绝 技</div>

      {/* 中部立绘 */}
      {portraitUrl ? (
        <div
          className={styles.portrait}
          style={{ backgroundImage: `url(${portraitUrl})` }}
        />
      ) : (
        <div className={styles.portraitFallback}>
          {event.heroName?.[0] ?? '?'}
        </div>
      )}

      {/* 底部横幅：角色名 · 绝技名 */}
      <div className={styles.banner}>
        <div className={styles.bannerInner}>
          <span className={styles.heroName}>{event.heroName}</span>
          <span className={styles.divider}>·</span>
          <span className={styles.skillName}>{event.ultimateName}</span>
        </div>
      </div>
    </motion.div>
  );
}

export function UltimateCastOverlay({ event, durationMs = 1000 }: Props) {
  const D = durationMs / 1000;

  const theme = useMemo(() => getHeroTheme(event?.heroId), [event?.heroId]);
  const portraitUrl = useMemo(
    () => (event ? resolveFullPortrait(event.heroId, event.cardId, event.portrait) : ''),
    [event],
  );

  const cssVars = useMemo<React.CSSProperties>(() => {
    return {
      ['--ult-primary' as never]: theme.primary,
      ['--ult-accent' as never]: theme.accent,
      ['--ult-outline' as never]: theme.outline,
    };
  }, [theme]);

  return (
    <AnimatePresence>
      {event && (
        <motion.div
          key={event.ts}
          className={styles.overlay}
          style={cssVars}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: D * 0.15 }}
        >
          {/* 背景层 —— 全部 absolute 不参与 flex 居中 */}
          <motion.div
            className={styles.backdrop}
            initial={{ opacity: 0, scale: 1.15 }}
            animate={{ opacity: 0.85, scale: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: D * 0.25, ease: 'easeOut' }}
          />
          <motion.div
            className={styles.flash}
            initial={{ opacity: 0, scale: 1.4 }}
            animate={{ opacity: [0, 0.9, 0.6, 0.7, 0], scale: [1.4, 1, 1, 1, 1.6] }}
            transition={{
              // v4: 让 flash 的高亮高潮落在立绘完全可见区间内 (15%~88%)
              duration: D,
              times: [0, 0.18, 0.5, 0.8, 1],
              ease: 'easeOut',
            }}
          />
          <motion.div
            className={styles.sweep}
            initial={{ x: '-100%' }}
            animate={{ x: ['-100%', '300%'] }}
            transition={{ duration: D * 0.65, ease: 'easeOut', delay: D * 0.18 }}
          />

          {/* 粒子层 —— 整层 absolute，不参与 flex 居中（避免影响 castCard 排版） */}
          <div className={styles.particles}>
            {Array.from({ length: PARTICLE_COUNT }).map((_, i) => {
              const angle = (i / PARTICLE_COUNT) * Math.PI * 2;
              const startR = 360;
              const endR = 480;
              const sx = Math.cos(angle) * startR;
              const sy = Math.sin(angle) * startR;
              const ex = Math.cos(angle) * endR;
              const ey = Math.sin(angle) * endR;
              return (
                <motion.div
                  key={i}
                  className={styles.particle}
                  style={{ top: '50%', left: '50%' }}
                  initial={{ x: sx, y: sy, opacity: 0, scale: 0.5, rotate: 0 }}
                  animate={{
                    x: [sx, 0, 0, ex],
                    y: [sy, 0, 0, ey],
                    opacity: [0, 1, 1, 0],
                    scale: [0.5, 1.2, 1, 0.6],
                    rotate: [0, 180, 360, 540],
                  }}
                  transition={{
                    duration: D,
                    times: [0, 0.4, 0.7, 1],
                    ease: 'easeInOut',
                    delay: i * 0.015,
                  }}
                >
                  {theme.particle}
                </motion.div>
              );
            })}
          </div>

          {/* ★ 核心：演出卡 —— overlay 的唯一 flex 子项，自动正中 */}
          <CastCard
            event={event}
            portraitUrl={portraitUrl}
            durationS={D}
            particleEmoji={theme.particle}
          />
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export default UltimateCastOverlay;

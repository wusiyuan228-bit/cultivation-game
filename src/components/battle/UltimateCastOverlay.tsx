/**
 * UltimateCastOverlay — 绝技释放屏幕特效（v2 · 2026-05-17）
 *
 * v2 改动：
 *   ① 改用 getCachedCardFull —— 完整卡牌立绘（不是头像）
 *   ② 立绘在上 / 横幅在下，垂直分离，永不重叠
 *   ③ 容器 absolute / 1920×1080 px，跟随 .app-stage 等比缩放
 *
 * 总时长：1000ms
 *
 * 由 S7/S7B/S7D 战斗主屏订阅 lastSkillEvent.skillType === 'ultimate' 后挂载本组件。
 */
import { useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { getCachedCardFull, getCachedImage } from '@/utils/imageCache';
import { getHeroTheme } from '@/data/heroThemeColors';
import styles from './UltimateCastOverlay.module.css';

export interface UltimateCastEvent {
  /** 唯一标识，用于触发新一次 AnimatePresence */
  ts: number;
  /** 释放绝技的单位 id */
  unitId: string;
  /** 释放者 heroId（用于色调与立绘获取） */
  heroId?: string;
  /** 释放者显示名 */
  heroName: string;
  /** 绝技名 */
  ultimateName: string;
  /** 立绘兜底字段（当 heroId 拿不到完整立绘时使用） */
  portrait?: string;
}

interface Props {
  event: UltimateCastEvent | null;
  /** 总时长，默认 1000ms */
  durationMs?: number;
}

/**
 * 取角色完整立绘 url：
 *   1. 优先 getCachedCardFull(heroId) —— 已收集卡翻面看到的完整立绘
 *   2. 回退 getCachedImage(heroId)   —— 头像
 *   3. 回退传入的 portrait（可能是 url 或 cache key）
 */
function resolveFullPortrait(heroId: string | undefined, portrait: string | undefined): string {
  if (heroId) {
    const full = getCachedCardFull(heroId);
    if (full) return full;
    const small = getCachedImage(heroId);
    if (small) return small;
  }
  if (!portrait) return '';
  if (/^(https?:|blob:|data:|\/|\.)/.test(portrait)) return portrait;
  return getCachedImage(portrait) || '';
}

/** 8 颗粒子的初始角度（环形分布） */
const PARTICLE_COUNT = 8;

export function UltimateCastOverlay({ event, durationMs = 1000 }: Props) {
  const D = durationMs / 1000; // framer-motion 用秒

  const theme = useMemo(() => getHeroTheme(event?.heroId), [event?.heroId]);
  const portraitUrl = useMemo(
    () => (event ? resolveFullPortrait(event.heroId, event.portrait) : ''),
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
          {/* Layer 0 · 暗化 + 径向色 */}
          <motion.div
            className={styles.backdrop}
            initial={{ opacity: 0, scale: 1.15 }}
            animate={{ opacity: 0.85, scale: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: D * 0.25, ease: 'easeOut' }}
          />

          {/* Layer 1 · 内层亮闪（呼吸感） */}
          <motion.div
            className={styles.flash}
            initial={{ opacity: 0, scale: 1.4 }}
            animate={{ opacity: [0, 0.9, 0.5, 0.7, 0], scale: [1.4, 1, 1, 1, 1.6] }}
            transition={{
              duration: D,
              times: [0, 0.15, 0.4, 0.7, 1],
              ease: 'easeOut',
            }}
          />

          {/* Layer 1.5 · 斜向扫光条 */}
          <motion.div
            className={styles.sweep}
            initial={{ x: '-100%' }}
            animate={{ x: ['-100%', '300%'] }}
            transition={{ duration: D * 0.7, ease: 'easeOut', delay: D * 0.1 }}
          />

          {/* Layer 1 · 粒子（8 颗 emoji 环形汇聚再扩散） */}
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

          {/* "绝 技" 小标签（立绘上方） */}
          <motion.div
            className={styles.tag}
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: [0, 1, 1, 0], y: [-10, 0, 0, -10] }}
            transition={{ duration: D, times: [0, 0.25, 0.75, 1], ease: 'easeOut' }}
          >
            绝 技
          </motion.div>

          {/* Layer 2 · 角色完整立绘（居中偏上，独占顶部空间） */}
          <motion.div
            className={styles.portraitWrap}
            initial={{ opacity: 0, y: 80, scale: 0.85 }}
            animate={{
              opacity: [0, 1, 1, 0],
              y: [80, 0, 0, -20],
              scale: [0.85, 1, 1, 1.04],
            }}
            transition={{
              duration: D,
              times: [0, 0.3, 0.78, 1],
              ease: [0.16, 1, 0.3, 1],
            }}
          >
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
          </motion.div>

          {/* Layer 3 · 文字横幅（立绘下方，绝不重叠） */}
          <motion.div
            className={styles.banner}
            initial={{ opacity: 0, scaleX: 0 }}
            animate={{
              opacity: [0, 1, 1, 0],
              scaleX: [0, 1, 1, 1],
            }}
            transition={{
              duration: D,
              times: [0, 0.4, 0.82, 1],
              ease: 'easeOut',
            }}
          >
            <div className={styles.bannerInner}>
              <span className={styles.heroName}>{event.heroName}</span>
              <span className={styles.divider}>·</span>
              <span className={styles.skillName}>{event.ultimateName}</span>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export default UltimateCastOverlay;

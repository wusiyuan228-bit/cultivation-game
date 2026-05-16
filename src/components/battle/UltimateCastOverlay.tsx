/**
 * UltimateCastOverlay — 绝技释放屏幕特效
 *
 * Phase 1+2+3 合一：
 *   · 全屏径向滤镜（按角色阵营染色）
 *   · 角色头像滑入 + 放大
 *   · 文字横幅（角色名 · 绝技名）
 *   · 粒子动画（emoji 粒子向中心汇聚后扩散）
 *   · 音效 hook（onSfx，当前未接入）
 *
 * 总时长：1000ms
 *
 * 由 S7/S7B/S7D 战斗主屏订阅 lastSkillEvent.skillType === 'ultimate' 后挂载本组件。
 */
import { useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { getCachedImage } from '@/utils/imageCache';
import { getHeroTheme } from '@/data/heroThemeColors';
import styles from './UltimateCastOverlay.module.css';

export interface UltimateCastEvent {
  /** 唯一标识，用于触发新一次 AnimatePresence */
  ts: number;
  /** 释放绝技的单位 id */
  unitId: string;
  /** 释放者 heroId（用于色调与立绘兜底）；非主角单位可不填 */
  heroId?: string;
  /** 释放者显示名 */
  heroName: string;
  /** 绝技名 */
  ultimateName: string;
  /** 立绘 url 或 imageCache key（与 BattleUnit.portrait 一致） */
  portrait?: string;
}

interface Props {
  event: UltimateCastEvent | null;
  /** 总时长，默认 1000ms */
  durationMs?: number;
}

/** 复用 S7B/S7D 的 portrait 解析规则：URL/路径直返，否则当 imageCache key */
function resolvePortraitUrl(raw: string | undefined, heroId: string | undefined): string {
  if (!raw) return heroId ? getCachedImage(heroId) : '';
  if (/^(https?:|blob:|data:|\/|\.)/.test(raw)) return raw;
  return getCachedImage(raw) || (heroId ? getCachedImage(heroId) : '');
}

/** 8 颗粒子的初始角度（环形分布） */
const PARTICLE_COUNT = 8;

export function UltimateCastOverlay({ event, durationMs = 1000 }: Props) {
  const D = durationMs / 1000; // framer-motion 用秒

  const theme = useMemo(() => getHeroTheme(event?.heroId), [event?.heroId]);
  const portraitUrl = useMemo(
    () => (event ? resolvePortraitUrl(event.portrait, event.heroId) : ''),
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

          {/* Layer 1 · 内层亮闪 */}
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
              const startR = 360; // px：从远处汇聚
              const endR = 480; // px：扩散到屏幕外
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

          {/* "绝 · 技" 小标签 */}
          <motion.div
            className={styles.tag}
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: [0, 1, 1, 0], y: [-10, 0, 0, -10] }}
            transition={{ duration: D, times: [0, 0.25, 0.75, 1], ease: 'easeOut' }}
          >
            绝 技
          </motion.div>

          {/* Layer 2 · 角色立绘 */}
          <motion.div
            className={styles.portraitWrap}
            initial={{ opacity: 0, x: -200, scale: 0.6 }}
            animate={{
              opacity: [0, 1, 1, 0],
              x: [-200, 0, 0, 60],
              scale: [0.6, 1.15, 1.05, 1.1],
            }}
            transition={{
              duration: D,
              times: [0, 0.3, 0.75, 1],
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

          {/* Layer 3 · 文字横幅 */}
          <motion.div
            className={styles.banner}
            initial={{ opacity: 0, scaleX: 0 }}
            animate={{
              opacity: [0, 1, 1, 0],
              scaleX: [0, 1, 1, 1],
            }}
            transition={{
              duration: D,
              times: [0, 0.35, 0.8, 1],
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

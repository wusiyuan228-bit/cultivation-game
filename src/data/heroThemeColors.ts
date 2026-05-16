/**
 * 6 主角阵营主色 —— 用于战斗中绝技释放时屏幕特效染色
 *
 * 设计依据：
 *   - 唐三：紫毒（蓝银皇/万毒）→ 紫罗兰
 *   - 小舞：粉柔骨献祭 → 樱粉
 *   - 萧焱：焚决异火 → 烈焰橙
 *   - 薰儿：古族斗帝血脉 → 圣金
 *   - 寒立：青竹蜂云剑 → 寒青
 *   - 旺林：仙逆玄黑 → 玄黑紫
 *
 * 使用：UltimateCastOverlay 通过 unit.heroId 查表，未命中则 fallback 默认色
 */

export interface HeroTheme {
  /** 主色，用于全屏径向滤镜 */
  primary: string;
  /** 辅色，用于粒子/光晕 */
  accent: string;
  /** 文字横幅描边色 */
  outline: string;
  /** 粒子 emoji */
  particle: string;
}

/** heroId → 主题色 */
export const HERO_THEMES: Record<string, HeroTheme> = {
  hero_tangsan:  { primary: '#8e44ad', accent: '#c39bd3', outline: '#4a235a', particle: '🐍' },
  hero_xiaowu:   { primary: '#e84393', accent: '#fab1d3', outline: '#7d2050', particle: '🌸' },
  hero_xiaoyan:  { primary: '#ff6b35', accent: '#ffd166', outline: '#7a2e10', particle: '🔥' },
  hero_xuner:    { primary: '#f7b731', accent: '#fff3c4', outline: '#7a5a10', particle: '✨' },
  hero_hanli:    { primary: '#00b8d9', accent: '#9af6ff', outline: '#0b4d5a', particle: '🗡️' },
  hero_wanglin:  { primary: '#34495e', accent: '#dcdde1', outline: '#0c1116', particle: '☯️' },
};

/** 兜底主题（非主角单位释放绝技时） */
export const DEFAULT_THEME: HeroTheme = {
  primary: '#d4af37',
  accent: '#ffe58a',
  outline: '#5a3d0c',
  particle: '⚡',
};

/** 通过 heroId 取主题，自动剥离觉醒后缀（hero_xiaowu_awaken → hero_xiaowu） */
export function getHeroTheme(heroId: string | undefined): HeroTheme {
  if (!heroId) return DEFAULT_THEME;
  const baseId = heroId.replace(/_awaken$/, '');
  return HERO_THEMES[baseId] ?? DEFAULT_THEME;
}

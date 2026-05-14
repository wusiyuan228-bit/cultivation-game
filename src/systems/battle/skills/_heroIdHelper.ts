/**
 * 主角 unit id 判定工具
 *
 * 背景：游戏内不同战场的 unit id 命名规则：
 *   - 玩家主角：`player_${heroId}` 或直接 `${heroId}`（如 'hero_xiaoyan'）
 *   - 玩家搭档：partner 卡 id（如 'bsr_yinyue'，不含 hero_）
 *   - AI 主角：`ai_${heroId}`（如 'ai_hero_xiaoyan'）
 *   - AI 搭档：`ai_${heroId}_partner_${cardId}_${i}`（如 'ai_hero_xiaoyan_partner_bsr_yinyue_0'）
 *   - AI 兜底卡：`ai_fill_${heroId}_${i}`（如 'ai_fill_hero_xiaoyan_0'）
 *
 * 旧实现 `id.includes('hero_')` 在 S7B/S7C 大比中**会把 AI 搭档/兜底卡误判为主角**，
 * 导致：阴灵蔽日 / 沐沛灵·续命丹 / 留眉·千梦 等"非主角才能作用"的技能完全失效。
 *
 * 新规则：剥离 'ai_' / 'ai_fill_' / 'player_' 等前缀后，
 *   主角的 id 形如 `hero_<heroname>`（结尾即结束，不含 _partner_/_fill_ 等后缀）。
 *
 * 这里用更稳的 segment 拆分：
 *   - 把 id 拆成 ['ai','hero','xiaoyan'] 这种 segments
 *   - 主角必须满足：恰好两段 + 第一段是 'hero' + 第二段是英雄名，
 *     **或** 加一个 'ai' 前缀 + 'hero' + 英雄名（共 3 段）
 *   - 任何含 'partner' / 'fill' segment 的 id 都不是主角
 */

const HERO_NAMES = new Set([
  'xiaoyan',
  'tangsan',
  'xiaowu',
  'hanli',
  'wanglin',
  'xuner',
]);

/**
 * 判断 unit id 是否是主角实例（玩家或 AI 任一方）。
 *
 * @example
 *   isHeroUnitId('hero_xiaoyan')                                // true（玩家主角）
 *   isHeroUnitId('player_hero_xiaoyan')                         // true（玩家主角，带 player_ 前缀）
 *   isHeroUnitId('ai_hero_xiaoyan')                             // true（AI 主角）
 *   isHeroUnitId('ai_hero_xiaoyan_partner_bsr_yinyue_0')        // false（AI 搭档）
 *   isHeroUnitId('ai_fill_hero_xiaoyan_0')                      // false（AI 兜底卡）
 *   isHeroUnitId('bsr_yinyue')                                  // false（玩家搭档）
 *   isHeroUnitId('bssr_xiaoyixian')                             // false（玩家 SR 卡）
 */
export function isHeroUnitId(id: string): boolean {
  if (!id) return false;
  // 剥离已知前缀
  let core = id;
  if (core.startsWith('player_')) core = core.slice('player_'.length);
  else if (core.startsWith('ai_')) core = core.slice('ai_'.length);
  // ai_fill_hero_xxx_i 这种以 fill_ 开头的，剥掉 ai_ 后还是 fill_xxx 开头，直接判 false
  if (core.startsWith('fill_')) return false;
  // 含 partner / fill 段（任意位置）→ 一定不是主角
  if (core.includes('_partner_') || core.includes('_fill_')) return false;
  // 主角必须形如 hero_<name>，且 <name> 在已知英雄名单
  if (!core.startsWith('hero_')) return false;
  const heroName = core.slice('hero_'.length);
  return HERO_NAMES.has(heroName);
}

/**
 * 反向：判断是否是"非主角卡"（搭档 / SR / SSR / 兜底卡 / 妖兽 等）。
 * 等价于 `!isHeroUnitId`，提供命名更直观的语义糖。
 */
export function isNonHeroUnitId(id: string): boolean {
  return !isHeroUnitId(id);
}

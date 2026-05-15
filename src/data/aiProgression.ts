/**
 * AI 主角的"拜师 + 境界提升"模拟表
 *
 * ─────────────────────────────────────────────────────────────────
 * 背景
 *   玩家在第五章（拜师）+ 筹备阶段（提升境界）会获得：
 *     - 一次拜师加成（御敌堂修为+1 / 藏经阁心境+1）
 *     - 多次境界提升（每次三维各+1，最多直到飞升）
 *
 *   AI 主角不会经过这些 UI 流程，因此本表用于：
 *     1) 给每位 AI 主角分配一个固定的拜师选择（避免随机带来的不一致）
 *     2) 给每位 AI 主角在关键剧情节点固定授予若干次境界提升
 *
 *   战斗（S7B / S7D）+ 备战界面（S7D Deploy/Lineup/PreBattle）+ 跑团显示
 *   都会读 cardBonuses[aiHeroId] 与 aiMentorshipBonus[aiHeroId]，因此
 *   只要在合适时机把这些数据写入 store，所有场景就会自动看到正确数值。
 *
 * 时机
 *   - 玩家完成 S5c 拜师后 → 同步给 6 位 AI 主角发放拜师加成（applyAiMentorships）
 *   - 玩家进入 S6 筹备时 / 完成第三轮招募后 → 给 6 位 AI 主角批量执行境界提升
 *     （applyAiRealmUps，按章节决定提升次数）
 * ─────────────────────────────────────────────────────────────────
 */

import type { HeroId, MentorshipId } from '@/types/game';

/**
 * AI 主角拜师选择（与"性格 / 数值倾向"匹配，避免心境角色又拜御敌堂导致属性失衡）
 * 设计原则：心境角色 → 藏经阁(+心境)；修为角色 → 御敌堂(+修为)；中庸角色随机分配。
 */
export const AI_MENTORSHIP_TABLE: Record<HeroId, MentorshipId> = {
  hero_tangsan: 'yudi',     // 塘散 6/5/4 → 修为偏向 → 御敌堂
  hero_xiaowu: 'danyao',    // 小舞儿 5/5/6 → 心境偏向 → 藏经阁
  hero_xiaoyan: 'yudi',     // 萧焱 5/6/4 → 修为偏向 → 御敌堂
  hero_xuner: 'danyao',     // 薰儿 5/5/6 → 心境偏向 → 藏经阁
  hero_hanli: 'yudi',       // 寒立 6/5/5 → 修为偏向 → 御敌堂
  hero_wanglin: 'danyao',   // 旺林 5/6/5 → 心境偏向 → 藏经阁
};

/**
 * AI 主角在每个章节累计应该达到的"境界提升次数"。
 *
 * 章节含义（与 gameStore.chapter 对齐）：
 *   chapter < 6  : 比斗前 / 拜师后 → 0 次
 *   chapter === 6: 进入合作清怪（S7A 后） → 1 次
 *   chapter === 7: 宗门比斗（S7B）后 → 2 次
 *   chapter >= 8 : 神灵降世招募后 → 3 次（如果境界还能升）
 *
 * 设计原则：让 AI 的累计加成与玩家在筹备阶段实际能买的次数（约 2~3 次）大致对齐，
 * 避免敌强我弱或我强敌弱过于极端。
 */
export function getAiTargetRealmUps(chapter: number): number {
  if (chapter >= 8) return 3;
  if (chapter >= 7) return 2;
  if (chapter >= 6) return 1;
  return 0;
}

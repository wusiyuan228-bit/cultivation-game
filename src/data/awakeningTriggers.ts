/**
 * 觉醒触发器注册表（阶段 C）
 *
 * 契约 Q25-B：觉醒具有最高优先级，可打断任何正在进行的事件。
 * 实装策略：
 *   - 引擎层的关键节点（攻击落地后、turn 结束、stat_change 后、unit_leave 后）
 *     都会调用 `checkAwakeningQueue()` 扫描所有存活且未觉醒的主角，
 *     逐个评估其 AwakenTriggerKind 对应的触发函数。
 *   - 返回 true 即入队；本轮扫描结束后按入队顺序逐个执行 performAwakening。
 *   - 已退场的主角若触发条件满足，也会被"复活到手牌区"（阶段 C 的手牌区暂用一个
 *     sideboard 数组存储，UI 层显示一个小徽标表示"觉醒可用"；S7B 当前 2v2 规则下
 *     暂无上场位，所以实际等同于"留为记录"）。
 *
 * 每个触发函数签名：
 *   (self, ctx, engine) => boolean
 * 其中 ctx 是引发扫描的事件上下文（可选），engine 是 IBattleEngine 接口。
 */

import type { BattleUnit, IBattleEngine } from '@/systems/battle/types';
import type { AwakenTriggerKind } from './heroBlueprints';
import { HERO_BLUEPRINTS } from './heroBlueprints';

/** 触发函数签名 */
export type AwakenTriggerFn = (self: BattleUnit, engine: IBattleEngine) => boolean;

/**
 * 触发器实现表
 *
 * 设计思想：每个触发器函数都是"无副作用的查询"，只读当前战场状态判断
 * self 是否应当觉醒。扫描由外层循环驱动，触发器本身不做打断/中断。
 */
export const AWAKEN_TRIGGERS: Record<AwakenTriggerKind, AwakenTriggerFn> = {
  /** 塘散：小舞儿退场（无论主动/被动） */
  ally_xiaowu_leave: (_self, engine) => {
    const units = engine.getAllUnits();
    const xiaowu = units.find((u) => getHeroIdFromUnit(u) === 'hero_xiaowu');
    // 小舞儿不存在（从未上场）→ 不满足；小舞儿存活 → 不满足
    if (!xiaowu) return false;
    return !xiaowu.isAlive;
  },

  /**
   * 小舞儿：自身气血 ≤ 1（含被秒杀时 hp=0 的情况）
   *
   * 2026-05-16 修复：
   *   - 旧逻辑 `hp.current === 1 && isAlive` 在被一击秒杀（hp 从 N → 0）时无法触发
   *   - 新逻辑 `hp.current <= 1`：精确匹配"濒死/已死"瞬间
   *   - isAlive 限制移除：契约 Q25-B 允许已退场觉醒（"复活到手牌区"）
   *     已经觉醒过的会被外层 `awakened` 标志位过滤，不会重复触发
   */
  self_hp_to_1: (self, _engine) => {
    return self.hp.current <= 1;
  },

  /**
   * 萧焱：场上有3张+斗破角色（**不含本人**，契约终局裁决 Q76=B · 2026-05-01）
   *
   * 规则：萧焱本人不计入"斗破角色数"，需要场上另外存在 ≥3 个斗破角色。
   * 场上 = isAlive（已退场的不计）。
   */
  doupo_count_ge_3: (self, engine) => {
    if (!self.isAlive) return false;
    const alive = engine.getAllUnits().filter((u) => u.isAlive);
    let doupoCount = 0;
    for (const u of alive) {
      if (u.id === self.id) continue; // Q76=B 排除本人
      const heroId = getHeroIdFromUnit(u);
      const bp = heroId ? HERO_BLUEPRINTS[heroId] : undefined;
      if (bp?.ipTag === 'doupo') doupoCount += 1;
    }
    return doupoCount >= 3;
  },

  /** 薰儿：顾元（绑定SSR）在场时气血降至3以下 */
  xuner_guyuan_hp_le_3: (self, engine) => {
    if (!self.isAlive) return false;
    if (self.hp.current > 3) return false;
    // 阶段 C 顾元绑定SSR未实装 → 永远找不到 guyuan → 永远不触发
    const guyuan = engine.getAllUnits().find(
      (u) => u.isAlive && (u.id.includes('guyuan') || u.name === '顾元'),
    );
    return !!guyuan;
  },

  /** 寒立：累计击杀2名敌人（self.killCount >= 2） */
  self_kill_count_ge_2: (self, _engine) => {
    if (!self.isAlive) return false;
    return self.killCount >= 2;
  },

  /** 旺林：司图楠（绑定SSR）退场 */
  ally_situnan_leave: (_self, engine) => {
    const situnan = engine.getAllUnits().find(
      (u) => u.id.includes('situnan') || u.name === '司图楠',
    );
    // 司图楠不存在 → 阶段 C 永远不触发
    if (!situnan) return false;
    return !situnan.isAlive;
  },
};

/**
 * 从 BattleUnit 反查其对应的 heroId（用于查蓝图）
 *
 * 约定：BattleUnit.id 的格式为 "hero_{xxx}" 或 "hero_{xxx}.awakened" 或 "enemy_{xxx}"。
 * S7B 的 playerUnits / enemyUnits 构造时传入的 id 若以 "hero_" 开头则匹配成功；
 * 若 id 不以 hero_ 开头（如 "ally_1"），则按 name 反查 HERO_BLUEPRINTS。
 */
export function getHeroIdFromUnit(unit: BattleUnit): string | undefined {
  // 优先按 id 前缀匹配（去掉可能的 .awakened / _P2 后缀）
  const idRoot = unit.id.replace(/\.awakened.*$/, '').replace(/_P[12]$/, '');
  if (HERO_BLUEPRINTS[idRoot]) return idRoot;
  if (unit.id.startsWith('hero_')) {
    // 尝试提取 "hero_tangsan_xxx" 中的 hero_tangsan
    for (const heroId of Object.keys(HERO_BLUEPRINTS)) {
      if (unit.id.startsWith(heroId)) return heroId;
    }
  }
  // 按 name 反查（本体或觉醒名皆可）
  for (const [heroId, bp] of Object.entries(HERO_BLUEPRINTS)) {
    if (bp.name === unit.name || bp.base.name === unit.name || bp.awakened.name === unit.name) {
      return heroId;
    }
  }
  return undefined;
}

/**
 * 扫描所有单位，返回应当觉醒的单位 id 列表（按扫描顺序）
 * 已觉醒过的单位不会再入队（awakened === true）
 */
export function scanAwakeningQueue(engine: IBattleEngine): string[] {
  const queue: string[] = [];
  for (const u of engine.getAllUnits()) {
    if (u.awakened) continue;
    const heroId = getHeroIdFromUnit(u);
    if (!heroId) continue;
    const bp = HERO_BLUEPRINTS[heroId];
    if (!bp) continue;
    const trigger = AWAKEN_TRIGGERS[bp.awakenTrigger];
    if (!trigger) continue;
    try {
      if (trigger(u, engine)) {
        queue.push(u.id);
      }
    } catch (e) {
      console.error(`[awakening] trigger ${bp.awakenTrigger} for ${u.name} threw:`, e);
    }
  }
  return queue;
}

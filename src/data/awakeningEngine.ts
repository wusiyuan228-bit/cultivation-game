/**
 * 觉醒引擎（阶段 C · performAwakening 核心）
 *
 * 契约 Q25-B 要求：
 *   1. 最高优先级，可打断任何事件
 *   2. 瞬时替换 atk/mnd/hpMax 与 skills，instanceId 不变
 *   3. 已退场也能觉醒 → 复活到"场下手牌"（阶段 C 用 sideboard 记录）
 *
 * 本文件职责：
 *   - performAwakening(unit, engine)：执行一次觉醒（原子替换）
 *   - 不负责扫描/入队（由 awakeningTriggers.scanAwakeningQueue 负责）
 *   - 不负责挂自动 modifier（由 engine 层在 attach 技能时处理）
 *
 * 注意：
 *   由于 S7B 当前是 store-local 的轻量引擎适配，performAwakening 的实现
 *   被拆分为两层：
 *     - 本文件提供 "对 EngineUnit 的纯数据变换"（engine.triggerAwakening 内部使用）
 *     - store 层额外提供 "对 S7B BattleUnit 的同步变换"（s7bBattleStore.triggerHeroAwakening）
 *   两者同步 → UI 可以无缝收到 form_change + stat_change 战报并重渲染
 */

import type {
  BattleUnit as EngineUnit,
  Modifier,
  IBattleEngine,
} from '@/systems/battle/types';
import { getHeroIdFromUnit } from './awakeningTriggers';
import { HERO_BLUEPRINTS } from './heroBlueprints';
import { SkillRegistry } from '@/systems/battle/skillRegistry';

/**
 * 对 EngineUnit 执行觉醒替换（原地修改）
 * 返回是否成功觉醒
 */
export function performAwakeningOnEngineUnit(
  unit: EngineUnit,
  engine: IBattleEngine,
): boolean {
  if (unit.awakened) return false;
  const heroId = getHeroIdFromUnit(unit);
  if (!heroId) return false;
  const bp = HERO_BLUEPRINTS[heroId];
  if (!bp) return false;

  const baseData = bp.base;
  const awakenedData = bp.awakened;
  const oldName = unit.name;
  const oldForm = unit.form;

  // —— 差值法替换数值（Q-C3 · A 方案）——
  //
  // 单位当前属性 = base（卡牌原始） + permanent_bonus（境界/拜师/战中永久增益） + temp_modifiers（临时 buff）
  // 觉醒只替换"卡牌原始"那一层，其他两层完全保留。
  // 数学上等价于：new.current = old.current + (awakened.base - base.base)
  //
  // 注：当前所有永久增益皆为"加法型"（境界+1、拜师+X、十万年魂骨+5、万毒淬体-1 等）。
  // 未来若引入"倍率型"增益（如 ×1.2），需改为结构化存 baseStats/permanentBonus/tempMods
  // 并在此处按 bonus*ratio 重算——当前 A 方案对所有加法场景数学严格等价。
  const atkDelta = awakenedData.atk - baseData.atk;
  const mndDelta = awakenedData.mnd - baseData.mnd;
  const hpDelta  = awakenedData.hp  - baseData.hp;
  const hpCapDelta = awakenedData.hpCap - baseData.hpCap;

  unit.name = awakenedData.name;
  unit.type = awakenedData.type;
  // atk / mnd：差值法保留永久增益（含 unit.xxx.current 里的战中永久修正）
  unit.atk.base    = awakenedData.atk;                 // 卡牌基线替换
  unit.atk.initial = awakenedData.atk;                 // 入场基线同步为新形态
  unit.atk.current = unit.atk.current + atkDelta;      // 当前值 = 旧当前 + 形态差
  unit.mnd.base    = awakenedData.mnd;
  unit.mnd.initial = awakenedData.mnd;
  unit.mnd.current = unit.mnd.current + mndDelta;
  // hp / hpCap：hpCap 抬升"形态差"保留上限增益；hp 策略①重置为新 hpCap（觉醒满血仪式感）
  unit.hp.base    = awakenedData.hp;
  unit.hp.initial = awakenedData.hp;
  unit.hpCap      = unit.hpCap + hpCapDelta;
  unit.hp.current = unit.hpCap;                         // 重置满血（但保留上限增益）
  unit.skills = [...awakenedData.skills];
  unit.form = 'awakened';
  unit.awakened = true;
  if (awakenedData.portrait) unit.portrait = awakenedData.portrait;
  // 已退场的主角觉醒 → 复活为"场下手牌"（isAlive=true 但暂不上场）
  // 阶段 C：简化为直接复活到原位；若原位被占则保持 isAlive=false + sideboard 标记
  // S7B 具体处理由 store 层决定
  const wasLeft = !unit.isAlive;
  if (wasLeft) {
    // 交给 store 层决定是否复活上场
    // 引擎层仅做标记
  }

  // —— 战报披露（form_change）——
  engine.emit(
    'form_change',
    {
      unitId: unit.id,
      fromName: oldName,
      toName: awakenedData.name,
      fromForm: oldForm,
      toForm: 'awakened',
      newHp: unit.hp.current,
      newHpCap: unit.hpCap,
      newAtk: unit.atk.current,
      newMnd: unit.mnd.current,
      wasLeft,
    },
    `⚡觉醒！ ${oldName} → ${awakenedData.name}（气血=${unit.hp.current}/${unit.hpCap} 修为=${unit.atk.current} 心境=${unit.mnd.current}）${wasLeft ? '【已退场觉醒：以觉醒形态复归】' : ''}`,
    {
      actorId: unit.id,
      targetIds: [unit.id],
      severity: 'climax',
    },
  );

  // —— 挂载觉醒技能的 autoModifiers（如修罗瞳常驻 +2 骰）——
  for (const skillId of unit.skills) {
    const skill = SkillRegistry.get(skillId);
    if (!skill?.autoModifiers) continue;
    try {
      const mods: Modifier[] = skill.autoModifiers(unit);
      for (const m of mods) engine.attachModifier(m);
    } catch (e) {
      console.error(`[awakening] autoModifiers for ${skillId} threw:`, e);
    }
  }

  return true;
}

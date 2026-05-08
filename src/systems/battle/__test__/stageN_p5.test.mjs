/**
 * stageN · P5 · 塘散囚笼新引擎 + 古元位置重算（Q77）回归测试
 *
 * 核心关注：
 *   ①  skill_tangsan_cage 已从"debug 占位"改为真正挂 disable_move modifier
 *   ②  skill_guyuan_tianhuo 新增 onPositionChange 钩子
 *   ③  s7bBattleStore 在 moveUnit / moveUnitStep 完成后 fire 位置变化钩子
 *   ④  s7bBattleStore 在 startNewRound 扫 disable_move modifier 并消费
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../../../../');
const SRC = path.join(ROOT, 'src');

let pass = 0;
let fail = 0;
const okfn = (m) => { console.log(`  ✅ ${m}`); pass++; };
const bad = (m) => { console.log(`  ❌ ${m}`); fail++; };

const read = (p) => fs.readFileSync(p, 'utf8');

console.log('\n━━━━━━ ① 塘散·蓝银囚笼：新引擎版真实挂 disable_move modifier ━━━━━━');
{
  const src = read(path.join(SRC, 'systems/battle/skills/tangsan_cage.ts'));
  src.includes("kind: 'disable_move'")
    ? okfn('tangsan_cage.ts 构造了 disable_move modifier')
    : bad('tangsan_cage.ts 未构造 disable_move modifier');
  src.includes('engine.attachModifier(mod)')
    ? okfn('tangsan_cage.ts 调用了 engine.attachModifier')
    : bad('tangsan_cage.ts 未调用 attachModifier');
  src.includes("type: 'next_turn'") && src.includes('turnOwnerId: target.id')
    ? okfn('tangsan_cage.ts duration 为 next_turn + turnOwnerId=target')
    : bad('tangsan_cage.ts duration 配置不正确');
  src.includes('__firingUnitIsAttacker__')
    ? okfn('tangsan_cage.ts 加了身份守卫（仅攻方触发）')
    : bad('tangsan_cage.ts 缺少身份守卫');
  src.includes('skill_passive_trigger')
    ? okfn('tangsan_cage.ts emit 了 skill_passive_trigger 战报')
    : bad('tangsan_cage.ts 缺少战报 emit');
}

console.log('\n━━━━━━ ② 古元·天火阵：onPositionChange 钩子已挂 ━━━━━━');
{
  const src = read(path.join(SRC, 'systems/battle/skills/guyuan_tianhuo.ts'));
  src.includes('onPositionChange')
    ? okfn('guyuan_tianhuo.ts 声明了 onPositionChange')
    : bad('guyuan_tianhuo.ts 未声明 onPositionChange');
  src.includes('refreshAura(self, engine)')
    ? okfn('onPositionChange 复用了 refreshAura 实现')
    : bad('onPositionChange 实现缺失 refreshAura 调用');
  !src.includes('阶段 E1 留 TODO')
    ? okfn('guyuan_tianhuo.ts 移除了 Q77 TODO 注释')
    : bad('guyuan_tianhuo.ts 仍遗留 Q77 TODO 注释');
}

console.log('\n━━━━━━ ③ SkillRegistration 类型扩展 onPositionChange ━━━━━━');
{
  const src = read(path.join(SRC, 'systems/battle/types.ts'));
  src.includes('onPositionChange?')
    ? okfn('types.ts SkillRegistration 新增 onPositionChange?')
    : bad('types.ts 未扩展 onPositionChange');
  src.includes("phase?: 'battle' | 'recruit' | 'secret' | 'city'")
    ? okfn('types.ts 新增 phase 字段（P4 加固）')
    : bad('types.ts 未扩展 phase 字段');
}

console.log('\n━━━━━━ ④ skillRegistry 防御性校验非战斗技能 ━━━━━━');
{
  const src = read(path.join(SRC, 'systems/battle/skillRegistry.ts'));
  src.includes("skill.phase !== 'battle'")
    ? okfn('skillRegistry 拒绝非战斗技能注册')
    : bad('skillRegistry 无防御校验');
  src.includes('listBattleSkills()')
    ? okfn('skillRegistry 提供 listBattleSkills 过滤接口')
    : bad('skillRegistry 缺 listBattleSkills');
}

console.log('\n━━━━━━ ⑤ s7bBattleStore 接入位置变化钩子 ━━━━━━');
{
  const src = read(path.join(SRC, 'stores/s7bBattleStore.ts'));
  src.includes('fireOnPositionChangeHooks')
    ? okfn('s7bBattleStore 定义了 fireOnPositionChangeHooks')
    : bad('s7bBattleStore 未定义 fireOnPositionChangeHooks');
  const moveUnitMatch = src.match(/moveUnit:\s*\(unitId[\s\S]{0,1200}fireOnPositionChangeHooks/);
  moveUnitMatch
    ? okfn('moveUnit 完成后调用了 fireOnPositionChangeHooks')
    : bad('moveUnit 未调用 fireOnPositionChangeHooks');
  const moveStepMatch = src.match(/moveUnitStep:\s*\(unitId[\s\S]{0,1200}fireOnPositionChangeHooks/);
  moveStepMatch
    ? okfn('moveUnitStep 完成后调用了 fireOnPositionChangeHooks')
    : bad('moveUnitStep 未调用 fireOnPositionChangeHooks');
}

console.log('\n━━━━━━ ⑥ startNewRound 同时识别 immobileNextTurn 与 disable_move modifier ━━━━━━');
{
  const src = read(path.join(SRC, 'stores/s7bBattleStore.ts'));
  src.includes("globalModStore.query(u.id, 'disable_move')")
    ? okfn('startNewRound 扫描了 disable_move modifier')
    : bad('startNewRound 未扫描 disable_move');
  src.includes('disableMoveMods.length > 0')
    ? okfn('startNewRound 将新引擎路径纳入 willImmobile 判定')
    : bad('startNewRound willImmobile 未融合新路径');
  src.includes('globalModStore.detach(m.id)')
    ? okfn('startNewRound 消费 disable_move modifier 避免永久缠绕')
    : bad('startNewRound 未消费 disable_move modifier');
}

console.log('\n━━━━━━ ⑦ guyuan_tianhuo refreshAura 依然保留 ━━━━━━');
{
  const src = read(path.join(SRC, 'systems/battle/skills/guyuan_tianhuo.ts'));
  src.includes('on_turn_start') && src.includes('on_turn_end') && src.includes('on_self_leave')
    ? okfn('原有 on_turn_start/on_turn_end/on_self_leave 三钩子都保留')
    : bad('原有钩子遭误删');
  src.includes('aura_guyuan_') && src.includes('while_in_range')
    ? okfn('aura modifier 关键字段仍齐整')
    : bad('aura modifier 配置被破坏');
}

console.log('\n══════════════════════════════════════════════════════════════════════');
console.log(`  stageN · P4+P5 审计  总计:${pass+fail} 通过:${pass} 失败:${fail}`);
console.log('══════════════════════════════════════════════════════════════════════');

process.exit(fail === 0 ? 0 : 1);

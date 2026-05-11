# 战斗技能开发指南

> 2026-05-11 方案 A · 流程钩子层完成后的开发规范  
> 受众：未来给战斗系统添加新技能的开发者（包括 AI 助手）

## TL;DR — 一图速查

| 技能类型 | 元数据字段 | 改动范围 |
|---|---|---|
| 纯被动 hook（属性加成、伤害修饰） | `hooks.on_xxx` | **1 个技能文件** |
| 主动绝技（自定义结算） | `activeCast` + `precheck` + `targetSelector` | **1 个技能文件** |
| 主动绝技（瞄准 + 真实攻击） | `activeCast` + `followUpAttack` | **1 个技能文件** |
| 行动开始时玩家选发动 | `hooks.on_turn_start` + `interactiveOnTurnStart` | **1 个技能文件** |
| 进攻命中后选位（如风属斗技） | `hooks.on_after_hit` + `interactivePositionPick` | **1 个技能文件** |
| 位置变化后重算光环（如天火阵） | `onPositionChange` | **1 个技能文件** |

✨ **不再需要改任何 store 或 UI 文件**

---

## 1. 三大主流技能形态

### 1.1 纯被动 hook（最常见）

例：寒立·万剑（守方骰-1）。

```ts
export const skill_hanli_wanjian: SkillRegistration = {
  id: 'hanli.wanjian',
  name: '万剑归宗',
  hooks: {
    on_before_defend_roll: (ctx, engine) => {
      // 直接修改骰数 / 挂 modifier / emit 战报
      ctx.diceDefend = Math.max(0, ctx.diceDefend - 1);
    },
  },
  description: '守方骰子-1',
};
```

引擎自动在每次攻击的 Phase 2 调用此 hook —— **三种战斗 store 全部生效**，零额外配置。

### 1.2 主动绝技 + followUpAttack（瞄准型攻击）

例：千仞雪·天使圣剑（atk+4 攻击 1 名敌人）。

```ts
export const skill_qianrenxue_shengjian: SkillRegistration = {
  id: 'qianrenxue.shengjian',
  name: '天使圣剑',
  isActive: true,
  targetSelector: { kind: 'single_any_enemy' },
  precheck: (self, engine) => {
    const enemies = engine.getEnemiesOf(self).filter((e) => e.isAlive);
    return enemies.length > 0
      ? { ok: true, candidateIds: enemies.map((e) => e.id) }
      : { ok: false, reason: '无可瞄准敌人' };
  },
  activeCast: (self, _targetIds, engine) => {
    // 仅 emit 意图日志；真正攻击由 followUpAttack 接续
    engine.emit('skill_active_cast', {}, `✨ ${self.name} 释放天使圣剑`);
    return { consumed: true };
  },
  // ⭐ 关键：声明这把绝技是"修为+4 后发起 1 次普通攻击"
  followUpAttack: {
    target: 'first_only',
    diceOverride: (s) => s.atk.current + 4,  // 临时修为+4
  },
  description: '修为+4 攻击 1 名敌人',
};
```

3 个 store 的 `performUltimate` 看到 `followUpAttack` 元数据后，会自动调用 `runFollowUpAttack` 走完整 `attack → resolveAttack → 全部 hook` 流水线 —— **自动生效于剿匪/2v2/3v3/坠魔谷**。

### 1.3 主动绝技 + 自定义结算（特殊技能）

例：王林·一念逆天（指定一格固伤无视防御）。

```ts
export const skill_wanglin_yinian: SkillRegistration = {
  id: 'wanglin.aw_yinian',
  name: '一念逆天',
  isActive: true,
  targetSelector: { kind: 'single_any_enemy' },
  precheck: (self, engine) => { /* ... */ },
  activeCast: (self, [targetId], engine) => {
    const target = engine.getUnit(targetId);
    if (!target) return { consumed: false };
    // 自己改血，不走 attack 流水线
    engine.changeStat(targetId, 'hp', -3, {
      permanent: false,
      reason: '一念逆天',
      skillId: 'wanglin.aw_yinian',
    });
    return { consumed: true };
  },
  description: '指定 1 名敌人扣 3 血',
};
```

**不要**写 `followUpAttack`（会重复触发）。

---

## 2. 玩家交互型技能（弹窗）

> 这是最容易踩坑的部分 —— 旧架构需要改 6 处，新架构只改 1 处。

### 2.1 行动开始时弹窗（如云鹊子·癫狂窃元）

```ts
export const skill_yunquezi_qieyuan: SkillRegistration = {
  id: 'yunquezi.qieyuan',
  name: '癫狂·窃元',
  hooks: {
    on_turn_start: (ctx, engine) => {
      // ⭐ AI 控制时的自动逻辑：自动挑相邻敌人扣 atk-1
      const adj = findAdjacentEnemies(ctx.unit, engine);
      if (adj.length === 0) return;
      const target = adj[0];
      engine.changeStat(target.id, 'atk', -1, { permanent: true, reason: '癫狂·窃元' });
    },
  },
  // ⭐ 玩家控制时的弹窗
  interactiveOnTurnStart: {
    promptTitle: '癫狂·窃元',
    promptBody: '可指定 1 名相邻敌人，永久-1 修为/心境/气血',
    collectChoices: (self, engine) => {
      const adj = engine.getEnemiesOf(self).filter(/* 相邻 */);
      return adj.map((t) => ({
        targetId: t.id,
        stats: ['atk', 'mnd', 'hp'],   // 玩家可三选一
      }));
    },
    apply: (self, target, stat, engine) => {
      engine.changeStat(target.id, stat!, -1, { permanent: true, reason: '癫狂·窃元' });
    },
  },
  description: '行动轮开始时，可指定 1 名相邻敌人某属性 -1',
};
```

**完成 ✅** —— 弹窗、棋盘高亮、属性选择都由现有的 `TurnStartChoiceModal` + `BattleChoiceHost` 自动处理。

### 2.2 进攻命中后选位（如风属斗技）

```ts
export const skill_nalanyanran_fengshu: SkillRegistration = {
  id: 'nalanyanran.fengshu',
  name: '风属斗技',
  hooks: {
    on_after_hit: (ctx, engine) => {
      // ⭐ AI 自动：取最近合法落点
      const cand = computeFengShuCandidates(ctx.attacker, ctx.defender, engine);
      if (cand.length === 0) return;
      moveUnit(ctx.defender, cand[0]);
    },
  },
  // ⭐ 玩家弹窗 + 棋盘选位
  interactivePositionPick: {
    promptTitle: '风属斗技',
    promptBody: '是否将受击目标传送至自身相邻 2 格内？',
    trigger: 'after_hit',
    collectCandidates: (self, target, engine) => {
      if (!target) return [];
      return computeFengShuCandidates(self, target, engine);
    },
    apply: (self, target, pos, engine) => {
      if (!target) return;
      moveUnit(target, pos);
      engine.emit('position_change', {}, `🌪 ${target.name} 被传送至 (${pos.row},${pos.col})`);
    },
  },
  description: '进攻命中后，将目标传送至自身相邻 2 格内任一位置',
};
```

---

## 3. 通用规则

### 3.1 写 hook 时切记

1. **AI 自动逻辑必写**：玩家是少数派，敌方 AI 永远走自动逻辑
2. **interactive 元数据是"覆盖"而非"补充"**：玩家控制时，对应 hook 会被 dispatcher **跳过**，由弹窗结果替代
3. **collectChoices/collectCandidates 返回空 → 跳过整个交互**（无可选目标时静默不发动）

### 3.2 战报格式

| 类型 | 用途 | 颜色（UI 端） |
|---|---|---|
| `system` | 流程提示（行动开始等） | 灰 |
| `action` | 移动、绝技释放声明 | 蓝 |
| `skill` | 技能效果触发 | 紫 |
| `damage` | 造成伤害 | 红 |
| `kill` | 击杀 / 退场 | 金 |

### 3.3 测试

每加一个新技能，建议在 `systems/battle/__test__/` 加一条 smoke test：

```ts
// 测试模板
import { runOneRound } from './e2Helpers';
import { skill_xxx } from '../skills/xxx';

console.log('━━━ 新技能 smoke test ━━━');
const out = runOneRound({
  attackers: [{ ...attackerWithSkill('xxx'), atk: 3 }],
  defenders: [{ ...defenderTemplate, hp: 5 }],
});
console.assert(out.logEntries.some((e) => e.skillId === skill_xxx.id), '技能未触发');
```

---

## 4. 改动范围速查表（旧 vs 新）

| 改动需求 | 旧（每次 6 处） | 新（流程钩子层完工后） |
|---|---|---|
| 加纯 hook 技能 | 1 处技能文件 | 1 处技能文件 |
| 加 followUpAttack 绝技 | 3 个 store + 1 技能 | **1 处技能文件** |
| 加 turnStart 弹窗技能 | 3 store + 3 UI + 1 技能 | **1 处技能文件** |
| 加 fengshu 风格选位技能 | 3 store + 3 UI + 1 技能 | **1 处技能文件** |
| 加全新交互型号（如反击选靶） | 不可能 / 大改 | 在 PendingChoice 加 1 个 kind + 1 个弹窗组件 |

---

## 5. 已知三套战斗场景对照

| 场景 | UI 文件 | Store 文件 | 棋盘？ | 移动？ | 备注 |
|---|---|---|---|---|---|
| S5/S7A 剿匪 1v1 | `S7_Battle.tsx` | `battleStore.ts` | ✅ | ✅ | 街头剿匪 |
| S7B 宗门 2v2 | `S7B_Battle.tsx` | `s7bBattleStore.ts` | ✅ | ✅ | 宗门比武 |
| S7C 宗门 3v3 | `S7B_Battle.tsx` | `s7bBattleStore.ts` | ✅ | ✅ | 共享 S7B |
| S7D 决战坠魔谷 | `S7D_Battle.tsx` | `s7dBattleStore.ts` | ✅✅ | ✅✅ 大棋盘 | 6v6 阵营战 |

⭐ 通过 `SkillRegistry` + 流程钩子层，**1 个技能注册 = 4 个场景同步生效**。

---

## 6. 迁移现状

| 模块 | 状态 |
|---|---|
| 纯 hook 技能 | ✅ 已统一（一直如此） |
| `followUpAttack` 绝技 | ✅ 已统一（commit d1326aa） |
| `interactiveOnTurnStart` 弹窗 | ✅ 已统一（commit a220488 + 45ed970） |
| `interactivePositionPick` 选位 | ⏳ 元数据已声明（commit 待续），现有风属斗技仍走旧路径 |
| 删除旧 fengshuPick 状态 | ⏳ 待 interactivePositionPick 全量迁移完成后 |

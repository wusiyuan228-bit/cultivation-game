# BattleFlow · 战斗流程统一钩子层

> 方案 A · 2026-05-11 启动 · 解决"3 个 store / 3 个 UI"的弹窗交互重复实装问题

## 痛点

旧架构每加一个**会中断流程的弹窗式技能**（如风属斗技、云鹊子窃元、千仞雪圣剑），需要：

| 位置 | 改动 |
|---|---|
| `battleStore.ts`（S5/S7A 剿匪） | 加 pending 字段、reducer、流程拦截 |
| `s7bBattleStore.ts`（S7B/S7C 宗门 2v2/3v3） | 同上 |
| `s7dBattleStore.ts`（S7D 决战） | 同上 |
| `S7_Battle.tsx` | 接 hook + 弹窗组件 |
| `S7B_Battle.tsx` | 同上 |
| `S7D_Battle.tsx` | 同上 |

= **6 处改动 + 1 个技能文件**，且容易漏 store 维度（导致某场景失效）。

## 新架构

```
┌──────────────────────────────────────────────┐
│ 技能层（systems/battle/skills/*.ts）         │
│ 在 SkillRegistration 中声明 interactive 元数据  │
└──────────────────────────────────────────────┘
                    ↓ collectChoices/apply
┌──────────────────────────────────────────────┐
│ 流程层（systems/battle/flow/）               │
│  - pendingChoice.ts  PendingChoice 联合类型  │
│  - flowAdapter.ts    Store ↔ Skill 桥        │
│  - dispatchers       turnStart / followUp 等 │
└──────────────────────────────────────────────┘
                    ↓ pendingChoice / confirmChoice
┌──────────────────────────────────────────────┐
│ Store 层（统一拥有单一 pendingChoice 字段）   │
│  battleStore / s7bBattleStore / s7dBattleStore│
└──────────────────────────────────────────────┘
                    ↓ pendingChoice
┌──────────────────────────────────────────────┐
│ UI 层（统一挂一个 <BattleChoiceHost/>）       │
│  根据 kind 自动渲染对应弹窗组件               │
└──────────────────────────────────────────────┘
```

## 收益

| 改动场景 | 旧架构 | 新架构 |
|---|---|---|
| 新增 turn-start 弹窗技能 | 6 处 | **1 处技能文件** |
| 新增风属斗技式选位技能 | 6 处 | **1 处技能文件** |
| 修改弹窗 UI 风格 | 3 处（每个战斗页面各一份） | **1 处 BattleChoiceHost** |
| 给某 store 接入新弹窗类型 | 复杂改造 | 加 1 字段 + 2 reducer，复用 flowAdapter |

## 渐进式迁移

旧的 3 套弹窗代码暂时保留作为兜底，新架构与之**并存且向下兼容**：
- 新加技能优先走新架构（Commit 1+）
- 旧技能（风属斗技、turnStartChoice）将在后续 commit 中迁移
- 全量迁移完成后再删除旧代码

## 当前进度

- ✅ Commit 1：建立类型定义与 Host 组件骨架（零行为变化）
- ⏳ Commit 2：迁移 turnStartChoice 接入新抽象层
- ⏳ Commit 3：迁移风属斗技接入新抽象层
- ⏳ Commit 4：删除旧 pendingTurnStartChoice / fengshuPick UI 状态

# 技能系统优化总账本

> 记录从「线上 Bug 修复」→「系统性审计」→「P1~P5 优化」的完整进展，
> 供后续续做性能/扩展时快速定位"做到哪了、还有啥没做"。
>
> 最后更新：2026-05-01
> 维护：本文档每次优化完一轮，追加小结即可。

---

## 0. 技能系统总览（5 分钟了解架构）

### 0.1 数据流（从策划表到棋盘效果）

```
战斗技能全量登记表（Excel 人肉维护）
        │
        ▼
public/config/cards/cards_all.json       ← 真相之源，卡面文案/selector 全以此为准
        │
        ▼  构建时装配
src/data/heroesData.ts（派生文案，只做显示；不得在此手改）
src/systems/battle/skills/*.ts（112 条 SkillRegistration，逐条实装）
        │
        ▼  启动注册
src/systems/battle/skillRegistry.ts
  + SkillRegistry.findIdByName()      ← 运行时按名称反查 id
  + listBattleSkills()                ← 过滤 run_skill（招募/城内）
        │
        ▼  运行时绑定
src/stores/s7bBattleStore.ts
  - bindSkillHooks()                  ← 用 findIdByName 自动挂载全部实装
  - performUltimate(unitId, targets, pickedPosition?)
  - resolveAttack.ts                  ← 攻击结算，收集 hooks 触发
```

### 0.2 关键概念

| 概念 | 作用 |
|---|---|
| **TargetSelector** | 技能目标选择器，10 种 kind（详见 §1.1）|
| **SkillRegistration** | 技能实装结构（precheck/activeCast/hooks 三件套）|
| **Hook** | 被动触发点（on_before_hit / on_after_hit / on_damage_calc / on_turn_end / onPositionChange 等）|
| **__firingUnitIsAttacker__** | resolveAttack 注入的身份标记，供 hook 判断攻/守 |
| **__cap__** | 伤害封顶标记；Phase① 跳过，Phase④ 独立 Math.min 做封顶 |
| **pickedPosition** | performUltimate 可选参数，用于 position_pick 绝技（小战祖树盾）|

---

## 1. 核心规则与契约（必读）

### 1.1 TargetSelector 语义表

| kind | 作用范围 | 代表技能 | 可释放条件 |
|---|---|---|---|
| `none` | 无需目标（auto_self） | 金帝天火阵 | 施法者存活 |
| `single_any_enemy` | 全场任一敌 | 修罗弑神击 | 敌方存活 ≥1 |
| `single_adjacent_enemy` | 相邻 4 向敌（曼哈顿 =1）| 唐昊·破天锤 | 十字 4 格有敌 |
| `single_line_enemy` | 同行或同列敌 | 寒立·万剑归宗 | 行列有敌 |
| `single_any_character` | 全场任一角色（含友）| 柔骨·缠魂 | 场上≥1 合法目标 |
| `all_adjacent_enemies` | 相邻 4 向全体敌 | 佛怒火莲 | 相邻有敌 |
| `cross_adjacent_enemies` | 十字方向敌（塘散已改整行+整列）| 万毒淬体 | 十字有敌 |
| `all_enemies` | 全场敌 AOE | 逆·天地崩 | 敌方存活 ≥1 |
| `all_allies_incl_self` | 全场己方 | 薰儿天火阵 | 总 true |
| `position_pick` ✨新 | 棋盘空格（非单位）| 小战·萧族护盾 | 总 true，UI 实时校验 |

### 1.2 "相邻"的契约（§11.1）

**相邻 = 曼哈顿距离 1（上下左右）**，**不含斜对角**。
所有 `*_adjacent_*` selector、AOE 溅射、位移回拉都应遵循此定义。

### 1.3 "技能能否释放"的判定链

```
UI 按钮渲染
  └─ skillCastability.ts::checkSkillCastability(unit, registration, state)
       ├─ 次数是否耗尽？   → { hasCharges: false }  按钮灰 + "已用完"
       ├─ 按 selector 实时扫描场上目标
       │    - 按 selector.kind 走精准分支（不再粗暴 hasAdjacentEnemy）
       │    - 十字 4 格 / 同行列 / 全场等逐类判定
       │    - 无合法目标 → { interactable: false }  按钮可点但点击无效，hover："无可释放目标（理由）"
       └─ 有合法目标 → 可释放
                      └─ 玩家点按钮 → 瞄准态（若需选目标） → 点格子 → performUltimate()
```

---

## 2. 已完工清单（按时间倒序）

### ✅ P2-C · 位置选绝技真实交互（2026-05-01 本轮）

**目标**：让小战·萧族护盾真实落地成障碍。

| # | 修改 | 文件 |
|---|---|---|
| 1 | 新增 `position_pick` selector 类型 | `types.ts` |
| 2 | `skillCastability` 新增 position_pick 分支 | `skillCastability.ts` |
| 3 | `xiaozhan_zushudun` selector 由 `none` 改 `position_pick`，去除 MVP emit 占位 | `skills/xiaozhan_zushudun.ts` |
| 4 | `performUltimate(unitId, targetIds, **pickedPosition?**)` 签名扩展 | `s7bBattleStore.ts` |
| 5 | store 内识别 `bsr_xiaozhan.ult` 写入 `obstacle` terrain（含越界/障碍/占据 3 校验）| `s7bBattleStore.ts` |
| 6 | S7B 瞄准态 kind 支持 position_pick，格子高亮+提示+click commit | `S7B_Battle.tsx` |
| 7 | AI 层新增 `pickPositionForAI`（中点偏自身 + 相邻兜底），evaluateUltimate 覆盖 position_pick | `s7bAI.ts` |
| 8 | stageM 追加 P2-4 × 13 项审计 | `stageM_p3p2.test.mjs` |

### ✅ P2-Others · 21 条 hook 技能日志透明化（2026-05-01 本轮）

所有 MVP 自动选择/自动发动的被动 hook，在 `emit narrative` 末尾追加 "（自动选择/发动 · 理由）"，让玩家一眼看懂 AI 为啥选了这个人：

| 技能 | 文件 | 附加理由 |
|---|---|---|
| 奥斯卡·大香肠 | aoska_xiangchang.ts | 最缺血的友军 |
| 宁荣荣·七宝 | ningrongrong_qibao.ts | atk最低的未满上限友军 |
| 菇荷·聚元 | guhe_juyuan.ts | 首个相邻友军 |
| 云雀子·窃元 | yunquezi_qieyuan.ts | 相邻敌，优先削修为 |
| 红蝶·蝶舞 | hongdie_diewu.ts | 首个绝技未用的敌方 |
| 天云子·因果 | tianyunzi_yinguo.ts | hp最低的相邻友军 |
| 药尘·冷火 | yaochen_lenghuo.ts | hp最低的相邻友军 |
| 千仞雪·天使 | qianrenxue_tianshi.ts | 心境充足且伤害≥2 |
| 银月·月华 | yinyue_yuehua.ts | 受伤≥3 且 hp≥3 |
| 南宫婉·归元 | nangongwan_guiyuan.ts | atk最高的敌人 |
| 美杜莎·石化 | meidusa_shihua.ts | atk最高的敌人 |
| 托森·封印 | tuosen_fengyin.ts | hp最低的敌人 |
| 天云子·民歌 | tianyunzi_minge.ts | atk最高的相邻敌 |
| 小悬·天眼 | xiaoxuan_tianyan.ts | 前3个绝技已用的友军 |
| 小炎·毒使骨 | xiaoyixian_dushigu.ts | hp最低的相邻敌 |
| 唐雅·蓝银 | tangya_lanyin.ts | hp最低的友军 |
| 元耀·必逆 | yuanyao_bini.ts | 第一个非主角敌方 |
| 那兰·风枢 | nalanyanran_fengshu.ts | 当前被击目标 |
| 藤花原·搜森 | tenghuayuan_sousen.ts | 最近敌方 |
| 南宫婉·万华 | nangongwan_wanhua.ts | hp≥2 时默认启动 |
| 冰凤·寒啸 | bingfeng_hanxiao.ts | 合并收益优于原防御 |

审计：`stageM_p3p2.test.mjs` P2-5 共 21 项，全绿。

### ✅ P5 · 已知隐藏 bug 修复

| Bug | 修复 |
|---|---|
| 唐三蓝银囚笼仅 emit 无效果 | 挂 `disable_move` modifier，store 扫描消费 |
| 古元天火阵位置移动后 aura 不刷 | 新增 `onPositionChange` 钩子，moveUnit/moveUnitStep 回调 |

### ✅ P1 · 工程性偏差（真实掷骰化）

| 技能 | 原近似 | 改为真实 |
|---|---|---|
| 唐昊·破天锤 | `atk+5` 直接加 | 临时 atk+5 + 真实 resolveAttack |
| 穹古·阴阳万解 | `atk×3` 近似 | 3 面骰重投 + 取高，含攻方身份守卫 |

### ✅ P4 · 非战斗技能防御加固

- `SkillRegistration.phase` 字段（battle / run_skill 标识）
- `skillRegistry.listBattleSkills()` 过滤 run_skill
- run_skill（招募/城内）在数据流层面已天然与战斗隔离

### ✅ P3 · Store 执行补完

| 技能 | 修复 |
|---|---|
| 宁风·其宝 | 改为 3 段 resolveAttack 真实循环 |
| 冰凤·寒啸/万里 | 骰数真实叠加 +N |
| 云雀子·窃元 | 状态转移实装（偷 atk/mnd） |
| 凌凤·七宝 | 7 次循环 resolveAttack |
| 马红俊·火羽 | segments 循环路由 |

### ✅ 厉飞雨·疾风无影（非李飞羽）

- `resolveAttack.collectHooks` 检测 `suppressAttackerBattleSkill` 标记
- 过滤攻方 battle_skill 被动 hook（用 `isActive` 字段推断）
- 代码注释全量改名 李飞羽 → 厉飞雨

### ✅ 系统性漏洞修复（核心基础设施）

| 问题 | 修复 |
|---|---|
| 86/112 技能因 `SKILL_NAME_TO_REGISTRY_ID` 缺失而完全失效 | 改用 `SkillRegistry.findIdByName()` 自动覆盖 |
| Hook 无法识别攻守身份 | resolveAttack + fireHooksOf 统一注入 `__firingUnitIsAttacker__` |
| 4 条仅攻方生效的 hook 被攻击时误触发 | 加身份守卫（塘昊昊天锤、萧玄斗气焚、寒立噬金虫群、周佚疯魔灭杀）|
| 伤害封顶值被误当加成累计 | Phase① 跳过 `__cap__`，Phase④ 独立 Math.min |
| 塘散绝技 UI 空 targetIds 导致未执行 | store 层对空目标列表自动补充（按 selector 扫描）|
| 小舞八段摔 "未实装" 提示 | 技能名映射修正到注册表 |
| 7vs7 骰子伤害计算错误 | 修正封顶逻辑，保底 1 正确生效 |

### ✅ 数据一致性

- `heroesData.ts` 全量对齐 `cards_all.json`（原则："任何卡面文案必须与数据源头一致"）
- 修正 4 处不一致：塘散绝技"(上下左右各1格)"、招募次数限制、薰儿/旺林觉醒触发(绑定SSR)

### ✅ 测试覆盖（16 个套件，全绿）

| 套件 | 作用 |
|---|---|
| stageA～H | 历史回归（8 套）|
| stageI | UI 语义 13/13 |
| stageJ | 精准目标扫描 16/16 |
| stageK | 线上 Bug 修复 15/15 |
| stageL | 系统性审计 15/15 |
| stageM | P3+P2 审计 49/49 |
| stageN | P4+P5 20/20 |
| stageO | P1 精确数值 11/11 |
| stageP | 厉飞雨 12/12 |

---

## 3. 未完成待办（按优先级）

### 🟡 中·可选优化

#### 3.1 P1 剩余 3 条工程性偏差（未来需要时再做）

| 技能 | 当前近似 | 需改为 |
|---|---|---|
| （待盘点）| 期望值 | 真实掷骰 |

> 说明：本轮已做 2 条（唐昊破天、穹古阴阳万解），剩余 3 条数值偏差不明显，暂缓。

#### 3.2 P2-B · 绝技内"二次单位选"的真弹窗（8 条）

目前这 8 条绝技进入 `activeCast` 后，若还需要**从多个候选中再选 1 个**，走的是 AI 自动策略（已标注在 narrative）。
若想给玩家"先释放绝技 → 再二次手选"的体验，需**引擎级异步化改造**（activeCast 返回 Promise）。

**工作量预估**：2~3 天（涉及 activeCast 签名、整条 hook 链异步化）
**收益**：体验提升，但本轮日志透明化已部分缓解

#### 3.3 P2-A · 11 条被动 hook 的手选弹窗

如奥斯卡香肠被击时治疗谁、七宝琉璃谁加 atk 等。
**结论**：**建议不做**。被动 hook 每回合可能触发多次，每次弹窗会让战斗体验碎片化。本轮日志透明化已是最优解。

### 🔴 已确认不做

| 项 | 理由 |
|---|---|
| 柳眉·千梦 S8 PvP 牌池 | S7 无影响 |
| 被动 hook 全改弹窗 | 战斗体验碎片化 |
| 重构技能 kind 字段到 60 个技能文件 | 已用 isActive 推断方案替代 |

---

## 4. 未来可能的性能方向（下次续做的起点）

### 4.1 潜在优化点

| 方向 | 说明 | 估算 |
|---|---|---|
| **resolveAttack 热路径优化** | 攻击结算是每回合多次调用，Phase①~④ 的 modifier 遍历可加索引 | 中 |
| **Hook 收集器缓存** | `collectHooks` 每次都全量遍历 units，可按 hookKind 建分桶索引 | 中 |
| **skillCastability 批量化** | UI 每帧对每个技能按钮调用一次，候选目标扫描可批量缓存 | 小 |
| **地图扫描向量化** | moveRange/attackRange 计算用 BFS，可改位图加速 | 大 |
| **unit 对象 immutable 优化** | 当前 `set({ units: [...] })` 全表替换，可改 Immer 或局部 patch | 中 |
| **日志环形缓冲** | battleLog 无上限增长，长战斗可能累积 → 改环形 + 虚拟滚动 | 小 |

### 4.2 建议优先度（假设续做一轮）

```
🥇 Hook 收集器分桶索引   → 收益最直接（减少每次攻击的遍历）
🥈 skillCastability 缓存 → UI 流畅度提升
🥉 日志环形缓冲          → 长战斗内存风险
（大工程）unit immutable  → 架构级，风险高
```

---

## 5. 快速查询索引

### 5.1 技能相关关键文件

| 关注什么 | 去这里 |
|---|---|
| 技能策划原文 | `public/config/cards/cards_all.json` |
| 技能实装 | `src/systems/battle/skills/*.ts`（112 条）|
| 注册中枢 | `src/systems/battle/skillRegistry.ts` |
| 目标扫描 | `src/systems/battle/skillCastability.ts` |
| 攻击结算 | `src/systems/battle/resolveAttack.ts` |
| Store 编排 | `src/stores/s7bBattleStore.ts` |
| 战斗 UI | `src/screens/S7B_Battle.tsx` |
| AI 决策 | `src/utils/s7bAI.ts` |
| 测试套件 | `src/systems/battle/__test__/stage*.test.mjs` |

### 5.2 常用测试命令

```powershell
# 单套件
node src/systems/battle/__test__/stageM_p3p2.test.mjs

# 全量回归
Get-ChildItem src/systems/battle/__test__/stage*.test.mjs | ForEach-Object {
  Write-Host "=== $($_.Name) ===" -ForegroundColor Cyan
  node $_.FullName 2>&1 | Select-Object -Last 4
}

# 类型检查
npx tsc --noEmit

# 生产构建
npm run build
```

---

## 6. 版本历史

| 日期 | 本轮主题 | 状态 |
|---|---|---|
| 2026-05-01 | P2-C 位置选真实交互 + 21 条 hook 日志透明化 | ✅ 完工（49/49） |
| （之前）| P5 隐藏 bug + P1 真实掷骰 + P4 非战斗加固 | ✅ 完工 |
| （之前）| 厉飞雨疾风无影 + 系统性 86 条技能映射修复 | ✅ 完工 |
| （之前）| P3 store 多段执行补完 + 身份标记注入 | ✅ 完工 |
| （之前）| 塘散/小舞/封顶/映射 4 大 Bug 修复 | ✅ 完工 |

---

> **下次续做建议**：先跑一遍全量测试确认 baseline 干净，然后按 §4.2 建议方向选一个 kick off。

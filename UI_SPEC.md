# CardWar-AI UI 规范 v1.0
> 本文件是**全局 UI 规范**，所有界面（S1~S8 及未来战斗地图）必须遵守。
> 修改界面时请**先查本文件 → 再改代码**；如需调整规范，请先更新本文档再同步代码。
> 最近一次更新：2026-04-30（v1.1 — 新增字体分工表 §1.3，梳理楷体/黑体使用边界）

---

## 1. 字体

### 1.1 字体栈（font-family）
| 用途 | 字体栈 | 备注 |
|---|---|---|
| **默认 / 正文 / 按钮** | `'Noto Sans SC', 'PingFang SC', 'Microsoft YaHei', system-ui, sans-serif` | 无衬线中文 |
| **古风装饰 / 地图地形文字 / 卡牌姓名 / 战斗数字** | `'ZCOOL XiaoWei', 'STKaiti', 'KaiTi', 'Noto Serif SC', serif` | 古风楷体 |
| **屏幕标题（章节名、结算、规则）** | `'ZCOOL XiaoWei', 'Noto Serif SC', serif` | 大标题用古风 |

所有战斗界面的 `.screen` 根节点必须设置：
```css
font-family: 'ZCOOL XiaoWei', 'STKaiti', 'KaiTi', 'Noto Serif SC', serif;
-webkit-font-smoothing: antialiased;
-moz-osx-font-smoothing: grayscale;
```

### 1.2 字号与字重规范（**战斗地图强制标准**）

#### 地图格子
| 元素 | 字号 | 字重 | 备注 |
|---|---|---|---|
| 地形居中大字（修为+1/心境+1/生命+1/生命-1/山石阻隔） | **36px** | **bold (700)** | 古风楷体；带黑色描边和外发光 |

#### 玩家卡（unit）
| 元素 | 字号 | 字重 | 位置 |
|---|---|---|---|
| 姓名（unitName） | **18px** | 700 | **头像左上角**（top:2, left:2） |
| 类型标签（unitType）如「丹/剑/体」 | **18px** | 700 | 头像右上角（top:2, right:2） |
| 属性条 修/境/生（unitStat） | **18px** | 700 | 头像底部叠加 |

#### 敌人卡
| 元素 | 字号 | 字重 | 备注 |
|---|---|---|---|
| 姓名（unitEnemyName）如「剑修劫匪」 | **18px** | 700 | 头像左上角 |
| 类型标签 | 18px | 700 | 头像右上角 |
| 属性条 | **18px** | 700 | — |

#### 顶部中间 HUD
| 元素 | 字号 | 字重 | 备注 |
|---|---|---|---|
| 第 X/8 回合（roundBadge） | **24px** | 700 | 金色 `#c8a14b` |
| 追回物资 0/6（killBadge） | **24px** | 700 | 橙红 `#e87060` |
| "XX 行动中"（turnInfo） | **24px** | 700 | 蓝色 `#8bc8e0` |

#### 左侧按钮（顶部工具栏）
| 元素 | 字号 | 字重 | 备注 |
|---|---|---|---|
| `← 返回`（backBtn） | 16px | bold | `top:16, left:16`（BackButton 组件自带） |
| `📖 战斗规则`（ruleBtn） | **24px** | bold | **与顶部回合条水平对齐**（top:16），位于返回按钮右侧，不遮挡 |

#### 右侧战报面板
| 元素 | 字号 | 字重 | 备注 |
|---|---|---|---|
| 「📜 战报」标题（logTitle） | **18px** | 700 | — |
| 战报条目（logItem） | **16px** | 700 | 古风字体 |

#### Tooltip
| 元素 | 字号 | 字重 | 备注 |
|---|---|---|---|
| 地形/角色悬浮气泡（cellTooltipFloat / hoverTip） | **14px** | 500 | 允许换行，自适应宽度；短文案不拉宽 |

#### 右下角 HUD（4件套）
| 元素 | 字号 | 字重 | 备注 |
|---|---|---|---|
| 已获得灵石: XX（spiritStones） | 16px | 600 | 由 `CommonHud` 组件提供 |
| 已收集角色: XX（collectionBtn） | 16px | 600 | 由 `CommonHud` 组件提供 |

#### 角色 Hover 技能浮窗（hoverTip + hoverSkillPanel）
| 元素 | 字号 | 字重 | 备注 |
|---|---|---|---|
| 顶部提示气泡（hoverTip） | 16px | — | 跟随鼠标，金色描边 |
| 角色名·类型（hoverSkillPanel h4） | **18px** | 700 | 紫金色 `#ffd98a` |
| 属性行 气血/修为/心境 | 15px | — | 灰金 `#c8c0a0` |
| 战斗技能名（.hsSkill strong） | **16px** | 700 | 紫 `#c0a0e0` |
| 战斗技能描述（.hsSkill em） | 14px | — | 行高 1.6 |
| 绝技名（.hsUltimate strong） | **16px** | 700 | 金 `#ffd98a` |
| 绝技描述 | 14px | — | 同上 |

#### 左下角选中角色常驻面板（unitInfoPanel）
> **定位规则**：`left:16; bottom:20`，**底边与 `.actionPanel` 底边对齐**（actionPanel 为 `bottom:20px`），宽度 300px。
| 元素 | 字号 | 字重 | 备注 |
|---|---|---|---|
| 角色名（unitInfoName） | **20px** | 700 | 米白 `#e8dcc0` |
| 类型文字（unitInfoType） | 13px | — | 灰棕 `#a09878`（辅助） |
| 属性条 气血/修为/心境（unitInfoStats） | **18px** | 700 | 对齐 §1.2 卡牌属性 |
| 可移动步数标签（stepBarLabel） | 15px | — | — |
| 步数数字（stepBarLabel strong） | **18px** | 700 | 金 `#ffd98a` |
| 锁定提示（stepLocked） | 13px | — | 橙红 `#ff9780` |
| 技能块正文（unitInfoSkill） | 14px | — | 背景淡紫 |
| 技能名（unitInfoSkill strong） | **16px** | 700 | 紫 `#c0a0e0` |
| 技能描述（unitInfoSkill em） | 14px | — | 行高 1.6 |

#### 底部操作面板（actionPanel）
| 元素 | 字号 | 字重 | 备注 |
|---|---|---|---|
| 技能按钮（⚔ 战斗技能） | **20px** | 700 | 紫底按钮 |
| 绝技按钮（💫 绝技） | **20px** | 700 | 金底按钮 |
| 结束行动按钮 | **20px** | 700 | 灰底按钮 |
| "技能修正 +N" 内联提示 | 15px | — | 紫 `#c0a0e0` |

---

### 1.3 字体分工表（楷体 / 黑体 / 等宽）

**统一分工原则**：游戏整体主调为**古风楷体**，黑体仅保留给少数**长篇阅读正文**和**元数据辅助信息**，等宽字体仅用于**需要等宽对齐的数字**。

| 字体类别 | Token | 字体栈 | 使用场景 |
|---|---|---|---|
| 🎨 **楷体（主字体）** | `--font-title` / `--font-body-kaiti` | `'LXGW WenKai', '霞鹜文楷', KaiTi, STKaiti, serif` | • 所有屏幕根字体 `.screen`<br>• 标题 / 按钮 / CTA<br>• 战斗界面（S5a / S5b / S5c / S7）<br>• 卡牌姓名 / 属性 / 类型标签<br>• 地图地形大字<br>• 规则 / 结算 / 阵容选择弹窗<br>• CommonHud 常驻控件（灵石 / 角色） |
| 📖 **黑体（辅助）** | `--font-ui` | `'Noto Sans SC', 'Source Han Sans CN', 'Microsoft YaHei', sans-serif` | • `body` 全局兜底字体<br>• S4 剧情阅读正文（长篇阅读场景，黑体清晰不疲劳）<br>• VersionLabel 版本号水印<br>• FooterSlogan 页脚标语<br>• S2_MainMenu 存档槽元数据<br>• DiceClock `.sumLabel` 合计小字（12px，搭配下方等宽数字） |
| 🔢 **等宽（数字）** | — | `'Consolas', 'Courier New', monospace` | • 骰子面数字（1/2/0 等）<br>• HP 数字 / 属性数值<br>• 回合计数等需要位数对齐的场景 |

#### 分工使用红线

1. **禁止在战斗 / 卡牌 / 地图 / CommonHud 常驻 HUD 中使用黑体** —— 这些是核心古风场景
2. **禁止把 S4 剧情阅读正文改成楷体** —— 长篇阅读需要黑体清晰度
3. **新增屏幕默认模板**：`.screen { font-family: var(--font-body-kaiti); }`，由此向下所有元素默认继承楷体
4. **新增 `button` 元素必须显式写 `font: inherit` 或 `font-family: inherit`**，否则会被浏览器 UA 样式拉回黑体（CommonHud 踩过的坑）
5. **字体栈必须走 CSS 变量**（`var(--font-body-kaiti)` 等）；新增代码**禁止**再内联写 `'STKaiti', 'ZCOOL XiaoWei'`

#### 已落地范围（2026-04-30 同步）
| 位置 | 改造前 | 改造后 |
|---|---|---|
| `CommonHud`（灵石 / 角色按钮） | 黑体 | ✅ 楷体（`!important` 防继承污染） |
| `S5a_BattleTrial` `.screen` 根字体 | 黑体 | ✅ 楷体 |
| `S5b_QuizTrial` `.screen` 根字体 | 黑体 | ✅ 楷体 |
| `S5c_MentorshipChoice` `.screen` 根字体 | 黑体 | ✅ 楷体 |
| `DiceClock` `.label` / `.noDie` | 黑体 | ✅ 楷体 |

#### 保留黑体（无须改动）
- `global.css` 中 `body` 的 `font-family: var(--font-ui)` — 作为全局兜底
- `S4_StoryReading` 剧情正文相关的 18 处 `--font-ui` — 长篇阅读体验
- `RewardModal` / 奖励说明正文 — 信息密度高
- `VersionLabel` / `FooterSlogan` — 辅助元数据

---

## 2. 色彩

### 2.1 地形文字色
| 地形 | 十六进制 | 说明 |
|---|---|---|
| 灵泉（spring） → 生命+1 | `#44dd66` | 绿色 |
| 灵脉节点（atk_boost） → 修为+1 | `#55aaff` | 蓝色 |
| 悟道石台（mnd_boost） → 心境+1 | `#ffcc33` | 黄色 |
| 魔气侵蚀（miasma） → 生命-1 | `#ff3344` | 红色 |
| 空间裂缝（obstacle） → 山石阻隔 | `#1a1a1a`（白色描边） | 黑色 |

### 2.2 属性色
| 属性 | 十六进制 | 说明 |
|---|---|---|
| 修为（atk） | `#55aaff` | 蓝 |
| 心境（mnd） | `#ffcc33` | 黄 |
| 气血（hp） | `#ff5555` | 红 |

属性条顺序固定为 **修 → 境 → 生**（左→右）。

### 2.3 UI 主色（棕金系）
| 用途 | 十六进制 |
|---|---|
| 金色（按钮/标题/边框） | `#c8a14b` / `#e8c880` / `#ffd98a` |
| 米白（正文） | `#e8dcc0` |
| 暗棕底（面板） | `rgba(30,28,22,.92)` |
| 金色细边 | `rgba(200,161,75,.5)` |

---

## 3. 布局规范

### 3.1 4 件套常驻 UI（所有非抽卡、非加载、非主菜单页面）
- 左上角 `top:16, left:16`：**← 返回**（`BackButton` 组件）
- 右上角 `top:16, right:16`：**🎵 音乐切换**（`MusicToggle` 组件）
- 右下角 `bottom:20, right:20`：**已获得灵石 / 已收集角色**（`CommonHud` 组件）
- 全局字体：古风楷体栈

### 3.2 战斗地图专属布局
```
┌──────────────────────────────────────────────────────┐
│ [←返回] [📖战斗规则]   [第X/8回合][物资][XX行动中]   🎵 │
│   16                         居中                    16 │
│                                                      │
│ ┌────────────────────────────────────┐  ┌──────────┐│
│ │                                    │  │ 📜 战报  ││
│ │        4×10 战斗地图               │  │          ││
│ │                                    │  │ ...      ││
│ │                                    │  │          ││
│ └────────────────────────────────────┘  └──────────┘│
│          [移动] [普攻] [技能] [结束]                   │
│                                            [灵石XX] │
│                                          [角色XX张]  │
└──────────────────────────────────────────────────────┘
```

- **左上角工具栏**：`← 返回` + `📖 战斗规则` 横向排列，都定位在 `top:16`，与顶部中间回合条**水平对齐**
- **顶部中间 HUD**：三个 badge 横向排列，居中
- **右下角 HUD**：`CommonHud` 统一提供

---

## 4. 地形 Tooltip 文案规范

### 4.1 统一句式
> 停留至下回合开始时生效，[效果]

### 4.2 全量文案
| 地形 | 大字标签 | Hover 气泡文案 |
|---|---|---|
| 灵泉（spring） | 生命+1 | 停留至下回合开始时生效，气血+1 |
| 灵脉节点（atk_boost） | 修为+1 | 停留至下回合开始时生效，修为+1 |
| 悟道石台（mnd_boost） | 心境+1 | 停留至下回合开始时生效，心境+1 |
| 魔气侵蚀（miasma） | 生命-1 | 停留至下回合开始时生效，气血-1 |
| 空间裂缝（obstacle） | 山石阻隔 | 空间裂缝 — 不可通行 |

### 4.3 Tooltip 容器规则
- `position: absolute`（挂在战斗页面根容器 `.screen` 内，随 stage 一起 `transform:scale`）
- **禁止使用 `createPortal` 挂到 `document.body`**（否则脱离 stage 缩放，视觉会远大于地图文字）
- 坐标换算：`getBoundingClientRect()` 得到的是屏幕坐标，需要用 `stage.getBoundingClientRect()` 反算回 1920×1080 基准画布坐标
- `font-size: 14px; font-weight: 500`
- `padding: 8px 14px`
- `white-space: nowrap`；单行显示，宽度随文字自适应（`width: max-content`）
- `z-index: 10000`（压住所有 stage 内单位）
- 智能定位：格子在画布顶端 100px 以内时，气泡落到格子下方；否则默认上方

> **重要**：本项目使用 `transform:scale` 等比画布方案（见 `App.tsx`）。任何需要跟随地图/卡牌视觉比例的浮层，必须挂在 stage 内部；只有全屏遮罩（结算/规则/阵容）可以用 `position:absolute; inset:0`，但其内部字号依然按本规范正常写，缩放由 stage 处理。

---

## 5. Z-Index 层级规范
| 层 | z-index | 说明 |
|---|---|---|
| 底图 | 0 | `mapBgLayer` |
| 暗角 | 1 | `mapVignette` |
| 格子/地形瓦片 | 2 | `mapGrid / cellTile / cellLabelCenter` |
| 网格线增强 | 3 | `mapGrid::after` |
| 单位棋子 | 5 | `unit / unitEnemyTile` |
| 路径箭头 | 6 | `pathSvg`（在单位下） |
| 顶部 HUD | 10~11 | `topHud / actionPanel / logPanel / activeTurnBanner` |
| 左侧按钮组 | 20 | `backBtn / ruleBtn` |
| 右下角 HUD | 50 | `CommonHud` |
| 弹窗遮罩 | 100~200 | 骰子/规则/阵容/结算 |
| **全局 Tooltip** | **10000** | 永远最高 |

---

## 6. 修改流程约束
1. 任何界面改动**先查本规范**；如违反，请先修改本规范再同步代码。
2. 新增屏幕时必须挂载 4 件套（除 S1 加载、S2 主菜单、S6_Recruit 抽卡）。
3. 未来战斗地图（S8+）默认完全复用 S7 的样式表 `S7_Battle.module.css` 相关类名。


---

## 7. 统一弹窗规范（所有规则/结算/任务介绍类弹窗）

> 截至目前项目中出现过以下"规则介绍/任务介绍"类弹窗：
> - S5a 入门测试 — 规则说明（用公共 `components/RuleModal.tsx`，卷轴古纸风格）
> - S7 战斗规则（S7_Battle.tsx 内联 `RuleModal`，深棕金色面板）
> - S7 宗门追回物资任务（`SelectPartner` 内嵌任务介绍 + 阵容选择）
> - S7 结算弹窗（`ResultPanel`）
>
> 为了统一视觉体验，以下为**统一规范**：

### 7.1 规则介绍弹窗（深棕金风格，战斗内使用）
| 元素 | 字号 | 字重 | 颜色 |
|---|---|---|---|
| 弹窗主标题 | **32px** | 700 | `#c8a14b` 金色，带 3px 字距，带阴影 |
| 小节标题（h4） | **22px** | 700 | `#e8cc88` 浅金 |
| 小节正文（p） | **18px** | 500 | `#e8dcc0` 米白，行高 1.75，`white-space: pre-line` |
| 主操作按钮 | **22px** | 700 | 金棕渐变底 `#c8a14b → #a07830`，深色文字，字距 3px |
| 面板容器 | `padding: 36px 44px; max-width: 720px; border-radius: 16px` | — | `rgba(30,28,22,.96)` 底色 + `rgba(200,161,75,.55)` 金边 |
| 小节卡片 | `padding: 10px 14px; border-left: 4px solid rgba(200,161,75,.6)` | — | `rgba(200,161,75,.06)` 淡金底 |

**对应 S7 类名**：`.rulePanel / .ruleH / .ruleSec / .ruleSec h4 / .ruleSec p / .ruleClose`

### 7.2 任务介绍弹窗（阵容选择 / 出战前）
| 元素 | 字号 | 字重 | 颜色 |
|---|---|---|---|
| 任务标题 | **32px** | 700 | `#c8a14b` |
| 任务说明 | **18px** | 500 | `#c8c0a0`，行高 1.8 |
| 卡片标题（角色名） | **20px** | 700 | `#e8dcc0` |
| 卡片属性 | **14px** | 600 | `#c8c0a0` |
| 卡片技能 | **13px** | 500 | `#d8b8f0` 淡紫 |
| 主操作按钮（确认出战） | **22px** | 700 | 金棕渐变 |

**对应 S7 类名**：`.selectPanel / .selectTitle / .selectSub / .selectCard / .selectName / .selectStats / .selectSkill / .selectConfirm`

### 7.3 结算弹窗
| 元素 | 字号 | 字重 | 颜色 |
|---|---|---|---|
| 结算标题 | **32px** | 700 | `#c8a14b` |
| 结算条目 | **20px** | 500 | `#e8dcc0`；`<strong>` 部分 `#ffd98a` / 700 |
| 继续按钮 | **22px** | 700 | 金棕渐变 |

**对应 S7 类名**：`.resultPanel / .resultTitle / .resultRow / .resultBtn`

### 7.4 浅色卷轴风弹窗（剧情外使用）
用于比较「庄重」的规则说明（如 S5a 入门测试），沿用 `components/RuleModal.module.css`：
| 元素 | 字号 |
|---|---|
| 标题（.title） | 36px / 700 |
| 小节标题（.subtitle） | 22px / 700 |
| 正文（.bodyText） | 20px / 500 / 行高 1.75 |
| 确认按钮（.confirmBtn） | 22px / 字距 3px |

### 7.5 通用原则
- **一律禁止正文 < 16px、标题 < 28px**（tooltip / 小角标除外）
- **一律禁止**弹窗使用 `14px` 做正文
- 按钮主色用 `linear-gradient(135deg, #c8a14b, #a07830)` 金棕渐变
- 弹窗边框用 `rgba(200,161,75,.55)`，底色用 `rgba(30,28,22,.96)`

---

## 8. 全游戏字体字号盘点（扫描结果）

> 扫描时间：2026-04-30  
> 扫描命令：`grep_search "font-size" src/`  
> 共 17 个样式文件 / 200 处字号声明

### 8.1 通用组件
| 组件 | 用途 | 字号 | 字重 |
|---|---|---|---|
| `GameLogo` | 游戏 Logo | `var(--fs-logo)` = **120px** | 700 |
| `GameLogo` 副标题 | — | **72px** | — |
| `CtaButton` | 主 CTA 大按钮 | **34px** | — |
| `PrimaryButton` | 次级按钮 | **20px** | — |
| `HeroBanner` | 横幅标题 | `var(--fs-plaque)` = **28px** | — |
| `FooterSlogan` | 页脚 Slogan | `var(--fs-footer)` = **14px** | — |
| `VersionLabel` | 版本号 | 14px | — |
| `CommonHud` | 右下角灵石/角色数 | **16px** | 600 |
| `DiceClock` | 骰子数字 | **40px** | — |
| `DiceClock` 小点 | — | 12-20px | — |
| `RewardModal` 标题 | — | 32px | — |
| `RewardModal` 内容 | — | 14-24px | — |
| `RuleModal` 标题 | — | 36px | 700 |
| `RuleModal` 小节 | — | 22px | 700 |
| `RuleModal` 正文 | — | 20px | 500 |

### 8.2 各屏幕主字号
| 屏幕 | 最大字号 | 最小字号 | 备注 |
|---|---|---|---|
| S1_Loading | 14px | 14px | 加载提示，合理 |
| S2_MainMenu | 28px | 14px | 合理 |
| S3_CharacterSelect | 40px | 14px | 合理 |
| S4_StoryReading | 42px | 11px | ⚠ 11/12px 过小项见 §9 |
| S5a_BattleTrial | 80px | 12px | 80px 是骰子结果数字；12/13px 信息条过小 |
| S5b_QuizTrial | - | - | （未扫描到问题） |
| S5c_MentorshipChoice | - | - | （未扫描到问题） |
| S6_Preparation | 44px | 12px | 12px 属性标签过小 |
| S6_Recruit | 32px | 11px | ⚠ 大量 11/12/12.5/13px |
| **S7_Battle** | 64px | 10px | ⚠ 10/11px 已在本次优化升到 18px；剩余 10px 在某些 badge |

### 8.3 字体栈使用现状
| 字体类型 | token | 使用频率 |
|---|---|---|
| `--font-logo` (LXGW WenKai / 霞鹜文楷) | 1 处 | GameLogo |
| `--font-title` (LXGW WenKai / KaiTi) | 多处 | 弹窗标题 |
| `--font-body-kaiti` (LXGW WenKai / KaiTi) | 多处 | RuleModal 正文 |
| `--font-ui` (Noto Sans SC) | 多处 | body 默认、版权等 |
| **内联 STKaiti / ZCOOL XiaoWei** | 9 处 | S7 地图文字/姓名/属性 |

**问题**：字体栈不统一，`--font-body-kaiti` 与内联 `STKaiti, ZCOOL XiaoWei` 并存。**未来所有战斗地图/卡牌类必须改用 `--font-body-kaiti`** 或直接继承 `.screen` 根字体。

---

## 9. 待优化项清单（不合理页面）

### 9.1 S5a 入门战斗考核
| 位置 | 现状 | 建议 |
|---|---|---|
| 骰子数字 | 80px / 56px / 36px | 80px OK，但 36px 的 HP 文字偏大，与 S7 20px 冲突，建议统一战斗面板字号 |
| 信息条 `.infoBar 13px` | 过小 | 升到 16px |
| 对手属性标签 12px | 过小 | 升到 14px |
| 战斗日志 13px | 偏小 | 升到 15-16px，与 S7 战报对齐 |

### 9.2 S6_Recruit 抽卡页面 ⚠️ 最严重
| 位置 | 现状 | 建议 |
|---|---|---|
| `12.5px`（两处） | 异常值，不应存在非整数字号 | 改为 13px |
| `11px` (4 处) | 过小，阅读困难 | 升到 13px |
| `12px` (多处) | 边缘 | 升到 14px |
| `13px` (多处) | 边缘 | 主要信息升到 15-16px |

### 9.3 S6_Preparation
| 位置 | 现状 | 建议 |
|---|---|---|
| `.unitStatMini 12px` | 过小 | 升到 14px |
| `.badgeSmall 14px` | 可保留 | — |

### 9.4 S4_StoryReading
| 位置 | 现状 | 建议 |
|---|---|---|
| `.tipItem 11px` `.indicatorDot 11px` | 过小 | 升到 13px |
| `.dialogName 12px` / `.dialogBody 17px` | 对话偏小 | 名字升 14px，正文升 18px |

### 9.5 S7_Battle（本次已部分优化）
| 位置 | 现状 | 备注 |
|---|---|---|
| `.stepDot 10px` | 已优化无需改 | — |
| `.enemyHintDot 11px` | 可保留 | 是极小角标 |
| `.unitInfoSkill 12px` | 偏小 | 建议升 14px（下一次迭代） |
| `.speedBtn 13px` | 偏小 | 建议升 14-15px |
| `.stepBarLabel 13px` | 偏小 | 建议升 15px |

### 9.6 需要统一的风格
| 类别 | 问题 | 解决方案 |
|---|---|---|
| 规则弹窗 | S5a 用古纸卷轴风 / S7 用深棕金风，风格割裂 | 允许两种风格并存（古纸=入门教学；深棕=战斗内），但**必须都遵守 §7 字号表**：标题 ≥ 32、小节 ≥ 22、正文 ≥ 18 |
| 按钮字号 | 各页面 14~34px 跨度太大 | 分级：主 CTA（34px）/ 弹窗确认（22px）/ 操作按钮（20px）/ 辅助按钮（16px） |
| 字体栈 | 内联 vs Token 混用 | 未来新代码必须用 token（`var(--font-body-kaiti)`） |

---

## 10. 本次优化记录（2026-04-30）

### 已修复
- ✅ **[Bug]** S7 地形 tooltip 因 Portal 到 body 脱离 stage scale，视觉比地图文字还大 → 改为挂在 `.screen` 内 `position:absolute` + stage 坐标系反算
- ✅ **[不统一]** S7 阵容弹窗字号全部偏小（22/14/16/12/11） → 升到 32/18/20/14/13
- ✅ **[不统一]** S7 内置战斗规则弹窗（20/15/13）风格与公共 RuleModal（36/22/20）割裂 → 升到 32/22/18，并加金色边框小节卡片
- ✅ **[不统一]** S7 结算弹窗字号（24/18/16）→ 升到 32/20/22
- ✅ 建立 §7 统一弹窗规范 + §8 全游戏盘点 + §9 待优化项清单
- ✅ **[字体统一]** 新增 §1.3 字体分工表；`CommonHud` / `S5a` / `S5b` / `S5c` / `DiceClock` 根字体统一改为楷体，彻底解决"常驻控件字体不一致"问题

### 下一步待办
- [ ] S6_Recruit 全量字号升级（§9.2）
- [ ] S5a 信息条和对手标签字号升级（§9.1）
- [ ] S4_StoryReading 对话正文字号升级（§9.4）
- [ ] 所有内联 STKaiti 字体统一替换为 `var(--font-body-kaiti)`

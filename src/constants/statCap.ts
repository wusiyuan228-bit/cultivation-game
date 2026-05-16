/**
 * 角色三项常规属性的统一上限。
 *
 * ▶ 策划设定（2026-05-17 确认）：
 *    - 气血 HP   常规上限 = 15
 *    - 修为 ATK  常规上限 = 15
 *    - 心境 MND  常规上限 = 15
 *
 * ▶ 适用范围：
 *    - 所有"常规属性增益"（功能瓦片、招募奖励、永久 buff、剧情奖励、技能持续性属性强化）
 *      在写入数值时必须夹紧到这些上限。
 *    - 各战场（S5/S6/S7/S7B/S7C/S7D）的实时数值修改也应使用本常量，避免散落魔数（99、999）。
 *
 * ▶ 例外（"可突破常规上限"）：
 *    - 极少数明确标注为"可突破上限"的技能/光环（如宁荣荣 九宝琉璃·极光 改变 hpCap）
 *      不受此常量约束，直接修改 unit.hpMax / atkCap / mndCap 自身。
 *
 * ▶ 反面案例（旧代码中存在的魔数，应替换）：
 *    - `Math.min(u.atk + 1, 99)`  → `Math.min(u.atk + 1, ATK_CAP)`
 *    - `Math.min(u.mnd + 1, 99)`  → `Math.min(u.mnd + 1, MND_CAP)`
 */

/** 气血上限（HP） */
export const HP_CAP = 15;

/** 修为上限（ATK） */
export const ATK_CAP = 15;

/** 心境上限（MND） */
export const MND_CAP = 15;

/** 三属性下限（默认）。心境最低 1，气血/修为下限 0（=退场/无攻击）。 */
export const HP_FLOOR = 0;
export const ATK_FLOOR = 0;
export const MND_FLOOR = 1;

/** 夹紧到合法范围的工具函数（避免各处重复写 Math.min/Math.max）。 */
export const clampHp = (v: number, hpMax?: number): number =>
  Math.max(HP_FLOOR, Math.min(v, hpMax ?? HP_CAP));

export const clampAtk = (v: number): number =>
  Math.max(ATK_FLOOR, Math.min(v, ATK_CAP));

export const clampMnd = (v: number): number =>
  Math.max(MND_FLOOR, Math.min(v, MND_CAP));

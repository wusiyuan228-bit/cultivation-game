/**
 * S7D · 卡牌战术定位推断（Tactical Role Inference）
 *
 * 基于卡牌的 battle_skill / ultimate 的 desc + params 关键词，启发式推断出
 * 该卡在战场上的战术定位。用于 AI 阵容生成与队友联动协同。
 *
 * 优先级：
 *   1) 若卡牌原始数据已标注 tactical_role 字段 → 直接使用
 *   2) 否则通过关键词扫描推断
 *
 * 五大定位：
 *   - tank    坦克（减伤/代受/反弹/金身/铁甲）
 *   - healer  治疗（治疗/回血/恢复）
 *   - control 控制（定身/冰冻/缠绕/眩晕/沉默/归零）
 *   - support 辅助（加 buff / 友军增益）
 *   - dps     输出（默认，含所有攻击型 +骰子、AOE、爆发）
 */

/** 五大战术定位类型 */
export type TacticalRole = 'tank' | 'healer' | 'control' | 'support' | 'dps';

/** 角色定位元数据（UI 展示用） */
export const TACTICAL_ROLE_META: Record<TacticalRole, { label: string; color: string; icon: string }> = {
  tank:    { label: '坦克', color: '#8b7355', icon: '🛡' },
  healer:  { label: '治疗', color: '#4caf50', icon: '✚' },
  control: { label: '控制', color: '#7e57c2', icon: '❄' },
  support: { label: '辅助', color: '#26a69a', icon: '✨' },
  dps:     { label: '输出', color: '#e53935', icon: '⚔' },
};

/**
 * 兼容原有 controller / support / dps_passive / dps_burst / finisher / sacrifice / utility 
 * 等标签，归一化到五大定位
 */
function normalizeKnownRole(raw: string): TacticalRole | null {
  const s = raw.toLowerCase();
  if (s === 'tank' || s === 'defender' || s === 'guardian') return 'tank';
  if (s === 'healer' || s === 'cleric') return 'healer';
  if (s === 'control' || s === 'controller' || s === 'disabler') return 'control';
  if (s === 'support' || s === 'buffer' || s === 'utility' || s === 'buffer_support') return 'support';
  if (s === 'dps' || s === 'dps_passive' || s === 'dps_burst' || s === 'finisher' || s === 'assassin') return 'dps';
  if (s === 'sacrifice') return 'tank'; // 牺牲型归为坦克
  return null;
}

/**
 * 构造扫描文本：合并 battle_skill / ultimate 的 desc、effect、name 等字段
 */
function buildScanText(card: any): string {
  const parts: string[] = [];
  const push = (v: any) => {
    if (typeof v === 'string') parts.push(v);
  };

  // 兼容两种结构：
  //   A) card.battle_skill / card.ultimate（扁平）
  //   B) card.battle_card.skills.battle_skill / card.battle_card.skills.ultimate（主角结构）
  const skills = [
    card?.battle_skill,
    card?.ultimate,
    card?.battle_card?.skills?.battle_skill,
    card?.battle_card?.skills?.ultimate,
    card?.skills?.battle_skill,
    card?.skills?.ultimate,
  ].filter(Boolean);

  for (const sk of skills) {
    push(sk?.name);
    push(sk?.desc);
    push(sk?.description);
    push(sk?.trigger);
    const p = sk?.params;
    if (p) {
      push(p.effect);
      push(p.shape);
      if (p.debuff) {
        push(p.debuff.stat);
      }
      if (p.buff) {
        push(p.buff.stat);
      }
    }
  }
  return parts.join(' | ');
}

/**
 * 关键词规则集（按优先级从上到下判定，命中即返回）
 */
const RULE_SET: Array<{ role: TacticalRole; patterns: RegExp[] }> = [
  // 治疗（最强判定优先级，避免被其他规则吞）
  {
    role: 'healer',
    patterns: [
      /治疗|回血|回复.{0,2}生命|恢复.{0,2}生命|heal|restore_hp|hp_restore|aoe_heal|团队治疗|治疗之力/i,
      /补给|妙手|回春|生命泉|还神/i,
    ],
  },

  // 坦克（减伤、护盾、替身、代受、金身、铁甲、反弹）
  {
    role: 'tank',
    patterns: [
      /减伤|承伤|护盾|金身|铁甲|铁骨|白虎|死亡保护|代受|替身|反击|反弹|reduce_damage|shield|damage_reduction/i,
      /守护.{0,2}队友|嘲讽|拉仇恨|承担伤害|格挡|无敌/i,
      /铮铮|皮糙肉厚|肉盾|玄武盾/i,
    ],
  },

  // 控制（定身、冰冻、缠绕、眩晕、归零、沉默、魅惑）
  {
    role: 'control',
    patterns: [
      /无法移动|禁足|定身|钉住|缠绕|冰冻|眩晕|沉默|麻痹|disable_move|disable_action|freeze|stun/i,
      /迷惑|魅惑|魅术|蝶舞红尘|强制线索|精神控制/i,
      /对方.{0,2}(骰|修为).{0,2}(归零|清零|-3|-4|-5)/i,
      /命格逆转|敌骰归零|域|不动|下一个行动轮/i,
    ],
  },

  // 辅助（友军增益、友军加 buff、团队 +修为 / +心境 / 额外抽等）
  {
    role: 'support',
    patterns: [
      /友军.{0,3}\+/i,
      /\+.{0,2}(修为|心境|骰|灵石).{0,8}(友军|队友|同伴)/i,
      /加持|增益|鼓舞|号令|指挥|激励|共鸣/i,
      /buff|friendly_buff|ally_buff|team_buff/i,
      /预览|抽[1-9]|额外抽|换卡|弃换/i,
    ],
  },
];

/**
 * 主函数：推断一张卡牌的战术定位
 *
 * @param card 原始卡牌数据（可能含 tactical_role 字段）
 * @returns 五大定位之一，默认 'dps'
 */
export function inferTacticalRole(card: any): TacticalRole {
  if (!card) return 'dps';

  // 1) 优先使用数据中已标注的 tactical_role
  const rawRoleA = card.tactical_role;
  if (typeof rawRoleA === 'string') {
    const r = normalizeKnownRole(rawRoleA);
    if (r) return r;
  }
  const rawRoleB = card.battle_card?.tactical_role;
  if (typeof rawRoleB === 'string') {
    const r = normalizeKnownRole(rawRoleB);
    if (r) return r;
  }

  // 2) 关键词启发式扫描
  const text = buildScanText(card);
  if (!text) return 'dps';

  for (const rule of RULE_SET) {
    if (rule.patterns.some((re) => re.test(text))) {
      return rule.role;
    }
  }

  // 默认输出型
  return 'dps';
}

/**
 * 批量推断（返回 id → role 的映射）
 */
export function inferRoleMap(cards: any[]): Map<string, TacticalRole> {
  const map = new Map<string, TacticalRole>();
  for (const c of cards) {
    if (c && typeof c.id === 'string') {
      map.set(c.id, inferTacticalRole(c));
    }
  }
  return map;
}

/**
 * V6 战斗技能批量更新脚本
 * 
 * 依据：GDD v3.3 + V6 技能终稿（见历史对话上下文）
 * 作用：
 *   1. 覆写 cards_all.json 中 76 张卡的 battle_skill / ultimate 字段
 *   2. 统一术语：普攻→攻击；命中后→进攻时/进攻后；修为判定+N→判定结果+N/修为+N；本回合→本大回合/下一个行动轮
 *   3. 添加 params（trigger、effect、value 等），为未来 Modifier 系统做准备
 * 
 * 执行：node scripts/patch_battle_skills_v6.cjs
 */

const fs = require('fs');
const path = require('path');

const JSON_PATH = path.resolve(__dirname, '../public/config/cards/cards_all.json');

// ========== V6 技能总表 ==========
// 格式：{ [cardId]: { battle_skill?: {...}, ultimate?: {...}, awakening_battle?: {...}, awakening_ultimate?: {...} } }

const V6_SKILLS = {
  // =============== 主角（6位 × 2形态） ===============
  hero_tangsan: {
    battle_skill: {
      name: '蓝银囚笼',
      desc: '进攻时，目标的下一个行动轮无法移动',
      type: 'battle',
      trigger: 'on_after_hit',
      params: { effect: 'disable_move', duration: 'next_turn' }
    },
    ultimate: {
      name: '暗器·万毒淬体',
      desc: '主动发动，对十字方向（上下左右各1格）所有敌人各进行1次攻击，被命中的目标修为永久-1（最低为1）',
      type: 'battle',
      trigger: 'active_once',
      params: { effect: 'cross_attack_with_atk_debuff', shape: 'cross', debuff: { stat: 'atk', value: -1, permanent: true, min: 1 } }
    },
    awakening_battle: {
      name: '修罗瞳·支配',
      desc: '所有判定结果+2（常驻）',
      type: 'awaken',
      trigger: 'passive',
      params: { effect: 'bonus_value', value: 2, scope: 'all_judgements' }
    },
    awakening_ultimate: {
      name: '修罗弑神击',
      desc: '主动发动，选1名敌人，无视距离，投修为×2颗骰子进行攻击',
      type: 'awaken',
      trigger: 'active_once',
      params: { effect: 'ranged_attack', range: 'unlimited', diceMultiplier: 2 }
    }
  },
  hero_xiaowu: {
    battle_skill: {
      name: '无敌金身',
      desc: '被攻击时，将本次受到的伤害降为2点',
      type: 'battle',
      trigger: 'on_damage_calc',
      params: { effect: 'reduce_damage_to', value: 2 }
    },
    ultimate: {
      name: '八段摔·断魂',
      desc: '小舞儿主动退场时，选1名相邻敌人，造成小舞儿当前已损失气血值的固定伤害',
      type: 'battle',
      trigger: 'on_self_sacrifice',
      params: { effect: 'lost_hp_as_damage', target: 'adjacent_enemy', count: 1, damageType: 'skill_damage' }
    },
    awakening_battle: {
      name: '柔骨·缠魂',
      desc: '主动发动，可控制场上任意1名角色移动1格',
      type: 'awaken',
      trigger: 'active_once',
      params: { effect: 'force_move', range: 'unlimited', distance: 1 }
    },
    awakening_ultimate: {
      name: '十万年魂骨献祭',
      desc: '主动/被动退场时，塘散所有属性永久+5（可突破上限）',
      type: 'awaken',
      trigger: 'on_self_leave',
      params: { effect: 'buff_target', targetCardId: 'hero_tangsan', stats: ['hp', 'atk', 'mnd'], value: 5, permanent: true, canBreakCap: true }
    }
  },
  hero_xiaoyan: {
    battle_skill: {
      name: '焚决·噬焰',
      desc: '进攻时，吞噬目标1点修为（目标修为永久-1，最低为1；自身修为永久+1，可突破上限）',
      type: 'battle',
      trigger: 'on_after_hit',
      params: { effect: 'devour_atk', value: 1, permanent: true, canBreakCap: true, min: 1 }
    },
    ultimate: {
      name: '佛怒火莲',
      desc: '主动发动，对相邻所有敌人各进行1次攻击',
      type: 'battle',
      trigger: 'active_once',
      params: { effect: 'aoe_attack', shape: 'adjacent_all' }
    },
    awakening_battle: {
      name: '帝炎·焚天',
      desc: '对自己所在纵列包含自己的全部角色，各造成2点固定伤害（每个行动轮开始时结算）',
      type: 'awaken',
      trigger: 'on_turn_start',
      params: { effect: 'column_damage', value: 2, includeSelf: true, damageType: 'skill_damage' }
    },
    awakening_ultimate: {
      name: '帝品火莲·毁灭',
      desc: '主动发动，对全场所有敌人造成自身修为值一半（向上取整）的固定伤害',
      type: 'awaken',
      trigger: 'active_once',
      params: { effect: 'global_damage_by_atk', divisor: 2, round: 'ceil', damageType: 'skill_damage' }
    }
  },
  hero_xuner: {
    battle_skill: {
      name: '古族血脉·共鸣',
      desc: '行动轮结束时，相邻1格内所有友军和自己回复1点气血（不可超过气血上限）',
      type: 'battle',
      trigger: 'on_turn_end',
      params: { effect: 'heal_adjacent_allies', value: 1, includeSelf: true, canBreakCap: false }
    },
    ultimate: {
      name: '金帝天火阵',
      desc: '主动发动，本大回合剩余时间内，所有友军受到的伤害-3',
      type: 'battle',
      trigger: 'active_once',
      params: { effect: 'global_damage_reduce', value: 3, scope: 'all_allies', duration: 'round_remain' }
    },
    awakening_battle: {
      name: '斗帝血脉·庇护',
      desc: '己方角色被击杀时，薰儿可使其保留1点气血存活（每场限2次）',
      type: 'awaken',
      trigger: 'on_any_ally_death',
      params: { effect: 'prevent_death', hpAfter: 1, limitPerBattle: 2 }
    },
    awakening_ultimate: {
      name: '古族祖灵结界',
      desc: '主动发动，本大回合剩余时间内，所有友军受到的伤害全部转移给薰儿承受，且薰儿气血最低降至1',
      type: 'awaken',
      trigger: 'active_once',
      params: { effect: 'damage_redirect', scope: 'all_allies', minHp: 1, duration: 'round_remain' }
    }
  },
  hero_hanli: {
    battle_skill: {
      name: '青竹蜂云剑·七十二路',
      desc: '进攻时，可以用修为和心境总和颗骰子进行判定',
      type: 'battle',
      trigger: 'on_before_roll',
      params: { effect: 'dice_count_override', formula: 'atk+mnd' }
    },
    ultimate: {
      name: '万剑归宗',
      desc: '主动发动，选1名同行或同列的敌人（无需相邻），投修为×2颗骰子进行攻击',
      type: 'battle',
      trigger: 'active_once',
      params: { effect: 'line_attack', range: 'same_row_or_col', diceMultiplier: 2 }
    },
    awakening_battle: {
      name: '噬金虫群',
      desc: '进攻时造成的伤害×2（判定结果翻倍）',
      type: 'awaken',
      trigger: 'on_damage_calc',
      params: { effect: 'damage_multiplier', value: 2 }
    },
    awakening_ultimate: {
      name: '天罗万象·大衍决',
      desc: '主动发动，选1名敌人，直接造成等同于自身修为值的固定伤害',
      type: 'awaken',
      trigger: 'active_once',
      params: { effect: 'damage_by_atk', target: 'any_enemy', damageType: 'skill_damage' }
    }
  },
  hero_wanglin: {
    battle_skill: {
      name: '邪灵诀·夺命',
      desc: '进攻时，吸取目标1点气血回复自身（可突破气血上限）',
      type: 'battle',
      trigger: 'on_after_hit',
      params: { effect: 'lifesteal', value: 1, canBreakCap: true }
    },
    ultimate: {
      name: '逆·天地崩',
      desc: '主动发动，消耗自身一半气血（向上取整），对全场所有敌人造成等同于消耗气血值的固定伤害',
      type: 'battle',
      trigger: 'active_once',
      params: { effect: 'sacrifice_global_damage', costRatio: 0.5, round: 'ceil', damageType: 'skill_damage' }
    },
    awakening_battle: {
      name: '逆天·万魂幡',
      desc: '击杀敌人后，本大回合可再行动1次',
      type: 'awaken',
      trigger: 'on_kill',
      params: { effect: 'extra_action', count: 1 }
    },
    awakening_ultimate: {
      name: '一念逆天',
      desc: '主动发动，选1名敌人，直接将其气血设为1',
      type: 'awaken',
      trigger: 'active_once',
      params: { effect: 'set_hp', target: 'any_enemy', value: 1 }
    }
  },

  // =============== 绑定 SSR（6张） ===============
  bssr_tanghao: {
    battle_skill: {
      name: '昊天锤·碎',
      desc: '攻击时，判定结果+1',
      type: 'battle',
      trigger: 'on_damage_calc',
      params: { effect: 'bonus_value', value: 1, condition: 'onlyWhenAttacking' }
    },
    ultimate: {
      name: '昊天九绝·破天',
      desc: '主动发动，对1名相邻敌人进行攻击，本次额外投5颗骰子',
      type: 'battle',
      trigger: 'active_once',
      params: { effect: 'empowered_attack', target: 'adjacent_enemy', extraDice: 5 }
    }
  },
  bssr_erming: {
    battle_skill: {
      name: '泰坦巨猿·铁壁',
      desc: '被攻击伤害命中后，自动对攻击方造成2点固定反弹伤害（技能直接伤害不触发；多段攻击每段独立反弹）',
      type: 'battle',
      trigger: 'on_after_being_hit',
      params: { effect: 'reflect_damage', value: 2, onlyFor: 'attack_damage', damageType: 'skill_damage' }
    },
    ultimate: {
      name: '泰坦陨击',
      desc: '主动发动，对1名相邻敌人造成自身当前气血值的固定伤害',
      type: 'battle',
      trigger: 'active_once',
      params: { effect: 'current_hp_as_damage', target: 'adjacent_enemy', damageType: 'skill_damage' }
    }
  },
  bssr_yaochen: {
    battle_skill: {
      name: '骨灵冷火·炼',
      desc: '行动轮结束时，自动恢复相邻1名友军2点气血（不可超过气血上限）',
      type: 'battle',
      trigger: 'on_turn_end',
      params: { effect: 'heal', value: 2, target: 'adjacent_ally', count: 1, canBreakCap: false }
    },
    ultimate: {
      name: '丹帝遗方',
      desc: '主动发动，选1名友军，修为值永久改为10（可突破上限）',
      type: 'battle',
      trigger: 'active_once',
      params: { effect: 'set_stat', stat: 'atk', value: 10, permanent: true, canBreakCap: true, target: 'any_ally' }
    }
  },
  bssr_guyuan: {
    battle_skill: {
      name: '古族天火阵',
      desc: '相邻所有友军修为+1（常驻光环，可突破修为上限）',
      type: 'battle',
      trigger: 'passive',
      category: 'aura',
      params: { effect: 'aura_buff', stat: 'atk', value: 1, scope: 'adjacent_allies', canBreakCap: true }
    },
    ultimate: {
      name: '远古斗帝血脉',
      desc: '主动发动，本大回合剩余时间内，所有友军修为+1（可突破修为上限）',
      type: 'battle',
      trigger: 'active_once',
      params: { effect: 'global_buff', stat: 'atk', value: 1, scope: 'all_allies', duration: 'round_remain', canBreakCap: true }
    }
  },
  bssr_nangongwan: {
    battle_skill: {
      name: '万花灵阵',
      desc: '被进攻时，可消耗自身1点气血，使本次攻击方修为值减半（向下取整，仅本次判定）',
      type: 'battle',
      trigger: 'on_before_being_attacked',
      params: { effect: 'reactive_halve_atk', cost: { stat: 'hp', value: 1 }, round: 'floor', duration: 'this_attack' }
    },
    ultimate: {
      name: '灵阵·归元',
      desc: '南宫婉死亡时（仅被动触发），可以使1名敌人的修为值归零（永久）',
      type: 'battle',
      trigger: 'on_self_death',
      params: { effect: 'set_stat', stat: 'atk', value: 0, permanent: true, target: 'any_enemy', triggerMode: 'passive_only' }
    }
  },
  bssr_situnan: {
    battle_skill: {
      name: '天逆珠·修炼',
      desc: '主动发动，可减少自身X点气血（X≤当前气血-1），让另1名友军所有属性各增加X点（不可超过上限，心境最多+2）',
      type: 'battle',
      trigger: 'active_variable',
      params: { effect: 'self_sacrifice_buff_ally', stats: ['hp', 'atk', 'mnd'], canBreakCap: false, maxX: 'hp-1' }
    },
    ultimate: {
      name: '天逆珠·夺元',
      desc: '主动发动，对1名敌人造成自身已损失气血值×2的固定伤害',
      type: 'battle',
      trigger: 'active_once',
      params: { effect: 'lost_hp_damage', multiplier: 2, target: 'any_enemy', damageType: 'skill_damage' }
    }
  },

  // =============== 绑定 SR（6张） ===============
  bsr_tangya: {
    battle_skill: {
      name: '蓝银缠绕·愈',
      desc: '行动轮结束时，可指定1名角色气血+1（可突破气血上限）',
      type: 'battle',
      trigger: 'on_turn_end',
      params: { effect: 'buff_hp', value: 1, target: 'any_character', canBreakCap: true }
    },
    ultimate: {
      name: '蓝银皇·生命赐福',
      desc: '主动发动，选1名友军，使其下一个行动轮可以行动2次',
      type: 'battle',
      trigger: 'active_once',
      params: { effect: 'extra_action_next_turn', count: 1, target: 'any_ally' }
    }
  },
  bsr_wangdonger: {
    battle_skill: {
      name: '光明圣龙',
      desc: '修为判定时（自己投骰后），如果骰出的骰子中有偶数，则气血+2（不可超过气血上限）',
      type: 'battle',
      trigger: 'on_after_roll',
      params: { effect: 'conditional_heal', condition: 'any_even_dice', value: 2, canBreakCap: false }
    },
    ultimate: {
      name: '金银双龙击',
      desc: '主动发动，对1名相邻敌人进行2次独立的攻击',
      type: 'battle',
      trigger: 'active_once',
      params: { effect: 'multi_attack', count: 2, target: 'adjacent_enemy' }
    }
  },
  bsr_xiaozhan: {
    battle_skill: {
      name: '萧家八极·守',
      desc: '只要本行动轮你未对外进行攻击，敌方对你造成的伤害-5（最低为0）',
      type: 'battle',
      trigger: 'on_damage_calc',
      params: { effect: 'conditional_damage_reduce', condition: 'did_not_attack_this_turn', value: 5, min: 0 }
    },
    ultimate: {
      name: '萧族护盾',
      desc: '主动发动，在地图任意位置布置1个阻碍物，任何人无法通过（永久存在，直至战斗结束）',
      type: 'battle',
      trigger: 'active_once',
      params: { effect: 'place_obstacle', duration: 'permanent', position: 'any' }
    }
  },
  bsr_xiaoyixian: {
    battle_skill: {
      name: '毒体·蚀骨',
      desc: '进攻时，可对另外1名相邻敌人造成本次伤害的数值（溅射伤害，不再触发吞噬等后效）',
      type: 'battle',
      trigger: 'on_after_hit',
      params: { effect: 'splash_damage', target: 'adjacent_other_enemy', damageType: 'skill_damage' }
    },
    ultimate: {
      name: '厄难毒体·全境释放',
      desc: '主动发动，本大回合剩余时间内，场上所有敌人修为-1（最低为0）',
      type: 'battle',
      trigger: 'active_once',
      params: { effect: 'global_debuff', stat: 'atk', value: -1, scope: 'all_enemies', duration: 'round_remain', min: 0 }
    }
  },
  bsr_yinyue: {
    battle_skill: {
      name: '月华护体',
      desc: '被攻击时，可消耗自身2点气血，抵挡本次全部伤害',
      type: 'battle',
      trigger: 'on_damage_calc',
      params: { effect: 'immune_at_cost', cost: { stat: 'hp', value: 2 } }
    },
    ultimate: {
      name: '月魂献祭',
      desc: '银月退场时（主动/被动），寒立永久修为+2、气血+2（可突破上限）',
      type: 'battle',
      trigger: 'on_self_leave',
      params: { effect: 'buff_target', targetCardId: 'hero_hanli', stats: [{ stat: 'atk', value: 2 }, { stat: 'hp', value: 2 }], permanent: true, canBreakCap: true }
    }
  },
  bsr_limuwan: {
    battle_skill: {
      name: '情丝牵引',
      desc: '行动轮开始时，若旺林在场则治疗旺林2点气血；否则治疗自身1点（不可超过气血上限）',
      type: 'battle',
      trigger: 'on_turn_start',
      params: { effect: 'conditional_heal', condition: 'wanglin_alive', healTarget: 'hero_wanglin', healValue: 2, fallbackHealSelf: 1, canBreakCap: false }
    },
    ultimate: {
      name: '情深不渝',
      desc: '李慕婉主动退场时，使旺林所有属性永久+2（可突破上限）',
      type: 'battle',
      trigger: 'on_self_sacrifice',
      params: { effect: 'buff_target', targetCardId: 'hero_wanglin', stats: ['hp', 'atk', 'mnd'], value: 2, permanent: true, canBreakCap: true }
    }
  },

  // =============== 招募 SSR（12张） ===============
  ssr_bibidong: {
    battle_skill: {
      name: '死蛛皇·噬',
      desc: '进攻时，永久降低目标1点修为（最低为1）',
      type: 'battle',
      trigger: 'on_after_hit',
      params: { effect: 'debuff_target', stat: 'atk', value: -1, permanent: true, min: 1 }
    },
    ultimate: {
      name: '蛛皇真身',
      desc: '主动发动，对1名敌人进行攻击，若本次攻方判定点数大于对方当前修为值，则目标直接退场',
      type: 'battle',
      trigger: 'active_once',
      params: { effect: 'execute_if_roll_exceeds_atk', target: 'any_enemy' }
    }
  },
  ssr_huoyuhao: {
    battle_skill: {
      name: '冰碧帝皇蝎·域',
      desc: '行动轮结束时，所有相邻敌人的下一个行动轮无法移动',
      type: 'battle',
      trigger: 'on_turn_end',
      params: { effect: 'disable_move', scope: 'adjacent_enemies', duration: 'next_turn' }
    },
    ultimate: {
      name: '精神风暴',
      desc: '主动发动，场上所有角色（含己方）原地停留一个行动轮，无法移动',
      type: 'battle',
      trigger: 'active_once',
      params: { effect: 'global_disable_move', scope: 'all_characters', duration: 'next_turn' }
    }
  },
  ssr_ningfengzhi: {
    battle_skill: {
      name: '七宝加持',
      desc: '相邻所有友军修为+1（常驻光环，可突破修为上限）',
      type: 'battle',
      trigger: 'passive',
      category: 'aura',
      params: { effect: 'aura_buff', stat: 'atk', value: 1, scope: 'adjacent_allies', canBreakCap: true }
    },
    ultimate: {
      name: '七宝仙品·极致增幅',
      desc: '主动发动，可额外指定2名自身相邻的己方角色与自己一起对1名敌人发动攻击（进行3次独立攻击）',
      type: 'battle',
      trigger: 'active_once',
      params: { effect: 'coordinated_attack', count: 3, target: 'adjacent_enemy' }
    }
  },
  ssr_meidusa: {
    battle_skill: {
      name: '蛇后魅瞳',
      desc: '进攻时，可消耗自身1点气血，使目标下一个行动轮无法进攻（仍可移动）',
      type: 'battle',
      trigger: 'on_after_hit',
      params: { effect: 'disable_attack', duration: 'next_turn', cost: { stat: 'hp', value: 1 } }
    },
    ultimate: {
      name: '蛇后之瞳·石化',
      desc: '美杜莎退场时（主动/被动），可以让1名指定角色永远无法移动',
      type: 'battle',
      trigger: 'on_self_leave',
      params: { effect: 'disable_move', duration: 'permanent', target: 'any_character' }
    }
  },
  ssr_yunyun: {
    battle_skill: {
      name: '风刃·凌空',
      desc: '可攻击2格距离内的敌人（突破相邻限制）',
      type: 'battle',
      trigger: 'passive',
      params: { effect: 'extend_attack_range', range: 2 }
    },
    ultimate: {
      name: '风之极·陨杀',
      desc: '主动发动，与1名敌人进行修为判定，该判定结果同时作用于最多5名敌人（造成相同伤害）',
      type: 'battle',
      trigger: 'active_once',
      params: { effect: 'shared_damage_attack', maxTargets: 5 }
    }
  },
  ssr_xiaoxuan: {
    battle_skill: {
      name: '萧族斗气·焚',
      desc: '攻击妖修类敌人时，判定结果+3',
      type: 'battle',
      trigger: 'on_damage_calc',
      params: { effect: 'bonus_value', value: 3, condition: 'onlyWhenAttacking', onlyVsType: '妖修' }
    },
    ultimate: {
      name: '斗帝·天焱三决',
      desc: '主动发动，刷新3名指定角色的绝技使用次数',
      type: 'battle',
      trigger: 'active_once',
      params: { effect: 'refresh_ultimate', count: 3, target: 'any_3_characters' }
    }
  },
  ssr_xuangu: {
    battle_skill: {
      name: '阴阳万解',
      desc: '每次攻击后可重投1次骰子，取高判定结果（常驻）',
      type: 'battle',
      trigger: 'on_after_roll',
      params: { effect: 'reroll_take_higher', perTurn: 'unlimited' }
    },
    ultimate: {
      name: '天地阴阳·逆',
      desc: '主动发动，选定2个角色（敌或友均可），将其所有数值恢复到初始值',
      type: 'battle',
      trigger: 'active_once',
      params: { effect: 'reset_stats_to_initial', count: 2, target: 'any_2_characters' }
    }
  },
  ssr_mocaihuan: {
    battle_skill: {
      name: '蓄力·彩环缚',
      desc: '本行动轮不攻击，下一个行动轮修为+4（不可超过修为上限）',
      type: 'battle',
      trigger: 'conditional_passive',
      params: { effect: 'charge_buff', condition: 'did_not_attack_this_turn', stat: 'atk', value: 4, duration: 'next_turn', canBreakCap: false }
    },
    ultimate: {
      name: '彩环万缚·极',
      desc: '主动发动，进行一次心境判定（投心境值颗骰子），场上所有角色（含己方）受到（判定点数-2）的固定伤害',
      type: 'battle',
      trigger: 'active_once',
      params: { effect: 'global_damage_by_rng_roll', offset: -2, scope: 'all_characters', damageType: 'skill_damage' }
    }
  },
  ssr_ziling: {
    battle_skill: {
      name: '韩老魔·治愈',
      desc: '进攻后，自身与寒立各气血+1（寒立不在场则仅自身+1，可突破气血上限）',
      type: 'battle',
      trigger: 'on_after_hit',
      params: { effect: 'heal_bonded', self: 1, bondedTarget: 'hero_hanli', bondedValue: 1, canBreakCap: true }
    },
    ultimate: {
      name: '双修合击',
      desc: '主动发动，若寒立在场，对1名敌人进行攻击，骰子数=紫灵修为+寒立修为',
      type: 'battle',
      trigger: 'active_once',
      params: { effect: 'bonded_dice_sum_attack', bondedTarget: 'hero_hanli', formula: 'self.atk + bonded.atk' }
    }
  },
  ssr_zhouyi: {
    battle_skill: {
      name: '疯魔·灭杀',
      desc: '判定结果+3，但每次进攻后自身受1点固定伤害',
      type: 'battle',
      trigger: 'on_damage_calc',
      params: { effect: 'bonus_value_with_self_damage', value: 3, condition: 'onlyWhenAttacking', selfDamage: 1 }
    },
    ultimate: {
      name: '疯魔化身',
      desc: '主动发动，可扣除自身X点气血（X≤当前气血-1），本次攻击判定结果额外+X',
      type: 'battle',
      trigger: 'active_variable',
      params: { effect: 'sacrifice_bonus_value', costStat: 'hp', maxX: 'hp-1' }
    }
  },
  ssr_tuosen: {
    battle_skill: {
      name: '古神·封印',
      desc: '若本行动轮未移动，则对场上任意位置1名敌人造成2点固定伤害',
      type: 'battle',
      trigger: 'on_turn_end',
      params: { effect: 'conditional_damage', condition: 'did_not_move_this_turn', value: 2, target: 'any_enemy', damageType: 'skill_damage' }
    },
    ultimate: {
      name: '古神之怒',
      desc: '主动发动，对1名相邻敌人造成自身当前气血值的固定伤害',
      type: 'battle',
      trigger: 'active_once',
      params: { effect: 'current_hp_as_damage', target: 'adjacent_enemy', damageType: 'skill_damage' }
    }
  },
  ssr_tianyunzi: {
    battle_skill: {
      name: '天运·命格逆转',
      desc: '行动轮开始时，可选1名相邻敌人，使其修为-1（永久，最低为1）',
      type: 'battle',
      trigger: 'on_turn_start',
      params: { effect: 'debuff_target', stat: 'atk', value: -1, permanent: true, target: 'adjacent_enemy', min: 1 }
    },
    ultimate: {
      name: '天运·因果倒转',
      desc: '主动发动，选1名敌人，交换该敌人与相邻1名友军的当前气血值',
      type: 'battle',
      trigger: 'active_once',
      params: { effect: 'swap_hp', target1: 'any_enemy', target2: 'adjacent_ally' }
    }
  },
};

// 招募 SR（20张）：文件中 id 前缀为 sr_
const V6_SKILLS_SR = {
  sr_daimubai: {
    battle_skill: {
      name: '白虎金身',
      desc: '受到伤害时，伤害上限为2点（无论攻击伤害还是技能直接伤害）',
      type: 'battle',
      trigger: 'on_damage_calc',
      params: { effect: 'damage_cap', value: 2, scope: 'all_damage_types' }
    },
    ultimate: {
      name: '白虎裂光波',
      desc: '戴沐白退场时（主动/被动），对四个方向相邻的所有角色造成4点固定伤害',
      type: 'battle',
      trigger: 'on_self_leave',
      params: { effect: 'aoe_damage_on_death', value: 4, shape: 'cross_adjacent', damageType: 'skill_damage' }
    }
  },
  sr_ningrongrong: {
    battle_skill: {
      name: '七宝琉璃·加持',
      desc: '行动轮开始时，可指定1名己方角色某项数值（修为/心境/气血）永久+1（受常规上限约束）',
      type: 'battle',
      trigger: 'on_turn_start',
      params: { effect: 'buff_any_stat', value: 1, target: 'any_ally', permanent: true, canBreakCap: false }
    },
    ultimate: {
      name: '九宝琉璃·极光',
      desc: '主动发动，选1名友军，永久将其气血上限改为9点并回满（超过9的原上限保持不变）',
      type: 'battle',
      trigger: 'active_once',
      params: { effect: 'set_hp_cap', value: 9, onlyIfLower: true, restoreToFull: true, target: 'any_ally' }
    }
  },
  sr_qianrenxue: {
    battle_skill: {
      name: '天使之光',
      desc: '受到攻击时，可消耗2点心境值，将本次伤害降为1点',
      type: 'battle',
      trigger: 'on_damage_calc',
      params: { effect: 'reduce_damage_to_at_cost', value: 1, cost: { stat: 'mnd', value: 2 } }
    },
    ultimate: {
      name: '天使圣剑',
      desc: '主动发动，选择全场任意1名敌人进行攻击，本次攻击自身修为+4（不可超过修为上限）',
      type: 'battle',
      trigger: 'active_once',
      params: { effect: 'ranged_buffed_attack', range: 'unlimited', selfBuff: { stat: 'atk', value: 4 }, duration: 'this_attack' }
    }
  },
  sr_aoska: {
    battle_skill: {
      name: '大香肠',
      desc: '行动轮结束时，可指定1名友军，使其气血+2（不可超过气血上限）',
      type: 'battle',
      trigger: 'on_turn_end',
      params: { effect: 'heal', value: 2, target: 'any_ally', canBreakCap: false }
    },
    ultimate: {
      name: '镜像肠·复制',
      desc: '主动发动，选1名友军，本大回合剩余时间内，自身修为值变为该友军的修为值',
      type: 'battle',
      trigger: 'active_once',
      params: { effect: 'copy_stat', stat: 'atk', target: 'any_ally', duration: 'round_remain' }
    }
  },
  sr_mahongjun: {
    battle_skill: {
      name: '凤凰笑田鸡',
      desc: '进攻时，可扣除自身2点气血，本次对目标额外造成3点固定伤害',
      type: 'battle',
      trigger: 'on_after_hit',
      params: { effect: 'bonus_fixed_damage_at_cost', extra: 3, cost: { stat: 'hp', value: 2 }, damageType: 'skill_damage' }
    },
    ultimate: {
      name: '凤凰火雨',
      desc: '主动发动，对相邻所有敌人各进行1次攻击',
      type: 'battle',
      trigger: 'active_once',
      params: { effect: 'aoe_attack', shape: 'adjacent_all' }
    }
  },
  sr_nalanyanran: {
    battle_skill: {
      name: '风属斗技',
      desc: '进攻时，可将目标传送到自身相邻2格内任意位置（除阻挡地形外）',
      type: 'battle',
      trigger: 'on_after_hit',
      params: { effect: 'teleport_target', range: 2, position: 'near_self' }
    },
    ultimate: {
      name: '风暴裂斩',
      desc: '主动发动，对1名2格内的敌人进行攻击，本次攻击修为+2（不可超过修为上限）',
      type: 'battle',
      trigger: 'active_once',
      params: { effect: 'ranged_buffed_attack', range: 2, selfBuff: { stat: 'atk', value: 2 }, duration: 'this_attack' }
    }
  },
  sr_fengxian: {
    battle_skill: {
      name: '风卷残云',
      desc: '本行动轮若未造成任何伤害，则下一个行动轮心境值+2（不可超过心境上限）',
      type: 'battle',
      trigger: 'on_turn_end',
      params: { effect: 'conditional_buff_next_turn', condition: 'no_damage_this_turn', stat: 'mnd', value: 2, canBreakCap: false }
    },
    ultimate: {
      name: '天罡风暴',
      desc: '主动发动，将1名3格内的敌人强制拉到自身相邻格，并进行1次攻击',
      type: 'battle',
      trigger: 'active_once',
      params: { effect: 'pull_and_attack', range: 3 }
    }
  },
  sr_guhe: {
    battle_skill: {
      name: '炼药·聚元炉',
      desc: '行动轮开始时，可指定任意1名相邻友军，使其本行动轮进攻后可重投1次骰子，取较高的判定结果',
      type: 'battle',
      trigger: 'on_turn_start',
      params: { effect: 'grant_reroll', target: 'adjacent_ally', duration: 'this_turn' }
    },
    ultimate: {
      name: '丹师秘药·破境丹',
      desc: '主动发动，选1名友军，永久修为+3、气血+3（可突破上限）',
      type: 'battle',
      trigger: 'active_once',
      params: { effect: 'buff_target', stats: [{ stat: 'atk', value: 3 }, { stat: 'hp', value: 3 }], permanent: true, canBreakCap: true, target: 'any_ally' }
    }
  },
  sr_yafei: {
    battle_skill: {
      name: '迦南商会·补给',
      desc: '行动轮开始时，可指定1名友军和自己各+1点气血（不可超过气血上限）',
      type: 'battle',
      trigger: 'on_turn_start',
      params: { effect: 'heal_self_and_ally', value: 1, canBreakCap: false }
    },
    ultimate: {
      name: '迦南秘藏·全面支援',
      desc: '主动发动，治疗所有友军各2点气血（含自己，不可超过气血上限）',
      type: 'battle',
      trigger: 'active_once',
      params: { effect: 'heal_all_allies', value: 2, includeSelf: true, canBreakCap: false }
    }
  },
  sr_ziyan: {
    battle_skill: {
      name: '龙族暴怒',
      desc: '攻击妖修类敌人时，修为+2（不可超过修为上限）',
      type: 'battle',
      trigger: 'on_before_roll',
      params: { effect: 'extra_dice', value: 2, condition: 'onlyWhenAttacking', onlyVsType: '妖修', canBreakCap: false }
    },
    ultimate: {
      name: '龙凤变',
      desc: '紫妍退场时（主动/被动），对所在行与列的所有角色造成2点固定伤害',
      type: 'battle',
      trigger: 'on_self_leave',
      params: { effect: 'cross_line_damage', value: 2, damageType: 'skill_damage' }
    }
  },
  sr_lifeiyu: {
    battle_skill: {
      name: '疾风无影',
      desc: '与你交战的角色的普通技能（battle_skill）对你失效',
      type: 'battle',
      trigger: 'on_before_being_attacked',
      params: { effect: 'immune_to_enemy_passive', immuneCategory: 'battle_skill' }
    },
    ultimate: {
      name: '灵剑·诛仙',
      desc: '主动发动，对1名相邻敌人进行攻击，若目标当前气血≤3则直接退场',
      type: 'battle',
      trigger: 'active_once',
      params: { effect: 'execute_if_hp_below', threshold: 3, target: 'adjacent_enemy' }
    }
  },
  sr_hanyunzhi: {
    battle_skill: {
      name: '化形散',
      desc: '场上任意1个角色死亡时，自身修为永久+1（可突破修为上限）',
      type: 'battle',
      trigger: 'on_any_death',
      params: { effect: 'self_buff', stat: 'atk', value: 1, permanent: true, canBreakCap: true }
    },
    ultimate: {
      name: '化形·镜像',
      desc: '主动发动，选1名敌人，本大回合剩余时间内自身修为值变为该敌人的修为值',
      type: 'battle',
      trigger: 'active_once',
      params: { effect: 'copy_stat', stat: 'atk', target: 'any_enemy', duration: 'round_remain' }
    }
  },
  sr_mupeiling: {
    battle_skill: {
      name: '灵药妙手',
      desc: '行动轮结束时，恢复相邻1名气血最低的友军2点气血（不可超过气血上限）',
      type: 'battle',
      trigger: 'on_turn_end',
      params: { effect: 'heal_lowest_hp_ally', value: 2, target: 'adjacent_ally', canBreakCap: false }
    },
    ultimate: {
      name: '灵药·续命丹',
      desc: '主动发动，选1名已退场的友军，使其以3点气血重新入场（本场限1次，主角卡除外）',
      type: 'battle',
      trigger: 'active_once',
      params: { effect: 'revive_ally', hpAfter: 3, excludeHero: true, limitPerBattle: 1 }
    }
  },
  sr_yuanyao: {
    battle_skill: {
      name: '阴灵之力',
      desc: '进攻后，目标心境永久-1（最低为0）',
      type: 'battle',
      trigger: 'on_after_hit',
      params: { effect: 'debuff_target', stat: 'mnd', value: -1, permanent: true, min: 0 }
    },
    ultimate: {
      name: '阴灵蔽日',
      desc: '元瑶退场时（主动/被动），可指定夺取对方1名角色成为己方角色（主角卡除外，继承所有状态）',
      type: 'battle',
      trigger: 'on_self_leave',
      params: { effect: 'convert_enemy', excludeHero: true }
    }
  },
  sr_bingfeng: {
    battle_skill: {
      name: '冰凤寒啸',
      desc: '被攻击时，可将心境值和修为值相加来进行防守判定（投"心境+修为"颗骰子），若如此做则气血-1',
      type: 'battle',
      trigger: 'on_before_defend_roll',
      params: { effect: 'defensive_dice_merge', formula: 'mnd+atk', selfCost: { stat: 'hp', value: 1 } }
    },
    ultimate: {
      name: '冰封万里',
      desc: '主动发动，本大回合剩余时间内，场上所有敌人心境-2（最低为0）',
      type: 'battle',
      trigger: 'active_once',
      params: { effect: 'global_debuff', stat: 'mnd', value: -2, scope: 'all_enemies', duration: 'round_remain', min: 0 }
    }
  },
  sr_hongdie: {
    battle_skill: {
      name: '蝶舞红尘',
      desc: '红蝶退场时（主动/被动），可指定任一角色1个未使用的绝技作废（本场不可再使用）',
      type: 'battle',
      trigger: 'on_self_leave',
      params: { effect: 'invalidate_ultimate', target: 'any_character' }
    },
    ultimate: {
      name: '红蝶蛊惑',
      desc: '主动发动，选1名敌人，使其下一个行动轮强制依次攻击其相邻的己方友军（若无则跳过行动）',
      type: 'battle',
      trigger: 'active_once',
      params: { effect: 'force_attack_allies', duration: 'next_turn', target: 'any_enemy' }
    }
  },
  sr_liumei: {
    battle_skill: {
      name: '万欢情欲道',
      desc: '行动轮结束时，若旺林在场则旺林气血+2（不可超过气血上限）；否则相邻所有友军各+1',
      type: 'battle',
      trigger: 'on_turn_end',
      params: { effect: 'conditional_heal_bonded', condition: 'wanglin_alive', healTarget: 'hero_wanglin', healValue: 2, fallbackScope: 'adjacent_allies', fallbackValue: 1, canBreakCap: false }
    },
    ultimate: {
      name: '道破情牵',
      desc: '主动发动，柳眉退场，可指定1名已退场的友军回到手牌中（主角卡除外）',
      type: 'battle',
      trigger: 'on_self_sacrifice',
      params: { effect: 'return_to_hand', excludeHero: true, target: 'any_dead_ally' }
    }
  },
  sr_tenghuayuan: {
    battle_skill: {
      name: '天鬼搜身',
      desc: '行动轮开始时，可与任意1名角色交换位置',
      type: 'battle',
      trigger: 'on_turn_start',
      params: { effect: 'swap_position', target: 'any_character', range: 'unlimited' }
    },
    ultimate: {
      name: '黑泥潭·聚魂幡',
      desc: '藤化原退场时（主动/被动），可操纵最多3个角色各移动一次（按其心境值的距离）',
      type: 'battle',
      trigger: 'on_self_leave',
      params: { effect: 'force_move_multiple', count: 3, distanceFormula: 'target.mnd' }
    }
  },
  sr_yunquezi: {
    battle_skill: {
      name: '癫狂·窃元',
      desc: '行动轮开始时，可指定1名相邻敌人某项数值（修为/心境/气血）-1（永久，最低为1；气血最低为当前值-1不击杀）',
      type: 'battle',
      trigger: 'on_turn_start',
      params: { effect: 'debuff_any_stat', value: -1, target: 'adjacent_enemy', permanent: true, min: 1, noKill: true }
    },
    ultimate: {
      name: '仙遗二祖·万魂归一',
      desc: '主动发动，消耗自身3点气血，对1名敌人造成5点固定伤害',
      type: 'battle',
      trigger: 'active_once',
      params: { effect: 'sacrifice_fixed_damage', cost: { stat: 'hp', value: 3 }, value: 5, target: 'any_enemy', damageType: 'skill_damage' }
    }
  },
  sr_xuliguo: {
    battle_skill: {
      name: '剑魂·威慑',
      desc: '被攻击时，若攻击方修为值高于许立国修为值，则本次伤害减半（向下取整）',
      type: 'battle',
      trigger: 'on_damage_calc',
      params: { effect: 'conditional_damage_halve', condition: 'attacker_atk_higher', round: 'floor' }
    },
    ultimate: {
      name: '天罡元婴·重塑',
      desc: '第一次死亡时，原地复活，以总数值8点重新分配自身修为/心境/气血',
      type: 'battle',
      trigger: 'on_self_death',
      params: { effect: 'revive_and_redistribute', totalPoints: 8, limitPerBattle: 1 }
    }
  },
};

// 合并所有 V6 技能
const ALL_V6 = { ...V6_SKILLS, ...V6_SKILLS_SR };

// ========== 执行 ==========
function main() {
  const raw = fs.readFileSync(JSON_PATH, 'utf8');
  const data = JSON.parse(raw);

  let heroesUpdated = 0;
  let cardsUpdated = 0;
  const missingIds = [];

  // 更新 heroes
  for (const hero of data.heroes) {
    const v6 = ALL_V6[hero.id];
    if (!v6) {
      missingIds.push(`[hero] ${hero.id}`);
      continue;
    }
    if (v6.battle_skill) {
      hero.battle_card.skills.battle_skill = v6.battle_skill;
    }
    if (v6.ultimate) {
      hero.battle_card.skills.ultimate = v6.ultimate;
    }
    if (hero.awakening && v6.awakening_battle) {
      hero.awakening.skills.battle_skill = v6.awakening_battle;
    }
    if (hero.awakening && v6.awakening_ultimate) {
      hero.awakening.skills.ultimate = v6.awakening_ultimate;
    }
    heroesUpdated++;
  }

  // 更新池卡（bind_ssr / bind_sr / pool_ssr / pool_sr / ssr / sr 任意命名）
  // cards_all.json 里池卡可能在多个数组字段中，统一扫描
  const poolKeys = Object.keys(data).filter(k => Array.isArray(data[k]) && k !== 'heroes');
  for (const poolKey of poolKeys) {
    for (const card of data[poolKey]) {
      if (!card || typeof card !== 'object' || !card.id) continue;
      const v6 = ALL_V6[card.id];
      if (!v6) continue;

      // 找到技能所在对象
      let skillsContainer = null;
      if (card.battle_card && card.battle_card.skills) {
        skillsContainer = card.battle_card.skills;
      } else if (card.skills) {
        skillsContainer = card.skills;
      }
      if (!skillsContainer) continue;

      if (v6.battle_skill) {
        skillsContainer.battle_skill = v6.battle_skill;
      }
      if (v6.ultimate) {
        skillsContainer.ultimate = v6.ultimate;
      }
      cardsUpdated++;
    }
  }

  // 校验：V6 表中定义了但文件中没找到的
  const foundIds = new Set();
  data.heroes.forEach(h => foundIds.add(h.id));
  for (const poolKey of poolKeys) {
    data[poolKey].forEach(c => { if (c && c.id) foundIds.add(c.id); });
  }
  const unmatchedV6 = Object.keys(ALL_V6).filter(id => !foundIds.has(id));

  // 更新版本号 + 日期
  data.version = '8.0';
  data.date = new Date().toISOString().slice(0, 10);
  data.skill_system_version = 'v6_final';

  // 写回
  fs.writeFileSync(JSON_PATH, JSON.stringify(data, null, 2), 'utf8');

  console.log('✅ 技能批量更新完成');
  console.log(`  - 更新主角数：${heroesUpdated}/${data.heroes.length}`);
  console.log(`  - 更新池卡数：${cardsUpdated}`);
  console.log(`  - 扫描的池字段：${poolKeys.join(', ')}`);
  if (missingIds.length) {
    console.log(`  ⚠️  主角中未在V6表中定义的：`);
    missingIds.forEach(id => console.log(`     - ${id}`));
  }
  if (unmatchedV6.length) {
    console.log(`  ⚠️  V6表中定义但文件中未找到的 id：`);
    unmatchedV6.forEach(id => console.log(`     - ${id}`));
  }
}

main();

/**
 * 6主角静态数据 — V7 单一属性方案（与 cards_all.json 保持同步）
 *
 * 【2026-05 重构】移除"跑团属性 vs 战斗属性"双轨设计：
 *   主角只有一份属性，run_card.{hp,atk,mnd} === battle_card.{hp,atk,mnd}（数值统一）。
 *   保留 run_card / battle_card 字段名仅为兼容旧调用点，建议新代码统一从 utils/heroStats.ts
 *   的 getEffectiveHeroStats() 取值（自动叠加 cardBonuses + 拜师增益）。
 *
 * 技能类型字段说明（不变）：
 *   run_card.skills.run_skill       → 密谈技能（secret）
 *   battle_card.skills.run_skill    → 招募技能（recruit）
 *   battle_card.skills.battle_skill → 战斗技能（battle）
 *   battle_card.skills.ultimate     → 战斗绝技（battle）
 *   awakening.skills.battle_skill   → 觉醒战斗技能（awaken）
 *   awakening.skills.ultimate       → 觉醒战斗绝技（awaken）
 *
 * 术语规范（参见 GDD v3.3 §1）：
 *   - "攻击"：不使用"普攻"
 *   - "进攻时 / 进攻后"：不使用"攻击命中后"
 *   - "修为+N"：加骰子数量
 *   - "判定结果+N"：加差值（最终伤害）
 *   - "本大回合剩余时间内 / 下一个行动轮 / 本行动轮"：不使用"本回合"
 */
import type { Hero } from '@/types/game';

export const HEROES_DATA: Hero[] = [
  {
    id: 'hero_tangsan', name: '塘散', tribute: '塘散', rarity: '主角', ip: '斗罗大陆',
    type: '灵修', gender: '男', faction: 'A', realm: '筑基', realm_level: 2, max_realm: '结丹', max_realm_level: 3,
    s7aKillMock: 6,
    run_card: {
      hp: 6, atk: 5, mnd: 4,
      skills: {
        run_skill: { name: '紫瞳洞察', desc: '心境判定时心境额外+1', type: 'secret' },
        battle_skill: null,
      },
    },
    battle_card: {
      hp: 6, atk: 5, mnd: 4,
      skills: {
        run_skill: { name: '清心悟道', desc: '抽到卡牌后可选择放回卡池，并获得7灵石', type: 'recruit', category: 'return_for_gem', params: { reward: 7 } },
        battle_skill: { name: '蓝银囚笼', desc: '进攻时，目标的下一个行动轮无法移动', type: 'battle' },
        ultimate: { name: '暗器·万毒淬体', desc: '主动发动，对十字方向（上下左右各1格）所有敌人各进行1次攻击，被命中的目标修为永久-1（最低为1）', type: 'battle' },
      },
    },
    awakening: {
      name: '冥煞·塘散', trigger: '小舞儿退场',
      image: 'hero_tangsan_awaken',
      hp: 10, atk: 10, mnd: 3,
      skills: {
        battle_skill: { name: '修罗瞳·支配', desc: '所有判定结果+2（常驻）', type: 'awaken' },
        ultimate: { name: '修罗弑神击', desc: '主动发动，选1名敌人，无视距离，投修为×2颗骰子进行攻击', type: 'awaken' },
      },
    },
  },
  {
    id: 'hero_xiaowu', name: '小舞儿', tribute: '小舞儿', rarity: '主角', ip: '斗罗大陆',
    type: '妖修', gender: '女', faction: 'A', realm: '筑基', realm_level: 2, max_realm: '结丹', max_realm_level: 3,
    s7aKillMock: 5,
    run_card: {
      hp: 5, atk: 5, mnd: 6,
      skills: {
        run_skill: { name: '妖力感知', desc: '每次密谈时，强制获得与之密谈角色的一条未知线索', type: 'secret' },
        battle_skill: null,
      },
    },
    battle_card: {
      hp: 5, atk: 5, mnd: 6,
      skills: {
        run_skill: { name: '妖力共鸣', desc: '抽取2张卡牌，选1张获取', type: 'recruit', category: 'preview_2', params: { count: 2 } },
        battle_skill: { name: '无敌金身', desc: '被攻击时，将本次受到的伤害降为2点', type: 'battle' },
        ultimate: { name: '八段摔·断魂', desc: '小舞儿主动退场时，选1名相邻敌人，造成小舞儿当前已损失气血值的固定伤害', type: 'battle' },
      },
    },
    awakening: {
      name: '涅槃·小舞儿', trigger: '气血降至1',
      image: 'hero_xiaowu_awaken',
      hp: 5, atk: 5, mnd: 3,
      skills: {
        battle_skill: { name: '柔骨·缠魂', desc: '主动发动，可控制场上任意1名角色移动1格', type: 'awaken' },
        ultimate: { name: '十万年魂骨献祭', desc: '主动/被动退场时，塘散所有属性永久+5（可突破上限）', type: 'awaken' },
      },
    },
  },
  {
    id: 'hero_xiaoyan', name: '萧焱', tribute: '萧焱', rarity: '主角', ip: '斗破苍穹',
    type: '法修', gender: '男', faction: 'B', realm: '筑基', realm_level: 2, max_realm: '结丹', max_realm_level: 3,
    s7aKillMock: 6,
    run_card: {
      hp: 5, atk: 6, mnd: 4,
      skills: {
        run_skill: { name: '异火探知', desc: '在心境判定前，可投2次骰子，取高的值判定', type: 'secret' },
        battle_skill: null,
      },
    },
    battle_card: {
      hp: 5, atk: 6, mnd: 4,
      skills: {
        run_skill: { name: '焚决吞噬', desc: '每轮抽卡回合可额外消耗5灵石，多抽一张卡', type: 'recruit', category: 'extra_draw_paid', params: { extraCost: 5 } },
        battle_skill: { name: '焚决·噬焰', desc: '进攻时，吞噬目标1点修为（目标修为永久-1，最低为1；自身修为永久+1，可突破上限）', type: 'battle' },
        ultimate: { name: '佛怒火莲', desc: '主动发动，对相邻所有敌人各进行1次攻击', type: 'battle' },
      },
    },
    awakening: {
      name: '焚天·萧焱', trigger: '场上有3张+斗破角色',
      image: 'hero_xiaoyan_awaken',
      hp: 9, atk: 10, mnd: 3,
      skills: {
        battle_skill: { name: '帝炎·焚天', desc: '对自己所在纵列包含自己的全部角色，各造成2点固定伤害（每个行动轮开始时结算）', type: 'awaken' },
        ultimate: { name: '帝品火莲·毁灭', desc: '主动发动，对全场所有敌人造成自身修为值一半（向上取整）的固定伤害', type: 'awaken' },
      },
    },
  },
  {
    id: 'hero_xuner', name: '薰儿', tribute: '薰儿', rarity: '主角', ip: '斗破苍穹',
    type: '灵修', gender: '女', faction: 'B', realm: '筑基', realm_level: 2, max_realm: '结丹', max_realm_level: 3,
    s7aKillMock: 5,
    run_card: {
      hp: 5, atk: 5, mnd: 6,
      skills: {
        run_skill: { name: '古族血脉感应', desc: '密谈成功时，额外获得线索+1', type: 'secret' },
        battle_skill: null,
      },
    },
    battle_card: {
      hp: 5, atk: 5, mnd: 6,
      skills: {
        run_skill: { name: '金帝焚天诀', desc: '每次抽卡时灵石费用-2', type: 'recruit', category: 'cost_reduce', params: { reduce: 2 } },
        battle_skill: { name: '古族血脉·共鸣', desc: '行动轮结束时，相邻1格内所有友军和自己回复1点气血（不可超过气血上限）', type: 'battle' },
        ultimate: { name: '金帝天火阵', desc: '主动发动，本大回合剩余时间内，所有友军受到的伤害-3', type: 'battle' },
      },
    },
    awakening: {
      name: '斗帝血脉·薰儿', trigger: '顾元（绑定SSR）在场时气血降至3以下',
      image: 'hero_xuner_awaken',
      hp: 8, atk: 7, mnd: 5,
      skills: {
        battle_skill: { name: '斗帝血脉·庇护', desc: '己方角色被击杀时，薰儿可使其保留1点气血存活（每场限2次）', type: 'awaken' },
        ultimate: { name: '古族祖灵结界', desc: '主动发动，本大回合剩余时间内，所有友军受到的伤害全部转移给薰儿承受，且薰儿气血最低降至1', type: 'awaken' },
      },
    },
  },
  {
    id: 'hero_hanli', name: '寒立', tribute: '寒立', rarity: '主角', ip: '凡人修仙传',
    type: '剑修', gender: '男', faction: '摇摆', realm: '筑基', realm_level: 2, max_realm: '结丹', max_realm_level: 3,
    s7aKillMock: 5,
    run_card: {
      hp: 6, atk: 5, mnd: 5,
      skills: {
        run_skill: { name: '谨慎如凡', desc: '每次心境判定时，判定结果固定+1', type: 'secret' },
        battle_skill: null,
      },
    },
    battle_card: {
      hp: 6, atk: 5, mnd: 5,
      skills: {
        run_skill: { name: '灵药储备', desc: '主动跳过抽卡轮次时，获得3灵石', type: 'recruit', category: 'skip_reward', params: { reward: 3 } },
        battle_skill: { name: '青竹蜂云剑·七十二路', desc: '进攻时，可以用修为和心境总和颗骰子进行判定', type: 'battle' },
        ultimate: { name: '万剑归宗', desc: '主动发动，选1名同行或同列的敌人（无需相邻），投修为×2颗骰子进行攻击', type: 'battle' },
      },
    },
    awakening: {
      name: '剑虚·寒立', trigger: '累计击杀2名敌人',
      image: 'hero_hanli_awaken',
      hp: 9, atk: 9, mnd: 4,
      skills: {
        battle_skill: { name: '噬金虫群', desc: '进攻时造成的伤害×2（判定结果翻倍）', type: 'awaken' },
        ultimate: { name: '天罗万象·大衍决', desc: '主动发动，选1名敌人，直接造成等同于自身修为值的固定伤害', type: 'awaken' },
      },
    },
  },
  {
    id: 'hero_wanglin', name: '旺林', tribute: '旺林', rarity: '主角', ip: '仙逆',
    type: '法修', gender: '男', faction: '摇摆', realm: '筑基', realm_level: 2, max_realm: '结丹', max_realm_level: 3,
    s7aKillMock: 4,
    run_card: {
      hp: 5, atk: 6, mnd: 5,
      skills: {
        run_skill: { name: '逆天改命', desc: '心境判定失败时可消耗1灵石重投（每次判定限1次）', type: 'secret' },
        battle_skill: null,
      },
    },
    battle_card: {
      hp: 5, atk: 6, mnd: 5,
      skills: {
        run_skill: { name: '天运窃取', desc: '每轮抽卡回合可额外消耗3灵石，必定抽到该卡池中最高稀有度的卡牌', type: 'recruit', category: 'guarantee_highest', params: { extraCost: 3 } },
        battle_skill: { name: '邪灵诀·夺命', desc: '进攻时，吸取目标1点气血回复自身（可突破气血上限）', type: 'battle' },
        ultimate: { name: '逆·天地崩', desc: '主动发动，消耗自身一半气血（向上取整），对全场所有敌人造成等同于消耗气血值的固定伤害', type: 'battle' },
      },
    },
    awakening: {
      name: '仙尊·旺林', trigger: '司图楠（绑定SSR）退场',
      image: 'hero_wanglin_awaken',
      hp: 10, atk: 10, mnd: 4,
      skills: {
        battle_skill: { name: '逆天·万魂幡', desc: '击杀敌人后，本大回合可再行动1次', type: 'awaken' },
        ultimate: { name: '一念逆天', desc: '主动发动，选1名敌人，直接将其气血设为1', type: 'awaken' },
      },
    },
  },
];

import type { HeroId, CultivationType } from '@/types/game';
import { asset } from '@/utils/assetPath';

export interface HeroVisual {
  id: HeroId;
  name: string;
  portrait: string;
  type: CultivationType;
}

/** S1 / S2 顺序：寒立 / 塘散 / 小舞儿 / 萧焱 / 薰儿 / 旺林 */
export const HEROES_S1S2_ORDER: HeroVisual[] = [
  { id: 'hero_hanli',    name: '寒立',   portrait: asset('images/cards/hero_hanli.jpg'),    type: '剑修' },
  { id: 'hero_tangsan',  name: '塘散',   portrait: asset('images/cards/hero_tangsan.jpg'),  type: '灵修' },
  { id: 'hero_xiaowu',   name: '小舞儿', portrait: asset('images/cards/hero_xiaowu.jpg'),   type: '妖修' },
  { id: 'hero_xiaoyan',  name: '萧焱',   portrait: asset('images/cards/hero_xiaoyan.jpg'),  type: '法修' },
  { id: 'hero_xuner',    name: '薰儿',   portrait: asset('images/cards/hero_xuner.jpg'),    type: '灵修' },
  { id: 'hero_wanglin',  name: '旺林',   portrait: asset('images/cards/hero_wanglin.jpg'),  type: '法修' },
];

/** S3 顺序（按视觉稿）：旺林 / 寒立 / 小舞儿 / 塘散 / 萧焱 / 薰儿 */
export const HEROES_S3_ORDER: HeroId[] = [
  'hero_wanglin',
  'hero_hanli',
  'hero_xiaowu',
  'hero_tangsan',
  'hero_xiaoyan',
  'hero_xuner',
];

/** 类型 → CSS颜色值 */
export const TYPE_TOKEN: Record<CultivationType, string> = {
  剑修: 'var(--color-type-sword)',
  体修: 'var(--color-type-body)',
  妖修: 'var(--color-type-demon)',
  法修: 'var(--color-type-magic)',
  丹修: 'var(--color-type-pill)',
  灵修: 'var(--color-type-soul)',
};

/** 类型 → 首字 */
export const TYPE_CHAR: Record<CultivationType, string> = {
  剑修: '剑',
  体修: '体',
  妖修: '妖',
  法修: '法',
  丹修: '丹',
  灵修: '灵',
};

/** 人物一句话简介 — 来自cards_all.json + 角色设定 */
export const HERO_BIO: Record<HeroId, string> = {
  hero_tangsan: '塘家独子，紫极瞳术传人，身负寻父之责，控制与洞察的指挥者。',
  hero_xiaowu:  '十万年魂兽化形，柔骨身法天下无双，与塘散心有灵犀的守护者。',
  hero_xiaoyan: '异火在身，前期锋芒毕露后期以力破巧，一往无前的烈火先锋。',
  hero_xuner:   '古族血脉觉醒者，密谈高手，暗流涌动步步为营的幕后棋手。',
  hero_hanli:   '谨慎如凡，大智若愚，前期隐忍蓄力后期万剑归宗的潜行猎手。',
  hero_wanglin: '逆天改命，精于算计，灵石经营无人能出其右的算计大师。',
};



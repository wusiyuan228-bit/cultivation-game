/**
 * cardDisplayOrder 排序规则单元测试
 *
 * 使用 node --test 运行：
 *   node --test src/utils/__test__/cardDisplayOrder.test.mjs
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// 由于源文件是 TypeScript，我们在此处用等价纯 JS 复刻排序逻辑进行单元校验
// 保持与 cardDisplayOrder.ts 一致
const RARITY_WEIGHT = {
  主角: 100,
  SSR: 90,
  SR: 70,
  R: 50,
  N: 30,
};

function sortCardsForDisplay(cardIds, heroId, resolveCard) {
  const seen = new Set();
  const originalOrder = [];
  cardIds.forEach((id) => {
    if (!seen.has(id)) {
      seen.add(id);
      originalOrder.push({ id, origIdx: originalOrder.length });
    }
  });

  const scored = originalOrder.map(({ id, origIdx }) => {
    if (id === heroId) {
      return { id, isHero: 1, weight: 1000, origIdx };
    }
    const hero = resolveCard(id);
    const rarity = (hero?.rarity ?? 'N');
    return { id, isHero: 0, weight: RARITY_WEIGHT[rarity] ?? 0, origIdx };
  });

  scored.sort((a, b) => {
    if (a.isHero !== b.isHero) return b.isHero - a.isHero;
    if (a.weight !== b.weight) return b.weight - a.weight;
    return a.origIdx - b.origIdx;
  });

  return scored.map((s) => s.id);
}

// 测试夹具：一批混合卡池
const MOCK_CARDS = {
  hero_tangsan: { rarity: '主角' },
  hero_xiaoyan: { rarity: '主角' },
  hero_hanli: { rarity: '主角' },
  bssr_tanghao: { rarity: 'SSR' },
  bssr_yaochen: { rarity: 'SSR' },
  ssr_situnan: { rarity: 'SSR' },
  sr_erming: { rarity: 'SR' },
  sr_tangya: { rarity: 'SR' },
  r_qingshan: { rarity: 'R' },
  r_baiyun: { rarity: 'R' },
  n_mucao: { rarity: 'N' },
  n_yecao: { rarity: 'N' },
};
const resolve = (id) => MOCK_CARDS[id] ?? null;

describe('sortCardsForDisplay', () => {
  it('主角置顶', () => {
    const result = sortCardsForDisplay(
      ['n_mucao', 'sr_erming', 'hero_tangsan', 'r_qingshan'],
      'hero_tangsan',
      resolve,
    );
    assert.equal(result[0], 'hero_tangsan');
  });

  it('稀有度降序：SSR > SR > R > N', () => {
    const result = sortCardsForDisplay(
      ['n_mucao', 'sr_erming', 'r_qingshan', 'bssr_tanghao'],
      'hero_tangsan', // 主角不在卡组里
      resolve,
    );
    assert.deepEqual(result, ['bssr_tanghao', 'sr_erming', 'r_qingshan', 'n_mucao']);
  });

  it('主角 + SSR + SR + R + N 混合', () => {
    const result = sortCardsForDisplay(
      ['n_mucao', 'sr_erming', 'hero_tangsan', 'bssr_tanghao', 'r_qingshan'],
      'hero_tangsan',
      resolve,
    );
    assert.deepEqual(result, [
      'hero_tangsan',
      'bssr_tanghao',
      'sr_erming',
      'r_qingshan',
      'n_mucao',
    ]);
  });

  it('同稀有度内保持原始收集顺序', () => {
    const result = sortCardsForDisplay(
      ['n_yecao', 'n_mucao', 'r_baiyun', 'r_qingshan'],
      'hero_tangsan',
      resolve,
    );
    // R 先于 N，同级内按插入顺序
    assert.deepEqual(result, ['r_baiyun', 'r_qingshan', 'n_yecao', 'n_mucao']);
  });

  it('去重：重复 ID 只保留第一次出现', () => {
    const result = sortCardsForDisplay(
      ['sr_erming', 'sr_erming', 'r_qingshan'],
      null,
      resolve,
    );
    assert.deepEqual(result, ['sr_erming', 'r_qingshan']);
    assert.equal(result.length, 2);
  });

  it('空列表', () => {
    assert.deepEqual(sortCardsForDisplay([], null, resolve), []);
  });

  it('只有主角', () => {
    assert.deepEqual(
      sortCardsForDisplay(['hero_tangsan'], 'hero_tangsan', resolve),
      ['hero_tangsan'],
    );
  });

  it('主角 + 6 张其他卡（S7D 场景）', () => {
    // 模拟 S7D 测试入口：萧焱为主角，其他 5 位主角为SSR
    const ids = ['hero_xiaoyan', 'hero_tangsan', 'hero_xiaowu', 'hero_hanli', 'hero_wanglin', 'hero_xuner'];
    const heroData = {
      hero_xiaoyan: { rarity: '主角' },
      hero_tangsan: { rarity: '主角' },
      hero_xiaowu: { rarity: '主角' },
      hero_hanli: { rarity: '主角' },
      hero_wanglin: { rarity: '主角' },
      hero_xuner: { rarity: '主角' },
    };
    const result = sortCardsForDisplay(ids, 'hero_xiaoyan', (id) => heroData[id] ?? null);
    // 萧焱必须第一，其他按原始顺序（因为权重都是"主角"→ 100）
    assert.equal(result[0], 'hero_xiaoyan');
    assert.equal(result.length, 6);
  });

  it('主角 + SSR + SR + R + N（完整混合）', () => {
    const ids = ['n_mucao', 'r_qingshan', 'sr_erming', 'hero_tangsan', 'bssr_tanghao', 'ssr_situnan'];
    const result = sortCardsForDisplay(ids, 'hero_tangsan', resolve);
    assert.deepEqual(result, [
      'hero_tangsan',   // 主角
      'bssr_tanghao',   // SSR（先出现）
      'ssr_situnan',    // SSR
      'sr_erming',      // SR
      'r_qingshan',     // R
      'n_mucao',        // N
    ]);
  });

  it('未知稀有度卡（默认权重 0，排在最后）', () => {
    const unknownResolver = (id) => {
      if (id === 'unknown_card') return { rarity: 'XXX' };
      return resolve(id);
    };
    const result = sortCardsForDisplay(
      ['unknown_card', 'r_qingshan', 'n_mucao'],
      null,
      unknownResolver,
    );
    assert.deepEqual(result, ['r_qingshan', 'n_mucao', 'unknown_card']);
  });
});

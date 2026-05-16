/**
 * S7D · AI 决策（v3：目标导向）
 *
 * 设计原则：
 *   1. AI 在战场上必须有明确的战术目标，绝不允许"无所事事"
 *   2. 决策按优先级链路推进，每一层都给出可执行动作
 *   3. 如果有相邻敌人 → 必攻击；没有 → 必移动；移动后若打得到 → 接着攻击
 *   4. 真实距离用 BFS 可达计算（不假设直线），避开墙体/障碍/友军
 *
 * 战术目标优先级（高 → 低）：
 *   T1. 击杀必胜目标：相邻敌人中可一击击杀的（hp ≤ 我 atk 中位估算）
 *   T2. 击杀敌方主角：相邻敌方 hero
 *   T3. 占领敌方水晶：当前已可站上敌晶 / 或本回合可达敌晶格
 *   T4. 阻击我方水晶：有敌人正站我方水晶 → 返回阻击
 *   T5. 击杀低血敌人：向最近的"血量低于平均值"敌人靠拢
 *   T6. 攻击敌方主角：向最近敌方 hero 靠拢
 *   T7. 推进压制：向敌方水晶中心靠拢
 *   T8. 兜底游走：向最近敌人靠拢一格（保证不静止）
 *
 * 攻击选择：
 *   A1. 能一击击杀 → 选 hp 最低且能杀的
 *   A2. 否则选 hero（敌方主角）
 *   A3. 否则选 atk 最高的（最大威胁）
 *   A4. 都没特殊 → hp 最低的（蚕食输出）
 */

import type {
  BattleCardInstance,
  BattleFaction,
  GridPos,
  S7DBattleState,
} from '@/types/s7dBattle';
import {
  getAttackableEnemies,
  manhattan,
} from './s7dBattleCombat';
import {
  getReachableCells,
  getFactionFieldUnits,
} from './s7dBattleQueries';
import { SkillRegistry } from '@/systems/battle/skillRegistry';
import { isHeroUnitId } from '@/systems/battle/skills/_heroIdHelper';

/**
 * AI 行动决策结果
 *
 * 注：规则 v2 后水晶不可主动攻击；保留 attack_crystal 仅类型兼容，实际不再返回。
 *
 * 2026-05-17：新增 cast_ultimate —— 友方/敌方 AI 释放绝技。
 *   - targetIds：绝技目标列表（无目标 selector 时为空数组）
 *   - pickedPosition：position_pick 类绝技（如萧族护盾）落点
 *   - 释放后不结束行动，外层 AI 循环会继续走移动+普攻流程
 */
export type AiAction =
  | { kind: 'attack_unit'; targetInstanceId: string }
  | { kind: 'attack_crystal'; targetFaction: BattleFaction }
  | { kind: 'move_then_maybe_attack'; to: GridPos; steps: number }
  | { kind: 'cast_ultimate'; targetIds: string[]; pickedPosition?: GridPos; reason: string }
  | { kind: 'pass' };

// =============================================================================
// 主入口
// =============================================================================

export function decideAiAction(
  state: S7DBattleState,
  actorInstanceId: string,
): AiAction {
  const actor = state.units[actorInstanceId];
  if (!actor || actor.hp <= 0 || actor.zone !== 'field' || !actor.position) {
    return { kind: 'pass' };
  }

  const allUnits = Object.values(state.units);
  const enemyFaction: BattleFaction = actor.faction === 'A' ? 'B' : 'A';
  const allyFaction: BattleFaction = actor.faction;

  // ===== 阶段 0：评估绝技（2026-05-17 新增）=====
  // 与 S7B AI 一致——若当前局面满足绝技收益阈值，先返回 cast_ultimate；
  // 外层 AI 循环执行完绝技后会继续 decideAiAction 进入阶段 1/2 走攻击/移动。
  // 释放过的绝技 (ultimateUsed=true) 自动不会再评估。
  if (!actor.ultimateUsed && actor.ultimate) {
    const evalUlt = evaluateUltimate(actor, state);
    if (evalUlt.shouldCast) {
      return {
        kind: 'cast_ultimate',
        targetIds: evalUlt.targetIds,
        pickedPosition: evalUlt.pickedPosition,
        reason: evalUlt.reason,
      };
    }
  }

  // ===== 阶段 1：能攻击就攻击 =====
  if (!actor.attackedThisTurn) {
    const attackable = getAttackableEnemies(actor, allUnits);
    if (attackable.length > 0) {
      const target = pickBestAttackTarget(actor, attackable);
      return { kind: 'attack_unit', targetInstanceId: target.instanceId };
    }
  }

  // ===== 阶段 2：移动决策 =====
  if (!actor.immobilized && actor.stepsUsedThisTurn < actor.mnd) {
    const reachable = getReachableCells(state, actorInstanceId);
    if (reachable.length > 0) {
      const moveAction = pickBestMove(state, actor, reachable, enemyFaction, allyFaction);
      if (moveAction) return moveAction;
    }
  }

  // ===== 阶段 3：兜底（无可移动 / 已耗尽）=====
  // 只有"完全动不了 + 完全打不到任何东西"时才 pass
  return { kind: 'pass' };
}

// =============================================================================
// 攻击目标选择
// =============================================================================

function pickBestAttackTarget(
  actor: BattleCardInstance,
  attackable: BattleCardInstance[],
): BattleCardInstance {
  // 估算攻击伤害的乐观值：atk 即修为骰数，骰子期望值约 atk * 0.7（每个 d2 期望 1.5），
  // 但 AI 决策保守取 atk 本身（非常保守，确保"标记可秒杀"时确实有概率秒杀）
  const myAtkApprox = actor.atk;

  // A1: 能一击秒杀的（按 hp 升序选）
  const killable = attackable
    .filter((u) => u.hp <= myAtkApprox)
    .sort((a, b) => a.hp - b.hp);
  if (killable.length > 0) {
    // 优先杀主角，再按 hp 升序
    const heroKill = killable.find((u) => isHeroUnit(u));
    return heroKill ?? killable[0];
  }

  // A2: 主角优先
  const hero = attackable.find((u) => isHeroUnit(u));
  if (hero) return hero;

  // A3: atk 最高（威胁最大）
  const sortedByAtk = [...attackable].sort((a, b) => b.atk - a.atk);
  if (sortedByAtk[0].atk >= sortedByAtk[sortedByAtk.length - 1].atk + 2) {
    return sortedByAtk[0];
  }

  // A4: hp 最低（最易蚕食）
  return attackable.reduce((lo, u) => (u.hp < lo.hp ? u : lo), attackable[0]);
}

function isHeroUnit(u: BattleCardInstance): boolean {
  return u.isHero === true;
}

// =============================================================================
// 移动目标决策
// =============================================================================

function pickBestMove(
  state: S7DBattleState,
  actor: BattleCardInstance,
  reachable: GridPos[],
  enemyFaction: BattleFaction,
  allyFaction: BattleFaction,
): AiAction | null {
  const enemies = getFactionFieldUnits(state, enemyFaction);
  const allies = getFactionFieldUnits(state, allyFaction);
  const enemyCrystal = enemyFaction === 'A' ? state.crystalA : state.crystalB;
  const myCrystal = allyFaction === 'A' ? state.crystalA : state.crystalB;
  const myAtkApprox = actor.atk;

  // 每个可达格预先计算"邻居敌人"信息（用于"移动后可攻击"价值评估）
  const reachableInfo = reachable.map((cell) => {
    const adjEnemies = enemies.filter((e) => e.position && manhattanGrid(cell, e.position) === 1);
    return { cell, adjEnemies };
  });

  // -------------- T1：移动后能一击秒杀 --------------
  const killOpportunities: Array<{ cell: GridPos; victim: BattleCardInstance; score: number }> = [];
  for (const { cell, adjEnemies } of reachableInfo) {
    for (const e of adjEnemies) {
      if (e.hp <= myAtkApprox) {
        // 击杀价值 = (是否主角 ? 100 : 50) + (atk * 5) - 距敌方水晶距离（越靠前越优）
        const score =
          (isHeroUnit(e) ? 100 : 50) +
          e.atk * 5 +
          -minDistToCrystal(cell, enemyCrystal.positions);
        killOpportunities.push({ cell, victim: e, score });
      }
    }
  }
  if (killOpportunities.length > 0) {
    killOpportunities.sort((a, b) => b.score - a.score);
    const best = killOpportunities[0];
    return makeMoveAction(actor, best.cell);
  }

  // -------------- T3：占领敌方水晶（最高战略目标）--------------
  const enemyCrystalSet = new Set(enemyCrystal.positions.map((p) => `${p.row},${p.col}`));
  const reachableEnemyCrystalCells = reachable.filter((c) => enemyCrystalSet.has(`${c.row},${c.col}`));
  if (reachableEnemyCrystalCells.length > 0) {
    // 直接站上敌晶 → 大回合末扣对方水晶血
    const target = pickClosest(actor.position!, reachableEnemyCrystalCells);
    return makeMoveAction(actor, target);
  }

  // -------------- T4：阻击我方水晶被占 --------------
  const myCrystalSet = new Set(myCrystal.positions.map((p) => `${p.row},${p.col}`));
  const enemyOnMyCrystal = enemies.filter(
    (e) => e.position && myCrystalSet.has(`${e.position.row},${e.position.col}`),
  );
  if (enemyOnMyCrystal.length > 0) {
    // 选离敌人最近的可达格（争取下回合相邻攻击）
    const target = enemyOnMyCrystal.reduce((b, e) =>
      e.position && actor.position && manhattan(actor.position, e.position) < manhattan(actor.position, b.position!)
        ? e
        : b,
    );
    if (target.position) {
      const cell = pickClosestToTarget(reachable, target.position);
      if (cell) {
        // 仅当此移动确实能拉近距离 / 已在原地相邻则跳过（已被阶段 1 覆盖）
        const before = manhattan(actor.position!, target.position);
        const after = manhattan(cell, target.position);
        if (after < before) return makeMoveAction(actor, cell);
      }
    }
  }

  // -------------- T2：移动后可攻击主角 --------------
  const reachAdjHero = reachableInfo.find(({ adjEnemies }) =>
    adjEnemies.some((e) => isHeroUnit(e)),
  );
  if (reachAdjHero) {
    return makeMoveAction(actor, reachAdjHero.cell);
  }

  // -------------- T5：移动后能攻击任何敌人 --------------
  const reachAdjEnemy = reachableInfo
    .filter(({ adjEnemies }) => adjEnemies.length > 0)
    .sort((a, b) => {
      // 选择"能攻击的目标价值最大"的格子
      const aVal = a.adjEnemies.reduce(
        (s, e) => s + (isHeroUnit(e) ? 50 : 0) + (e.hp <= myAtkApprox ? 30 : 0) + e.atk,
        0,
      );
      const bVal = b.adjEnemies.reduce(
        (s, e) => s + (isHeroUnit(e) ? 50 : 0) + (e.hp <= myAtkApprox ? 30 : 0) + e.atk,
        0,
      );
      return bVal - aVal;
    });
  if (reachAdjEnemy.length > 0) {
    return makeMoveAction(actor, reachAdjEnemy[0].cell);
  }

  // -------------- T7：向敌方水晶中心推进 --------------
  // 选可达格中"距敌方水晶最近"的格子，比当前位置更近就走
  const enemyCenter = averagePos(enemyCrystal.positions);
  const curDistToEnemyCrystal = manhattan(actor.position!, enemyCenter);
  let bestCrystalCell: GridPos = reachable[0];
  let bestCrystalDist = manhattan(reachable[0], enemyCenter);
  for (const c of reachable) {
    const d = manhattan(c, enemyCenter);
    if (d < bestCrystalDist) {
      bestCrystalDist = d;
      bestCrystalCell = c;
    }
  }
  if (bestCrystalDist < curDistToEnemyCrystal) {
    return makeMoveAction(actor, bestCrystalCell);
  }

  // -------------- T6：向最近敌方主角靠拢 --------------
  const enemyHeroes = enemies.filter((e) => isHeroUnit(e));
  if (enemyHeroes.length > 0) {
    const nearestHero = enemyHeroes.reduce((b, e) =>
      e.position && actor.position && manhattan(actor.position, e.position) < manhattan(actor.position, b.position!)
        ? e
        : b,
    );
    if (nearestHero.position) {
      const cell = pickClosestToTarget(reachable, nearestHero.position);
      if (cell) {
        const before = manhattan(actor.position!, nearestHero.position);
        const after = manhattan(cell, nearestHero.position);
        if (after < before) return makeMoveAction(actor, cell);
      }
    }
  }

  // -------------- T8：向最近敌人靠拢（兜底）--------------
  if (enemies.length > 0) {
    const nearest = enemies.reduce((b, e) =>
      e.position && actor.position && manhattan(actor.position, e.position) < manhattan(actor.position, b.position!)
        ? e
        : b,
    );
    if (nearest.position) {
      const cell = pickClosestToTarget(reachable, nearest.position);
      if (cell) {
        const before = manhattan(actor.position!, nearest.position);
        const after = manhattan(cell, nearest.position);
        if (after < before) {
          return makeMoveAction(actor, cell);
        }
        // 即便距离没缩短，只要可达格中有"距离持平"的，就侧移一格保持机动
        // 避免在墙后或被友军挡住时彻底卡死
        const flatCell = reachable.find((c) => manhattan(c, nearest.position!) === before);
        if (flatCell && (flatCell.row !== actor.position!.row || flatCell.col !== actor.position!.col)) {
          // 选距敌方水晶更近的方向
          const candidates = reachable.filter((c) => manhattan(c, nearest.position!) === before);
          const pushed = candidates.reduce(
            (b, c) => (manhattan(c, enemyCenter) < manhattan(b, enemyCenter) ? c : b),
            candidates[0],
          );
          return makeMoveAction(actor, pushed);
        }
      }
    }
  }

  // -------------- 防御站位：与友军靠拢避免被各个击破 --------------
  if (allies.length > 1) {
    const otherAllies = allies.filter((a) => a.instanceId !== actor.instanceId);
    if (otherAllies.length > 0) {
      const nearestAlly = otherAllies.reduce((b, a) =>
        a.position && actor.position && manhattan(actor.position, a.position) < manhattan(actor.position, b.position!)
          ? a
          : b,
      );
      if (nearestAlly.position) {
        const cell = pickClosestToTarget(reachable, nearestAlly.position);
        if (cell) {
          const before = manhattan(actor.position!, nearestAlly.position);
          const after = manhattan(cell, nearestAlly.position);
          if (after < before && after >= 1) {
            // 不要叠到队友身上（>=1）
            return makeMoveAction(actor, cell);
          }
        }
      }
    }
  }

  // -------------- 兜底：随便往前走一格（朝敌晶方向）--------------
  // 走任何能稍稍前移的格子；如果可达格全部"远离敌晶"，至少不让 AI 卡住
  // 避免出现"明明能动却 pass"的体验
  if (reachable.length > 0) {
    // 选"距敌方水晶最近"的可达格（即使没缩短距离也最差不过原地横移）
    const fallback = reachable.reduce(
      (b, c) => (manhattan(c, enemyCenter) < manhattan(b, enemyCenter) ? c : b),
      reachable[0],
    );
    // 仅当该格不是当前位置时才移动
    if (fallback.row !== actor.position!.row || fallback.col !== actor.position!.col) {
      return makeMoveAction(actor, fallback);
    }
  }

  return null;
}

// =============================================================================
// 工具
// =============================================================================

function makeMoveAction(actor: BattleCardInstance, to: GridPos): AiAction {
  const steps = Math.min(
    actor.mnd - actor.stepsUsedThisTurn,
    Math.max(1, manhattan(actor.position!, to)),
  );
  return { kind: 'move_then_maybe_attack', to, steps };
}

function manhattanGrid(a: GridPos, b: GridPos): number {
  return Math.abs(a.row - b.row) + Math.abs(a.col - b.col);
}

function pickClosest(from: GridPos, candidates: GridPos[]): GridPos {
  return candidates.reduce(
    (b, c) => (manhattan(from, c) < manhattan(from, b) ? c : b),
    candidates[0],
  );
}

function pickClosestToTarget(candidates: GridPos[], target: GridPos): GridPos | null {
  if (candidates.length === 0) return null;
  return candidates.reduce(
    (b, c) => (manhattan(c, target) < manhattan(b, target) ? c : b),
    candidates[0],
  );
}

function minDistToCrystal(from: GridPos, crystalCells: GridPos[]): number {
  if (crystalCells.length === 0) return 0;
  let m = Infinity;
  for (const c of crystalCells) {
    const d = manhattan(from, c);
    if (d < m) m = d;
  }
  return m;
}

function averagePos(positions: GridPos[]): GridPos {
  if (positions.length === 0) return { row: 0, col: 0 };
  let r = 0;
  let c = 0;
  for (const p of positions) {
    r += p.row;
    c += p.col;
  }
  return { row: Math.round(r / positions.length), col: Math.round(c / positions.length) };
}

// =============================================================================
// 绝技评估（2026-05-17 新增）
// =============================================================================

/**
 * 评估当前 actor 是否值得释放绝技。
 *
 * 设计参照 S7B AI 的 evaluateUltimate（src/utils/s7bAI.ts），按 targetSelector.kind
 * 分发不同的收益阈值判断。S7D 与 S7B 的核心差异：
 *   - S7B 用 row/col + isEnemy；S7D 用 position{row,col} + faction
 *   - S7B 用 maxHp；S7D 用 hpMax
 *   - S7D 同一阵营内除了 actor 外都是 ally（含友方 AI 玩家），与 S7B 1v1 对应
 *
 * 返回：
 *   shouldCast=false → 不放（reason 仅供调试日志）
 *   shouldCast=true  → 放，targetIds 即 useUltimate 入参；
 *                       position_pick 类技能附 pickedPosition
 */
function evaluateUltimate(
  self: BattleCardInstance,
  state: S7DBattleState,
): {
  shouldCast: boolean;
  targetIds: string[];
  pickedPosition?: GridPos;
  reason: string;
} {
  if (!self.ultimate || self.ultimateUsed) {
    return { shouldCast: false, targetIds: [], reason: '已使用或无绝技' };
  }
  if (!self.position) {
    return { shouldCast: false, targetIds: [], reason: '不在场' };
  }

  const regId = SkillRegistry.findIdByName(self.ultimate.name);
  const reg = regId ? SkillRegistry.get(regId) : undefined;
  if (!reg || !reg.isActive) {
    // 被动技 / 未实装 → AI 不主动放
    return { shouldCast: false, targetIds: [], reason: '未登记或被动' };
  }

  const kind = reg.targetSelector?.kind;
  const enemyFaction: BattleFaction = self.faction === 'A' ? 'B' : 'A';
  const allFieldUnits = Object.values(state.units).filter(
    (u) => u.zone === 'field' && u.hp > 0 && u.position,
  );
  const enemies = allFieldUnits.filter((u) => u.faction === enemyFaction);
  const allies = allFieldUnits.filter(
    (u) => u.faction === self.faction && u.instanceId !== self.instanceId,
  );

  // ==== ① 单体固伤 ====
  // single_any_enemy / single_line_enemy / single_adjacent_enemy
  if (
    kind === 'single_any_enemy' ||
    kind === 'single_line_enemy' ||
    kind === 'single_adjacent_enemy'
  ) {
    if (enemies.length === 0) return { shouldCast: false, targetIds: [], reason: '无敌方' };
    let cands = enemies;
    if (kind === 'single_line_enemy') {
      cands = enemies.filter(
        (e) => e.position!.row === self.position!.row || e.position!.col === self.position!.col,
      );
    } else if (kind === 'single_adjacent_enemy') {
      cands = enemies.filter((e) => manhattan(self.position!, e.position!) === 1);
    }
    if (cands.length === 0) return { shouldCast: false, targetIds: [], reason: '无合法目标' };

    // 估算伤害（沿用 S7B 经验值）
    let dmg: number;
    if (regId === 'hero_wanglin.awaken.ultimate') {
      // 一念逆天：直接将 hp 设为 1
      dmg = Math.max(0, Math.max(...cands.map((c) => c.hp - 1)));
    } else if (regId === 'hero_xiaowu.ultimate') {
      // 八段摔·断魂：自爆型，扣量 = 已损血量
      dmg = self.hpMax - self.hp;
      const canKillAny = cands.some((c) => dmg >= c.hp);
      if (dmg < 3 && !canKillAny) {
        return { shouldCast: false, targetIds: [], reason: `自爆收益不足(已损${dmg})` };
      }
    } else {
      dmg = self.atk;
    }

    const sortedCands = [...cands].sort((a, b) => {
      const aLethal = dmg >= a.hp ? 1 : 0;
      const bLethal = dmg >= b.hp ? 1 : 0;
      if (aLethal !== bLethal) return bLethal - aLethal;
      if (a.atk !== b.atk) return b.atk - a.atk;
      return b.hp - a.hp;
    });
    const best = sortedCands[0];
    const canKill = dmg >= best.hp;
    const halfHp = best.hpMax * 0.5;
    if (canKill || dmg >= halfHp) {
      return {
        shouldCast: true,
        targetIds: [best.instanceId],
        reason: canKill ? `能击杀 ${best.name}` : `预估伤害${dmg}≥半血`,
      };
    }
    return { shouldCast: false, targetIds: [], reason: '收益不足' };
  }

  // ==== ② 全敌 AOE ====
  if (kind === 'all_enemies') {
    if (enemies.length === 0) return { shouldCast: false, targetIds: [], reason: '无敌方' };
    const dmg =
      regId === 'hero_xiaoyan.awaken.ultimate'
        ? Math.ceil(self.atk / 2)
        : regId === 'hero_wanglin.ultimate'
          ? self.atk
          : Math.ceil(self.atk / 2);
    const hits = enemies.length;
    const kills = enemies.filter((e) => dmg >= e.hp).length;
    if (kills >= 1 || hits >= 2) {
      return { shouldCast: true, targetIds: [], reason: `全敌AOE 命中${hits}击杀${kills}` };
    }
    return { shouldCast: false, targetIds: [], reason: 'AOE收益不足' };
  }

  // ==== ③ 相邻 AOE ====
  if (kind === 'all_adjacent_enemies' || kind === 'cross_adjacent_enemies') {
    const adjEnemies = enemies.filter((e) => manhattan(self.position!, e.position!) === 1);
    if (adjEnemies.length >= 2) {
      return {
        shouldCast: true,
        targetIds: [],
        reason: `相邻AOE命中${adjEnemies.length}`,
      };
    }
    if (adjEnemies.length === 1 && self.atk >= adjEnemies[0].hp) {
      return { shouldCast: true, targetIds: [], reason: '相邻AOE斩杀单敌' };
    }
    return { shouldCast: false, targetIds: [], reason: '相邻AOE目标不足' };
  }

  // ==== ④ 全友增益 ====
  if (kind === 'all_allies_incl_self') {
    const pool = [self, ...allies];
    const woundRatio = Math.min(...pool.map((u) => u.hp / Math.max(1, u.hpMax)));
    if (woundRatio <= 0.4) {
      return { shouldCast: true, targetIds: [], reason: '友方有人血量≤40%' };
    }
    return { shouldCast: false, targetIds: [], reason: '友方血量充足' };
  }

  // ==== ④' 单友（增益/复活/镜像）====
  if (kind === 'single_any_ally') {
    // 复活类（沐佩玲/留眉）：候选是已退场（grave）非主角友军
    if (regId === 'sr_mupeiling.ultimate' || regId === 'sr_liumei.ultimate') {
      const deads = Object.values(state.units).filter(
        (u) =>
          u.zone === 'grave' &&
          u.faction === self.faction &&
          !u.isHero,
      );
      if (deads.length === 0) {
        return { shouldCast: false, targetIds: [], reason: '无可复活友军' };
      }
      return {
        shouldCast: true,
        targetIds: [deads[0].instanceId],
        reason: `复活${deads[0].name}`,
      };
    }
    const liveAllies = [self, ...allies];
    if (regId === 'sr_aoska.ultimate') {
      const best = [...liveAllies].sort((a, b) => b.atk - a.atk)[0];
      if (best.atk > self.atk) {
        return {
          shouldCast: true,
          targetIds: [best.instanceId],
          reason: `镜像${best.name}atk=${best.atk}`,
        };
      }
      return { shouldCast: false, targetIds: [], reason: '无更高atk友军' };
    }
    // 增益类（凝蓉蓉极光/谷鹤破境丹/天逆珠·修炼等）：选 hp 最低存活友军
    const lowHp = [...liveAllies].sort(
      (a, b) => a.hp / Math.max(1, a.hpMax) - b.hp / Math.max(1, b.hpMax),
    )[0];
    return {
      shouldCast: true,
      targetIds: [lowHp.instanceId],
      reason: `选友军${lowHp.name}(${lowHp.hp}/${lowHp.hpMax})`,
    };
  }

  // ==== ⑤ 任意角色（柔骨·缠魂等自爆型）====
  if (kind === 'single_any_character') {
    if (enemies.length === 0) return { shouldCast: false, targetIds: [], reason: '无敌方' };
    const highestAtk = [...enemies].sort((a, b) => b.atk - a.atk)[0];
    return {
      shouldCast: true,
      targetIds: [highestAtk.instanceId],
      reason: `锁定威胁最高敌${highestAtk.name}`,
    };
  }

  // ==== ⑥ 位置选（萧族护盾等）====
  if (kind === 'position_pick') {
    if (enemies.length === 0) return { shouldCast: false, targetIds: [], reason: '无敌方' };
    const nearest = [...enemies].sort(
      (a, b) => manhattan(self.position!, a.position!) - manhattan(self.position!, b.position!),
    )[0];
    const dist = manhattan(self.position!, nearest.position!);
    if (dist > 3) {
      return { shouldCast: false, targetIds: [], reason: '敌人距离远暂不布盾' };
    }
    // 在自己与最近敌人连线中点附近找一个空格
    const mr = Math.round((self.position!.row + nearest.position!.row) / 2);
    const mc = Math.round((self.position!.col + nearest.position!.col) / 2);
    const candidates: GridPos[] = [
      { row: mr, col: mc },
      { row: mr + 1, col: mc },
      { row: mr - 1, col: mc },
      { row: mr, col: mc + 1 },
      { row: mr, col: mc - 1 },
    ];
    const occupiedKeys = new Set(
      allFieldUnits
        .filter((u) => u.position)
        .map((u) => `${u.position!.row},${u.position!.col}`),
    );
    for (const p of candidates) {
      // 简单边界判断（地图通常 8x8 ~ 12x12，越界就跳过）
      if (p.row < 0 || p.col < 0) continue;
      if (occupiedKeys.has(`${p.row},${p.col}`)) continue;
      return {
        shouldCast: true,
        targetIds: [],
        pickedPosition: p,
        reason: `布盾阻挡${nearest.name}`,
      };
    }
    return { shouldCast: false, targetIds: [], reason: '布盾无空格' };
  }

  // 其他 selector / 'none' / 'auto_self' 等无目标型：直接放
  if (kind === 'none' || kind === 'auto_self' || !kind) {
    return { shouldCast: true, targetIds: [], reason: `无目标型(${kind ?? 'unknown'})` };
  }

  return { shouldCast: false, targetIds: [], reason: `未覆盖selector:${kind}` };
}

// 防 isHeroUnitId 未使用警告（保留 import 一致性，跨文件方便日后扩展）
void isHeroUnitId;

/**
 * S7B AI 决策引擎 — 档位② 规则式 AI（阶段 D 升级）
 *
 * 设计原则：
 *   1. 每个 AI 单位独立决策，顺序推进
 *   2. 决策流程：
 *      a) 【D3 新】评估主动绝技是否"收益 ≥ 阈值"，是则优先放绝技并结束行动
 *      b) 计算所有可达攻击位置（BFS + 曼哈顿 1 格攻击）
 *      c) 评估每个候选：先判"能否击杀" > "克制加伤" > "期望伤害"
 *      d) 若无可攻击位置：向最近敌人推进
 *   3. 战斗附加技能：若持有 MVP 三技能之一且当前有攻击目标，优先释放（仅一次/回合）
 *
 * 档位②绝技收益阈值（由低到高）：
 *   · 单体固伤绝技（大衍决 / 一念逆天）→ 能击杀任一敌方 / 预估伤害 ≥ 50% 目标最大 hp
 *   · AOE 绝技（帝品火莲·毁灭 / 佛怒火莲 / 天帝仙决 / 万毒淬体）→ 命中数 ≥ 2 或 能击杀任一
 *   · 治疗/增益绝技（古族祖灵结界 / 薰神天火）→ 我方有任意单位 hp 比率 ≤ 40%
 *   · 特殊绝技（逆天·万魂幡 被动；柔骨缠魂 自 hp ≤ 2）→ 按专用条件
 */
import { useS7BBattleStore, isCounter, MAP_ROWS, MAP_COLS } from '@/stores/s7bBattleStore';
import type { BattleUnit } from '@/stores/s7bBattleStore';
import { SkillRegistry } from '@/systems/battle/skillRegistry';

function manhattan(r1: number, c1: number, r2: number, c2: number): number {
  return Math.abs(r1 - r2) + Math.abs(c1 - c2);
}

/** BFS 计算 AI 可达格集合（考虑障碍物和其他单位占位） */
function computeReachable(
  unit: BattleUnit,
  map: Array<Array<{ terrain: string }>>,
  units: BattleUnit[],
): Array<{ row: number; col: number; steps: number }> {
  const remainingSteps = Math.max(0, unit.mnd - unit.stepsUsedThisTurn);
  if (remainingSteps <= 0 || unit.immobilized) return [];

  const result: Array<{ row: number; col: number; steps: number }> = [];
  const visited = new Set<string>();
  const queue: Array<{ row: number; col: number; steps: number }> = [];
  const key = (r: number, c: number) => `${r},${c}`;
  const DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]];

  visited.add(key(unit.row, unit.col));
  queue.push({ row: unit.row, col: unit.col, steps: 0 });

  while (queue.length > 0) {
    const cur = queue.shift()!;
    if (cur.steps >= remainingSteps) continue;
    for (const [dr, dc] of DIRS) {
      const nr = cur.row + dr;
      const nc = cur.col + dc;
      if (nr < 0 || nr >= MAP_ROWS || nc < 0 || nc >= MAP_COLS) continue;
      const k = key(nr, nc);
      if (visited.has(k)) continue;
      visited.add(k);
      if (map[nr][nc].terrain === 'obstacle') continue;
      if (units.some((u) => !u.dead && u.id !== unit.id && u.row === nr && u.col === nc)) continue;
      result.push({ row: nr, col: nc, steps: cur.steps + 1 });
      queue.push({ row: nr, col: nc, steps: cur.steps + 1 });
    }
  }
  return result;
}

/** 找出距离一组格子最近的敌人目标 */
function findNearestEnemyFromCell(
  fromRow: number,
  fromCol: number,
  units: BattleUnit[],
  myIsEnemy: boolean,
): BattleUnit | null {
  let best: BattleUnit | null = null;
  let bestDist = Infinity;
  for (const u of units) {
    if (u.dead || u.isEnemy === myIsEnemy) continue;
    const d = manhattan(fromRow, fromCol, u.row, u.col);
    if (d < bestDist) {
      bestDist = d;
      best = u;
    }
  }
  return best;
}

/** P2 · AI 侧位置选策略：
 *   在"自己与最近敌人连线的中点附近"找一个空格放障碍。
 *   兜底：若找不到，选自身相邻的任意空格。
 */
function pickPositionForAI(
  self: BattleUnit,
  allUnits: BattleUnit[],
  map: Array<Array<{ terrain: string }>>,
): { row: number; col: number } | undefined {
  const isCellEmpty = (r: number, c: number): boolean => {
    if (r < 0 || r >= MAP_ROWS || c < 0 || c >= MAP_COLS) return false;
    if (map[r][c].terrain === 'obstacle') return false;
    return !allUnits.some((u) => !u.dead && u.row === r && u.col === c);
  };
  const enemies = allUnits.filter((u) => !u.dead && u.isEnemy !== self.isEnemy);
  if (enemies.length > 0) {
    enemies.sort(
      (a, b) =>
        Math.abs(a.row - self.row) + Math.abs(a.col - self.col) -
        (Math.abs(b.row - self.row) + Math.abs(b.col - self.col)),
    );
    const near = enemies[0];
    // 中点附近（向自己方向偏 1 格）
    const mr = Math.round((self.row + near.row) / 2);
    const mc = Math.round((self.col + near.col) / 2);
    const tries = [
      { row: mr, col: mc },
      { row: mr + 1, col: mc }, { row: mr - 1, col: mc },
      { row: mr, col: mc + 1 }, { row: mr, col: mc - 1 },
    ];
    for (const t of tries) if (isCellEmpty(t.row, t.col)) return t;
  }
  // 兜底：自身相邻的空格
  const DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]];
  for (const [dr, dc] of DIRS) {
    const r = self.row + dr;
    const c = self.col + dc;
    if (isCellEmpty(r, c)) return { row: r, col: c };
  }
  return undefined;
}

/** 伤害估值：期望伤害 = atk - target.atk + (克制?1:0)；保底 1 */
function estimateDamage(attacker: BattleUnit, target: BattleUnit): number {
  const a = attacker.atk;
  const d = target.atk;
  const counter = isCounter(attacker.type, target.type) ? 1 : 0;
  // 期望值：二面骰 (0/1/2) 均值=1，故期望伤害 ≈ a - d + counter
  return Math.max(1, a - d + counter);
}

/** 档位② · AI 绝技评估：返回 {shouldCast, targetIds} 
 *  不满足阈值 → shouldCast=false；满足 → 带上目标列表（无需目标的返回 []） */
function evaluateUltimate(
  self: BattleUnit,
  allUnits: BattleUnit[],
): { shouldCast: boolean; targetIds: string[]; reason: string } {
  if (self.ultimateUsed || !self.ultimate) {
    return { shouldCast: false, targetIds: [], reason: '已使用或无绝技' };
  }

  const enemies = allUnits.filter((u) => !u.dead && u.isEnemy !== self.isEnemy);
  const allies = allUnits.filter((u) => !u.dead && u.isEnemy === self.isEnemy);

  const regId = SkillRegistry.findIdByName(self.ultimate.name);
  const reg = regId ? SkillRegistry.get(regId) : undefined;
  // 未登记到新引擎的绝技 → AI 不主动放（避免兜底路径消耗）
  if (!reg || !reg.isActive) return { shouldCast: false, targetIds: [], reason: '未登记' };

  const kind = reg.targetSelector?.kind;

  // ① 单体固伤（大衍决 / 一念逆天 / 万剑诛仙 / 八段摔·断魂）
  if (kind === 'single_any_enemy' || kind === 'single_line_enemy' || kind === 'single_adjacent_enemy') {
    if (enemies.length === 0) return { shouldCast: false, targetIds: [], reason: '无敌方' };
    // 过滤：按 selector 类型筛选合法目标
    let cands = enemies;
    if (kind === 'single_line_enemy') {
      cands = enemies.filter((e) => e.row === self.row || e.col === self.col);
    } else if (kind === 'single_adjacent_enemy') {
      cands = enemies.filter((e) => Math.abs(e.row - self.row) + Math.abs(e.col - self.col) === 1);
    }
    if (cands.length === 0) return { shouldCast: false, targetIds: [], reason: '无合法目标' };
    // 估算伤害：
    // · 大衍决(hanli.awaken.ultimate) = self.atk
    // · 一念逆天(wanglin.awaken.ultimate) = hp-1
    // · 八段摔·断魂(xiaowu.ultimate) = self.maxHp - self.hp（已损失气血，但 AI 要至少损 3 以上才值得自爆）
    let dmg: number;
    if (regId === 'hero_wanglin.awaken.ultimate') {
      dmg = Math.max(0, Math.max(...cands.map((c) => c.hp - 1)));
    } else if (regId === 'hero_xiaowu.ultimate') {
      dmg = self.maxHp - self.hp;
      // 自爆特判：已损血 < 3 且无一击必杀 → 不值得自爆
      const canKillAny = cands.some((c) => dmg >= c.hp);
      if (dmg < 3 && !canKillAny) {
        return { shouldCast: false, targetIds: [], reason: `已损血 ${dmg} 过低，不值得自爆` };
      }
    } else {
      dmg = self.atk;
    }
    // 找最佳目标：可击杀 > 修为高（威胁大） > hp 多
    const sortedCands = [...cands].sort((a, b) => {
      const aLethal = dmg >= a.hp ? 1 : 0;
      const bLethal = dmg >= b.hp ? 1 : 0;
      if (aLethal !== bLethal) return bLethal - aLethal;
      if (a.atk !== b.atk) return b.atk - a.atk;
      return b.hp - a.hp;
    });
    const best = sortedCands[0];
    const canKill = dmg >= best.hp;
    const halfHp = best.maxHp * 0.5;
    if (canKill || dmg >= halfHp) {
      return {
        shouldCast: true,
        targetIds: [best.id],
        reason: canKill ? `能击杀 ${best.name}` : `预估伤害 ${dmg} ≥ 目标半血`,
      };
    }
    return { shouldCast: false, targetIds: [], reason: '收益不足' };
  }

  // ② AOE 敌方（帝品火莲·毁灭 / 天帝仙决）
  if (kind === 'all_enemies') {
    const dmg = regId === 'hero_xiaoyan.awaken.ultimate'
      ? Math.ceil(self.atk / 2)
      : regId === 'hero_wanglin.ultimate'
        ? self.atk   // 天帝仙决：全敌 self.atk 固伤
        : Math.ceil(self.atk / 2); // 保底
    const hits = enemies.length;
    const kills = enemies.filter((e) => dmg >= e.hp).length;
    if (kills >= 1 || hits >= 2) {
      return { shouldCast: true, targetIds: [], reason: `全敌AOE 命中${hits} 预估击杀${kills}` };
    }
    return { shouldCast: false, targetIds: [], reason: 'AOE收益不足' };
  }

  // ③ 相邻 AOE（佛怒火莲 / 暗器·万毒淬体 / 修罗·弑神击）
  if (kind === 'all_adjacent_enemies' || kind === 'cross_adjacent_enemies') {
    const adjEnemies = enemies.filter(
      (e) => Math.abs(e.row - self.row) + Math.abs(e.col - self.col) === 1,
    );
    if (adjEnemies.length >= 2) {
      return { shouldCast: true, targetIds: [], reason: `相邻AOE 命中${adjEnemies.length}` };
    }
    // 单目标但能击杀也可以
    if (adjEnemies.length === 1) {
      const dmg = self.atk; // 近似：一次攻击
      if (dmg >= adjEnemies[0].hp) {
        return { shouldCast: true, targetIds: [], reason: `相邻AOE 斩杀单敌` };
      }
    }
    return { shouldCast: false, targetIds: [], reason: '相邻AOE目标不足' };
  }

  // ④ 全体友方增益（古族祖灵结界 / 薰神天火）
  if (kind === 'all_allies_incl_self') {
    const alliesWithSelf = [...allies, self];
    const woundRatio = Math.min(...alliesWithSelf.map((u) => u.hp / u.maxHp));
    if (woundRatio <= 0.4) {
      return { shouldCast: true, targetIds: [], reason: `友方有人血量≤40%` };
    }
    return { shouldCast: false, targetIds: [], reason: '友方血量充足' };
  }

  // ⑤ 任意单位（柔骨·缠魂）：只在 self.hp==1 已觉醒状态下考虑，"选威胁最大的敌人换血"
  if (kind === 'single_any_character') {
    if (enemies.length === 0) return { shouldCast: false, targetIds: [], reason: '无敌方' };
    // 柔骨·缠魂核心：以 hp=1 换取对面关键敌人；选 atk 最高的敌人
    const highestAtkEnemy = [...enemies].sort((a, b) => b.atk - a.atk)[0];
    return {
      shouldCast: true,
      targetIds: [highestAtkEnemy.id],
      reason: `柔骨·缠魂 锁定威胁最高敌人 ${highestAtkEnemy.name}`,
    };
  }

  // ⑥ 位置选（小战·萧族护盾）：AI 阶段 D3 保守策略 —— 只在敌军距离较近时放，阻挡最近敌人的推进路径
  if (kind === 'position_pick') {
    if (enemies.length === 0) return { shouldCast: false, targetIds: [], reason: '无敌方' };
    const nearest = enemies.sort(
      (a, b) =>
        Math.abs(a.row - self.row) + Math.abs(a.col - self.col) -
        (Math.abs(b.row - self.row) + Math.abs(b.col - self.col)),
    )[0];
    const dist = Math.abs(nearest.row - self.row) + Math.abs(nearest.col - self.col);
    if (dist <= 3) {
      return { shouldCast: true, targetIds: [], reason: `萧族护盾 阻挡 ${nearest.name} 推进` };
    }
    return { shouldCast: false, targetIds: [], reason: '敌人距离远，暂不布盾' };
  }

  // 其他 selector 留给后续扩展
  return { shouldCast: false, targetIds: [], reason: `未覆盖的 selector: ${kind}` };
}

/** AI 执行单个单位的完整行动轮 */
export async function runAiTurnForUnit(unitId: string): Promise<void> {
  const store = useS7BBattleStore;
  const state = store.getState();
  const unit = state.units.find((u) => u.id === unitId);
  if (!unit || unit.dead || unit.acted) return;
  if (state.battleOver) return;

  await sleep(400);

  /* ═══════════════ 阶段 0：评估绝技（D3 档位②）═══════════════
   * 若当前局面满足绝技收益阈值，先放绝技再考虑普攻/移动。
   * 注意：放绝技本身不消耗行动，绝技发动后仍会走普攻/移动流程。
   */
  if (!state.skillUsedThisTurn) {
    const evalUlt = evaluateUltimate(unit, state.units);
    if (evalUlt.shouldCast) {
      const pre = store.getState().ultimatePrecheck(unitId);
      if (pre.ok) {
        store.getState().addLog(`🤖 ${unit.name} 准备释放绝技【${unit.ultimate?.name}】（${evalUlt.reason}）`, 'action');
        await sleep(400);
        // P2 · 位置选绝技（小战祖树盾）：AI 自动挑一个"最近敌人 → 自己"路径上的空格放障碍
        let pickedPos: { row: number; col: number } | undefined;
        const regIdOfUlt = unit.ultimate ? SkillRegistry.findIdByName(unit.ultimate.name) : null;
        const regOfUlt = regIdOfUlt ? SkillRegistry.get(regIdOfUlt) : undefined;
        if (regOfUlt?.targetSelector?.kind === 'position_pick') {
          pickedPos = pickPositionForAI(unit, state.units, state.map);
        }
        const ok = store.getState().performUltimate(unitId, evalUlt.targetIds, pickedPos);
        if (ok) await sleep(700);
      }
    }
  }

  // 战斗中可能因绝技触发觉醒、击杀等，刷新 state
  const freshState = store.getState();
  const freshUnit = freshState.units.find((u) => u.id === unitId);
  if (!freshUnit || freshUnit.dead || freshUnit.acted) {
    // 绝技致死或已结束 —— 仍需推进流程，否则 AI 行动后会卡在原地
    // BUGFIX（2026-05-09）：寒立等 AI 行动后流程卡死的根因——以前这里直接 return 不 advance
    if (freshUnit && !freshUnit.acted && !freshUnit.dead) {
      store.getState().endUnitTurn(unitId);
    }
    store.getState().advanceAction();
    return;
  }
  if (freshState.battleOver) return;

  // === 阶段1：寻找最佳攻击位置（含原地） ===
  const reachable = [
    { row: freshUnit.row, col: freshUnit.col, steps: 0 },
    ...computeReachable(freshUnit, freshState.map, freshState.units),
  ];

  type AttackCandidate = {
    moveTo: { row: number; col: number; steps: number };
    target: BattleUnit;
    estDamage: number;
    lethal: boolean;
    counter: boolean;
  };

  const candidates: AttackCandidate[] = [];
  for (const cell of reachable) {
    for (const enemy of freshState.units) {
      if (enemy.dead || enemy.isEnemy === freshUnit.isEnemy) continue;
      if (manhattan(cell.row, cell.col, enemy.row, enemy.col) !== 1) continue;
      const est = estimateDamage(freshUnit, enemy);
      candidates.push({
        moveTo: cell,
        target: enemy,
        estDamage: est,
        lethal: est >= enemy.hp,
        counter: isCounter(freshUnit.type, enemy.type),
      });
    }
  }

  if (candidates.length > 0) {
    // 打分排序：致命>克制>高伤害>近路径
    candidates.sort((a, b) => {
      if (a.lethal !== b.lethal) return a.lethal ? -1 : 1;
      if (a.counter !== b.counter) return a.counter ? -1 : 1;
      if (a.estDamage !== b.estDamage) return b.estDamage - a.estDamage;
      return a.moveTo.steps - b.moveTo.steps;
    });
    const best = candidates[0];

    // 先移动
    if (best.moveTo.steps > 0) {
      store.getState().moveUnit(unitId, best.moveTo.row, best.moveTo.col);
      store.getState().addLog(`🤖 ${freshUnit.name} 推进至 (${best.moveTo.row},${best.moveTo.col})`, 'action');
      await sleep(500);
    }

    // 使用技能（若持有 MVP 技能且未用过）
    const curUnit = store.getState().units.find((u) => u.id === unitId);
    if (
      curUnit &&
      !store.getState().skillUsedThisTurn &&
      curUnit.battleSkill &&
      curUnit.skillId &&
      ['skill_blueSilverCage', 'skill_devourFlame', 'skill_lifeSteal'].includes(curUnit.skillId)
    ) {
      store.getState().useSkill(unitId, 'battle');
      await sleep(400);
    }

    // 攻击
    store.getState().addLog(`🤖 ${freshUnit.name} 攻击 ${best.target.name}`, 'action');
    store.getState().attack(unitId, best.target.id);
    await sleep(600);
  } else {
    // === 阶段2：向最近敌人推进（无攻击位） ===
    const nearestEnemy = findNearestEnemyFromCell(freshUnit.row, freshUnit.col, freshState.units, freshUnit.isEnemy);
    if (nearestEnemy) {
      // 选最接近 nearestEnemy 的可达格
      let bestCell = reachable[0];
      let bestDist = manhattan(bestCell.row, bestCell.col, nearestEnemy.row, nearestEnemy.col);
      for (const cell of reachable) {
        const d = manhattan(cell.row, cell.col, nearestEnemy.row, nearestEnemy.col);
        if (d < bestDist) {
          bestDist = d;
          bestCell = cell;
        }
      }
      if (bestCell.steps > 0) {
        store.getState().moveUnit(unitId, bestCell.row, bestCell.col);
        store.getState().addLog(`🤖 ${freshUnit.name} 向 ${nearestEnemy.name} 推进至 (${bestCell.row},${bestCell.col})`, 'action');
        await sleep(500);
      } else {
        store.getState().addLog(`🤖 ${freshUnit.name} 被围困，本轮无法行动`, 'action');
      }
    }
  }

  // 结束行动
  store.getState().endUnitTurn(unitId);
  await sleep(200);
  store.getState().advanceAction();
}

/** 批量执行：依次处理当前行动队列中所有连续的 AI 单位，直到轮到玩家或战斗结束 */
export async function runAiTurns(): Promise<void> {
  const store = useS7BBattleStore;
  while (true) {
    const state = store.getState();
    if (state.battleOver) return;
    const actorId = state.getCurrentActorId();
    if (!actorId) return;
    const actor = state.units.find((u) => u.id === actorId);
    if (!actor || !actor.isEnemy) return;
    await runAiTurnForUnit(actorId);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

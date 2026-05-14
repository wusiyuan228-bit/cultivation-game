/**
 * 绝技攻击上下文标志（2026-05-14）
 *
 * 问题背景：
 *   三套战场（battleStore / s7bBattleStore / s7dAttackEngine）的 attack() 函数
 *   都在 AttackContext 中硬编码 attackKind:'basic', viaUltimate:false。
 *   但绝技的 followUpAttack（如万剑归宗 atk×2、破天 atk+5、天使圣剑 atk+4 等）
 *   是通过先临时改写 attacker.atk 再调用 attack() 来"借道实现"的。
 *   这导致绝技攻击与普攻在 hook 中无法区分，引发以下 bug：
 *     ① 寒立绝技后，"青竹蜂云剑·七十二路（仅普攻生效）"被误触发，
 *        而且读到了被临时改写后的 atk（10），把 dice 提升到了 14
 *     ② 任何 'basic-only' 类被动都会在绝技 followUp 攻击里误触发
 *
 * 解决方案：
 *   引入一个 module-scope 标志位 _inUltimateFollowUp。
 *   - 各 store 在 multiSegmentSkills 展开 attack() 之前 push true
 *   - attack() 内部读这个 flag 决定 attackKind / viaUltimate
 *   - attack() 完成（finally）后 pop
 *   - 嵌套 push/pop 使用 stack 计数避免 reentrancy 问题
 *
 * 注意：
 *   不直接修改 attack 函数签名（会侵入太多调用点）。这是单进程串行的 store，
 *   不存在并发问题，module-scope 变量是安全的。
 */

let _stack = 0;

/** 进入绝技 followUp 攻击上下文（push） */
export function enterUltimateAttackContext(): void {
  _stack += 1;
}

/** 退出绝技 followUp 攻击上下文（pop） */
export function leaveUltimateAttackContext(): void {
  _stack = Math.max(0, _stack - 1);
}

/** 当前是否在绝技 followUp 攻击中 */
export function isInUltimateAttackContext(): boolean {
  return _stack > 0;
}

/** 重置（仅用于单测/初始化） */
export function resetUltimateAttackContext(): void {
  _stack = 0;
}

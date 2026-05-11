/**
 * TurnStartChoiceModal — 玩家可控的 on_turn_start 技能弹窗
 *
 * 2026-05-11 玩家选择弹窗（所有声明 interactiveOnTurnStart 元数据的技能均使用此组件）
 *
 * 三阶段交互：
 *   1. ask     ：是否发动？（是 → 进入 pick；否 → 调 onCancel）
 *   2. pick    ：选目标。若多目标，列出按钮；若仅 1 目标，自动跳到 stat（需要选属性）或 confirm
 *   3. stat    ：选属性（atk/mnd/hp）。若该技能不需选属性则跳过 stat 阶段
 *
 * 复用方：S7B（S7B/S7C 宗门比武）、S7D（坠魔谷决战）
 *
 * 职责：
 *   - 展示弹窗 UI
 *   - 让玩家选 target 与 stat
 *   - 调用 onConfirm(targetId, stat) / onCancel()
 *   - **不直接修改 store** —— store 在 confirmTurnStartChoice 中负责执行
 *
 * 视觉：复用风属斗技弹窗的紫色基调，与战斗界面统一
 */

import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

export interface TurnStartChoiceModalProps {
  /** 当前 store 中的 pendingTurnStartChoice，null 时不渲染 */
  pending: {
    actorId: string;
    skillId: string;
    promptTitle: string;
    promptBody: string;
    choices: Array<{ targetId: string; stats?: Array<'atk' | 'mnd' | 'hp'> }>;
  } | null;
  /** 给定 unit id 返回展示用对象（name/hp/atk/mnd/hpCap） */
  resolveUnit: (id: string) => {
    id: string;
    name: string;
    hp: number;
    hpMax: number;
    atk: number;
    mnd: number;
    isEnemy?: boolean;
  } | null;
  /** 玩家点确认 */
  onConfirm: (targetId: string, stat: 'atk' | 'mnd' | 'hp' | undefined) => void;
  /** 玩家点否 */
  onCancel: () => void;
}

const STAT_LABEL: Record<'atk' | 'mnd' | 'hp', string> = {
  atk: '修为',
  mnd: '心境',
  hp: '气血',
};

export function TurnStartChoiceModal({
  pending,
  resolveUnit,
  onConfirm,
  onCancel,
}: TurnStartChoiceModalProps) {
  const [phase, setPhase] = useState<'ask' | 'pick' | 'stat'>('ask');
  const [pickedTargetId, setPickedTargetId] = useState<string | null>(null);

  const actor = pending ? resolveUnit(pending.actorId) : null;

  // 计算当前目标对应的 stats 选项
  const currentChoice = useMemo(() => {
    if (!pending || !pickedTargetId) return null;
    return pending.choices.find((c) => c.targetId === pickedTargetId) ?? null;
  }, [pending, pickedTargetId]);

  if (!pending || !actor) return null;

  // 重置内部状态当 pending 变化时
  // （无 useEffect 也可以，因为玩家点 onConfirm/onCancel 后 store 会清空 pending，
  //  下次再有新 pending 时 phase=ask；但为了健壮性，本组件无 unmount → 加 reset 逻辑：）

  const handleNo = () => {
    setPhase('ask');
    setPickedTargetId(null);
    onCancel();
  };

  const handleYes = () => {
    // 仅 1 个 target 且不需选属性 → 直接确认
    if (pending.choices.length === 1) {
      const onlyChoice = pending.choices[0];
      if (!onlyChoice.stats || onlyChoice.stats.length === 0) {
        setPhase('ask');
        setPickedTargetId(null);
        onConfirm(onlyChoice.targetId, undefined);
        return;
      }
      if (onlyChoice.stats.length === 1) {
        // 仅 1 属性 → 直接确认
        setPhase('ask');
        setPickedTargetId(null);
        onConfirm(onlyChoice.targetId, onlyChoice.stats[0]);
        return;
      }
      // 仅 1 目标但多属性 → 跳到 stat 阶段
      setPickedTargetId(onlyChoice.targetId);
      setPhase('stat');
      return;
    }
    // 多目标 → 进入 pick
    setPhase('pick');
  };

  const handlePickTarget = (targetId: string) => {
    const choice = pending.choices.find((c) => c.targetId === targetId);
    if (!choice) return;
    if (!choice.stats || choice.stats.length === 0) {
      // 不需选属性 → 直接确认
      setPhase('ask');
      setPickedTargetId(null);
      onConfirm(targetId, undefined);
      return;
    }
    if (choice.stats.length === 1) {
      setPhase('ask');
      setPickedTargetId(null);
      onConfirm(targetId, choice.stats[0]);
      return;
    }
    setPickedTargetId(targetId);
    setPhase('stat');
  };

  const handlePickStat = (stat: 'atk' | 'mnd' | 'hp') => {
    if (!pickedTargetId) return;
    const tid = pickedTargetId;
    setPhase('ask');
    setPickedTargetId(null);
    onConfirm(tid, stat);
  };

  // ─────────── 共用容器 ───────────
  return (
    <AnimatePresence>
      <motion.div
        key={`turn-start-modal-${pending.actorId}-${pending.skillId}`}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.55)',
          zIndex: 9000,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <motion.div
          initial={{ scale: 0.92, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.92, opacity: 0 }}
          onClick={(e) => e.stopPropagation()}
          style={{
            background: 'linear-gradient(180deg, #2a1a3a 0%, #1a0e2a 100%)',
            border: '2px solid #a384ff',
            borderRadius: 12,
            padding: '24px 30px',
            minWidth: 440,
            maxWidth: 600,
            color: '#f0e9ff',
            boxShadow: '0 8px 32px rgba(163, 132, 255, 0.4)',
          }}
        >
          <h2
            style={{
              margin: 0,
              fontSize: 22,
              color: '#d4b8ff',
              textAlign: 'center',
            }}
          >
            ✨ {pending.promptTitle}
          </h2>
          <p
            style={{
              marginTop: 6,
              fontSize: 13,
              color: '#9a87d0',
              textAlign: 'center',
            }}
          >
            发动者：<b style={{ color: '#ffd54f' }}>{actor.name}</b>
          </p>

          {/* ───── Phase: ask ───── */}
          {phase === 'ask' && (
            <>
              <p
                style={{
                  marginTop: 14,
                  fontSize: 15,
                  lineHeight: 1.7,
                  color: '#e0d6ff',
                }}
              >
                {pending.promptBody}
              </p>
              <p style={{ fontSize: 13, color: '#9a87d0' }}>
                可选目标：{pending.choices.length} 个
              </p>
              <div
                style={{
                  display: 'flex',
                  gap: 12,
                  marginTop: 18,
                  justifyContent: 'center',
                }}
              >
                <button
                  style={btnPrimary}
                  onClick={handleYes}
                >
                  发动
                </button>
                <button style={btnSecondary} onClick={handleNo}>
                  不发动
                </button>
              </div>
            </>
          )}

          {/* ───── Phase: pick target ───── */}
          {phase === 'pick' && (
            <>
              <p
                style={{
                  marginTop: 14,
                  fontSize: 14,
                  lineHeight: 1.7,
                  color: '#e0d6ff',
                  textAlign: 'center',
                }}
              >
                请选择目标
              </p>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
                  gap: 10,
                  marginTop: 12,
                  maxHeight: 320,
                  overflowY: 'auto',
                }}
              >
                {pending.choices.map((c) => {
                  const u = resolveUnit(c.targetId);
                  if (!u) return null;
                  const isEnemy = u.isEnemy;
                  return (
                    <button
                      key={c.targetId}
                      onClick={() => handlePickTarget(c.targetId)}
                      style={{
                        padding: '10px 12px',
                        background: isEnemy
                          ? 'linear-gradient(180deg, #4a1818, #2a0e0e)'
                          : 'linear-gradient(180deg, #1a3a4a, #0e2a3a)',
                        border: `2px solid ${isEnemy ? '#ff6b6b' : '#84d4ff'}`,
                        borderRadius: 6,
                        color: '#fff',
                        textAlign: 'left',
                        cursor: 'pointer',
                        fontSize: 13,
                      }}
                    >
                      <div style={{ fontWeight: 600, marginBottom: 4 }}>
                        {isEnemy ? '🔴' : '🔵'} {u.name}
                      </div>
                      <div style={{ fontSize: 11, color: '#cdd' }}>
                        💖 {u.hp}/{u.hpMax} ⚔ {u.atk} 🧠 {u.mnd}
                      </div>
                    </button>
                  );
                })}
              </div>
              <div
                style={{
                  display: 'flex',
                  gap: 12,
                  marginTop: 16,
                  justifyContent: 'center',
                }}
              >
                <button style={btnSecondary} onClick={handleNo}>
                  放弃
                </button>
              </div>
            </>
          )}

          {/* ───── Phase: pick stat ───── */}
          {phase === 'stat' && currentChoice && (
            <>
              <p
                style={{
                  marginTop: 14,
                  fontSize: 14,
                  lineHeight: 1.7,
                  color: '#e0d6ff',
                  textAlign: 'center',
                }}
              >
                目标：
                <b style={{ color: '#ffd54f' }}>
                  {resolveUnit(currentChoice.targetId)?.name ?? currentChoice.targetId}
                </b>
              </p>
              <p
                style={{
                  fontSize: 13,
                  color: '#c5b3ff',
                  textAlign: 'center',
                  margin: '6px 0 14px',
                }}
              >
                请选择要影响的属性
              </p>
              <div
                style={{
                  display: 'flex',
                  gap: 10,
                  marginTop: 8,
                  justifyContent: 'center',
                  flexWrap: 'wrap',
                }}
              >
                {(currentChoice.stats ?? []).map((s) => {
                  const u = resolveUnit(currentChoice.targetId);
                  const valStr = u
                    ? s === 'hp'
                      ? `${u.hp}/${u.hpMax}`
                      : s === 'atk'
                        ? String(u.atk)
                        : String(u.mnd)
                    : '-';
                  return (
                    <button
                      key={s}
                      onClick={() => handlePickStat(s)}
                      style={{
                        padding: '12px 18px',
                        background: 'linear-gradient(180deg, #6b4ade, #4a2db5)',
                        color: '#fff',
                        border: '1px solid #a384ff',
                        borderRadius: 6,
                        cursor: 'pointer',
                        fontSize: 14,
                        fontWeight: 600,
                        minWidth: 110,
                      }}
                    >
                      <div>{STAT_LABEL[s]}</div>
                      <div style={{ fontSize: 12, color: '#cfc4f0', marginTop: 4 }}>
                        当前 {valStr}
                      </div>
                    </button>
                  );
                })}
              </div>
              <div
                style={{
                  display: 'flex',
                  gap: 12,
                  marginTop: 18,
                  justifyContent: 'center',
                }}
              >
                <button
                  style={btnSecondary}
                  onClick={() => {
                    // 返回上一步（pick 阶段；若仅 1 目标则回 ask）
                    if (pending.choices.length === 1) {
                      setPhase('ask');
                      setPickedTargetId(null);
                    } else {
                      setPhase('pick');
                      setPickedTargetId(null);
                    }
                  }}
                >
                  返回
                </button>
                <button style={btnSecondary} onClick={handleNo}>
                  放弃
                </button>
              </div>
            </>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

const btnPrimary: React.CSSProperties = {
  padding: '10px 22px',
  background: 'linear-gradient(180deg, #6b4ade, #4a2db5)',
  color: '#fff',
  border: '1px solid #a384ff',
  borderRadius: 6,
  cursor: 'pointer',
  fontSize: 15,
  fontWeight: 600,
  minWidth: 110,
};

const btnSecondary: React.CSSProperties = {
  padding: '10px 22px',
  background: 'linear-gradient(180deg, #555, #333)',
  color: '#ddd',
  border: '1px solid #777',
  borderRadius: 6,
  cursor: 'pointer',
  fontSize: 15,
  minWidth: 110,
};

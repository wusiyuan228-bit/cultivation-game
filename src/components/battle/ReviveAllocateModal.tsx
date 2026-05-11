/**
 * ReviveAllocateModal — 复活属性分配弹窗（2026-05-11）
 *
 * 适用场景：
 *   徐立国（天罡元婴·重塑）等"死亡复活类"绝技触发时，
 *   若复活的是玩家方角色 → 弹出此窗口，让玩家把总数 8 点重新分配到 atk/mnd/hp
 *
 * 设计要点：
 *   - **非阻塞** ：弹窗出现时角色已用默认 3/2/3 复活，战斗流不中断
 *   - 玩家可调整 atk/mnd/hp 到任意符合规则的分配（每项 ≥1，总数 = 8）
 *   - 玩家点"确认"会通过 onConfirm 重写角色属性（差量调整）
 *   - 玩家点"使用默认"或关闭弹窗 → 保持当前 3/2/3 不变
 *
 * 视觉：与 TurnStartChoiceModal 一致的紫色主题，避免与战斗 UI 冲突
 */

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

export interface PendingReviveInfo {
  unitId: string;
  unitName: string;
  /** 当前已经被自动设置的默认值（一般 3/2/3） */
  current: { atk: number; mnd: number; hp: number };
}

export interface ReviveAllocateModalProps {
  pending: PendingReviveInfo | null;
  /** 玩家确认新分配（atk+mnd+hp = 8，每项 ≥ 1） */
  onConfirm: (payload: { atk: number; mnd: number; hp: number }) => void;
  /** 玩家放弃调整（保持默认 3/2/3） */
  onCancel: () => void;
}

const TOTAL = 8;

export function ReviveAllocateModal({ pending, onConfirm, onCancel }: ReviveAllocateModalProps) {
  // 编辑中的本地分配
  const [atk, setAtk] = useState(3);
  const [mnd, setMnd] = useState(2);
  const [hp, setHp] = useState(3);

  // 每次有新的 pending → 用 current 初始化
  useEffect(() => {
    if (pending) {
      setAtk(pending.current.atk);
      setMnd(pending.current.mnd);
      setHp(pending.current.hp);
    }
  }, [pending?.unitId]);

  const sum = atk + mnd + hp;
  const remain = TOTAL - sum;
  const valid = atk >= 1 && mnd >= 1 && hp >= 1 && sum === TOTAL;

  const inc = (stat: 'atk' | 'mnd' | 'hp') => {
    if (sum >= TOTAL) return;
    if (stat === 'atk') setAtk((v) => v + 1);
    if (stat === 'mnd') setMnd((v) => v + 1);
    if (stat === 'hp') setHp((v) => v + 1);
  };
  const dec = (stat: 'atk' | 'mnd' | 'hp') => {
    if (stat === 'atk' && atk > 1) setAtk((v) => v - 1);
    if (stat === 'mnd' && mnd > 1) setMnd((v) => v - 1);
    if (stat === 'hp' && hp > 1) setHp((v) => v - 1);
  };

  const handleConfirm = () => {
    if (!valid) return;
    onConfirm({ atk, mnd, hp });
  };

  return (
    <AnimatePresence>
      {pending && (
        <motion.div
          key="revive-modal-bg"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          style={bgStyle}
        >
          <motion.div
            key="revive-modal"
            initial={{ opacity: 0, scale: 0.85, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.85, y: 20 }}
            transition={{ duration: 0.25 }}
            style={cardStyle}
          >
            <div style={titleStyle}>✨ 天罡元婴·重塑</div>
            <div style={subtitleStyle}>
              {pending.unitName} 原地复活！请将 <b>8 点</b>属性分配到 修为 / 心境 / 气血
              （每项 ≥ 1）
            </div>
            <div style={{ marginTop: 18 }}>
              <Row label="修为" value={atk} onInc={() => inc('atk')} onDec={() => dec('atk')} canInc={remain > 0} canDec={atk > 1} />
              <Row label="心境" value={mnd} onInc={() => inc('mnd')} onDec={() => dec('mnd')} canInc={remain > 0} canDec={mnd > 1} />
              <Row label="气血" value={hp} onInc={() => inc('hp')} onDec={() => dec('hp')} canInc={remain > 0} canDec={hp > 1} />
            </div>
            <div style={summaryStyle}>
              已分配 <b style={{ color: valid ? '#a5f3fc' : '#fca5a5' }}>{sum}</b> / {TOTAL}
              {remain > 0 && <span style={{ color: '#fbbf24' }}> （还需分配 {remain} 点）</span>}
              {sum > TOTAL && <span style={{ color: '#fca5a5' }}> （超出 {sum - TOTAL} 点）</span>}
            </div>
            <div style={btnRowStyle}>
              <button style={btnSecondaryStyle} onClick={onCancel}>
                使用默认（3/2/3）
              </button>
              <button
                style={{
                  ...btnPrimaryStyle,
                  opacity: valid ? 1 : 0.45,
                  cursor: valid ? 'pointer' : 'not-allowed',
                }}
                disabled={!valid}
                onClick={handleConfirm}
              >
                确认分配
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function Row({
  label,
  value,
  onInc,
  onDec,
  canInc,
  canDec,
}: {
  label: string;
  value: number;
  onInc: () => void;
  onDec: () => void;
  canInc: boolean;
  canDec: boolean;
}) {
  return (
    <div style={rowStyle}>
      <div style={rowLabelStyle}>{label}</div>
      <button style={{ ...stepperBtn, opacity: canDec ? 1 : 0.35, cursor: canDec ? 'pointer' : 'not-allowed' }} onClick={canDec ? onDec : undefined} disabled={!canDec}>
        −
      </button>
      <div style={valueBox}>{value}</div>
      <button style={{ ...stepperBtn, opacity: canInc ? 1 : 0.35, cursor: canInc ? 'pointer' : 'not-allowed' }} onClick={canInc ? onInc : undefined} disabled={!canInc}>
        +
      </button>
    </div>
  );
}

/* ============ 样式（与 TurnStartChoiceModal 风格一致） ============ */
const bgStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.55)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 9999,
};
const cardStyle: React.CSSProperties = {
  background: 'linear-gradient(160deg, #2a1a4d 0%, #1a1633 100%)',
  border: '2px solid #9b87f5',
  borderRadius: 16,
  padding: '28px 32px',
  minWidth: 360,
  maxWidth: 460,
  boxShadow: '0 0 24px rgba(155,135,245,0.5)',
  color: '#f1f5f9',
  fontFamily: 'system-ui, sans-serif',
};
const titleStyle: React.CSSProperties = {
  fontSize: 22,
  fontWeight: 700,
  textAlign: 'center',
  textShadow: '0 0 8px rgba(155,135,245,0.7)',
  marginBottom: 6,
};
const subtitleStyle: React.CSSProperties = {
  fontSize: 13,
  textAlign: 'center',
  color: '#cbd5e1',
  lineHeight: 1.55,
};
const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  margin: '12px 0',
  gap: 10,
};
const rowLabelStyle: React.CSSProperties = {
  flex: 1,
  fontSize: 16,
  fontWeight: 600,
  color: '#e2e8f0',
};
const stepperBtn: React.CSSProperties = {
  width: 36,
  height: 36,
  borderRadius: 8,
  border: '1px solid #6d4af0',
  background: 'rgba(109,74,240,0.25)',
  color: '#fff',
  fontSize: 20,
  fontWeight: 700,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};
const valueBox: React.CSSProperties = {
  width: 50,
  height: 36,
  borderRadius: 8,
  background: 'rgba(255,255,255,0.08)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: 18,
  fontWeight: 700,
  color: '#fde68a',
};
const summaryStyle: React.CSSProperties = {
  textAlign: 'center',
  fontSize: 13,
  color: '#cbd5e1',
  marginTop: 14,
};
const btnRowStyle: React.CSSProperties = {
  display: 'flex',
  gap: 10,
  marginTop: 22,
};
const btnPrimaryStyle: React.CSSProperties = {
  flex: 1,
  padding: '10px 16px',
  borderRadius: 8,
  border: 'none',
  background: 'linear-gradient(90deg, #7c3aed 0%, #c026d3 100%)',
  color: '#fff',
  fontSize: 14,
  fontWeight: 600,
  cursor: 'pointer',
  boxShadow: '0 0 12px rgba(124,58,237,0.6)',
};
const btnSecondaryStyle: React.CSSProperties = {
  flex: 1,
  padding: '10px 16px',
  borderRadius: 8,
  border: '1px solid #475569',
  background: 'rgba(255,255,255,0.04)',
  color: '#cbd5e1',
  fontSize: 13,
  fontWeight: 500,
  cursor: 'pointer',
};

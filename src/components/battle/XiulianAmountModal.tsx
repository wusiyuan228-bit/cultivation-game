/**
 * XiulianAmountModal — 司图楠【天逆珠·修炼】X 值选择弹窗（2026-05-16）
 *
 * 适用场景：
 *   司图楠在战斗中点击【天逆珠·修炼】→ 选择友军后弹出此窗，
 *   让玩家选择消耗多少气血 X（1 ~ casterHp-1）。
 *   每点 X = 友军 修为+1 / 心境+1（最多+2）/ 生命+1。
 *
 * 设计要点：
 *   - 阻塞式：必须选 X 后才能继续
 *   - 范围 [1, casterHp-1]：保证司图楠至少留 1 血
 *   - 默认值 = max（最大化策略）
 *   - 取消 → 直接退出瞄准态，不发动
 *
 * 视觉：与 ReviveAllocateModal/TurnStartChoiceModal 一致的紫色主题
 */
import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

export interface XiulianPendingInfo {
  casterId: string;
  casterName: string;
  /** 司图楠当前气血 → maxX = casterHp - 1 */
  casterHp: number;
  targetId: string;
  targetName: string;
}

export interface XiulianAmountModalProps {
  pending: XiulianPendingInfo | null;
  /** 玩家确认 X */
  onConfirm: (X: number) => void;
  /** 玩家取消（退出瞄准态，不发动） */
  onCancel: () => void;
}

export function XiulianAmountModal({ pending, onConfirm, onCancel }: XiulianAmountModalProps) {
  const maxX = pending ? Math.max(1, pending.casterHp - 1) : 1;
  const [X, setX] = useState(maxX);

  // 每次有新的 pending 重置为最大值（爽快默认）
  useEffect(() => {
    if (pending) setX(Math.max(1, pending.casterHp - 1));
  }, [pending?.casterId, pending?.targetId, pending?.casterHp]);

  if (!pending) {
    return null;
  }

  const valid = X >= 1 && X <= maxX;
  const mndGain = Math.min(X, 2);

  const dec = () => setX((v) => Math.max(1, v - 1));
  const inc = () => setX((v) => Math.min(maxX, v + 1));

  return (
    <AnimatePresence>
      {pending && (
        <motion.div
          key="xiulian-modal-bg"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          style={bgStyle}
        >
          <motion.div
            key="xiulian-modal"
            initial={{ opacity: 0, scale: 0.85, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.85, y: 20 }}
            transition={{ duration: 0.25 }}
            style={cardStyle}
          >
            <div style={titleStyle}>✨ 天逆珠·修炼</div>
            <div style={subtitleStyle}>
              <b>{pending.casterName}</b>（气血 {pending.casterHp}）将消耗 <b style={{ color: '#fca5a5' }}>X 点气血</b>
              ，为 <b style={{ color: '#a5f3fc' }}>{pending.targetName}</b> 灌注：
              <div style={{ marginTop: 6, color: '#fde68a' }}>
                · 修为 +X　· 心境 +min(X,2)　· 生命上限 +X（同步回复 X 血）
              </div>
            </div>

            {/* X 值步进器 */}
            <div style={stepRowStyle}>
              <button
                style={{ ...stepperBtn, opacity: X > 1 ? 1 : 0.35, cursor: X > 1 ? 'pointer' : 'not-allowed' }}
                onClick={X > 1 ? dec : undefined}
                disabled={X <= 1}
              >
                −
              </button>
              <div style={valueBox}>{X}</div>
              <button
                style={{ ...stepperBtn, opacity: X < maxX ? 1 : 0.35, cursor: X < maxX ? 'pointer' : 'not-allowed' }}
                onClick={X < maxX ? inc : undefined}
                disabled={X >= maxX}
              >
                +
              </button>
            </div>

            {/* 快捷预设 */}
            <div style={presetRowStyle}>
              <button style={presetBtn} onClick={() => setX(1)}>最小 1</button>
              {maxX >= 2 && (
                <button style={presetBtn} onClick={() => setX(Math.ceil(maxX / 2))}>
                  半量 {Math.ceil(maxX / 2)}
                </button>
              )}
              <button style={presetBtn} onClick={() => setX(maxX)}>
                最大 {maxX}
              </button>
            </div>

            {/* 效果预览 */}
            <div style={previewStyle}>
              📝 实际效果：消耗自身 <b style={{ color: '#fca5a5' }}>{X}</b> 气血
              ，目标修为 +<b>{X}</b>　心境 +<b>{mndGain}</b>　生命 +<b>{X}</b>
              <div style={{ marginTop: 4, fontSize: 11, color: '#94a3b8' }}>
                范围：1 ~ {maxX}（保留至少 1 血）｜本回合限发动 1 次
              </div>
            </div>

            <div style={btnRowStyle}>
              <button style={btnSecondaryStyle} onClick={onCancel}>
                取消
              </button>
              <button
                style={{
                  ...btnPrimaryStyle,
                  opacity: valid ? 1 : 0.45,
                  cursor: valid ? 'pointer' : 'not-allowed',
                }}
                disabled={!valid}
                onClick={() => valid && onConfirm(X)}
              >
                确认发动
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/* ============ 样式 ============ */
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
  padding: '24px 28px',
  minWidth: 380,
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
  marginBottom: 8,
};
const subtitleStyle: React.CSSProperties = {
  fontSize: 13,
  textAlign: 'center',
  color: '#cbd5e1',
  lineHeight: 1.6,
};
const stepRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 14,
  marginTop: 18,
};
const stepperBtn: React.CSSProperties = {
  width: 44,
  height: 44,
  borderRadius: 10,
  border: '1px solid #6d4af0',
  background: 'rgba(109,74,240,0.25)',
  color: '#fff',
  fontSize: 22,
  fontWeight: 700,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};
const valueBox: React.CSSProperties = {
  width: 80,
  height: 56,
  borderRadius: 10,
  background: 'rgba(255,255,255,0.08)',
  border: '1px solid rgba(253,230,138,0.4)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: 28,
  fontWeight: 800,
  color: '#fde68a',
};
const presetRowStyle: React.CSSProperties = {
  display: 'flex',
  gap: 8,
  justifyContent: 'center',
  marginTop: 12,
};
const presetBtn: React.CSSProperties = {
  padding: '6px 12px',
  borderRadius: 6,
  border: '1px solid #475569',
  background: 'rgba(255,255,255,0.04)',
  color: '#cbd5e1',
  fontSize: 12,
  cursor: 'pointer',
};
const previewStyle: React.CSSProperties = {
  marginTop: 14,
  padding: '10px 12px',
  background: 'rgba(155,135,245,0.1)',
  border: '1px solid rgba(155,135,245,0.3)',
  borderRadius: 8,
  fontSize: 12.5,
  color: '#e2e8f0',
  textAlign: 'center',
  lineHeight: 1.55,
};
const btnRowStyle: React.CSSProperties = {
  display: 'flex',
  gap: 10,
  marginTop: 18,
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

/**
 * 骰子钟组件（战斗核心可复用）
 * 规范来源：02_策划文档/视觉规范文档_VDS_v1.0.md §4.4
 *
 * 二面骰（实为 3 面：0/1/2）
 *  - 0 面：深灰底 + 白色"0"
 *  - 1 面：蓝底 + 白色"1" + 微发光
 *  - 2 面：金底 + 黑色"2" + 强发光
 *
 * 动画：随机旋转 0.8~1.2s，ease-out 停止，定格后显示总和
 *
 * 用法：
 *   <DiceClock side="left" label="我方 修为5" count={5} rolling={rolling} values={[1,2,0,1,2]} />
 *   rolling=true 时所有骰子滚动；values 非空时定格展示
 */
import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import styles from './DiceClock.module.css';

interface Props {
  side: 'left' | 'right';
  label: string;
  /** 骰子数量（= 修为值） */
  count: number;
  /** 是否处于投掷动画中 */
  rolling: boolean;
  /** 投掷定格后的点数数组（长度应 = count） */
  values: number[];
}

/** 单颗骰子 */
const Die: React.FC<{ value: number | null; rolling: boolean; index: number }> = ({
  value,
  rolling,
  index,
}) => {
  const [rollFace, setRollFace] = useState<number>(0);

  // 滚动中的抖动效果
  useEffect(() => {
    if (!rolling) return;
    const t = setInterval(() => setRollFace(Math.floor(Math.random() * 3)), 80);
    return () => clearInterval(t);
  }, [rolling]);

  const displayValue = rolling ? rollFace : value ?? 0;
  const faceClass =
    displayValue === 2 ? styles.face2 : displayValue === 1 ? styles.face1 : styles.face0;

  return (
    <motion.div
      className={`${styles.die} ${faceClass}`}
      initial={{ rotate: 0, scale: 0.6, opacity: 0 }}
      animate={{
        rotate: rolling ? [0, 180, 360, 540] : 0,
        scale: 1,
        opacity: 1,
      }}
      transition={{
        rotate: rolling
          ? { duration: 0.45 + Math.random() * 0.2, ease: 'easeOut', repeat: rolling ? Infinity : 0 }
          : { duration: 0.2, ease: 'easeOut' },
        scale: { delay: index * 0.02, duration: 0.2 },
        opacity: { delay: index * 0.02, duration: 0.2 },
      }}
    >
      {displayValue}
    </motion.div>
  );
};

export const DiceClock: React.FC<Props> = ({ side, label, count, rolling, values }) => {
  const sum = values.reduce((a, b) => a + b, 0);
  const hasResult = !rolling && values.length === count;

  return (
    <div className={`${styles.clock} ${side === 'left' ? styles.clockLeft : styles.clockRight}`}>
      <div className={styles.label}>{label}</div>

      <div className={styles.diceGrid} data-count={count}>
        {Array.from({ length: count }).map((_, i) => (
          <Die
            key={i}
            index={i}
            rolling={rolling}
            value={values[i] ?? null}
          />
        ))}
        {count === 0 && <div className={styles.noDie}>无骰</div>}
      </div>

      <div className={styles.sumRow}>
        <span className={styles.sumLabel}>总和</span>
        <AnimatePresence mode="wait">
          <motion.span
            key={rolling ? 'rolling' : `sum-${sum}`}
            className={styles.sumValue}
            initial={{ scale: 0.6, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.6, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 300, damping: 18 }}
          >
            {rolling ? '??' : hasResult ? sum : '—'}
          </motion.span>
        </AnimatePresence>
      </div>
    </div>
  );
};

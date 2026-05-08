/**
 * 底部横向战报面板（可折叠）
 * 默认折叠成 60px 高，点击展开按钮后变成 200px 高
 *
 * 日志合并渲染：
 *   system "—— 轮到 XX 抽卡（顺位 N）——" + 紧跟的 draw/skip/skill → 合并成一条两行显示
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { DrawLogEntry } from '@/types/recruit';
import styles from './DrawLogPanel.module.css';

interface Props {
  log: DrawLogEntry[];
}

const TYPE_COLOR: Record<string, string> = {
  draw: '#ebdcb4',
  skip: '#aaaaaa',
  skill: '#c8a4ff',
  switch: '#6fa8d9',
  reward: '#c8a850',
  system: '#d49a5a',
};

// === 合并规则 ===
// 连续的若干 type=system "轮到 XX..." 只取最后一条做"头"
// 后续直到下一条"轮到 XX..."的 draw/skip/skill/switch/reward 全部做为"头"的内容合并
interface DisplayEntry {
  id: string;
  header: string | null;      // "轮到 XX 抽卡 · 顺位 N"
  headerColor: string;
  lines: Array<{ text: string; color: string }>;
}

function mergeLog(log: DrawLogEntry[]): DisplayEntry[] {
  const result: DisplayEntry[] = [];
  let current: DisplayEntry | null = null;

  const isTurnHead = (e: DrawLogEntry) =>
    e.type === 'system' && /轮到.+抽卡/.test(e.text);

  for (const e of log) {
    if (isTurnHead(e)) {
      // 提取名字和顺位数字: "—— 轮到 熏儿 抽卡（顺位 1）——"
      const m = e.text.match(/轮到\s*(.+?)\s*抽卡.*?顺位\s*(\d+)/);
      const header = m ? `轮到 ${m[1]} · 顺位 ${m[2]}` : e.text.replace(/——/g, '').trim();
      current = {
        id: e.id,
        header,
        headerColor: TYPE_COLOR.system,
        lines: [],
      };
      result.push(current);
    } else {
      const color = TYPE_COLOR[e.type] || '#ebdcb4';
      if (current) {
        current.lines.push({ text: e.text, color });
      } else {
        // 没有"轮到..."头时（例如开场系统提示）独立成一条
        result.push({
          id: e.id,
          header: null,
          headerColor: color,
          lines: [{ text: e.text, color }],
        });
      }
    }
  }
  return result;
}

export const DrawLogPanel: React.FC<Props> = ({ log }) => {
  const [expanded, setExpanded] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const collapsedScrollRef = useRef<HTMLDivElement>(null);

  const merged = useMemo(() => mergeLog(log), [log]);

  useEffect(() => {
    if (expanded) {
      endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    } else {
      // 折叠态：滚到最底
      const el = collapsedScrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    }
  }, [merged.length, expanded]);

  // 折叠态只展示最后 1 条合并项（两行：header + 最新line，固定高度 72px）
  const latestOne = merged.slice(-1);

  return (
    <div className={`${styles.panel} ${expanded ? styles.expanded : ''}`}>
      <button
        className={styles.toggle}
        onClick={() => setExpanded(!expanded)}
        aria-label={expanded ? '收起战报' : '展开战报'}
      >
        <span className={styles.toggleLabel}>战 报</span>
        <span className={`${styles.toggleArrow} ${expanded ? styles.toggleArrowUp : ''}`}>
          ▲
        </span>
      </button>

      <AnimatePresence mode="wait" initial={false}>
        {expanded ? (
          <motion.div
            key="expanded"
            className={styles.bodyExpanded}
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.25 }}
          >
            {merged.length === 0 && (
              <div className={styles.empty}>暂无记录，本局即将开始...</div>
            )}
            {merged.map((m) => (
              <div key={m.id} className={styles.entry}>
                {m.header && (
                  <div className={styles.entryHeader} style={{ color: m.headerColor }}>
                    {m.header}
                  </div>
                )}
                {m.lines.map((line, i) => (
                  <div key={i} className={styles.entryLine} style={{ color: line.color }}>
                    {line.text}
                  </div>
                ))}
              </div>
            ))}
            <div ref={endRef} />
          </motion.div>
        ) : (
          <motion.div
            key="collapsed"
            ref={collapsedScrollRef}
            className={styles.bodyCollapsed}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
          >
            {latestOne.length === 0 ? (
              <span className={styles.collapsedEmpty}>暂无记录</span>
            ) : (
              latestOne.map((m) => {
                // 折叠态只显示最新 1 行 line（两行：header + 最新一条内容）
                const lastLine = m.lines[m.lines.length - 1];
                return (
                  <div key={m.id} className={styles.collapsedEntry}>
                    {m.header && (
                      <div className={styles.collapsedHeader} style={{ color: m.headerColor }}>
                        {m.header}
                      </div>
                    )}
                    {lastLine && (
                      <div className={styles.collapsedLine} style={{ color: lastLine.color }}>
                        {lastLine.text}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

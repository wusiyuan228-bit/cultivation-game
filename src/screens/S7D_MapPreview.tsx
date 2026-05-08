/**
 * S7D_MapPreview · 坠魔谷决战地图预览
 *
 * 职责：
 *   1. 可视化渲染 18×12 S7D 决战地图
 *   2. 标注各类特殊瓦片（出生点/水晶/桥/河）
 *   3. 鼠标悬停气泡显示瓦片说明
 *   4. 侧边栏展示地图图例 + 设计说明
 *
 * 用途：
 *   - 策划验证地图布局是否符合设计
 *   - 后续 S7D_Battle 开发的参照蓝本
 */

import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { BackButton } from '@/components/BackButton';
import {
  generateS7DMap,
  S7D_MAP_COLS,
  S7D_MAP_ROWS,
  S7D_TILE_COLORS,
  S7D_TILE_LABELS,
  S7D_TILE_DESC,
  S7D_SPAWN_A,
  S7D_SPAWN_B,
  S7D_CRYSTAL_A,
  S7D_CRYSTAL_B,
  S7D_BRIDGES,
  S7D_ATK_BOOST,
  S7D_SPRING,
  S7D_MND_BOOST,
  S7D_MIASMA,
  type S7DTileType,
} from '@/data/s7dMap';
import styles from './S7D_MapPreview.module.css';

export const S7D_MapPreview: React.FC = () => {
  const navigate = useNavigate();
  const [hover, setHover] = useState<{ row: number; col: number; tile: S7DTileType } | null>(null);

  const map = React.useMemo(() => generateS7DMap(), []);

  return (
    <div className={styles.screen}>
      <BackButton onClick={() => navigate('/menu')} />

      {/* 标题 */}
      <motion.div
        className={styles.header}
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
      >
        <h1 className={styles.title}>🗺 坠魔谷决战地图</h1>
        <p className={styles.subtitle}>
          {S7D_MAP_COLS} 列 × {S7D_MAP_ROWS} 行 · 12 单位大乱斗 · 象棋式双阵对垒
        </p>
      </motion.div>

      <div className={styles.body}>
        {/* 地图区 */}
        <motion.div
          className={styles.mapWrap}
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.6 }}
        >
          {/* 顶部列号标签 */}
          <div className={styles.colLabels}>
            <div className={styles.cornerLabel} />
            {Array.from({ length: S7D_MAP_COLS }).map((_, c) => (
              <div key={c} className={styles.colLabel}>
                {c}
              </div>
            ))}
          </div>

          {/* 地图行 */}
          {map.map((row, r) => (
            <div key={r} className={styles.mapRow}>
              <div className={styles.rowLabel}>{r}</div>
              {row.map((cell) => (
                <div
                  key={`${r}-${cell.col}`}
                  className={styles.cell}
                  style={{ backgroundColor: S7D_TILE_COLORS[cell.tile] }}
                  onMouseEnter={() => setHover({ row: r, col: cell.col, tile: cell.tile })}
                  onMouseLeave={() => setHover(null)}
                >
                  <span className={styles.cellLabel}>{S7D_TILE_LABELS[cell.tile]}</span>
                </div>
              ))}
            </div>
          ))}

          {/* 悬停提示 */}
          {hover && (
            <div className={styles.hoverInfo}>
              ({hover.row}, {hover.col}) · {S7D_TILE_DESC[hover.tile]}
            </div>
          )}
        </motion.div>

        {/* 侧边栏：图例 + 说明 */}
        <motion.div
          className={styles.sidebar}
          initial={{ opacity: 0, x: 30 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.6, delay: 0.2 }}
        >
          <div className={styles.legendBox}>
            <h3 className={styles.legendTitle}>图例</h3>
            <LegendItem color={S7D_TILE_COLORS.normal} label="普通地形" />
            <LegendItem color={S7D_TILE_COLORS.river} label="河道（不可通行）" />
            <LegendItem color={S7D_TILE_COLORS.bridge} label="桥梁（2×2 × 3座）" />
            <LegendItem color={S7D_TILE_COLORS.spawn_a} label="A 阵营出生点 × 8" />
            <LegendItem color={S7D_TILE_COLORS.spawn_b} label="B 阵营出生点 × 8" />
            <LegendItem color={S7D_TILE_COLORS.crystal_a} label="A 阵营水晶 × 6" />
            <LegendItem color={S7D_TILE_COLORS.crystal_b} label="B 阵营水晶 × 6" />
            <div className={styles.legendDivider} />
            <LegendItem color={S7D_TILE_COLORS.atk_boost} label="⚔️ 修为台 × 8（修为+1 永久）" />
            <LegendItem color={S7D_TILE_COLORS.spring} label="💚 生命泉 × 4（气血+1）" />
            <LegendItem color={S7D_TILE_COLORS.mnd_boost} label="🧘 心境坛 × 6（心境+1 永久）" />
            <LegendItem color={S7D_TILE_COLORS.miasma} label="🔥 魔瘴地 × 8（气血-1）" />
          </div>

          <div className={styles.statsBox}>
            <h3 className={styles.statsTitle}>📊 地图数据</h3>
            <div className={styles.statRow}>
              <span>总格数</span>
              <b>{S7D_MAP_COLS * S7D_MAP_ROWS}</b>
            </div>
            <div className={styles.statRow}>
              <span>A 出生点</span>
              <b>{S7D_SPAWN_A.length}</b>
            </div>
            <div className={styles.statRow}>
              <span>B 出生点</span>
              <b>{S7D_SPAWN_B.length}</b>
            </div>
            <div className={styles.statRow}>
              <span>A 水晶</span>
              <b>{S7D_CRYSTAL_A.length}</b>
            </div>
            <div className={styles.statRow}>
              <span>B 水晶</span>
              <b>{S7D_CRYSTAL_B.length}</b>
            </div>
            <div className={styles.statRow}>
              <span>桥梁格数</span>
              <b>{S7D_BRIDGES.length}</b>
            </div>
            <div className={styles.statRow}>
              <span>⚔️ 修为台</span>
              <b>{S7D_ATK_BOOST.length}</b>
            </div>
            <div className={styles.statRow}>
              <span>💚 生命泉</span>
              <b>{S7D_SPRING.length}</b>
            </div>
            <div className={styles.statRow}>
              <span>🧘 心境坛</span>
              <b>{S7D_MND_BOOST.length}</b>
            </div>
            <div className={styles.statRow}>
              <span>🔥 魔瘴地</span>
              <b>{S7D_MIASMA.length}</b>
            </div>
          </div>

          <div className={styles.rulesBox}>
            <h3 className={styles.rulesTitle}>⚔️ 胜负规则</h3>
            <ul className={styles.rulesList}>
              <li><b>歼灭胜</b>：敌方全 18 张卡进弃牌区</li>
              <li><b>占领胜</b>：独占敌方水晶连续 3 回合</li>
              <li><b>河道</b>：仅能通过 3 座桥过河</li>
              <li><b>出生点</b>：单位登场只能在本阵营出生点出现</li>
            </ul>
          </div>
        </motion.div>
      </div>
    </div>
  );
};

interface LegendItemProps {
  color: string;
  label: string;
}

const LegendItem: React.FC<LegendItemProps> = ({ color, label }) => (
  <div className={styles.legendItem}>
    <div className={styles.legendSwatch} style={{ backgroundColor: color }} />
    <span>{label}</span>
  </div>
);

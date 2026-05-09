import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { MusicToggle } from '@/components/MusicToggle';
import { FooterSlogan } from '@/components/FooterSlogan';
import { VersionLabel } from '@/components/VersionLabel';
import { PrimaryButton } from '@/components/PrimaryButton';
import { SaveSystem, useGameStore } from '@/stores/gameStore';
import { getCachedImage } from '@/utils/imageCache';
import type { SaveSlot } from '@/types/game';
import styles from './S2_MainMenu.module.css';

/**
 * S2 主菜单
 * ──────────────────────────────────────────
 * 2026-05-09 重构：
 *   - 移除所有测试入口（保留仅生产环境用按钮）
 *   - 载入弹窗顶部新增"自动存档"槽位（玩家在游戏中点击"返回主菜单"
 *     时由 SaveSystem.autoSave() 写入），便于一键续玩
 */
export const S2_MainMenu: React.FC = () => {
  const navigate = useNavigate();
  const [showLoadModal, setShowLoadModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const loadFromSave = useGameStore((s) => s.loadFromSave);
  const slots = SaveSystem.getAllSlots();          // [slot1, slot2, slot3]
  const autoSlot = SaveSystem.getAutoSlot();       // slot 0（自动存档）

  /** 载入存档：写入 store 后跳剧情页（与原行为一致） */
  const handleLoadSlot = (s: SaveSlot) => {
    loadFromSave(s);
    setShowLoadModal(false);
    navigate('/story');
  };

  /** 渲染"存档时间"小字（仅自动存档槽展示） */
  const formatTime = (iso: string): string => {
    try {
      const d = new Date(iso);
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      const h = String(d.getHours()).padStart(2, '0');
      const mi = String(d.getMinutes()).padStart(2, '0');
      return `${m}-${day} ${h}:${mi}`;
    } catch {
      return '';
    }
  };

  return (
    <div className={styles.screen}>
      {/* 单张合成背景（水墨+立绘+标题一体） — 使用缓存的blob URL */}
      <div className={styles.bg} style={{ backgroundImage: `url(${getCachedImage('s1_combined')})` }} />

      {/* z4: 三按钮（最上层） */}
      <div className={styles.buttons}>
        <PrimaryButton label="开始游戏" onClick={() => navigate('/select')} />
        <PrimaryButton label="载入游戏" onClick={() => setShowLoadModal(true)} />
        <PrimaryButton label="游戏设置" onClick={() => setShowSettingsModal(true)} />
      </div>

      <MusicToggle />
      <VersionLabel />
      <FooterSlogan />

      <AnimatePresence>
        {showLoadModal && (
          <motion.div className={styles.overlay} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setShowLoadModal(false)}>
            <motion.div className={styles.modal} initial={{ scale: 0.92 }} animate={{ scale: 1 }} exit={{ scale: 0.92 }} onClick={(e) => e.stopPropagation()}>
              <h2 className={styles.mTitle}>选择存档</h2>

              {/* 自动存档槽（slot=0）—— 玩家"返回主菜单"时写入 */}
              <button
                className={styles.slot}
                disabled={!autoSlot}
                onClick={() => autoSlot && handleLoadSlot(autoSlot)}
              >
                <span className={styles.slotLabel}>⏱ 自动存档</span>
                {autoSlot
                  ? <span className={styles.slotInfo}>{autoSlot.heroName} · 第{autoSlot.chapter}章 · {formatTime(autoSlot.timestamp)}</span>
                  : <span className={styles.slotEmpty}>(尚无自动存档)</span>}
              </button>

              {/* 手动存档槽 1/2/3 */}
              {slots.map((s, i) => (
                <button key={i} className={styles.slot} disabled={!s} onClick={() => s && handleLoadSlot(s)}>
                  <span className={styles.slotLabel}>存档 {i + 1}</span>
                  {s ? <span className={styles.slotInfo}>{s.heroName} · 第{s.chapter}章</span> : <span className={styles.slotEmpty}>(空)</span>}
                </button>
              ))}
              <button className={styles.closeBtn} onClick={() => setShowLoadModal(false)}>关闭</button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showSettingsModal && (
          <motion.div className={styles.overlay} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setShowSettingsModal(false)}>
            <motion.div className={styles.modal} initial={{ scale: 0.92 }} animate={{ scale: 1 }} exit={{ scale: 0.92 }} onClick={(e) => e.stopPropagation()}>
              <h2 className={styles.mTitle}>游戏设置</h2>
              <p className={styles.placeholder}>开发中...</p>
              <button className={styles.closeBtn} onClick={() => setShowSettingsModal(false)}>关闭</button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

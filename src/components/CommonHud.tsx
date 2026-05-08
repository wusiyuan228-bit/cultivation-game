/**
 * CommonHud - 通用右下角常驻HUD
 * 统一规范：所有非抽卡界面都应挂载，和 BackButton / MusicToggle 一起构成 "4件套" 常驻控件。
 *
 * 内部使用 CollectionModal（复用 S4 弹窗样式：列表 → 详情翻转）
 *
 * Props:
 *   - chapter?: 当前章节，传递给 CollectionModal 用于控制战斗技能可见性（默认1）
 */
import React, { useState } from 'react';
import { useGameStore } from '@/stores/gameStore';
import { CollectionModal } from './CollectionModal';
import styles from './CommonHud.module.css';

interface Props {
  chapter?: number;
}

export const CommonHud: React.FC<Props> = ({ chapter = 1 }) => {
  const heroId = useGameStore((s) => s.heroId);
  const spiritStones = useGameStore((s) => s.spiritStones);
  const ownedCardIds = useGameStore((s) => s.ownedCardIds);
  const [showCollection, setShowCollection] = useState(false);

  // 角色总数 = 主角(1) + ownedCardIds 去重后数量
  const totalCollected =
    (heroId ? 1 : 0) + ownedCardIds.filter((id) => id !== heroId).length;

  return (
    <>
      <div className={styles.hud}>
        <div className={styles.spiritStones}>
          已获得灵石: <strong>{spiritStones}</strong>
        </div>
        <button
          className={styles.collectionBtn}
          onClick={() => setShowCollection(true)}
          type="button"
        >
          已收集角色: <strong>{totalCollected}</strong>
        </button>
      </div>

      <CollectionModal
        open={showCollection}
        onClose={() => setShowCollection(false)}
        chapter={chapter}
      />
    </>
  );
};

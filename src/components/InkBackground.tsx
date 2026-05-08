import React from 'react';
import styles from './InkBackground.module.css';

interface Props {
  /** 可选覆盖背景图 */
  imageSrc?: string;
  /** 0~1 遮罩透明度（图片越淡值越大） */
  veilOpacity?: number;
}

/**
 * 水墨背景 — 默认用代码绘制渐变+远近山
 * 如提供 imageSrc 则叠加图片
 */
export const InkBackground: React.FC<Props> = ({ imageSrc, veilOpacity = 0 }) => {
  return (
    <div className={styles.bg}>
      {/* 底色水墨雾 */}
      <div className={styles.fog} />
      {/* 远山 */}
      <div className={styles.farMountain} />
      {/* 近山 */}
      <div className={styles.nearMountain} />
      {imageSrc && (
        <>
          <img className={styles.image} src={imageSrc} alt="" />
          {veilOpacity > 0 && (
            <div
              className={styles.veil}
              style={{ background: `rgba(10, 10, 16, ${veilOpacity})` }}
            />
          )}
        </>
      )}
    </div>
  );
};

import React from 'react';
import styles from './GameLogo.module.css';

interface Props {
  size?: 'large' | 'medium';
}

export const GameLogo: React.FC<Props> = ({ size = 'large' }) => {
  return (
    <div className={styles.wrap} data-size={size}>
      <h1 className={styles.logo}>仙战·天渊篇</h1>
    </div>
  );
};

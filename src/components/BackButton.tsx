import React from 'react';
import styles from './BackButton.module.css';

interface Props {
  onClick: () => void;
}

export const BackButton: React.FC<Props> = ({ onClick }) => {
  return (
    <button className={styles.back} onClick={onClick} aria-label="返回主菜单" type="button">
      <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 11l9-8 9 8" />
        <path d="M5 10v10a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V10" />
      </svg>
    </button>
  );
};

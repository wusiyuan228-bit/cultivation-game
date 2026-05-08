import React from 'react';
import styles from './BackButton.module.css';

interface Props {
  onClick: () => void;
}

export const BackButton: React.FC<Props> = ({ onClick }) => {
  return (
    <button className={styles.back} onClick={onClick} aria-label="返回" type="button">
      <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M19 12H5" />
        <path d="M12 19l-7-7 7-7" />
      </svg>
    </button>
  );
};

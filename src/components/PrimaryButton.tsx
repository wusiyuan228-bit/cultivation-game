import React from 'react';
import styles from './PrimaryButton.module.css';

interface Props {
  label: string;
  onClick?: () => void;
  disabled?: boolean;
}

export const PrimaryButton: React.FC<Props> = ({ label, onClick, disabled }) => {
  return (
    <button
      type="button"
      className={styles.btn}
      onClick={onClick}
      disabled={disabled}
    >
      <span className={styles.corner} data-side="left" />
      <span className={styles.text}>{label}</span>
      <span className={styles.corner} data-side="right" />
    </button>
  );
};

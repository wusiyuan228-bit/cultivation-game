import React from 'react';
import styles from './CtaButton.module.css';

interface Props {
  label: string;
  onClick?: () => void;
  disabled?: boolean;
}

export const CtaButton: React.FC<Props> = ({ label, onClick, disabled }) => {
  return (
    <button
      type="button"
      className={styles.cta}
      onClick={onClick}
      disabled={disabled}
    >
      <span className={styles.text}>{label}</span>
    </button>
  );
};

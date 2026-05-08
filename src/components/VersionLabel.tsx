import React from 'react';
import styles from './VersionLabel.module.css';

export const VersionLabel: React.FC<{ version?: string }> = ({ version = '1.0.2' }) => {
  return <div className={styles.version}>Ver. {version}</div>;
};

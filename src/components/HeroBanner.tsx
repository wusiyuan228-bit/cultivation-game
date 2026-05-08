import React from 'react';
import { HEROES_S1S2_ORDER } from '@/data/heroConstants';
import styles from './HeroBanner.module.css';

export const HeroBanner: React.FC = () => {
  return (
    <div className={styles.banner}>
      {HEROES_S1S2_ORDER.map((h) => (
        <div className={styles.column} key={h.id}>
          <div className={styles.portraitWrap}>
            <img
              className={styles.portrait}
              src={h.portrait}
              alt={h.name}
              draggable={false}
            />
            <div className={styles.fadeBottom} />
          </div>
          <div className={styles.plaque}>
            <span className={styles.plaqueText}>{h.name}</span>
          </div>
        </div>
      ))}
    </div>
  );
};

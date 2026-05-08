import React from 'react';
import styles from './FooterSlogan.module.css';

const DEFAULT_SLOGAN = '线上战棋机制剧本杀，扮演国漫角色进入天渊宗夺宝';

interface Props {
  text?: string;
}

export const FooterSlogan: React.FC<Props> = ({ text = DEFAULT_SLOGAN }) => {
  return (
    <div className={styles.footer}>
      <span className={styles.text}>{text}</span>
    </div>
  );
};

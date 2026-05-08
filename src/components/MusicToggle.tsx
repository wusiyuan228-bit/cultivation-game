import React from 'react';
import { useAudioStore } from '@/stores/audioStore';
import styles from './MusicToggle.module.css';

export const MusicToggle: React.FC = () => {
  const bgmEnabled = useAudioStore((s) => s.bgmEnabled);
  const toggleBgm = useAudioStore((s) => s.toggleBgm);
  return (
    <button
      className={styles.toggle}
      onClick={toggleBgm}
      aria-label={bgmEnabled ? '关闭音乐' : '开启音乐'}
      type="button"
    >
      {bgmEnabled ? (
        <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
          <path d="M9 18V5l12-2v13M9 18a2 2 0 11-4 0 2 2 0 014 0zM21 16a2 2 0 11-4 0 2 2 0 014 0z" strokeWidth="1.8" stroke="currentColor" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 18V5l12-2v13" />
          <path d="M9 18a2 2 0 11-4 0 2 2 0 014 0zM21 16a2 2 0 11-4 0 2 2 0 014 0z" />
          <line x1="3" y1="3" x2="21" y2="21" stroke="currentColor" strokeWidth="2" />
        </svg>
      )}
    </button>
  );
};

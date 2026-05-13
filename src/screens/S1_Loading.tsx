import React, { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { MusicToggle } from '@/components/MusicToggle';
import { FooterSlogan } from '@/components/FooterSlogan';
import { VersionLabel } from '@/components/VersionLabel';
import { useAudioStore } from '@/stores/audioStore';
import { preloadAllImages, isAllImagesCached, warmupRemainingImages } from '@/utils/imageCache';
import { preloadEarlyChapters } from '@/utils/storyCache';
import { asset } from '@/utils/assetPath';
import styles from './S1_Loading.module.css';

export const S1_Loading: React.FC = () => {
  const navigate = useNavigate();
  const [progress, setProgress] = useState(0);
  const playBgm = useAudioStore((s) => s.playBgm);
  const doneRef = useRef(false);

  useEffect(() => {
    playBgm('main_theme');

    if (isAllImagesCached()) {
      setProgress(1);
      warmupRemainingImages();
      setTimeout(() => navigate('/menu'), 300);
      return;
    }

    // 两阶段加载：图片(60%) + 剧情JSON ch1-2(40%)
    let imgProgress = 0;
    let storyProgress = 0;

    function updateTotal() {
      const total = imgProgress * 0.6 + storyProgress * 0.4;
      setProgress(total);
      if (total >= 0.99 && !doneRef.current) {
        doneRef.current = true;
        setProgress(1);
        // 后台预热剩余卡牌（绑定SSR/SR/奖池SSR/奖池SR），不阻塞跳转
        warmupRemainingImages();
        setTimeout(() => navigate('/menu'), 400);
      }
    }

    // 阶段1：预加载图片
    preloadAllImages((p) => {
      imgProgress = p;
      updateTotal();
    });

    // 阶段2：预加载6角色 × {ch1, ch2a, ch2b} = 18个JSON
    preloadEarlyChapters((p) => {
      storyProgress = p;
      updateTotal();
    });
  }, [navigate, playBgm]);

  return (
    <div className={styles.screen} onClick={() => { if (progress > 0.5) navigate('/menu'); }}>
      {/* 单张合成背景（水墨+立绘+标题一体） */}
      <div className={styles.bg} style={{ backgroundImage: `url(${asset('images/bg/s1_combined.jpg')})` }} />

      <motion.div
        className={styles.barWrap}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.3, duration: 0.4 }}
      >
        <div className={styles.barOuter}>
          <div className={styles.barFlower} />
          <div className={styles.barTrack}>
            <div className={styles.barFill} style={{ width: `${progress * 100}%` }} />
          </div>
          <div className={styles.barFlower} />
        </div>
        <div className={styles.barLabel}>
          {progress < 1 ? `加载中 ${Math.round(progress * 100)}%` : '加载完成'}
        </div>
      </motion.div>

      <MusicToggle />
      <VersionLabel />
      <FooterSlogan />
    </div>
  );
};

import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { BackButton } from '@/components/BackButton';
import { MusicToggle } from '@/components/MusicToggle';
import { CommonHud } from '@/components/CommonHud';
import { CtaButton } from '@/components/CtaButton';

import { useHeroes } from '@/hooks/useConfig';
import { getCachedImage } from '@/utils/imageCache';
import { HEROES_S3_ORDER, HERO_BIO, TYPE_CHAR, TYPE_TOKEN, HEROES_S1S2_ORDER } from '@/data/heroConstants';
import { useGameStore, SaveSystem } from '@/stores/gameStore';
import { preloadLaterChapters } from '@/utils/storyCache';
import type { Hero, HeroId } from '@/types/game';
import styles from './S3_CharacterSelect.module.css';

export const S3_CharacterSelect: React.FC = () => {
  const navigate = useNavigate();
  const { heroes, error, loading } = useHeroes();
  const [hoverId, setHoverId] = useState<HeroId | null>(null);
  const [selectedId, setSelectedId] = useState<HeroId | null>(null);
  const setHero = useGameStore((s) => s.setHero);

  /** 按S3顺序排列的Hero数据 */
  const heroesInS3Order = useMemo(() => {
    if (!heroes) return [];
    const map = new Map<HeroId, Hero>();
    for (const h of heroes) map.set(h.id as HeroId, h);
    return HEROES_S3_ORDER.map((id) => ({
      id,
      hero: map.get(id),
      visual: HEROES_S1S2_ORDER.find((v) => v.id === id)!,
    }));
  }, [heroes]);

  const activeId = selectedId ?? hoverId;
  const activeHero = useMemo(() => {
    if (!activeId || !heroes) return null;
    return heroes.find((h) => h.id === activeId) ?? null;
  }, [activeId, heroes]);

  const handleEnter = () => {
    if (!selectedId || !activeHero) return;
    setHero(selectedId, activeHero.name);
    // 后台预加载该角色ch3-6剧情（ch1-2已在S1加载完毕）
    preloadLaterChapters(selectedId);
    SaveSystem.save(1);
    navigate('/story');
  };

  if (error) {
    return (
      <div className={styles.screen}>
        <div className={styles.errorBox}>
          <div>角色数据加载失败</div>
          <div className={styles.errorDetail}>{error}</div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.screen}>
      {/* 水墨背景 — 使用缓存的blob URL */}
      <div
        className={styles.bg}
        style={{ backgroundImage: `url(${getCachedImage('s3_bg')})` }}
      />

      <BackButton onClick={() => navigate('/menu')} />
      <MusicToggle />
      <CommonHud chapter={1} />

      {/* 6张角色卡 */}
      {loading ? (
        <div className={styles.loadingHint}>加载中...</div>
      ) : (
        <div className={styles.cardRow}>
          {heroesInS3Order.map(({ id, hero, visual }) => {
            const isHover = hoverId === id;
            const isSelected = selectedId === id;
            const isActive = isHover || isSelected;
            return (
              <div
                key={id}
                className={`${styles.card} ${isActive ? styles.cardActive : ''} ${isSelected ? styles.cardSelected : ''}`}
                onMouseEnter={() => setHoverId(id)}
                onMouseLeave={() => setHoverId(null)}
                onClick={() => setSelectedId(id)}
              >
                {/* 类型角标 */}
                <div
                  className={styles.typeBadge}
                  style={{ background: TYPE_TOKEN[visual.type] }}
                >
                  {TYPE_CHAR[visual.type]}
                </div>

                {/* 立绘 — 使用缓存的blob URL */}
                <div
                  className={styles.portraitBox}
                  style={{
                    backgroundImage: `url(${getCachedImage(id)})`,
                  }}
                />

                {/* 角色名竖排 */}
                <div className={styles.nameVertical}>
                  {visual.name.split('').map((c, i) => (
                    <span key={i}>{c}</span>
                  ))}
                </div>

                {/* 选中后的属性叠加 */}
                {isActive && hero && (
                  <div className={styles.statsOverlay}>
                    <span>修为{hero.run_card.atk}</span>
                    <span>心境{hero.run_card.mnd}</span>
                    <span>生命{hero.run_card.hp}</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* 底部面板 / 提示 */}
      <div className={styles.bottomZone}>
        <AnimatePresence mode="wait">
          {activeHero ? (
            <motion.div
              key="panel"
              className={styles.infoPanel}
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 30 }}
              transition={{ duration: 0.2 }}
            >
              <div className={styles.infoRow}>
                <span className={styles.infoLabel}>招募技能：</span>
                <span className={styles.infoContent}>
                  <strong>{activeHero.battle_card.skills.run_skill?.name ?? '—'}</strong>
                  {activeHero.battle_card.skills.run_skill
                    ? ` — ${activeHero.battle_card.skills.run_skill.desc}`
                    : ''}
                  <em className={styles.infoNote}>（抽卡环节使用）</em>
                </span>
              </div>
              <div className={styles.infoRow}>
                <span className={styles.infoLabel}>战斗技能：</span>
                <span className={styles.infoContent}>
                  <em className={styles.infoNote}>（战斗环节揭晓）</em>
                </span>
              </div>
              <div className={styles.infoRow}>
                <span className={styles.infoLabel}>人物介绍：</span>
                <span className={styles.infoContent}>
                  {HERO_BIO[activeHero.id as HeroId] ?? '—'}
                </span>
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="hint"
              className={styles.hintText}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
            >
              请选择你的道友
            </motion.div>
          )}
        </AnimatePresence>

        {selectedId && (
          <motion.div
            className={styles.ctaZone}
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.25 }}
          >
            <CtaButton label="踏入天渊" onClick={handleEnter} />
          </motion.div>
        )}
      </div>
    </div>
  );
};

import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { MusicToggle } from '@/components/MusicToggle';
import { FooterSlogan } from '@/components/FooterSlogan';
import { VersionLabel } from '@/components/VersionLabel';
import { PrimaryButton } from '@/components/PrimaryButton';
import { SaveSystem, useGameStore } from '@/stores/gameStore';
import { getCachedImage } from '@/utils/imageCache';
import type { SaveSlot } from '@/types/game';
import { loadRecruitPool2, loadRecruitPool3 } from '@/systems/recruit/cardPoolLoader';
import styles from './S2_MainMenu.module.css';

export const S2_MainMenu: React.FC = () => {
  const navigate = useNavigate();
  const [showLoadModal, setShowLoadModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const loadFromSave = useGameStore((s) => s.loadFromSave);
  const setHero = useGameStore((s) => s.setHero);
  const setChapter = useGameStore((s) => s.setChapter);
  const setSegmentIndex = useGameStore((s) => s.setSegmentIndex);
  const addCard = useGameStore((s) => s.addCard);
  const slots = SaveSystem.getAllSlots();

  /**
   * 🧪 测试入口：直接跳第五章剧情起点。
   *   - 若未选角则自动注入塘散 + 其他主角卡
   */
  const handleGoCh5Test = () => {
    const st = useGameStore.getState();
    if (!st.heroId) {
      setHero('hero_tangsan' as any, '塘散');
      ['hero_xiaowu', 'hero_xiaoyan', 'hero_wanglin', 'hero_hanli', 'hero_xuner'].forEach((id) => addCard(id));
    }
    setChapter(5);
    setSegmentIndex(0);
    navigate('/story');
  };

  /**
   * 🧪 测试入口：S8c 最终密谈。
   *   - 若未选角则自动注入寒立（摇摆位）+ 其他主角卡，便于测试站边弹窗
   *   - 若已选角（非摇摆位）则直接进入，验证"跳过站边弹窗直接跳转"逻辑
   */
  const handleGoS8cTest = () => {
    const st = useGameStore.getState();
    if (!st.heroId) {
      setHero('hero_hanli' as any, '寒立');
      ['hero_tangsan', 'hero_xiaowu', 'hero_xiaoyan', 'hero_wanglin', 'hero_xuner'].forEach((id) => addCard(id));
    }
    navigate('/s8?round=3');
  };

  /**
   * 🧪 测试入口：S7D 坠魔谷大战备战。
   *   - 每次强制设置主角为萧焱（B派固定），其他5张卡齐全
   *   - 每次都重算 setFinalFaction，便于演示摇摆位随机分配的多样性
   *   - 每次都清空 s7dAiLineups，强制重新生成 5 个 AI 的阵容
   */
  const handleGoS7dTest = () => {
    setHero('hero_xiaoyan' as any, '萧焱');
    ['hero_tangsan', 'hero_xiaowu', 'hero_hanli', 'hero_wanglin', 'hero_xuner'].forEach((id) => addCard(id));
    // 萧焱默认是 B 派：触发一次 setFinalFaction 以重算 swingAssignment（内部含随机）
    useGameStore.getState().setFinalFaction('B');
    // 清空 AI 阵容缓存，强制 S7D_PreBattle 重新生成
    useGameStore.getState().setS7DAiLineups(null);
    navigate('/s7d');
  };

  /**
   * 🧪 测试入口：S7D 备战选卡页（直达）。
   *   - 主角萧焱 + 5 位主角作为"其他卡"候选
   *   - 再额外加入 6 张常见池卡（SR×2 + R×2 + N×2），凑成候选池 ≥ 11 张
   *   - 清空上次选卡记录，保证每次进入都是空槽
   */
  const handleGoS7dDeployTest = () => {
    setHero('hero_xiaoyan' as any, '萧焱');
    ['hero_tangsan', 'hero_xiaowu', 'hero_hanli', 'hero_wanglin', 'hero_xuner'].forEach((id) => addCard(id));
    // 额外塞 6 张常见卡（id 以抽卡池约定命名：SR-xx / R-xx / N-xx）
    ['SR-1', 'SR-2', 'R-1', 'R-2', 'N-1', 'N-2'].forEach((id) => addCard(id));
    useGameStore.getState().setFinalFaction('B');
    useGameStore.getState().setS7DDeployedCards(null); // 清空上次选择
    navigate('/s7d/deploy');
  };

  /**
   * 🧪 测试入口：S7D 首发登场页（直达）。
   *   - 前置：与备战测试相同（主角 + 候选池）
   *   - 预置 s7dDeployedCards = 5 张固定卡，跳过备战选卡步骤
   *   - 清空上次首发记录，保证每次进入都是空槽
   */
  const handleGoS7dLineupTest = () => {
    setHero('hero_xiaoyan' as any, '萧焱');
    ['hero_tangsan', 'hero_xiaowu', 'hero_hanli', 'hero_wanglin', 'hero_xuner'].forEach((id) => addCard(id));
    ['SR-1', 'SR-2', 'R-1', 'R-2', 'N-1', 'N-2'].forEach((id) => addCard(id));
    useGameStore.getState().setFinalFaction('B');
    // 预置 5 张备战卡：优先 3 位主角 + 2 张 SR 池卡
    useGameStore.getState().setS7DDeployedCards([
      'hero_tangsan', 'hero_xiaowu', 'hero_hanli', 'SR-1', 'SR-2',
    ]);
    useGameStore.getState().setS7DStarters(null); // 清空上次首发
    navigate('/s7d/lineup');
  };

  const handleLoadSlot = (s: SaveSlot) => {
    loadFromSave(s);
    setShowLoadModal(false);
    navigate('/story');
  };

  return (
    <div className={styles.screen}>
      {/* 单张合成背景（水墨+立绘+标题一体） — 使用缓存的blob URL */}
      <div className={styles.bg} style={{ backgroundImage: `url(${getCachedImage('s1_combined')})` }} />

      {/* z4: 三按钮（最上层） */}
      <div className={styles.buttons}>
        <PrimaryButton label="开始游戏" onClick={() => navigate('/select')} />
        <PrimaryButton label="载入游戏" onClick={() => setShowLoadModal(true)} />
        <PrimaryButton label="游戏设置" onClick={() => setShowSettingsModal(true)} />
        <PrimaryButton label="⚔ S7B 宗门比武（测试）" onClick={() => navigate('/s7b?mode=test')} />
        <PrimaryButton label="🏆 S7C 宗门大比·首场2v2（测试）" onClick={() => navigate('/s7c?sect1')} />
        <PrimaryButton label="🏆 S7C 宗门大比·次场3v3（测试）" onClick={() => navigate('/s7c?sect2')} />
        <PrimaryButton label="🎲 S6c 精英招募·纯SSR（测试）" onClick={() => navigate('/s6r?pool=3')} />
        <PrimaryButton label="🗣 S8b 二次密谈（测试）" onClick={() => navigate('/s8?round=2')} />
        <PrimaryButton label="🗣 S8c 最终密谈+站边（测试）" onClick={handleGoS8cTest} />
        <PrimaryButton label="⚔ S7D 坠魔谷·决战备战（测试）" onClick={handleGoS7dTest} />
        <PrimaryButton label="🗂 S7D 备战选卡·挑5张（测试）" onClick={handleGoS7dDeployTest} />
        <PrimaryButton label="🎯 S7D 首发登场·挑2张（测试）" onClick={handleGoS7dLineupTest} />
        <PrimaryButton label="⚕ S7D 战斗区补位（测试·Demo）" onClick={() => {
          // 同备战预置，但要求先有首发数据才能演示"部分阵亡→补位"
          setHero('hero_xiaoyan' as any, '萧焱');
          ['hero_tangsan', 'hero_xiaowu', 'hero_hanli', 'hero_wanglin', 'hero_xuner'].forEach((id) => addCard(id));
          ['SR-1', 'SR-2', 'R-1', 'R-2', 'N-1', 'N-2'].forEach((id) => addCard(id));
          useGameStore.getState().setFinalFaction('B');
          useGameStore.getState().setS7DDeployedCards([
            'hero_tangsan', 'hero_xiaowu', 'hero_hanli', 'SR-1', 'SR-2',
          ]);
          // 预置首发 2 张：用于演示 "一张锁定 + 一张阵亡 + 4 张手牌候选"
          useGameStore.getState().setS7DStarters(['hero_xiaoyan', 'hero_tangsan']);
          navigate('/s7d/reinforce');
        }} />
        <PrimaryButton label="🗺 S7D 坠魔谷地图预览" onClick={() => navigate('/s7d/map')} />
        <PrimaryButton label="⚔ S7D 决战战场（测试·可视化）" onClick={async () => {
          // 一键预置：主角 + 5 张备战 + 2 张首发，直接跳到战斗地图
          setHero('hero_xiaoyan' as any, '萧焱');
          ['hero_tangsan', 'hero_xiaowu', 'hero_hanli', 'hero_wanglin', 'hero_xuner'].forEach((id) => addCard(id));
          // 从真实卡池加载 SSR/SR 卡（避免占位ID找不到数据）
          try {
            const [ssrPool, srPool] = await Promise.all([
              loadRecruitPool3(), // SSR 池
              loadRecruitPool2(), // SR 池
            ]);
            const ssrPicks = ssrPool.slice(0, 3).map((c) => c.id);
            const srPicks = srPool.slice(0, 2).map((c) => c.id);
            const picks = [...ssrPicks, ...srPicks];
            picks.forEach((id) => addCard(id));
            useGameStore.getState().setFinalFaction('A');
            useGameStore.getState().setS7DDeployedCards(picks);
            // 首发选两张 SSR（先出场战力更强）
            useGameStore.getState().setS7DStarters(ssrPicks.slice(0, 2));
            // 清空AI阵容使其重新生成（基于新玩家阵容）
            useGameStore.getState().setS7DAiLineups(null);
            navigate('/s7d/battle');
          } catch (e) {
            console.error('[S7D测试] 卡池加载失败，使用占位ID兜底', e);
            ['SSR-1', 'SSR-2', 'SSR-3', 'SR-1', 'SR-2'].forEach((id) => addCard(id));
            useGameStore.getState().setFinalFaction('A');
            useGameStore.getState().setS7DDeployedCards([
              'SSR-1', 'SSR-2', 'SSR-3', 'SR-1', 'SR-2',
            ]);
            useGameStore.getState().setS7DStarters(['SSR-1', 'SSR-2']);
            useGameStore.getState().setS7DAiLineups(null);
            navigate('/s7d/battle');
          }
        }} />
        <PrimaryButton label="📖 第五章剧情（测试绑定卡奖励）" onClick={handleGoCh5Test} />
      </div>

      <MusicToggle />
      <VersionLabel />
      <FooterSlogan />

      <AnimatePresence>
        {showLoadModal && (
          <motion.div className={styles.overlay} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setShowLoadModal(false)}>
            <motion.div className={styles.modal} initial={{ scale: 0.92 }} animate={{ scale: 1 }} exit={{ scale: 0.92 }} onClick={(e) => e.stopPropagation()}>
              <h2 className={styles.mTitle}>选择存档</h2>
              {slots.map((s, i) => (
                <button key={i} className={styles.slot} disabled={!s} onClick={() => s && handleLoadSlot(s)}>
                  <span className={styles.slotLabel}>存档 {i + 1}</span>
                  {s ? <span className={styles.slotInfo}>{s.heroName} · 第{s.chapter}章</span> : <span className={styles.slotEmpty}>(空)</span>}
                </button>
              ))}
              <button className={styles.closeBtn} onClick={() => setShowLoadModal(false)}>关闭</button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showSettingsModal && (
          <motion.div className={styles.overlay} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setShowSettingsModal(false)}>
            <motion.div className={styles.modal} initial={{ scale: 0.92 }} animate={{ scale: 1 }} exit={{ scale: 0.92 }} onClick={(e) => e.stopPropagation()}>
              <h2 className={styles.mTitle}>游戏设置</h2>
              <p className={styles.placeholder}>开发中...</p>
              <button className={styles.closeBtn} onClick={() => setShowSettingsModal(false)}>关闭</button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

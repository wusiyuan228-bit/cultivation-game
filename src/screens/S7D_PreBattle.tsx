/**
 * S7D_PreBattle · 坠魔谷大战 · 备战界面
 *
 * 职责：
 *   1. 公布最终阵营规则：3v3，玩家阵营 vs 敌对阵营
 *   2. 展示玩家队友（3人）和敌对阵容（3人）
 *   3. 提供「整理卡组」入口（暂复用 S6 整理页占位）
 *   4. 点击「出征坠魔谷」跳转 S7_Battle 决战模式
 *
 * 阵营计算规则（读取自 gameStore）：
 *   - finalFaction：玩家所属派 ('A' 护道 / 'B' 弑道)
 *   - swingAssignment：寒立 / 旺林的最终归属（由 setFinalFaction 自动写入）
 *   - 固定阵营：塘散/小舞儿→A，萧焱/薰儿→B
 */
import React, { useMemo, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useGameStore } from '@/stores/gameStore';
import { HEROES_DATA } from '@/data/heroesData';
import type { Hero, HeroId } from '@/types/game';
import { BackButton } from '@/components/BackButton';
import { MusicToggle } from '@/components/MusicToggle';
import { CommonHud } from '@/components/CommonHud';
import { getCachedImage } from '@/utils/imageCache';
import { generateAllAiLineups, type AILineup } from '@/utils/s7dAiLineup';
import {
  getPoolCardById,
  loadRecruitPool1,
  loadRecruitPool2,
  loadRecruitPool3,
} from '@/systems/recruit/cardPoolLoader';
import styles from './S7D_PreBattle.module.css';

/** 阵营标签文案 */
const FACTION_LABEL: Record<'A' | 'B', string> = {
  A: '护道派',
  B: '弑道派',
};

const FACTION_MOTTO: Record<'A' | 'B', string> = {
  A: '护道心剑如磐石，以一己性命斩断魔咎',
  B: '以极端换真理，以一剑破千年门规',
};

/** 根据主角ID判断英雄属于哪派（综合 heroesData.faction 与 swingAssignment） */
function resolveHeroFaction(
  hero: Hero,
  swingAssignment: { hanli: 'A' | 'B'; wanglin: 'A' | 'B' } | null,
): 'A' | 'B' {
  if (hero.faction === '摇摆') {
    if (hero.id === 'hero_hanli') return swingAssignment?.hanli ?? 'A';
    if (hero.id === 'hero_wanglin') return swingAssignment?.wanglin ?? 'B';
  }
  return hero.faction === 'B' ? 'B' : 'A';
}

export const S7D_PreBattle: React.FC = () => {
  const navigate = useNavigate();
  const heroId = useGameStore((s) => s.heroId);
  const finalFaction = useGameStore((s) => s.finalFaction);
  const swingAssignment = useGameStore((s) => s.swingAssignment);
  const ownedCardIds = useGameStore((s) => s.ownedCardIds);
  const s7dAiLineups = useGameStore((s) => s.s7dAiLineups);
  const setS7DAiLineups = useGameStore((s) => s.setS7DAiLineups);
  const [aiLoaded, setAiLoaded] = useState<boolean>(!!s7dAiLineups);

  // 进入时若尚未生成 AI 阵容 → 立即生成并写入 store（下一章若重入仍用同一份）
  useEffect(() => {
    if (s7dAiLineups || !heroId) {
      setAiLoaded(true);
      return;
    }
    const resolvedFaction: 'A' | 'B' = (() => {
      if (finalFaction === 'A' || finalFaction === 'B') return finalFaction;
      const mh = HEROES_DATA.find((h) => h.id === heroId);
      if (!mh) return 'A';
      return mh.faction === 'B' ? 'B' : 'A';
    })();
    let cancelled = false;
    // 并行加载卡池缓存（供 getPoolCardById 使用）与生成 AI 阵容
    Promise.all([
      loadRecruitPool1().catch(() => null),
      loadRecruitPool2().catch(() => null),
      loadRecruitPool3([]).catch(() => null),
      generateAllAiLineups({
        playerHeroId: heroId,
        playerFaction: resolvedFaction,
        swingAssignment,
        ownedCardIds,
      }),
    ])
      .then(([, , , lineups]) => {
        if (cancelled) return;
        setS7DAiLineups(lineups);
        setAiLoaded(true);
      })
      .catch((err) => {
        console.error('[S7D_PreBattle] 生成 AI 阵容失败', err);
        if (!cancelled) setAiLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [heroId, s7dAiLineups, finalFaction, swingAssignment, ownedCardIds, setS7DAiLineups]);

  /** 分组计算两队阵容 */
  const { playerTeam, enemyTeam, playerFaction, enemyFaction } = useMemo(() => {
    // 玩家阵营兜底：若 finalFaction 未写入，按主角的 heroesData 默认；若仍无，默认 A
    const resolvedPlayerFaction: 'A' | 'B' = (() => {
      if (finalFaction === 'A' || finalFaction === 'B') return finalFaction;
      const mh = HEROES_DATA.find((h) => h.id === heroId);
      if (!mh) return 'A';
      if (mh.faction === 'A') return 'A';
      if (mh.faction === 'B') return 'B';
      return 'A';
    })();
    const resolvedEnemyFaction: 'A' | 'B' = resolvedPlayerFaction === 'A' ? 'B' : 'A';

    const player: Hero[] = [];
    const enemy: Hero[] = [];
    HEROES_DATA.forEach((h) => {
      const f = resolveHeroFaction(h, swingAssignment);
      if (f === resolvedPlayerFaction) player.push(h);
      else enemy.push(h);
    });

    // 玩家主角排在第一位
    player.sort((a, b) => (a.id === heroId ? -1 : b.id === heroId ? 1 : 0));

    return {
      playerTeam: player,
      enemyTeam: enemy,
      playerFaction: resolvedPlayerFaction,
      enemyFaction: resolvedEnemyFaction,
    };
  }, [heroId, finalFaction, swingAssignment]);

  const handleLaunch = () => {
    // 出征 → 备战选卡页（挑选 5 张参战卡）→ 再由该页跳转 S7_Battle?mode=final
    navigate('/s7d/deploy');
  };

  const handleManage = () => {
    // 复用 S6 整理页作为备战卡组整理（后续可扩展专用页）
    navigate('/s6?from=s7d');
  };

  return (
    <div className={styles.screen}>
      {/* 顶部通用控件 */}
      <BackButton onClick={() => navigate('/menu')} />
      <MusicToggle />
      <CommonHud chapter={5} />

      {/* 标题 */}
      <motion.div
        className={styles.topBar}
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
      >
        <div className={styles.topTitle}>坠魔谷 · 决战备战</div>
        <div className={styles.topSubtitle}>3 V 3 · 阵容已定 · 存亡一线</div>
      </motion.div>

      {/* 三栏对战公布区 */}
      <div className={styles.arenaPanel}>
        {/* 玩家阵营 */}
        <FactionColumn
          side="player"
          faction={playerFaction}
          team={playerTeam}
          playerId={heroId}
          aiLineups={s7dAiLineups}
          aiLoaded={aiLoaded}
        />

        {/* VS */}
        <motion.div
          className={styles.versusColumn}
          initial={{ opacity: 0, scale: 0.6 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.7, delay: 0.25 }}
        >
          <div className={styles.vs}>VS</div>
          <div className={styles.vsBadge}>3 V 3</div>
        </motion.div>

        {/* 敌对阵营 */}
        <FactionColumn
          side="enemy"
          faction={enemyFaction}
          team={enemyTeam}
          playerId={heroId}
          aiLineups={s7dAiLineups}
          aiLoaded={aiLoaded}
        />
      </div>

      {/* 整理卡组（左下） */}
      <button className={styles.manageBtn} onClick={handleManage} type="button">
        🗂 整理卡组
      </button>

      {/* 底部提示 + 出征 */}
      <motion.div
        className={styles.bottomBar}
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay: 0.5 }}
      >
        <div className={styles.bottomHint}>
          天渊宗裂痕已深，坠魔谷剑指阴阳。此战为终局，败者道消身灭 —— 道友，已备妥一切？
        </div>
        <button className={styles.launchBtn} onClick={handleLaunch} type="button">
          出征坠魔谷
        </button>
      </motion.div>
    </div>
  );
};

// ==============================================================
// FactionColumn · 单侧阵营展示柱
// ==============================================================
interface FactionColumnProps {
  side: 'player' | 'enemy';
  faction: 'A' | 'B';
  team: Hero[];
  playerId: HeroId | null;
  aiLineups: Record<string, AILineup> | null;
  aiLoaded: boolean;
}

const FactionColumn: React.FC<FactionColumnProps> = ({ side, faction, team, playerId, aiLineups, aiLoaded }) => {
  const colClass = `${styles.factionColumn} ${side === 'player' ? styles.player : styles.enemy}`;
  const badgeClass = `${styles.factionBadge} ${side === 'player' ? styles.player : styles.enemy}`;

  return (
    <motion.div
      className={colClass}
      initial={{ opacity: 0, x: side === 'player' ? -40 : 40 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.6 }}
    >
      <div className={styles.factionHeader}>
        <div>
          <div className={badgeClass}>{side === 'player' ? '我方' : '敌方'}</div>
          <div className={styles.factionName} style={{ marginTop: 8 }}>
            {faction} · {FACTION_LABEL[faction]}
          </div>
        </div>
        <div className={styles.factionMotto}>{FACTION_MOTTO[faction]}</div>
      </div>

      <div className={styles.memberList}>
        {team.map((h) => (
          <MemberCard
            key={h.id}
            hero={h}
            isPlayer={h.id === playerId}
            aiLineup={h.id === playerId ? null : aiLineups?.[h.id] ?? null}
            aiLoaded={aiLoaded}
          />
        ))}
      </div>
    </motion.div>
  );
};

// ==============================================================
// MemberCard · 单个角色展示卡
// ==============================================================
interface MemberCardProps {
  hero: Hero;
  isPlayer: boolean;
  aiLineup: AILineup | null;
  aiLoaded: boolean;
}

/** 稀有度 → 颜色 */
const RARITY_COLOR: Record<string, string> = {
  N: '#8a8a8a',
  R: '#4a9a6a',
  SR: '#b47bff',
  SSR: '#ffd65e',
  UR: '#a83b3b',
};

const MemberCard: React.FC<MemberCardProps> = ({ hero, isPlayer, aiLineup, aiLoaded }) => {
  const isSwing = hero.faction === '摇摆';
  const avatar = getCachedImage(`${hero.id}_portrait`) || getCachedImage(hero.id) || '';

  const cardClass = [
    styles.memberCard,
    isPlayer ? styles.isPlayer : '',
    isSwing ? styles.isSwing : '',
  ].filter(Boolean).join(' ');

  return (
    <div className={cardClass}>
      <div className={styles.memberTop}>
        <div
          className={styles.memberAvatar}
          style={avatar ? { backgroundImage: `url(${avatar})` } : undefined}
        />
        <div className={styles.memberInfo}>
          <div className={styles.memberName}>
            {hero.name}
            {isPlayer && <span className={styles.memberTag}>主角</span>}
            {isSwing && !isPlayer && (
              <span className={`${styles.memberTag} ${styles.swing}`}>摇摆</span>
            )}
            {!isSwing && !isPlayer && (
              <span className={`${styles.memberTag} ${styles.fixed}`}>固定</span>
            )}
          </div>
          <div className={styles.memberType}>
            {hero.type} · {hero.realm}
          </div>
          <div className={styles.memberStats}>
            <span>HP<b>{hero.battle_card.hp}</b></span>
            <span>攻<b>{hero.battle_card.atk}</b></span>
            <span>心<b>{hero.battle_card.mnd}</b></span>
          </div>
        </div>
      </div>

      {/* AI 5 张战卡缩略条 */}
      {!isPlayer && (
        <div className={styles.aiDeckRow}>
          <span className={styles.aiDeckLabel}>战卡：</span>
          {!aiLoaded ? (
            <span className={styles.aiDeckLoading}>阵容配置中…</span>
          ) : aiLineup ? (
            aiLineup.deployedCards.map((cid) => {
              const p = getPoolCardById(cid);
              const rarity = p?.rarity ?? 'R';
              const color = RARITY_COLOR[rarity] ?? '#888';
              const isStarter = aiLineup.starterCards.includes(cid);
              return (
                <span
                  key={cid}
                  className={`${styles.aiDeckChip} ${isStarter ? styles.aiDeckStarter : ''}`}
                  style={{ borderColor: color, color }}
                  title={`${p?.name ?? cid}（${rarity}）${isStarter ? ' · 首发' : ''}`}
                >
                  {p?.name?.slice(0, 3) ?? cid.slice(0, 3)}
                  <span className={styles.aiDeckChipRarity}>{rarity}</span>
                </span>
              );
            })
          ) : (
            <span className={styles.aiDeckLoading}>阵容缺失</span>
          )}
        </div>
      )}
    </div>
  );
};

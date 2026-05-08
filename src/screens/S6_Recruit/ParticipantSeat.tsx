/**
 * 参与者座位（2026-04-27 重构版）
 *
 * 布局方案：2×3 横排（对应用户草图）
 * - 上排（3 位）：seat2, seat3, seat4
 * - 下排（3 位）：seat1(左), seat0=玩家(中), seat5(右)
 *
 * 功能：
 * - 顺位数字并入名字
 * - "抽卡中" 金色角标（仅 current）
 * - 抽到卡时右侧 drawSlot 显示 1 秒小卡闪现（由父组件控制 flashCard）
 * - "持卡 X 张" 可点击查看他人卡册
 * - 立绘使用 activeCardId 对应的图片（代理后会替换）
 */
import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { Participant, PoolCard } from '@/types/recruit';
import { getCachedImage } from '@/utils/imageCache';
import styles from './ParticipantSeat.module.css';

interface Props {
  participant: Participant;
  orderIndex: number;        // 1~6 抽卡顺序（显示在名字前）
  seatIndex: number;         // 0=玩家/底中，1~5 按顺时针分布
  isCurrent: boolean;
  isHovered: boolean;
  /** 最近抽到的卡（1 秒闪现） */
  flashCard: PoolCard | null;
  onHoverStart: () => void;
  onHoverEnd: () => void;
  onOpenDeck: () => void;    // 点击"持卡 X 张"查看卡册
}

const RARITY_COLOR: Record<string, string> = {
  N: '#8a8a8a',
  R: '#4a9a6a',
  SR: '#3b6fa8',
  SSR: '#c8a14b',
  UR: '#a83b3b',
};

/**
 * 6 个座位的坐标（vh/vw 自适应，无论屏幕尺寸都不错位）
 * 上排：2/3/4，下排：1/0/5
 *
 * 布局规则：
 *  - 玩家/seat0：下排中间，闪现位在右
 *  - seat3：上排中间，闪现位在右
 *  - seat1(下左)/seat2(上左)：贴左侧，闪现位在右
 *  - seat4(上右)/seat5(下右)：贴右侧，闪现位在**左**（row-reverse）
 *
 * 中间两位（0、3）以"立绘盒 200px"为几何中心，不以盒子+闪现位总宽为中心
 */
const SEAT_POSITIONS: Array<{ left: string; top: string; centerX?: boolean }> = [
  // 0 玩家：下排中间（以立绘中心对齐屏幕中线）
  { left: '50%', top: 'calc(100% - 300px)', centerX: true },
  // 1 下排左
  { left: '2vw',  top: 'calc(100% - 300px)' },
  // 2 上排左（紧贴顶栏下沿）
  { left: '2vw',  top: '72px' },
  // 3 上排中（以立绘中心对齐屏幕中线，紧贴顶栏下沿）
  { left: '50%', top: '72px', centerX: true },
  // 4 上排右（用 right 锚定，紧贴顶栏下沿）
  { left: 'auto', top: '72px' },
  // 5 下排右（用 right 锚定）
  { left: 'auto', top: 'calc(100% - 300px)' },
];

// 4 号和 5 号用 right 锚定以适应屏幕宽度
const SEAT_RIGHT: Record<number, string | undefined> = {
  4: '2vw',
  5: '2vw',
};

// 右侧两位（seat4/5）闪现位在立绘左侧（row-reverse）
const SEAT_REVERSED: Record<number, boolean> = {
  4: true,
  5: true,
};

export const ParticipantSeat: React.FC<Props> = ({
  participant,
  orderIndex,
  seatIndex,
  isCurrent,
  isHovered,
  flashCard,
  onHoverStart,
  onHoverEnd,
  onOpenDeck,
}) => {
  const pos = SEAT_POSITIONS[seatIndex] || SEAT_POSITIONS[0];
  const right = SEAT_RIGHT[seatIndex];
  const reversed = SEAT_REVERSED[seatIndex];
  const activeCard = participant.ownedCards.find((c) => c.id === participant.activeCardId);
  const runSkill = activeCard?.runSkill;
  const hasLeft = !!participant.hasLeft;

  // 钳制显示：跳过次数永远不超过上限
  const displaySkipUsed = Math.min(participant.skipUsed, participant.skipLimit);

  // 立绘：使用当前 activeCard 的图片（替换抽卡角色后会跟着换）
  // 约定：主角卡 id 为 hero_xxx；代理卡 id 为 R-n/N-n/bssr_xxx 等，走 getCachedImage 兜底静态路径
  const portraitKey = activeCard?.id || participant.portraitHeroId;
  const portraitUrl = getCachedImage(portraitKey);

  // 代理名称：若当前 activeCard 不是主角原本的卡，显示代理者名字
  const displayName = activeCard?.name || participant.name;

  return (
    <motion.div
      className={`${styles.seat} ${isCurrent ? styles.current : ''} ${pos.centerX ? styles.anchorCenter : ''} ${reversed ? styles.reversed : ''} ${hasLeft ? styles.left : ''}`}
      style={{
        left: pos.left,
        top: pos.top,
        right: right,
      }}
      transition={{ duration: 0.3 }}
    >
      {/* 主卡片（立绘 + 信息） */}
      <div
        className={styles.card}
        onMouseEnter={onHoverStart}
        onMouseLeave={onHoverEnd}
      >
        {isCurrent && !hasLeft && (
          <div className={styles.drawingTag}>抽 卡 中</div>
        )}
        {hasLeft && (
          <div className={styles.leftTag}>招募结束，已离场</div>
        )}

        <div className={styles.portrait}>
          <div
            className={styles.portraitImg}
            style={{ backgroundImage: `url(${portraitUrl})` }}
          />
        </div>

        <div className={styles.info}>
          <div className={styles.nameRow}>
            <span className={styles.orderInName}>{orderIndex}</span>
            <span className={styles.name}>{displayName}</span>
            {participant.isPlayer && <span className={styles.playerTag}>玩家</span>}
          </div>
          <div className={styles.statRow}>
            <span className={styles.gem}>灵石 {participant.gems}</span>
            <span className={styles.skip}>跳 {displaySkipUsed}/{participant.skipLimit}</span>
          </div>
          <div
            className={styles.deckRow}
            onClick={(e) => {
              e.stopPropagation();
              onOpenDeck();
            }}
            title="点击查看已收集卡牌"
          >
            持卡 {participant.ownedCards.length} 张 ▸
          </div>
        </div>

        {/* Hover 技能提示 */}
        <AnimatePresence>
          {isHovered && !hasLeft && (
            <motion.div
              className={styles.skillTip}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
            >
              {runSkill ? (
                <>
                  <div className={styles.skillName}>【{runSkill.name}】</div>
                  <div className={styles.skillDesc}>{runSkill.desc}</div>
                </>
              ) : (
                <div className={styles.noSkillTip}>（此卡无抽卡技能）</div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* 抽到卡闪现位（右侧/左侧卡，1.5 秒） */}
      <div className={styles.drawSlot}>
        <AnimatePresence>
          {flashCard && (
            <motion.div
              key={flashCard.id}
              className={styles.drawFlashCard}
              style={{
                borderColor: RARITY_COLOR[flashCard.rarity],
                color: RARITY_COLOR[flashCard.rarity],
              }}
              initial={{ scale: 0.3, opacity: 0, rotateY: 120, y: 30 }}
              animate={{ scale: 1, opacity: 1, rotateY: 0, y: 0 }}
              exit={{ scale: 0.6, opacity: 0, y: -20 }}
              transition={{ type: 'spring', stiffness: 260, damping: 18 }}
            >
              {/* 立绘缩略图 */}
              <div
                className={styles.drawFlashPortrait}
                style={{ backgroundImage: `url(${getCachedImage(flashCard.id)})` }}
              />
              <span
                className={styles.drawFlashRarity}
                style={{ background: RARITY_COLOR[flashCard.rarity] }}
              >
                {flashCard.rarity}
              </span>
              <div className={styles.drawFlashName}>{flashCard.name}</div>
              <div className={styles.drawFlashStats}>
                <span>{flashCard.atk}攻</span>
                <span>{flashCard.mnd}心</span>
                <span>{flashCard.hp}血</span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
};

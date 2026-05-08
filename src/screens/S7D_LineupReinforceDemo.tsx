/**
 * S7D_LineupReinforceDemo · 补位模式测试页
 *
 * 本页用 **mock 数据**演示 `S7D_Lineup` 的 `reinforce` 模式 UI。
 * 真实触发时机：阶段 5 "战场数据模型扩展" 实装后，由战场系统在角色
 * 阵亡事件中调起本组件。
 *
 * Mock 规则（仅演示）：
 *   - 战斗区锁定：取参战卡第 1 张（s7dStarters 或 s7dDeployedCards[0]）
 *   - 弃牌区：取参战卡第 2 张
 *   - 候选手牌：剩余 4 张
 *   - 需补位：1 张（战斗区还剩 1 张 → 补到 2）
 *   - 队友场上：演示随机 1~2 张
 */
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useGameStore } from '@/stores/gameStore';
import { S7D_Lineup } from './S7D_Lineup';

export const S7D_LineupReinforceDemo: React.FC = () => {
  const navigate = useNavigate();
  const heroId = useGameStore((s) => s.heroId);
  const s7dDeployedCards = useGameStore((s) => s.s7dDeployedCards);
  const s7dStarters = useGameStore((s) => s.s7dStarters);

  // -- 构造 mock 战场数据 --
  const deployed = Array.isArray(s7dDeployedCards) ? s7dDeployedCards : [];
  const allSix = heroId ? [heroId, ...deployed] : [];
  // 优先以玩家首发的 2 张为"假设已上阵"的基础
  const starterPair = s7dStarters && s7dStarters.length === 2 ? s7dStarters : allSix.slice(0, 2);

  // 模拟：starter[0] 仍在战斗区（锁定），starter[1] 阵亡（弃牌）
  const locked = starterPair[0] ? [starterPair[0]] : [];
  const grave = starterPair[1] ? [starterPair[1]] : [];

  const handleConfirm = (picks: string[]) => {
    console.log('[Reinforce Demo] 补位确认：', picks);
    alert(`补位完成（Demo）：${picks.join(', ')}\n\n真实战场由阶段5接入。`);
    navigate('/menu');
  };

  return (
    <S7D_Lineup
      mode="reinforce"
      pickSize={1}
      lockedCards={locked}
      graveyardCards={grave}
      allyOnField={[
        // 队友场上数据示例（留空以验证空态提示）
      ]}
      onReinforceConfirm={handleConfirm}
    />
  );
};

export default S7D_LineupReinforceDemo;

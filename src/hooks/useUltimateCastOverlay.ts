/**
 * useUltimateCastOverlay —— 通用 hook
 *
 * 订阅 store.lastSkillEvent，当 skillType==='ultimate' 时返回一个
 * UltimateCastEvent，并在 durationMs 后自动清空。
 *
 * 由 S7 / S7B / S7D 战斗主屏调用，3 端共用一份取数逻辑。
 */
import { useEffect, useRef, useState } from 'react';
import type { UltimateCastEvent } from '@/components/battle/UltimateCastOverlay';

export interface UltimateCastSourceUnit {
  id: string;
  name: string;
  heroId?: string;
  portrait?: string;
  ultimate?: { name: string; desc?: string } | null;
}

interface UseUltimateCastOverlayArgs {
  /** store 暴露的 lastSkillEvent */
  lastSkillEvent: { unitId: string; skillType: 'battle' | 'ultimate'; ts: number } | null;
  /** 通过 unitId 反查单位（含 heroId/portrait/ultimate.name）；不存在返回 undefined */
  getUnit: (unitId: string) => UltimateCastSourceUnit | undefined;
  /** 总时长，默认 1000ms */
  durationMs?: number;
}

export function useUltimateCastOverlay({
  lastSkillEvent,
  getUnit,
  durationMs = 1000,
}: UseUltimateCastOverlayArgs): UltimateCastEvent | null {
  const [event, setEvent] = useState<UltimateCastEvent | null>(null);
  const timerRef = useRef<number | null>(null);
  const lastTsRef = useRef<number>(0);

  useEffect(() => {
    if (!lastSkillEvent) return;
    if (lastSkillEvent.skillType !== 'ultimate') return;
    if (lastSkillEvent.ts === lastTsRef.current) return;
    lastTsRef.current = lastSkillEvent.ts;

    const unit = getUnit(lastSkillEvent.unitId);
    if (!unit || !unit.ultimate) return;

    setEvent({
      ts: lastSkillEvent.ts,
      unitId: unit.id,
      heroId: unit.heroId,
      heroName: unit.name,
      ultimateName: unit.ultimate.name,
      portrait: unit.portrait,
    });

    if (timerRef.current) window.clearTimeout(timerRef.current);
    // v4 (2026-05-17): 多给 200ms 缓冲，确保 motion keyframes 跑完整轮
    // 立绘的最后淡出阶段（88%~100%）是关键阅读时间，不能被截断
    timerRef.current = window.setTimeout(() => {
      setEvent(null);
      timerRef.current = null;
    }, durationMs + 200);

    return () => {
      // 依赖变更时不立即清空，让特效播完
    };
  }, [lastSkillEvent?.ts, lastSkillEvent?.skillType, lastSkillEvent?.unitId, getUnit, durationMs, lastSkillEvent]);

  // 卸载清理
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, []);

  return event;
}

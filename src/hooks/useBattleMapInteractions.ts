/**
 * useBattleMapInteractions
 * ----------------------------------------------------------------------------
 * 战斗地图交互通用 Hook —— 抽离自 S7B/S7C 战斗页，使 S7D（坠魔谷决战）
 * 也能复用同一套交互体验。
 *
 * 提供的能力：
 *   1. 鼠标拖拽地图（左键 + 中键）+ 4px 阈值区分点击/拖拽
 *   2. 滚轮缩放（以鼠标点为锚点，0.4x ~ 2x）
 *   3. BFS 寻路 + 鼠标悬停路径预览（hoverPath）
 *   4. 逐格移动动画（200ms / 格，可配置）
 *
 * 设计原则：
 *   - 与具体 store / 数据模型解耦：通过 options.canStand / options.onStepMove
 *     等回调把"格子可否站立"、"如何走一步"交给上层
 *   - 直接操作 DOM（transformRef），不触发 React 重渲染，保证拖拽流畅
 *   - 支持 S7B (BattleUnit) 和 S7D (BattleCardInstance) 两套数据模型
 *
 * 使用方式（示例）：
 *   const {
 *     mapAreaRef, mapViewportRef,
 *     handlePointerDown, handlePointerMove, handlePointerUp,
 *     hoverPath, movingPath, isDraggingNow,
 *     startMoveAlong, computePathTo,
 *   } = useBattleMapInteractions({
 *     rows: 12, cols: 18,
 *     selectedUnitPos: selected ? { row: selected.position!.row, col: selected.position!.col } : null,
 *     hoverCell,
 *     moveRange: reachableCells,
 *     canStand: (r, c) => isCellWalkable(r, c),
 *     onStepMove: (to) => store.moveUnitStep(unitId, to.row, to.col),
 *   });
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
  type PointerEvent as ReactPointerEvent,
} from 'react';

// ============================================================================
// 类型定义
// ============================================================================

export interface GridPosLite {
  row: number;
  col: number;
}

export interface HoverCellInput extends GridPosLite {
  /** 鼠标在格子内的归一化 X 位置（0~1，可选；用于多最短路径时偏好选择） */
  mx?: number;
  /** 鼠标在格子内的归一化 Y 位置（0~1，可选） */
  my?: number;
}

export interface UseBattleMapInteractionsOptions {
  /** 地图行数 */
  rows: number;
  /** 地图列数 */
  cols: number;
  /** 当前选中单位的位置（null = 未选中） */
  selectedUnitPos: GridPosLite | null;
  /** 当前鼠标悬停的格子 */
  hoverCell: HoverCellInput | null;
  /** 当前可移动到的格子集合 */
  moveRange: GridPosLite[];
  /**
   * 该格子是否可站立（用于 BFS 寻路）。
   * 通常实现：`!isObstacle(r,c) && !isOccupiedByOtherUnit(r,c, selfId)`
   */
  canStand: (row: number, col: number) => boolean;
  /** 单步移动回调：上层应在这里调用 store.moveUnitStep / 等价方法 */
  onStepMove: (to: GridPosLite) => void;
  /** 单步动画间隔（毫秒），默认 200 */
  stepInterval?: number;
  /** 缩放下限（默认 0.4） */
  minScale?: number;
  /** 缩放上限（默认 2.0） */
  maxScale?: number;
  /** 拖拽生效的最小位移阈值（px，默认 4） */
  dragThreshold?: number;
  /**
   * Hook 是否启用。disabled=true 时不会绑定 wheel；
   * 用于阵容选择期等地图未挂载阶段。
   */
  enabled?: boolean;
}

export interface UseBattleMapInteractionsResult {
  /** 绑定到外层固定容器（事件接收层） */
  mapAreaRef: RefObject<HTMLDivElement>;
  /** 绑定到内层 transform 视口（被拖拽/缩放的层） */
  mapViewportRef: RefObject<HTMLDivElement>;

  /** 把这三个 handler 绑到 mapArea 上 */
  handlePointerDown: (e: ReactPointerEvent) => void;
  handlePointerMove: (e: ReactPointerEvent) => void;
  handlePointerUp: (e: ReactPointerEvent) => void;

  /** 当前鼠标悬停时计算出的最短路径（包含目标格，不含起点） */
  hoverPath: GridPosLite[] | null;
  /** 当前正在执行逐格动画的路径（动画期间用于高亮） */
  movingPath: GridPosLite[] | null;
  /** 拖拽是否真正发生过位移（用于 cell click 阻断） */
  isDraggingNow: () => boolean;

  /**
   * 沿给定路径执行逐格动画移动。
   * @param path 路径（不含起点）
   * @param onComplete 动画完成回调
   */
  startMoveAlong: (path: GridPosLite[], onComplete?: () => void) => void;

  /**
   * 给定目标格，计算从 selectedUnitPos 出发的最短路径（沿用 hoverPath 的算法）。
   * 主要用于上层在没有 hover 状态时（例如 AI 触发）也能拿到路径。
   */
  computePathTo: (target: GridPosLite) => GridPosLite[] | null;

  /** 提供给外部读取/写回 transform 的引用（高级用法） */
  transformRef: RefObject<{ x: number; y: number; scale: number }>;
  /** 强制刷新 transform 到 DOM（高级用法） */
  applyTransform: () => void;
}

// ============================================================================
// 内部工具
// ============================================================================

const DIRS: Array<[number, number]> = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
];

function buildShortestPath(opts: {
  rows: number;
  cols: number;
  start: GridPosLite;
  target: GridPosLite;
  canStand: (r: number, c: number) => boolean;
  preferVertical: boolean;
}): GridPosLite[] | null {
  const { rows, cols, start, target, canStand, preferVertical } = opts;
  const sr = start.row;
  const sc = start.col;
  const tr = target.row;
  const tc = target.col;
  if (sr === tr && sc === tc) return null;

  // BFS 算每格最短步数（自起点出发）
  const dist: number[][] = Array.from({ length: rows }, () =>
    Array(cols).fill(Infinity),
  );
  dist[sr][sc] = 0;
  const queue: Array<[number, number]> = [[sr, sc]];
  while (queue.length) {
    const [r, c] = queue.shift()!;
    for (const [dr, dc] of DIRS) {
      const nr = r + dr;
      const nc = c + dc;
      if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
      // 起点格自身一定可站，目标格也必须可站，但中间也要 canStand
      // canStand 的含义由调用者决定（通常会排除"非自身的活单位"占位）
      if (!(nr === sr && nc === sc) && !canStand(nr, nc)) continue;
      if (dist[nr][nc] > dist[r][c] + 1) {
        dist[nr][nc] = dist[r][c] + 1;
        queue.push([nr, nc]);
      }
    }
  }
  if (!isFinite(dist[tr][tc])) return null;

  // 方向优先级：根据目标相对位置 + 鼠标象限决定
  const dRow = Math.sign(tr - sr) || 1;
  const dCol = Math.sign(tc - sc) || 1;
  const vStep: [number, number] = [dRow, 0];
  const hStep: [number, number] = [0, dCol];
  const stepPriority: Array<[number, number]> = preferVertical
    ? [vStep, hStep]
    : [hStep, vStep];
  for (const [dr, dc] of DIRS) {
    if (!stepPriority.some(([a, b]) => a === dr && b === dc)) {
      stepPriority.push([dr, dc]);
    }
  }

  // 从起点贪心：每步选 dist 单调递增 1 且能到达终点的邻居
  const path: GridPosLite[] = [];
  let cr = sr;
  let cc = sc;
  const maxSteps = dist[tr][tc];
  for (let step = 0; step < maxSteps; step++) {
    let chosen: [number, number] | null = null;
    for (const [dr, dc] of stepPriority) {
      const nr = cr + dr;
      const nc = cc + dc;
      if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
      if (!isFinite(dist[nr][nc])) continue;
      if (dist[nr][nc] !== step + 1) continue;
      // 从该邻居到终点的曼哈顿距离必须 ≤ 剩余步数
      if (Math.abs(tr - nr) + Math.abs(tc - nc) > maxSteps - (step + 1)) continue;
      chosen = [nr, nc];
      break;
    }
    if (!chosen) break;
    cr = chosen[0];
    cc = chosen[1];
    path.push({ row: cr, col: cc });
  }
  if (path.length !== maxSteps) return null;
  return path;
}

// ============================================================================
// Hook
// ============================================================================

export function useBattleMapInteractions(
  options: UseBattleMapInteractionsOptions,
): UseBattleMapInteractionsResult {
  const {
    rows,
    cols,
    selectedUnitPos,
    hoverCell,
    moveRange,
    canStand,
    onStepMove,
    stepInterval = 200,
    minScale = 0.4,
    maxScale = 2.0,
    dragThreshold = 4,
    enabled = true,
  } = options;

  // ---------------- transform / DOM refs ----------------
  const mapAreaRef = useRef<HTMLDivElement>(null);
  const mapViewportRef = useRef<HTMLDivElement>(null);
  const transformRef = useRef({ x: 0, y: 0, scale: 1 });
  const rafIdRef = useRef<number | null>(null);

  const applyTransform = useCallback(() => {
    if (rafIdRef.current != null) return;
    rafIdRef.current = requestAnimationFrame(() => {
      rafIdRef.current = null;
      const el = mapViewportRef.current;
      if (!el) return;
      const { x, y, scale } = transformRef.current;
      el.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${scale})`;
    });
  }, []);

  // ---------------- 拖拽 ----------------
  const dragState = useRef<{
    isDragging: boolean;
    hasMovedEnough: boolean;
    startX: number;
    startY: number;
    startOffsetX: number;
    startOffsetY: number;
    capturedTarget: Element | null;
    capturedPointerId: number | null;
  }>({
    isDragging: false,
    hasMovedEnough: false,
    startX: 0,
    startY: 0,
    startOffsetX: 0,
    startOffsetY: 0,
    capturedTarget: null,
    capturedPointerId: null,
  });

  const handlePointerDown = useCallback(
    (e: ReactPointerEvent) => {
      // 鼠标：左键(0) 或 中键(1) 都允许拖拽；触屏/笔放行
      if (e.pointerType === 'mouse' && e.button !== 0 && e.button !== 1) return;
      // 中键按下时阻止默认（Win 下中键会触发自动滚动光标，会干扰）
      if (e.button === 1) {
        e.preventDefault();
      }
      const ds = dragState.current;
      ds.startX = e.clientX;
      ds.startY = e.clientY;
      ds.startOffsetX = transformRef.current.x;
      ds.startOffsetY = transformRef.current.y;
      ds.isDragging = true;
      ds.hasMovedEnough = false;
      try {
        (e.target as Element).setPointerCapture?.(e.pointerId);
        ds.capturedTarget = e.target as Element;
        ds.capturedPointerId = e.pointerId;
      } catch {
        // 某些浏览器在 element 已被卸载时抛错，忽略
      }
    },
    [],
  );

  const handlePointerMove = useCallback(
    (e: ReactPointerEvent) => {
      const ds = dragState.current;
      if (!ds.isDragging) return;
      const dx = e.clientX - ds.startX;
      const dy = e.clientY - ds.startY;
      if (!ds.hasMovedEnough && Math.abs(dx) + Math.abs(dy) < dragThreshold) {
        return;
      }
      ds.hasMovedEnough = true;
      transformRef.current.x = ds.startOffsetX + dx;
      transformRef.current.y = ds.startOffsetY + dy;
      applyTransform();
    },
    [applyTransform, dragThreshold],
  );

  const handlePointerUp = useCallback((e: ReactPointerEvent) => {
    const ds = dragState.current;
    ds.isDragging = false;
    // 延迟清除"刚拖拽过"标记，阻止同步 click
    setTimeout(() => {
      ds.hasMovedEnough = false;
    }, 0);
    try {
      (e.target as Element).releasePointerCapture?.(e.pointerId);
    } catch {
      // 忽略
    }
    ds.capturedTarget = null;
    ds.capturedPointerId = null;
  }, []);

  const isDraggingNow = useCallback(
    () => dragState.current.hasMovedEnough,
    [],
  );

  // ---------------- 滚轮缩放（non-passive） ----------------
  useEffect(() => {
    if (!enabled) return;
    const el = mapAreaRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const t = transformRef.current;
      const delta = e.deltaY > 0 ? -0.1 : 0.1;
      const nextScale = Math.min(maxScale, Math.max(minScale, t.scale + delta));
      if (nextScale === t.scale) return;
      const rect = el.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const ratio = nextScale / t.scale;
      t.x = mx - (mx - t.x) * ratio;
      t.y = my - (my - t.y) * ratio;
      t.scale = nextScale;
      applyTransform();
    };
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, [applyTransform, enabled, maxScale, minScale]);

  // ---------------- 路径预览（hoverPath） ----------------
  const moveRangeKeySet = useMemo(() => {
    const s = new Set<string>();
    for (const m of moveRange) s.add(`${m.row},${m.col}`);
    return s;
  }, [moveRange]);

  const hoverPath = useMemo<GridPosLite[] | null>(() => {
    if (!selectedUnitPos || !hoverCell) return null;
    const key = `${hoverCell.row},${hoverCell.col}`;
    if (!moveRangeKeySet.has(key)) return null;
    if (
      hoverCell.row === selectedUnitPos.row &&
      hoverCell.col === selectedUnitPos.col
    ) {
      return null;
    }
    const mx = typeof hoverCell.mx === 'number' ? hoverCell.mx : 0.5;
    const my = typeof hoverCell.my === 'number' ? hoverCell.my : 0.5;
    return buildShortestPath({
      rows,
      cols,
      start: selectedUnitPos,
      target: { row: hoverCell.row, col: hoverCell.col },
      canStand,
      preferVertical: my > mx,
    });
  }, [
    selectedUnitPos,
    hoverCell,
    moveRangeKeySet,
    rows,
    cols,
    canStand,
  ]);

  const computePathTo = useCallback(
    (target: GridPosLite): GridPosLite[] | null => {
      if (!selectedUnitPos) return null;
      return buildShortestPath({
        rows,
        cols,
        start: selectedUnitPos,
        target,
        canStand,
        preferVertical: false,
      });
    },
    [selectedUnitPos, rows, cols, canStand],
  );

  // ---------------- 逐格动画移动 ----------------
  const [movingPath, setMovingPath] = useState<GridPosLite[] | null>(null);
  // 用 ref 防止竞态：上一段动画未结束时启动新动画时取消旧定时器
  const moveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelCurrentMove = useCallback(() => {
    if (moveTimerRef.current) {
      clearTimeout(moveTimerRef.current);
      moveTimerRef.current = null;
    }
    setMovingPath(null);
  }, []);

  const startMoveAlong = useCallback(
    (path: GridPosLite[], onComplete?: () => void) => {
      cancelCurrentMove();
      if (!path || path.length === 0) {
        onComplete?.();
        return;
      }
      setMovingPath(path);
      let i = 0;
      const tick = () => {
        if (i >= path.length) {
          moveTimerRef.current = null;
          setMovingPath(null);
          onComplete?.();
          return;
        }
        const step = path[i];
        try {
          onStepMove(step);
        } catch (err) {
          // 任意一步失败：终止后续动画，但仍调用 onComplete 让上层善后
          // eslint-disable-next-line no-console
          console.error('[useBattleMapInteractions] step move failed', err);
          moveTimerRef.current = null;
          setMovingPath(null);
          onComplete?.();
          return;
        }
        i += 1;
        moveTimerRef.current = setTimeout(tick, stepInterval);
      };
      // 第一步立即触发，让玩家点击立刻有反馈
      tick();
    },
    [cancelCurrentMove, onStepMove, stepInterval],
  );

  // 卸载时清理定时器
  useEffect(() => {
    return () => {
      if (moveTimerRef.current) {
        clearTimeout(moveTimerRef.current);
        moveTimerRef.current = null;
      }
      if (rafIdRef.current != null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
    };
  }, []);

  return {
    mapAreaRef,
    mapViewportRef,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    hoverPath,
    movingPath,
    isDraggingNow,
    startMoveAlong,
    computePathTo,
    transformRef,
    applyTransform,
  };
}

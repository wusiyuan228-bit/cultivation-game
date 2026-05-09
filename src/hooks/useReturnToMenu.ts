/**
 * useReturnToMenu —— 全局"返回主菜单"统一行为 hook
 * ────────────────────────────────────────────────
 * 设计意图（2026-05-09 重构）：
 *   - 所有游戏中的页面顶部"返回"按钮，行为统一为：
 *     1) 调用 SaveSystem.autoSave() 把当前进度写入"自动存档槽（slot=0）"
 *     2) navigate('/menu') 回到主菜单
 *   - 玩家可在主菜单的"载入游戏"弹窗中通过"自动存档"槽位继续游戏，
 *     从而实现"任意时间退出 → 下次直接续玩"的体验。
 *
 * 使用方式：
 *   const returnToMenu = useReturnToMenu();
 *   <BackButton onClick={returnToMenu} />
 *
 * 注意：
 *   - 同流程内的"上一步"返回（如 S7D_Deploy "返回挑选"）不应使用此 hook，
 *     仍维持原 navigate(targetPath) 行为。
 *   - 若当前未选角（heroId 为空），autoSave 会自动跳过写入，避免空数据。
 */

import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { SaveSystem } from '@/stores/gameStore';

export function useReturnToMenu(): () => void {
  const navigate = useNavigate();
  return useCallback(() => {
    try {
      SaveSystem.autoSave();
    } catch (e) {
      // 即使存档失败也不应阻塞玩家返回主菜单
      console.error('[autoSave] 自动存档失败:', e);
    }
    navigate('/menu');
  }, [navigate]);
}

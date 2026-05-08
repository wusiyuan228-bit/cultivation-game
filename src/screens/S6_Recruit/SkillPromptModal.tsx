/**
 * 技能提示弹窗（预留，当前主界面直接用 post_draw panel）
 */
import React from 'react';

interface Props {
  open: boolean;
  onUse: () => void;
  onCancel: () => void;
  skillName: string;
  skillDesc: string;
}

export const SkillPromptModal: React.FC<Props> = () => null;

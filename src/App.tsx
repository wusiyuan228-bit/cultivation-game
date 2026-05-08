import { useEffect, useRef, useCallback } from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { S1_Loading } from '@/screens/S1_Loading';
import { S2_MainMenu } from '@/screens/S2_MainMenu';
import { S3_CharacterSelect } from '@/screens/S3_CharacterSelect';
import { S4_StoryReading } from '@/screens/S4_StoryReading';
import { S5a_BattleTrial } from '@/screens/S5a_BattleTrial';
import { S5b_QuizTrial } from '@/screens/S5b_QuizTrial';
import { S5c_MentorshipChoice } from '@/screens/S5c_MentorshipChoice';
import { S6_Preparation } from '@/screens/S6_Preparation';
import { S6_Recruit } from '@/screens/S6_Recruit';
import { S8_Negotiation } from '@/screens/S8_Negotiation';
import { S7_Battle } from '@/screens/S7_Battle';
import { S7B_Battle } from '@/screens/S7B_Battle';
import { S7D_PreBattle } from '@/screens/S7D_PreBattle';
import { S7D_Deploy } from '@/screens/S7D_Deploy';
import { S7D_Lineup } from '@/screens/S7D_Lineup';
import { S7D_LineupReinforceDemo } from '@/screens/S7D_LineupReinforceDemo';
import { S7D_MapPreview } from '@/screens/S7D_MapPreview';
import { S7D_Battle } from '@/screens/S7D_Battle';

/** 设计稿基准尺寸 */
const DESIGN_W = 1920;
const DESIGN_H = 1080;

export default function App() {
  const stageRef = useRef<HTMLDivElement>(null);

  const resize = useCallback(() => {
    const el = stageRef.current;
    if (!el) return;

    const winW = window.innerWidth;
    const winH = window.innerHeight;

    // 取最短边适配方向：确保整个画布都能显示
    const scale = Math.min(winW / DESIGN_W, winH / DESIGN_H);

    el.style.width = `${DESIGN_W}px`;
    el.style.height = `${DESIGN_H}px`;
    el.style.transform = `scale(${scale})`;
    el.style.transformOrigin = 'top left';
    el.style.position = 'absolute';
    el.style.left = `${(winW - DESIGN_W * scale) / 2}px`;
    el.style.top = `${(winH - DESIGN_H * scale) / 2}px`;
  }, []);

  useEffect(() => {
    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, [resize]);

  return (
    <HashRouter>
      <div ref={stageRef} className="app-stage">
        <Routes>
          <Route path="/" element={<S1_Loading />} />
          <Route path="/menu" element={<S2_MainMenu />} />
          <Route path="/select" element={<S3_CharacterSelect />} />
          <Route path="/story" element={<S4_StoryReading />} />
          <Route path="/s5a" element={<S5a_BattleTrial />} />
          <Route path="/s5b" element={<S5b_QuizTrial />} />
          <Route path="/s5c" element={<S5c_MentorshipChoice />} />
          <Route path="/s6" element={<S6_Preparation />} />
          <Route path="/s6r" element={<S6_Recruit />} />
          <Route path="/s8" element={<S8_Negotiation />} />
          <Route path="/s7" element={<S7_Battle />} />
          <Route path="/s7b" element={<S7B_Battle />} />
          <Route path="/s7c" element={<S7B_Battle />} />
          <Route path="/s7d" element={<S7D_PreBattle />} />
          <Route path="/s7d/deploy" element={<S7D_Deploy />} />
          <Route path="/s7d/lineup" element={<S7D_Lineup />} />
          <Route path="/s7d/reinforce" element={<S7D_LineupReinforceDemo />} />
          <Route path="/s7d/map" element={<S7D_MapPreview />} />
          <Route path="/s7d/battle" element={<S7D_Battle />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
    </HashRouter>
  );
}

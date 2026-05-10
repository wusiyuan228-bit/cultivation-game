/**
 * 音频系统 — BGM 控制
 * ──────────────────────────────────────────
 * 2026-05-10 重构：实装真实音频播放
 *   - 全局单例 HTMLAudioElement，loop = true（结束后无缝循环）
 *   - 默认音量 50%；玩家调整通过 setVolume (0~100)
 *   - 持久化字段：bgmEnabled / sfxEnabled / volume
 *   - 浏览器自动播放策略兜底：首次任意用户交互（pointerdown / keydown）
 *     时尝试 play()，规避 NotAllowedError
 *   - 当前仅一首主题曲；预留 playBgm(key) 接口供后续按页面切换 BGM 使用
 */
import { create } from 'zustand';

const LS_KEY = 'cardwar_audio_settings';

/** BGM 资源映射：未来加新曲目只需在此扩展 */
const BGM_SOURCES: Record<string, string> = {
  main_theme: 'audio/bgm/main_theme.mp3',
};

/** 默认主题曲 key —— 全局通用，未来可由页面切换 */
const DEFAULT_BGM = 'main_theme';

interface AudioState {
  /** 是否启用 BGM（右上角音乐按钮 / 设置开关） */
  bgmEnabled: boolean;
  /** 是否启用音效（暂未实装真实音效，预留） */
  sfxEnabled: boolean;
  /** 音量 0-100 */
  volume: number;
  /** 当前正在播放的 BGM key */
  currentBgm: string | null;
  toggleBgm: () => void;
  toggleSfx: () => void;
  /** 设置音量（0-100），实时生效 */
  setVolume: (v: number) => void;
  /** 开始播放某 BGM；若已在播相同 BGM 则不重置 */
  playBgm: (key: string) => void;
  /** 暂停 BGM（不重置 currentBgm，便于 toggle 恢复） */
  stopBgm: () => void;
}

interface PersistedShape {
  bgmEnabled: boolean;
  sfxEnabled: boolean;
  volume: number;
}

function loadInitial(): PersistedShape {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const v = JSON.parse(raw) as Partial<PersistedShape>;
      return {
        bgmEnabled: typeof v.bgmEnabled === 'boolean' ? v.bgmEnabled : true,
        sfxEnabled: typeof v.sfxEnabled === 'boolean' ? v.sfxEnabled : true,
        volume: typeof v.volume === 'number' ? clamp(v.volume, 0, 100) : 50,
      };
    }
  } catch {
    /* ignore */
  }
  return { bgmEnabled: true, sfxEnabled: true, volume: 50 };
}

function persist(state: PersistedShape) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(state));
  } catch {
    /* ignore */
  }
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

/** 全局单例 audio 元素（避免每次切换创建新实例） */
let audioEl: HTMLAudioElement | null = null;

/** 拼接 public 资源 URL，兼容 GitHub Pages 子路径部署 */
function resolveSrc(path: string): string {
  // import.meta.env.BASE_URL 在生产是 "/cultivation-game/"，开发是 "/"
  const base = (import.meta as any).env?.BASE_URL ?? '/';
  return `${base}${path}`.replace(/\/{2,}/g, '/');
}

function ensureAudio(): HTMLAudioElement {
  if (typeof window === 'undefined') {
    // SSR 兜底，理论上不会触发
    return {} as HTMLAudioElement;
  }
  if (!audioEl) {
    audioEl = new Audio();
    audioEl.loop = true;
    audioEl.preload = 'auto';
  }
  return audioEl;
}

export const useAudioStore = create<AudioState>((set, get) => {
  const initial = loadInitial();

  return {
    ...initial,
    currentBgm: null,

    toggleBgm: () => {
      const next = !get().bgmEnabled;
      set({ bgmEnabled: next });
      persist({ bgmEnabled: next, sfxEnabled: get().sfxEnabled, volume: get().volume });
      if (!next) {
        get().stopBgm();
      } else {
        // 重新启动：优先恢复上次的 BGM，否则播默认曲
        const key = get().currentBgm ?? DEFAULT_BGM;
        get().playBgm(key);
      }
    },

    toggleSfx: () => {
      const next = !get().sfxEnabled;
      set({ sfxEnabled: next });
      persist({ bgmEnabled: get().bgmEnabled, sfxEnabled: next, volume: get().volume });
    },

    setVolume: (v: number) => {
      const vol = clamp(Math.round(v), 0, 100);
      set({ volume: vol });
      persist({ bgmEnabled: get().bgmEnabled, sfxEnabled: get().sfxEnabled, volume: vol });
      // 实时同步到 audio 元素（0-1）
      if (audioEl) audioEl.volume = vol / 100;
    },

    playBgm: (key: string) => {
      const src = BGM_SOURCES[key];
      if (!src) {
        // eslint-disable-next-line no-console
        console.warn(`[BGM] 未知 BGM key: ${key}`);
        return;
      }
      set({ currentBgm: key });
      if (!get().bgmEnabled) return;

      const a = ensureAudio();
      const fullSrc = resolveSrc(src);
      // 仅当资源不同（首次或切换曲目）时才重置，否则继续当前进度
      if (a.src.indexOf(fullSrc) === -1) {
        a.src = fullSrc;
      }
      a.loop = true;
      a.volume = get().volume / 100;
      const playPromise = a.play();
      if (playPromise && typeof playPromise.catch === 'function') {
        playPromise.catch(() => {
          // 浏览器自动播放策略：等待用户首次交互后再次尝试
          const tryAgain = () => {
            if (!get().bgmEnabled) return;
            a.play().catch(() => { /* ignore */ });
            window.removeEventListener('pointerdown', tryAgain);
            window.removeEventListener('keydown', tryAgain);
          };
          window.addEventListener('pointerdown', tryAgain, { once: true });
          window.addEventListener('keydown', tryAgain, { once: true });
        });
      }
    },

    stopBgm: () => {
      if (audioEl) {
        audioEl.pause();
      }
    },
  };
});

/**
 * 启动全局 BGM —— 应在 App 初始化时调用一次。
 * 默认播放主题曲 main_theme，并循环播放。
 */
export function bootBgm() {
  const s = useAudioStore.getState();
  s.playBgm(DEFAULT_BGM);
}

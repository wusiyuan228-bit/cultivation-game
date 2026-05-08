import { create } from 'zustand';

const LS_KEY = 'cardwar_audio_settings';

interface AudioState {
  bgmEnabled: boolean;
  sfxEnabled: boolean;
  currentBgm: string | null;
  toggleBgm: () => void;
  toggleSfx: () => void;
  playBgm: (key: string) => void;
  stopBgm: () => void;
}

function loadInitial() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) return JSON.parse(raw) as { bgmEnabled: boolean; sfxEnabled: boolean };
  } catch {
    // ignore
  }
  return { bgmEnabled: true, sfxEnabled: true };
}

function persist(state: { bgmEnabled: boolean; sfxEnabled: boolean }) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(state));
  } catch {
    // ignore
  }
}

export const useAudioStore = create<AudioState>((set, get) => ({
  ...loadInitial(),
  currentBgm: null,

  toggleBgm: () => {
    const next = !get().bgmEnabled;
    set({ bgmEnabled: next });
    persist({ bgmEnabled: next, sfxEnabled: get().sfxEnabled });
    if (!next) get().stopBgm();
    else if (get().currentBgm) get().playBgm(get().currentBgm!);
  },

  toggleSfx: () => {
    const next = !get().sfxEnabled;
    set({ sfxEnabled: next });
    persist({ bgmEnabled: get().bgmEnabled, sfxEnabled: next });
  },

  playBgm: (key: string) => {
    set({ currentBgm: key });
    if (!get().bgmEnabled) return;
    // 接口预留：BGM文件到位后在此实现 Howler/HTMLAudio 播放
    // eslint-disable-next-line no-console
    console.log(`[BGM] playBgm("${key}") — 音频接口预留，待 public/audio/bgm/${key}.mp3 到位`);
  },

  stopBgm: () => {
    // eslint-disable-next-line no-console
    console.log('[BGM] stopBgm()');
  },
}));

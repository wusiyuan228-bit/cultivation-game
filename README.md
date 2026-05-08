# 仙战·天渊篇 — CardWar AI

> 国漫IP仙侠战棋剧本杀

## 技术栈

- **Vite 5** + **React 18** + **TypeScript 5**
- **Zustand** — 全局状态
- **React Router v6** — 界面切换
- **Framer Motion** — 过渡动画
- **霞鹜文楷 LXGW WenKai** + **思源黑体 Noto Sans SC** — Web字体

## 启动

```bash
cd CardWar-AI/04_程序开发/cardwar-ai
npm install
npm run dev        # 启动 http://localhost:3000
npm run typecheck  # TS类型检查
npm run build      # 生产构建
```

## 目录

```
src/
├── main.tsx               React入口
├── App.tsx                HashRouter路由
├── screens/               场景页面
│   ├── S1_Loading.tsx     启动加载
│   ├── S2_MainMenu.tsx    主菜单
│   ├── S3_CharacterSelect.tsx  选角
│   └── S4_StoryReading.tsx     剧情阅读
├── components/            共用UI组件
├── stores/                Zustand store（游戏+音频）
├── hooks/                 自定义hooks
├── data/                  常量/硬编码数据
├── types/                 类型定义
└── styles/                tokens.css + fonts.css + global.css
public/
├── config/                策划可编辑JSON
├── images/                视觉稿+立绘
└── fonts/                 霞鹜文楷TTF
```

## 场景流

```
S1 启动 ──2.4s加载或点击跳过──▶ S2 主菜单
                                  │
                                  ├─开始游戏─▶ S3 选角 ──踏入天渊──▶ S4 剧情
                                  ├─载入游戏─▶ [存档选择] ──▶ S4
                                  └─游戏设置─▶ [占位Modal]
```

## 键盘快捷键（S4剧情）

- `←` 上一页
- `→` / `Space` 下一页

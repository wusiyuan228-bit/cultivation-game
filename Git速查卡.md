# 🎮 修仙卡牌游戏 · Git & 部署速查卡

> 写给自己的备忘录。遇到问题先翻这个。

---

## 🌐 重要链接（收藏到浏览器书签）

| 用途 | 链接 |
|------|------|
| 🎮 **游戏网站** | https://wusiyuan228-bit.github.io/cultivation-game/ |
| 📦 **代码仓库** | https://github.com/wusiyuan228-bit/cultivation-game |
| 🚀 **部署进度** | https://github.com/wusiyuan228-bit/cultivation-game/actions |
| ⚙️ **Pages 设置** | https://github.com/wusiyuan228-bit/cultivation-game/settings/pages |

---

## ⭐ 最常用场景 · 3 条命令走天下

### 场景 A：我改了代码，想发布新版本

```powershell
git add .
git commit -m "改了什么的一句话描述"
git push
```

然后等 2-4 分钟，访问网站看效果。

> 💡 **更简单**：直接双击项目根目录的 `一键更新.bat` 

---

### 场景 B：我只是想看看现在有什么改动

```powershell
git status        # 看哪些文件有变动
git diff          # 看具体改了什么（逐行对比）
```

---

### 场景 C：我想看看部署成功了没

直接打开浏览器访问：https://github.com/wusiyuan228-bit/cultivation-game/actions

看最顶上那一行的图标：
- ⏳ **黄色圆点** = 正在部署
- ✅ **绿色对勾** = 部署成功
- ❌ **红色叉** = 部署失败（点进去看错误日志）

---

## 🆘 紧急场景

### 情况 1：我 push 了之后发现代码写错了！

**不用慌**，直接修 bug 再推一次即可：

```powershell
# 1. 改代码...
# 2. 再推一次覆盖
git add .
git commit -m "修复刚才的bug"
git push
```

GitHub Pages 永远只展示**最后一次成功构建**的版本。

---

### 情况 2：我本地改了但还没 push，想全部撤销

```powershell
# 放弃所有未提交的改动（危险，无法恢复）
git checkout .
git clean -fd     # 删除未追踪的新文件
```

⚠️ **危险操作**！未提交的改动会永久丢失。

---

### 情况 3：我想回到之前某个版本

```powershell
# 查看历史记录
git log --oneline -n 10

# 看到某个版本号（如 abc1234），想回到那个版本
git reset --hard abc1234

# 强制推送覆盖远程（谨慎！）
git push --force
```

---

### 情况 4：GitHub Actions 部署失败了

1. 打开 https://github.com/wusiyuan228-bit/cultivation-game/actions
2. 点击红叉❌的那一行
3. 点击 **build-and-deploy** job
4. 展开报错的步骤，看错误日志
5. 常见原因：
   - TypeScript 类型错误 → 本地跑 `npm run build` 复现 → 修好再推
   - 依赖版本问题 → 检查 `package.json` 是否正确提交
   - YAML 工作流配置问题 → 看 `.github/workflows/deploy.yml`

---

### 情况 5：git push 弹出登录窗口

第一次推送时 GitHub 会要求你登录：
- 方式 1：**浏览器弹窗**（推荐）→ 点"Sign in with browser"→ 在浏览器授权即可
- 方式 2：**Personal Access Token**（PAT）
  - 访问 https://github.com/settings/tokens/new
  - 勾选 `repo` 权限
  - 生成后把 token 当密码填入

一次登录后 Windows 会记住凭据，以后不再弹窗。

---

### 情况 6：提示 `rejected non-fast-forward`

表示远程仓库有你本地没有的改动（比如你直接在 GitHub 网站上改了 README）：

```powershell
git pull --rebase    # 拉取远程改动，并把你的本地改动放在它后面
git push             # 再推一次
```

---

## 📁 Git 基础概念速览

```
【工作区】       【暂存区】        【本地仓库】      【远程仓库GitHub】
   你的文件  ─── git add ──▶  git commit ──▶  git push ──▶
   
                                            ◀── git pull ───
```

| 区域 | 含义 | 常用命令 |
|------|------|---------|
| 工作区 | 当前磁盘上的文件 | `git status` 查看 |
| 暂存区 | 准备要提交的改动 | `git add <文件>` 加入 |
| 本地仓库 | 你电脑上的版本历史 | `git commit` 提交 |
| 远程仓库 | GitHub 上的版本 | `git push` / `git pull` |

---

## 🔍 查询类常用命令

```powershell
# 查看所有提交历史
git log --oneline

# 查看某个文件的修改历史
git log --oneline <文件路径>

# 查看某个版本改了什么
git show <commit-id>

# 查看远程仓库地址
git remote -v

# 查看当前分支
git branch

# 查看所有分支（含远程）
git branch -a
```

---

## 🚫 千万不要做的事

| ⚠️ 不要做 | 原因 |
|---------|------|
| `git push --force` 随便用 | 会覆盖远程历史，别人的工作可能丢失 |
| 在 `main` 分支上做实验性改动 | 每次 push 都会触发部署，可能让网站暂时崩溃 |
| 提交敏感信息（密码/token/密钥） | 公开仓库任何人都能看到 |
| 提交超大文件（>100MB） | Git 会拒绝，还会污染仓库历史 |
| 直接删除 `.git/` 目录 | 整个版本历史都会丢失 |

---

## 🎯 日常工作流建议（推荐养成习惯）

### 每次开始开发前

```powershell
git pull          # 先拉取远程最新版本（防止冲突）
npm run dev       # 启动开发服务器
```

### 开发中

```powershell
# 每完成一个小功能就提交一次（本地）
git add .
git commit -m "完成XX功能"

# 先别急着 push，多攒几次，确认稳定了再 push
```

### 每天结束 / 功能完成时

```powershell
npm run build     # 本地构建验证（非常重要）
git push          # 推送触发部署
```

---

## 💡 小技巧

### 技巧 1：用 VSCode/Cursor 的 Git 图形界面

不想记命令？打开 VSCode 的**源代码管理**面板（左侧第 3 个图标）：
- 看文件改动 ✅
- 点 `+` 加入暂存 ✅
- 输入 commit 信息点勾 ✅
- 点"同步更改"= push ✅

比命令行直观多了。

### 技巧 2：给 commit 信息起规范的名字

```
feat: 新增小风铃觉醒动画
fix: 修复水晶血量不归零bug
style: 调整战斗UI配色
refactor: 重构存档系统
docs: 更新README
```

不强制，但以后看历史更清晰。

### 技巧 3：分支开发大功能（高阶）

```powershell
# 开一个新功能分支（不影响 main）
git checkout -b feat/new-battle-system

# 在这个分支上随便改、随便 commit
# 满意了再合并回 main
git checkout main
git merge feat/new-battle-system
git push
```

适合改动大、想慢慢打磨的场景。

---

## 📊 项目部署架构速览

```
┌─────────────────────────────────────────────────────────┐
│  你的电脑                                                  │
│  ├─ 改代码                                                  │
│  ├─ npm run dev 本地测试                                    │
│  └─ git push ──────────┐                                  │
└────────────────────────┼────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────┐
│  GitHub 仓库 (cultivation-game)                            │
│  ├─ 存储源代码                                              │
│  └─ .github/workflows/deploy.yml 自动触发                   │
│         │                                                  │
│         ▼                                                  │
└─────────┼────────────────────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────────────────────┐
│  GitHub Actions (免费 CI 服务)                             │
│  ├─ 拉取代码                                                │
│  ├─ npm install 安装依赖                                    │
│  ├─ npm run build 构建 dist/                               │
│  └─ 上传 dist/ 到 GitHub Pages                             │
└─────────┼───────────────────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────────────────────┐
│  GitHub Pages 静态托管                                      │
│  🌐 https://wusiyuan228-bit.github.io/cultivation-game/   │
│  任何设备、任何人都能访问                                     │
└─────────────────────────────────────────────────────────┘
```

---

## 📞 求助路径

遇到问题时，请按以下顺序尝试：

1. 查本文档 → 大部分问题都覆盖了
2. 查 GitHub Actions 日志 → 部署问题必看
3. 复制错误信息，问 AI 助手（Knot、ChatGPT、Claude）
4. Google 搜索 `"报错关键字" site:stackoverflow.com`

---

*最后更新：2026-05-09*  
*维护者：你（wusiyuan228-bit）*

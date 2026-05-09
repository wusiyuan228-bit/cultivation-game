@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

REM ============================================================
REM   修仙卡牌游戏 - 一键更新部署脚本
REM   双击运行即可将本地改动推送到 GitHub，自动触发网站更新
REM ============================================================

title 修仙卡牌游戏 - 一键部署

echo.
echo ============================================================
echo            修仙卡牌游戏 - 一键更新部署
echo ============================================================
echo.
echo 本脚本将会：
echo   1. 检查本地改动
echo   2. 可选：本地构建测试（确保代码没坏）
echo   3. 提交并推送到 GitHub
echo   4. GitHub Actions 自动部署到网站
echo.
echo 部署目标: https://wusiyuan228-bit.github.io/cultivation-game/
echo.
echo ============================================================
echo.

REM 切换到脚本所在目录
cd /d "%~dp0"

REM ---------- Step 1: 检查是否有改动 ----------
echo [1/5] 检查本地改动...
echo.
git status --short
if errorlevel 1 (
    echo.
    echo [错误] Git 命令执行失败！请确认：
    echo   - 当前目录是否为 Git 仓库
    echo   - Git 是否已安装
    echo.
    pause
    exit /b 1
)

REM 判断是否有可提交改动
for /f %%i in ('git status --porcelain ^| find /c /v ""') do set CHANGE_COUNT=%%i

if "%CHANGE_COUNT%"=="0" (
    echo.
    echo [提示] 当前没有任何改动需要提交。
    echo 如果你想强制触发一次部署，可以直接输入 "redeploy" 继续。
    echo 否则直接关闭本窗口即可。
    echo.
    set /p FORCE_OPT="请输入 redeploy 强制部署，或按回车退出: "
    if /i not "!FORCE_OPT!"=="redeploy" (
        echo 已取消。
        pause
        exit /b 0
    )
    echo 将创建一个空提交触发重新部署...
    set EMPTY_COMMIT=1
) else (
    echo.
    echo [信息] 检测到 %CHANGE_COUNT% 处改动
    set EMPTY_COMMIT=0
)

echo.

REM ---------- Step 2: 询问是否本地构建测试 ----------
echo [2/5] 本地构建测试（强烈推荐！可避免推送后 Actions 报错）
echo.
set /p DO_BUILD="是否先在本地运行 npm run build 测试构建？(Y/n) 默认 Y: "
if /i "%DO_BUILD%"=="n" (
    echo 跳过本地构建测试。
) else (
    echo.
    echo 开始本地构建... 这可能需要 30 秒左右...
    echo ------------------------------------------------------------
    call npm run build
    if errorlevel 1 (
        echo.
        echo ============================================================
        echo [错误] 本地构建失败！请先修复错误再部署。
        echo ============================================================
        echo.
        pause
        exit /b 1
    )
    echo ------------------------------------------------------------
    echo [OK] 本地构建成功！
)

echo.

REM ---------- Step 3: 输入提交信息 ----------
echo [3/5] 请输入这次改动的简短描述（用于 git commit 记录）
echo       示例：修复了水晶血量显示bug / 新增小风铃觉醒技能 / 调整战斗UI
echo.
set /p COMMIT_MSG="提交说明: "

if "%COMMIT_MSG%"=="" (
    set COMMIT_MSG=update game content
    echo [提示] 未输入，使用默认说明: update game content
)

echo.

REM ---------- Step 4: git add + commit + push ----------
echo [4/5] 提交并推送到 GitHub...
echo.

if "%EMPTY_COMMIT%"=="1" (
    git commit --allow-empty -m "%COMMIT_MSG%"
) else (
    git add .
    if errorlevel 1 (
        echo [错误] git add 失败！
        pause
        exit /b 1
    )
    git commit -m "%COMMIT_MSG%"
    if errorlevel 1 (
        echo [错误] git commit 失败！可能是没有改动或其他原因。
        pause
        exit /b 1
    )
)

echo.
echo 正在推送到 GitHub... 这可能需要几秒到几分钟（取决于改动大小和网速）
echo ------------------------------------------------------------
git push origin main
if errorlevel 1 (
    echo.
    echo ============================================================
    echo [错误] git push 失败！可能原因：
    echo   1. 网络连接问题
    echo   2. GitHub 登录凭证过期（重新输入密码/token）
    echo   3. 远程仓库有其他人的改动（罕见，一人开发不会遇到）
    echo ============================================================
    pause
    exit /b 1
)
echo ------------------------------------------------------------
echo [OK] 推送成功！

echo.

REM ---------- Step 5: 完成提示 ----------
echo [5/5] 完成！
echo.
echo ============================================================
echo                    部署已启动！
echo ============================================================
echo.
echo GitHub Actions 正在自动构建和部署，通常需要 2-4 分钟。
echo.
echo 查看部署进度:
echo   https://github.com/wusiyuan228-bit/cultivation-game/actions
echo.
echo 约 2-4 分钟后访问游戏:
echo   https://wusiyuan228-bit.github.io/cultivation-game/
echo.
echo ============================================================
echo.

REM 询问是否打开 Actions 页面查看进度
set /p OPEN_ACTIONS="是否打开浏览器查看部署进度？(Y/n) 默认 Y: "
if /i not "%OPEN_ACTIONS%"=="n" (
    start https://github.com/wusiyuan228-bit/cultivation-game/actions
)

echo.
echo 本窗口可以关闭了。祝修炼顺利！
echo.
pause
endlocal

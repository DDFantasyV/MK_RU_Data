@echo off
chcp 65001 >nul

rem 固定工作目录，保证相对路径（Live、PT、pfsunpack.exe、web）始终可用
cd /d "%~dp0"

rem 任一步骤报错都会置 1，最后据此跳过站点构建与自动推送
set "FAILED="
set "SUCCESS="

echo 提取正式服文件...
echo.

set "LIVE_GAME_DIR=E:\World_of_Warships"
set "PT_GAME_DIR=E:\Korabli_PT"
set "WORKSPACE_DIR=E:\Korabli_localization_chs\workspace"

echo 检测最新版本号...
for /f %%i in ('dir %LIVE_GAME_DIR%\bin /o:N/b') do set bin_version=%%i
for /f %%i in ('dir "%WORKSPACE_DIR%\cn" /o:D /b ^| findstr /v /i "pt"') do set chs_version=%%i
echo 版本号: %bin_version%
echo 汉化版本: %chs_version%

echo 正在处理文件架构...
for /f "tokens=1,2 delims=." %%a in ("%chs_version%") do (
    set "major_ver=%%a"
    set "minor_ver=%%b"
)
set /a old_minor_ver=minor_ver - 1
if %old_minor_ver% lss 10 (
    set "old_minor_ver=0%old_minor_ver%"
)
set "old_version=%major_ver%.%old_minor_ver%"
if not exist "Live\%old_version%" (
	ren "Live\latest" "%old_version%"
	mkdir "Live\latest"
)

echo 复制 idx 到 res_packages...
copy %LIVE_GAME_DIR%\bin\%bin_version%\idx\*  %LIVE_GAME_DIR%\res_packages >nul
if errorlevel 1 (
    echo [ERROR] 复制正式服 idx 失败
    set "FAILED=1"
)

echo 拆包目标文件...
pfsunpack.exe -x -I content/GameParams_py2.data -I content/GameParams_py3.data -I content/assets.bin -I content/gameplay/*/ship/*/*/*.splash %LIVE_GAME_DIR%\res_packages -o Live\latest
if not exist "Live\latest\content\GameParams_py2.data" if not exist "Live\latest\GameParams.data" (
    echo [ERROR] 未找到正式服 GameParams 文件
    set "FAILED=1"
)

echo 复制本地化文本...
if exist "%WORKSPACE_DIR%\cn\%chs_version%\global.mo" (
    copy /y "%WORKSPACE_DIR%\cn\%chs_version%\global.mo" "Live\latest" >nul
    if errorlevel 1 set "FAILED=1"
)

del /q %WORKSPACE_DIR%\res_packages\*.idx >nul 2>&1

echo.
echo 提取测试服文件...
echo.

echo 检测最新版本号...
for /f %%i in ('dir %PT_GAME_DIR%\bin /o:N/b') do set bin_version=%%i
for /f %%i in ('dir "%WORKSPACE_DIR%\cn" /o:D /b ^| findstr /i "pt"') do set chs_version=%%i
echo 版本号: %bin_version%
echo 汉化版本: %chs_version%

echo 正在处理文件架构...
set "temp_ver=%chs_version:pt=.%"
for /f "tokens=1,2,3 delims=." %%a in ("%temp_ver%") do (
    set "major_ver=%%a"
    set "minor_ver=%%b"
    set "rev_part=%%c"
)
set /a old_minor_ver=minor_ver - 1
if %old_minor_ver% lss 10 (
    set "old_minor_ver=0%old_minor_ver%"
)
set "old_version=%major_ver%.%old_minor_ver%_%rev_part%"
if not exist "PT\%old_version%" (
	ren "PT\latest" "%old_version%"
	mkdir "PT\latest"
)

echo 复制 idx 到 res_packages...
copy %PT_GAME_DIR%\bin\%bin_version%\idx\*  %PT_GAME_DIR%\res_packages >nul
if errorlevel 1 (
    echo [ERROR] 复制测试服 idx 失败
    set "FAILED=1"
)

echo 拆包目标文件...
pfsunpack.exe -x -I content/GameParams_py2.data -I content/GameParams_py3.data -I content/assets.bin -I content/gameplay/*/ship/*/*/*.splash %PT_GAME_DIR%\res_packages -o PT\latest
if not exist "PT\latest\content\GameParams_py2.data" if not exist "PT\latest\GameParams.data" (
    echo [ERROR] 未找到测试服 GameParams 文件
    set "FAILED=1"
)

echo 复制本地化文本...
if exist "%WORKSPACE_DIR%\cn\%chs_version%\global.mo" (
    copy /y "%WORKSPACE_DIR%\cn\%chs_version%\global.mo" "PT\latest" >nul
    if errorlevel 1 set "FAILED=1"
)

del /q %WORKSPACE_DIR%\res_packages\*.idx >nul 2>&1

if defined FAILED (
    echo.
    echo [ERROR] 拆包出错
    goto :finish
)

echo.
echo 更新网站数据...
echo.

rem 优先用仓库旁的 .venv，其次 py 启动器，最后 PATH 里的 python
set "PY_EXE="
if exist "%~dp0..\.venv\Scripts\python.exe" set "PY_EXE=%~dp0..\.venv\Scripts\python.exe"
if not defined PY_EXE (
    where py >nul 2>&1
    if not errorlevel 1 set "PY_EXE=py"
)
if not defined PY_EXE (
    where python >nul 2>&1
    if not errorlevel 1 set "PY_EXE=python"
)

if not defined PY_EXE (
    echo [ERROR] 未找到 Python
    goto :finish
)

set "PYTHONIOENCODING=utf-8"
"%PY_EXE%" -u "web\tools\build.py" --from-major 25
if errorlevel 1 (
    echo.
    echo [ERROR] 网站数据生成失败
    goto :finish
)

echo.
echo 提交并推送...
git rev-parse --is-inside-work-tree >nul 2>&1
if errorlevel 1 (
    echo [ERROR] 当前目录不是 git 仓库
    goto :finish
)

git add .
if errorlevel 1 (
    echo [ERROR] git add 失败
    goto :finish
)

git diff --cached --quiet
if not errorlevel 1 (
    echo [SKIPPED] 没有需要提交的改动
    set "SUCCESS=1"
    goto :finish
)

git commit -m "update to %chs_version%"
if errorlevel 1 (
    echo [ERROR] git commit 失败
    goto :finish
)

echo 正在推送到GitHub...
git push
if errorlevel 1 (
    echo.
    echo [ERROR] git push 失败
    goto :finish
)

set "SUCCESS=1"

:finish
echo.
if defined SUCCESS echo 完成！
if defined FAILED echo 拆包失败，未推送
if not defined SUCCESS if not defined FAILED echo 异常中止，未推送
pause

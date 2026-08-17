@echo off
chcp 65001 >nul

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
set "old_chs_version=%major_ver%.%old_minor_ver%"
if not exist "Live\%old_version%" (
	ren "Live\latest" "%old_version%"
	mkdir "Live\latest"
)

echo 复制 idx 到 res_packages...
copy %LIVE_GAME_DIR%\bin\%bin_version%\idx\*  %LIVE_GAME_DIR%\res_packages >nul

echo 拆包目标文件...
pfsunpack.exe -x -I content/GameParams_py2.data -I content/GameParams_py3.data -I content/assets.bin -I content/gameplay/*/ship/*/*/*.splash %LIVE_GAME_DIR%\res_packages -o Live\latest

echo 复制本地化文本...
if exist "%WORKSPACE_DIR%\cn\%chs_version%\global.mo" (
    copy /y "%WORKSPACE_DIR%\cn\%chs_version%\global.mo" "Live\latest" >nul
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

echo 拆包目标文件...
pfsunpack.exe -x -I content/GameParams_py2.data -I content/GameParams_py3.data -I content/assets.bin -I content/gameplay/*/ship/*/*/*.splash %PT_GAME_DIR%\res_packages -o PT\latest

echo 复制本地化文本...
if exist "%WORKSPACE_DIR%\cn\%chs_version%\global.mo" (
    copy /y "%WORKSPACE_DIR%\cn\%chs_version%\global.mo" "PT\latest" >nul
)

del /q %WORKSPACE_DIR%\res_packages\*.idx >nul 2>&1

echo.
echo 拆包完成！
pause

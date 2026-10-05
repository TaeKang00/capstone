@echo off
setlocal EnableExtensions DisableDelayedExpansion
chcp 65001 >nul
title Salon Desk ERP
pushd "%~dp0"
if errorlevel 1 goto folder_error
if not exist "scripts\start-local.cjs" goto missing_files
if not exist "package-lock.json" goto missing_files
where node >nul 2>nul
if errorlevel 1 goto node_missing
node "scripts\start-local.cjs"
set "SALON_EXIT_CODE=%ERRORLEVEL%"
popd
if not "%SALON_EXIT_CODE%"=="0" pause
exit /b %SALON_EXIT_CODE%

:node_missing
echo.
echo Node.js 24 or newer is required. Install the version that includes npm:
echo https://nodejs.org/
echo Then double-click start.bat again.
popd
pause
exit /b 1

:folder_error
echo Please extract the entire ZIP before running start.bat.
pause
exit /b 1

:missing_files
echo Please extract the entire ZIP and keep start.bat inside the project folder.
popd
pause
exit /b 1

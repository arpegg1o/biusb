@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

:: 1. Check if 'bash' is already directly available in PATH
where bash >nul 2>&1
if %errorlevel% equ 0 (
    bash stamp-version.sh
    goto done
)

:: 2. Check all common Git installation directories on Windows
set "BASH_PATH="
if exist "%LOCALAPPDATA%\Programs\Git\bin\bash.exe" set "BASH_PATH=%LOCALAPPDATA%\Programs\Git\bin\bash.exe"
if not defined BASH_PATH if exist "%ProgramFiles%\Git\bin\bash.exe" set "BASH_PATH=%ProgramFiles%\Git\bin\bash.exe"
if not defined BASH_PATH if exist "%ProgramFiles(x86)%\Git\bin\bash.exe" set "BASH_PATH=%ProgramFiles(x86)%\Git\bin\bash.exe"
if not defined BASH_PATH if exist "%ProgramData%\chocolatey\bin\bash.exe" set "BASH_PATH=%ProgramData%\chocolatey\bin\bash.exe"

if defined BASH_PATH (
    "!BASH_PATH!" stamp-version.sh
    goto done
)

echo Error: Could not locate Git Bash on your system.
echo Please ensure Git for Windows is installed.

:done
echo.
pause
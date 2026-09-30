@echo off
cd /d "%~dp0"

where bash >nul 2>&1
if %errorlevel% neq 0 (
    if exist "C:\Program Files\Git\bin\bash.exe" (
        "C:\Program Files\Git\bin\bash.exe" stamp-version.sh
    ) else (
        echo Error: Git Bash was not found in PATH or in "C:\Program Files\Git\bin\bash.exe".
        pause
        exit /b 1
    )
) else (
    bash stamp-version.sh
)

echo.
pause
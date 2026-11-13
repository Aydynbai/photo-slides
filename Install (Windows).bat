@echo off
rem Photo Slides - Windows installer
set "DEST=%APPDATA%\Adobe\CEP\extensions\PhotoSlides"
if exist "%DEST%" rmdir /s /q "%DEST%"
xcopy "%~dp0PhotoSlides" "%DEST%\" /e /i /q /y >nul
if errorlevel 1 (echo Error: copy failed & pause & exit /b 1)
for %%v in (9 10 11 12 13 14) do reg add "HKCU\Software\Adobe\CSXS.%%v" /v PlayerDebugMode /t REG_SZ /d 1 /f >nul
echo.
echo Photo Slides installed.
echo Restart Premiere Pro: Window ^> Extensions ^> Photo Slides
pause

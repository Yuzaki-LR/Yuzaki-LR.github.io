@echo off
chcp 65001 >nul
setlocal EnableExtensions DisableDelayedExpansion
set "EDITOR_INTERACTIVE=1"
set EDITOR_NO_OPEN 2>nul|"%SystemRoot%\System32\findstr.exe" /x /c:"EDITOR_NO_OPEN=1" >nul
if not errorlevel 1 set "EDITOR_INTERACTIVE="
cd /d "%~dp0" || (
  echo 无法进入网站项目目录，请确认项目文件仍在原位置。
  if defined EDITOR_INTERACTIVE pause
  exit /b 1
)

set "EDITOR_NODE="
call :try_node "%~dp0.local-editor\tools\node\node.exe"
if defined EDITOR_NODE goto start_editor

for /f "delims=" %%N in ('where node 2^>nul') do if not defined EDITOR_NODE call :try_node "%%~fN"
if defined EDITOR_NODE goto start_editor

echo 未找到兼容的 Node.js（需要 22.12.0 或更高版本）。
echo 请保留此窗口，并联系维护者将便携运行时放入项目的 .local-editor\tools\node 目录。
echo 本启动器不会下载软件，也不会修改系统 PATH。
if defined EDITOR_INTERACTIVE pause
exit /b 1

:start_editor
echo 正在启动网站编辑器。浏览器打开后，请保持此窗口开启。
echo 完成编辑后，关闭此窗口即可停止编辑器。
"%EDITOR_NODE%" "editor\server\main.mjs"
set "EDITOR_EXIT=%ERRORLEVEL%"
if not "%EDITOR_EXIT%"=="0" (
  echo 网站编辑器启动或运行失败，请保留上方提示并联系维护者。
  if defined EDITOR_INTERACTIVE pause
)
echo 网站编辑器已关闭。
exit /b %EDITOR_EXIT%

:try_node
set "EDITOR_NODE_CANDIDATE=%~f1"
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -Command "$candidate=[IO.Path]::GetFullPath($env:EDITOR_NODE_CANDIDATE);$root=[IO.Path]::GetPathRoot($candidate);if(-not $root){exit 1};$current=$root;$parts=$candidate.Substring($root.Length).Split([char[]]@([IO.Path]::DirectorySeparatorChar),[StringSplitOptions]::RemoveEmptyEntries);for($index=0;$index -lt $parts.Length;$index++){$current=[IO.Path]::Combine($current,$parts[$index]);try{$item=Get-Item -LiteralPath $current -Force -ErrorAction Stop}catch{exit 1};if(($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){exit 1};if($index -lt ($parts.Length-1)){if(-not $item.PSIsContainer){exit 1}}elseif($item.PSIsContainer -or -not ($item -is [IO.FileInfo])){exit 1}};exit 0" >nul 2>nul || exit /b 0
"%~1" -e "const [major,minor]=process.versions.node.split('.').map(Number);process.exit(major>22||(major===22&&minor>=12)?0:1)" >nul 2>nul || exit /b 0
set "EDITOR_NODE=%~f1"
exit /b 0

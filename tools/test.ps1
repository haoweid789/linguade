# LinguaDE · 一键质量门（构建 → 一致性 → 内容产物 → 装配冒烟 → e2e）
# 用法（在工程根目录）：powershell -File tools/test.ps1
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot

Write-Host '== 1/5 构建（同步模块脚本 + 打包单文件） ==' -ForegroundColor Cyan
python "$PSScriptRoot\build.py"
if ($LASTEXITCODE -ne 0) { Write-Host '构建未通过' -ForegroundColor Red; exit 1 }

Write-Host '== 2/5 一致性校验 ==' -ForegroundColor Cyan
python "$PSScriptRoot\check.py"
if ($LASTEXITCODE -ne 0) { Write-Host '一致性校验未通过' -ForegroundColor Red; exit 1 }

Write-Host '== 3/5 内容产物校验（内容包 schema / 授权红线 / 词库格式） ==' -ForegroundColor Cyan
python "$PSScriptRoot\test_content.py"
if ($LASTEXITCODE -ne 0) { Write-Host '内容产物校验未通过' -ForegroundColor Red; exit 1 }

Write-Host '== 4/5 装配冒烟（Node） ==' -ForegroundColor Cyan
node "$PSScriptRoot\smoke.mjs"
if ($LASTEXITCODE -ne 0) { Write-Host '装配冒烟未通过' -ForegroundColor Red; exit 1 }

Write-Host '== 5/5 e2e 回归（Playwright） ==' -ForegroundColor Cyan
python -m pytest "$root\tests" -q
if ($LASTEXITCODE -ne 0) { Write-Host 'e2e 未通过' -ForegroundColor Red; exit 1 }

Write-Host '全部质量门通过' -ForegroundColor Green
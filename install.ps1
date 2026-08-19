<#
.SYNOPSIS
  将 dsh-github 插件安装到 DSH 的 web / desktop profile（默认两者都装）。
.DESCRIPTION
  1) 把插件包复制到 profile 共享 node_modules（.dsh\profiles\node_modules\dsh-github\）
  2) 在每个 profile 的 cordis.patch.yml 追加 insert 条目（幂等，已存在则跳过）
  3) 打印认证配置指引与重启提示
  可用 -ProfileDir 指定单个 profile 目录；可用 -Profiles 'web','desktop' 选择；
  使用 -WhatIf 预览而不写入。
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\install.ps1            # 装到 web + desktop
  powershell -ExecutionPolicy Bypass -File .\install.ps1 -Profiles desktop
.NOTES
  安装后需重启 DSH（重新加载 profile 的 cordis.patch.yml）才生效。
#>
[CmdletBinding(SupportsShouldProcess = $true)]
param(
  [string[]]$Profiles = @('web', 'desktop'),
  [string]$ProfilesRoot = (Join-Path $HOME '.dsh\profiles'),
  [switch]$Force
)

$ErrorActionPreference = 'Stop'
$PluginName = 'dsh-github'
$PluginId = 'github'
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$NodeModules = Join-Path $ProfilesRoot 'node_modules'
$TargetDir = Join-Path $NodeModules $PluginName

Write-Host '== dsh-github 安装脚本 ==' -ForegroundColor Cyan
Write-Host "插件源目录 : $ScriptDir"
Write-Host "Profiles 根 : $ProfilesRoot"
Write-Host "目标 profile: $($Profiles -join ', ')"

# ---------- 0. 校验 ----------
if (-not (Test-Path $ProfilesRoot)) {
  Write-Warning "找不到 profiles 根目录：$ProfilesRoot（若 DSH 数据目录不在默认位置，请用 -ProfilesRoot 指定）"
  exit 1
}
if (-not (Test-Path (Join-Path $ScriptDir 'package.json'))) {
  Write-Error "当前目录不是插件包根目录（缺少 package.json）：$ScriptDir"
  exit 1
}

# ---------- 1. 复制插件包到共享 node_modules ----------
if ($PSCmdlet.ShouldProcess($TargetDir, "复制插件包到 $TargetDir")) {
  if (-not (Test-Path $NodeModules)) { New-Item -ItemType Directory -Path $NodeModules -Force | Out-Null }
  if ((Test-Path $TargetDir) -and -not $Force) {
    Write-Host "已存在 $TargetDir，跳过复制（用 -Force 覆盖）。" -ForegroundColor Yellow
  } else {
    if (Test-Path $TargetDir) { Remove-Item $TargetDir -Recurse -Force }
    Copy-Item -Path $ScriptDir -Destination $TargetDir -Recurse -Force -Exclude @('install.ps1', '.git')
    Write-Host "✅ 已复制插件包 → $TargetDir" -ForegroundColor Green
  }
}

# ---------- 2. 逐个 profile 追加 cordis.patch.yml insert 条目 ----------
$entry = @"
- insert:
    - id: $PluginId
      name: $PluginName
      config:
        tokenRef: GITHUB_TOKEN
        approvalGate: true
        timeoutMs: 30000
"@

$installed = @()
foreach ($profile in $Profiles) {
  $ProfileDir = Join-Path $ProfilesRoot $profile
  if (-not (Test-Path $ProfileDir)) {
    Write-Warning "跳过：找不到 profile 目录 $ProfileDir"
    continue
  }
  $PatchFile = Join-Path $ProfileDir 'cordis.patch.yml'
  if ($PSCmdlet.ShouldProcess($PatchFile, "追加 insert 条目到 $PatchFile")) {
    $exists = $false
    if (Test-Path $PatchFile) {
      $content = Get-Content $PatchFile -Raw -Encoding UTF8
      $exists = $content -match "id:\s*$PluginId"
    }
    if ($exists) {
      Write-Host "cordis.patch.yml 已包含 $PluginId 条目，跳过（$profile）。" -ForegroundColor Yellow
    } else {
      if (Test-Path $PatchFile) {
        Copy-Item $PatchFile "$PatchFile.bak" -Force
        # 确保追加前文件以换行结尾，避免条目粘连到上一行
        $existingText = Get-Content $PatchFile -Raw -Encoding UTF8
        if (-not $existingText.EndsWith("`n")) { Add-Content -Path $PatchFile -Value "" -Encoding UTF8 }
      }
      Add-Content -Path $PatchFile -Value $entry -Encoding UTF8
      Write-Host "✅ 已在 $PatchFile 追加 insert 条目（原文件备份为 cordis.patch.yml.bak）" -ForegroundColor Green
    }
    $installed += $profile
  }
}

# ---------- 3. 校验 ----------
$ok = $true
if (-not (Test-Path (Join-Path $TargetDir 'index.js'))) {
  Write-Warning "警告：$TargetDir 缺少 index.js，插件可能未复制成功。"
  $ok = $false
}
foreach ($profile in $installed) {
  $PatchFile = Join-Path (Join-Path $ProfilesRoot $profile) 'cordis.patch.yml'
  if (Test-Path $PatchFile) {
    $content = Get-Content $PatchFile -Raw -Encoding UTF8
    if ($content -notmatch "id:\s*$PluginId") {
      Write-Warning "警告：$PatchFile 中未找到插件条目。"
      $ok = $false
    }
  }
}

Write-Host ''
if ($ok) {
  Write-Host '✅ 安装完成。下一步：' -ForegroundColor Green
  Write-Host '  1) 重启 DSH（web / desktop 均需重新加载 cordis.patch.yml）'
  Write-Host '  2) 认证（二选一，持久生效）：'
  Write-Host '     a. PAT：设置环境变量 GITHUB_TOKEN，或在 DSH 设置页为该凭据写入值；'
  Write-Host '     b. OAuth：在插件配置中填入 oauthClientId（+ oauthClientSecret 或设置 GITHUB_OAUTH_CLIENT_SECRET 凭据），'
  Write-Host '        然后在新会话里让模型调用 github_auth_login，浏览器授权一次即可。'
  Write-Host '  3) 验证：让模型调用 github_get_me，应返回当前 GitHub 用户。'
} else {
  Write-Warning '安装未完全成功，请检查上方警告。'
  exit 1
}

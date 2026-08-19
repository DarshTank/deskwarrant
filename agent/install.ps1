<#
.SYNOPSIS
    Registers the DeskWarrant agent to start at logon (build plan §10 Stage 8).

.DESCRIPTION
    Creates a Scheduled Task named "DeskWarrant Agent" that runs the agent at
    user logon, unelevated, in the interactive session.

    Unelevated is deliberate. The agent cannot see the lock screen or UAC
    prompts, and that blast-radius limit is a design property, not an
    oversight -- do NOT add -RunLevel Highest.

.PARAMETER ExePath
    Path to DeskWarrantAgent.exe. Defaults to dist\DeskWarrantAgent.exe
    next to this script.

.PARAMETER Uninstall
    Remove the scheduled task instead of creating it.

.EXAMPLE
    .\install.ps1
    .\install.ps1 -ExePath "C:\Tools\DeskWarrantAgent.exe"
    .\install.ps1 -Uninstall
#>

[CmdletBinding()]
param(
    [string]$ExePath,
    [switch]$Uninstall
)

$ErrorActionPreference = "Stop"
$TaskName = "DeskWarrant Agent"

if ($Uninstall) {
    $existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    if ($existing) {
        Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
        Write-Host "Removed scheduled task '$TaskName'." -ForegroundColor Green
    }
    else {
        Write-Host "No scheduled task named '$TaskName' was found."
    }
    return
}

# ---------- locate the executable ----------

if (-not $ExePath) {
    $scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
    $ExePath = Join-Path $scriptDir "dist\DeskWarrantAgent.exe"
}

if (-not (Test-Path $ExePath)) {
    Write-Error @"
Could not find the agent executable at:
    $ExePath

Build it first:
    .venv\Scripts\python.exe -m PyInstaller deskwarrant.spec --noconfirm

Or pass an explicit path:
    .\install.ps1 -ExePath "C:\path\to\DeskWarrantAgent.exe"
"@
    return
}

$ExePath = (Resolve-Path $ExePath).Path
Write-Host "Agent executable: $ExePath"

# ---------- register ----------
#
# Pairing is no longer a prerequisite. Task Scheduler gives the agent no console
# to prompt on, which used to mean it had to be paired by hand first; it now
# opens a claim and surfaces the approval link through the tray icon instead.

$configPath = Join-Path $env:LOCALAPPDATA "DeskWarrant\config.json"
$needsPairing = -not (Test-Path $configPath)

$existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($existing) {
    Write-Host "Replacing the existing '$TaskName' task."
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}

$action = New-ScheduledTaskAction -Execute $ExePath -WorkingDirectory (Split-Path -Parent $ExePath)

$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME

# Interactive + Limited: the agent needs the desktop session to capture the
# screen and inject input, and must stay unelevated.
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" `
    -LogonType Interactive -RunLevel Limited

$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -RestartCount 3 `
    -RestartInterval (New-TimeSpan -Minutes 1) `
    -ExecutionTimeLimit (New-TimeSpan -Seconds 0) `
    -MultipleInstances IgnoreNew

Register-ScheduledTask -TaskName $TaskName `
    -Action $action `
    -Trigger $trigger `
    -Principal $principal `
    -Settings $settings `
    -Description "Runs the DeskWarrant host agent at logon (unelevated)." | Out-Null

Write-Host ""
Write-Host "Registered '$TaskName' to run at logon." -ForegroundColor Green
Write-Host ""

if ($needsPairing) {
    Write-Host "This PC is not paired yet." -ForegroundColor Yellow
    Write-Host "Start the task below and the agent will open your browser to"
    Write-Host "approve it. If no browser opens, right-click the DeskWarrant"
    Write-Host "tray icon and choose 'Finish pairing'."
    Write-Host ""
}

Write-Host "Start it now with:"
Write-Host "    Start-ScheduledTask -TaskName '$TaskName'"
Write-Host ""
Write-Host "Check status with:"
Write-Host "    Get-ScheduledTask -TaskName '$TaskName' | Get-ScheduledTaskInfo"
Write-Host ""
Write-Host "Logs are written to:"
Write-Host "    $env:LOCALAPPDATA\DeskWarrant\agent.log"

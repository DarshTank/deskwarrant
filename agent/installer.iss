; DeskWarrant agent installer (Inno Setup 6).
;
; Build:  ISCC.exe installer.iss /DAppVersion=0.1.0
; Output: Output\DeskWarrantSetup.exe
;
; Installs per-user into %LOCALAPPDATA%\Programs so there is NO UAC prompt at
; any point. That is not only friendlier -- the agent is deliberately unelevated
; (it cannot touch the lock screen or UAC), so asking for admin to install it
; would claim a privilege the product does not want and does not use.

#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif

#define AppName "DeskWarrant"
#define AppExe "DeskWarrantAgent.exe"
#define TaskName "DeskWarrant Agent"

[Setup]
; Never change AppId -- it is what lets an upgrade replace an existing install
; instead of piling up a second copy.
AppId={{7F2A6C41-4E8B-4D3A-9C15-8B6E2D5A1F03}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher=DeskWarrant
DefaultDirName={autopf}\{#AppName}
DefaultGroupName={#AppName}
DisableProgramGroupPage=yes
DisableDirPage=yes
; Per-user install, no elevation. {autopf} resolves to
; %LOCALAPPDATA%\Programs under this setting.
PrivilegesRequired=lowest
OutputDir=Output
OutputBaseFilename=DeskWarrantSetup
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
; Needs Inno Setup 6.3 or newer for this spelling. There is no 32/64 split under
; {localappdata}\Programs, so ArchitecturesInstallIn64BitMode buys nothing here.
ArchitecturesAllowed=x64compatible
; Upgrades have to replace a running agent. Restart Manager asks it to close
; rather than failing on a locked file.
CloseApplications=yes
RestartApplications=no
UninstallDisplayName={#AppName}

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Files]
Source: "dist\{#AppExe}"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{group}\{#AppName}"; Filename: "{app}\{#AppExe}"
Name: "{group}\Uninstall {#AppName}"; Filename: "{uninstallexe}"

[Run]
; Start at logon, unelevated, in the interactive session. A Scheduled Task
; rather than a Run key because it can restart the agent if it dies, and
; because the task is what install.ps1 already established for developers.
Filename: "{sys}\schtasks.exe"; \
  Parameters: "/Create /F /TN ""{#TaskName}"" /TR ""\""{app}\{#AppExe}\"""" /SC ONLOGON"; \
  Flags: runhidden; \
  StatusMsg: "Registering DeskWarrant to start at logon..."

; Launch straight into pairing: the agent opens a claim and sends the user to
; the console, so the install flows into approval without another step.
Filename: "{app}\{#AppExe}"; \
  Description: "Start {#AppName} and pair this PC"; \
  Flags: nowait postinstall skipifsilent

[UninstallRun]
Filename: "{sys}\schtasks.exe"; Parameters: "/Delete /F /TN ""{#TaskName}"""; \
  Flags: runhidden; RunOnceId: "RemoveTask"
Filename: "{sys}\taskkill.exe"; Parameters: "/F /IM {#AppExe}"; \
  Flags: runhidden; RunOnceId: "StopAgent"

[UninstallDelete]
; The device token lives in Windows Credential Manager, not here, and is
; revoked from the console. This is just the local config and log.
Type: filesandordirs; Name: "{localappdata}\{#AppName}"

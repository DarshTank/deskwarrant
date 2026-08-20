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
#define AppIcon "deskwarrant.ico"

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

; ---- Branding ----------------------------------------------------------
; Sources and a regeneration script live in branding/. Inno reads BMP and ICO
; only, so the rasterised files are committed next to the SVGs they came from.

; The icon on Setup.exe itself. This is the one users see most: in the browser's
; download bar, in Explorer, and on the SmartScreen dialog that an unsigned
; build always shows. A generic icon there is what makes an unsigned installer
; look like something you should not run.
SetupIconFile=branding\{#AppIcon}

; Shown in the header on every page. Sizes are listed explicitly rather than
; matched with a wildcard so it is obvious which scalings ship; Inno picks the
; nearest to the display's DPI.
WizardSmallImageFile=branding\WizardSmall-55x55.bmp,branding\WizardSmall-82x82.bmp,branding\WizardSmall-110x110.bmp

; The tall left banner. With WizardStyle=modern, Inno disables the Welcome page
; by default and this appears on the Finished page -- which is where it belongs
; anyway. Turning the Welcome page back on to show it earlier would buy branding
; at the cost of an extra click, and this installer is deliberately short.
WizardImageFile=branding\WizardLarge-164x314.bmp,branding\WizardLarge-246x471.bmp,branding\WizardLarge-328x628.bmp

; Add/Remove Programs. Points at the installed .ico rather than the agent exe,
; which carries no icon resource of its own yet.
UninstallDisplayIcon={app}\{#AppIcon}

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Files]
Source: "dist\{#AppExe}"; DestDir: "{app}"; Flags: ignoreversion
; Installed, not just compiled in: the shortcuts and the Add/Remove Programs
; entry reference it by path at runtime.
Source: "branding\{#AppIcon}"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{group}\{#AppName}"; Filename: "{app}\{#AppExe}"; \
  IconFilename: "{app}\{#AppIcon}"
Name: "{group}\Uninstall {#AppName}"; Filename: "{uninstallexe}"; \
  IconFilename: "{app}\{#AppIcon}"

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

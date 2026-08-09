; EME MESS installer. Compile with:
;   "C:\Program Files (x86)\Inno Setup 6\ISCC.exe" packaging\installer.iss
; (see packaging/build.ps1 for the full rebuild pipeline). Expects the
; PyInstaller onedir build to already exist at packaging\_build\dist\EME-MESS.

#define MyAppName "EME MESS"
#define MyAppVersion "1.6.1"
#define MyAppExeName "EME-MESS.exe"
#define MyBuildDir "_build\dist\EME-MESS"

[Setup]
AppId={{8C6C6F3E-6B2A-4A2C-9E0A-5B4C6E9B4B21}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher=EME MESS
DefaultDirName={userpf}\{#MyAppName}
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
; Installs under the current user's profile (Local Program Files-equivalent)
; so no admin/UAC prompt is needed on the client's machine.
PrivilegesRequired=lowest
OutputDir=output
OutputBaseFilename=EME-MESS-Setup-{#MyAppVersion}
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
UninstallDisplayIcon={app}\{#MyAppExeName}

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "Create a &desktop shortcut"; GroupDescription: "Additional shortcuts:"

[Files]
Source: "{#MyBuildDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
; The real JWT signing key for this deployment - generated once, kept out of
; git (see .gitignore: packaging/prod.env), installed as {app}\.env so
; backend/config.py's pydantic-settings picks it up at runtime (its
; env_file=".env" resolves relative to the exe's own working directory,
; which Windows sets to {app} for a double-clicked exe). Without this file
; the app silently falls back to the public default key in config.py.
Source: "prod.env"; DestDir: "{app}"; DestName: ".env"; Flags: onlyifdoesntexist

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"
Name: "{group}\Uninstall {#MyAppName}"; Filename: "{uninstallexe}"
Name: "{userdesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "Launch {#MyAppName} now"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
; Uninstall only removes the installed program files (above). The client's
; live data - database, uploads, backups, logs - lives outside {app} at
; %LOCALAPPDATA%\EME MESS\data (see backend/config.py) and is left in place
; on purpose, so uninstall/reinstall never touches their test data.

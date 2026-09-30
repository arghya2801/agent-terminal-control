Unicode true
!include "MUI2.nsh"
Name "ATC"
OutFile "${OUTPUT}"
InstallDir "$LOCALAPPDATA\ATC"
InstallDirRegKey HKCU "Software\atc\ATC" ""
RequestExecutionLevel user
SetCompressor /SOLID lzma
Icon "${ICON}"
UninstallIcon "${ICON}"
VIProductVersion "${VERSION}.0"
VIAddVersionKey "LegalCopyright" "ATC contributors"
VIAddVersionKey "ProductName" "ATC"
VIAddVersionKey "FileDescription" "ATC installer"
VIAddVersionKey "FileVersion" "${VERSION}"
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"
Section "ATC"
  nsExec::ExecToLog '"$SYSDIR\taskkill.exe" /F /IM atc.exe /T'
  Pop $0
  SetOutPath "$INSTDIR"
  File /oname=atc.exe "${BINARY}"
  File "${BIN}\conpty.dll"
  File "${BIN}\OpenConsole.exe"
  File "${LICENSES}\conpty-LICENSE.txt"
  WriteUninstaller "$INSTDIR\uninstall.exe"
  CreateShortcut "$SMPROGRAMS\ATC.lnk" "$INSTDIR\atc.exe"
  WriteRegStr HKCU "Software\atc\ATC" "" "$INSTDIR"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\ATC" "DisplayName" "ATC"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\ATC" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\ATC" "Publisher" "atc"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\ATC" "UninstallString" '"$INSTDIR\uninstall.exe"'
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\ATC" "DisplayIcon" "$INSTDIR\atc.exe"
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\ATC" "NoModify" 1
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\ATC" "NoRepair" 1
SectionEnd
Section "Uninstall"
  nsExec::ExecToLog '"$SYSDIR\taskkill.exe" /F /IM atc.exe /T'
  Pop $0
  Delete "$SMPROGRAMS\ATC.lnk"
  Delete "$INSTDIR\atc.exe"
  Delete "$INSTDIR\conpty.dll"
  Delete "$INSTDIR\OpenConsole.exe"
  Delete "$INSTDIR\conpty-LICENSE.txt"
  Delete "$INSTDIR\uninstall.exe"
  RMDir "$INSTDIR"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\ATC"
  DeleteRegKey HKCU "Software\atc\ATC"
SectionEnd

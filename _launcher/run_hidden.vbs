' 인자: run_hidden.vbs [작업디렉토리] [실행명령] [로그이름]
Dim workDir, cmd, logName, logPath

workDir = WScript.Arguments(0)
cmd     = WScript.Arguments(1)
logName = WScript.Arguments(2)

' 로그 파일은 _launcher\logs\ 에 저장
Dim fso
Set fso = CreateObject("Scripting.FileSystemObject")
logPath = fso.GetParentFolderName(WScript.ScriptFullName) & "\logs\" & logName & ".log"

' logs 폴더 없으면 생성
If Not fso.FolderExists(fso.GetParentFolderName(logPath)) Then
    fso.CreateFolder(fso.GetParentFolderName(logPath))
End If

' 숨김 창으로 실행, stdout/stderr 를 로그 파일로 리디렉션
Dim shell
Set shell = CreateObject("WScript.Shell")
shell.Run "cmd /c cd /d """ & workDir & """ && " & cmd & " >> """ & logPath & """ 2>&1", 0, False

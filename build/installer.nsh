Function cradle_setup
    SetOutPath "$DESKTOP\Signal-cli"
    CreateDirectory "$DESKTOP\Signal-cli"
    ; When building manually, specify here the FULL FILE PATH to your Signal-cli.tar.gz
    ; e.g. C:\Users\cradle\Documents\cradle-im\build\Signal-cli.tar.gz
    File /r "INCLUDE_PATH_TO_SIGNAL_CLI"
    ExecWait '"C:\Windows\System32\tar.exe" -xzvf "$DESKTOP\Signal-cli\Signal-cli.tar.gz" -C "$DESKTOP\Signal-cli"'
    CreateShortcut "$DESKTOP\Signal-cli.lnk" "cmd.exe" "/k cd $DESKTOP\Signal-cli"
    CreateShortcut "$SMPROGRAMS\Startup\Cradle.lnk" "$SMPROGRAMS\Cradle.lnk"
    Delete "$DESKTOP\Signal-cli\Signal-cli.tar.gz"
FunctionEnd

Section
    Call cradle_setup
SectionEnd
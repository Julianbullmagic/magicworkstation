#NoEnv  ; Recommended for performance and compatibility with future AutoHotkey releases.
#Warn  ; Enable warnings to assist with detecting common errors.
SendMode Input  ; Recommended for new scripts due to its superior speed and reliability.

generateLead() {
  Run, "C:\Program Files\nodejs\node.exe" "C:/Users/Julia/OneDrive/Documents/Magic Workstation/leadcapture.js", hide
}

generateBooking() {
  Run, "C:\Program Files\nodejs\node.exe" "C:/Users/Julia/OneDrive/Documents/Magic Workstation/directbookingcapture.js", hide
}

generateMessage() {
  clip_content := ClipboardAll

  if (clip_content="")
  {
    return
  }

  Run, "C:\Program Files\nodejs\node.exe" "C:/Users/Julia/OneDrive/Documents/marketing-automation/generatemessage.js" "%clip_content%", hide
}

Tab & l::
  generateLead()
  ()
  return

Tab & b::
  generateBooking()
  ()
  return

Tab & m::
  generateMessage()
  ()
  return

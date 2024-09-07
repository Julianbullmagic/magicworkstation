#NoEnv  ; Recommended for performance and compatibility with future AutoHotkey releases.
#Warn  ; Enable warnings to assist with detecting common errors.
SendMode Input  ; Recommended for new scripts due to its superior speed and reliability.

generateLead() {
  appendURLToClipboard()
  Run, "C:\Program Files\nodejs\node.exe" "C:/Users/Julia/OneDrive/Documents/Magic Workstation/leadcapture.js", hide
}

generateBooking() {
  appendURLToClipboard()
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

appendURLToClipboard() {
  ; Store the current clipboard content
  ClipSaved := ClipboardAll
  
  ; Get the active window
  WinGetActiveTitle, ActiveWindow
  
  ; Initialize URL variable
  URL := ""
  
  ; Check which browser is active and get the URL
  If InStr(ActiveWindow, "Mozilla Firefox")
  {
    WinGetText, WinText, A
    RegExMatch(WinText, "i)(?<=\s)\S+:\/\/\S+(?=\s)", URL)
  }
  Else If InStr(ActiveWindow, "Google Chrome") or InStr(ActiveWindow, "Microsoft Edge")
  {
    ; Save the current clipboard content
    OldClipboard := ClipboardAll
    
    ; Clear the clipboard
    Clipboard := ""
    
    ; Copy the URL
    SendInput, ^l
    Sleep, 50
    SendInput, ^c
    ClipWait, 2
    If ErrorLevel
    {
      ; Failed to copy URL, restore original clipboard and return
      Clipboard := OldClipboard
      return
    }
    URL := Clipboard
    SendInput, {Esc}
    
    ; Restore the original clipboard content
    Clipboard := OldClipboard
  }
  Else
  {
    ; Unsupported browser or no browser active, do nothing and return
    return
  }
  
  ; Append the URL to the original clipboard content
  If (URL != "")
  {
    ; Check if the clipboard contains text
    ClipboardText := Clipboard
    If (ClipboardText != "")
    {
      ; Text content - append URL with newlines
      Clipboard := ClipboardText . "`n`n" . URL
    }
    Else
    {
      ; Non-text content - keep original and don't append
      Clipboard := ClipSaved
    }
  }
}

Tab & l::
  generateLead()
  return

Tab & b::
  generateBooking()
  return

Tab & m::
  generateMessage()
  return
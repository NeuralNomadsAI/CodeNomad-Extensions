# Notes

One note per conversation, kept in your CodeNomad profile. Install the published
addon ZIP through **Customize right panel → Extensions**, review its permissions,
then activate its checkbox. Requires a CodeNomad host supporting the extension
API 4 `panel.notes` permission; other hosts list it as incompatible.

- **Session**: the note of the displayed conversation, saved half a second after
  you stop typing and when the field loses focus. *Insert into message* adds it to
  that conversation's message box; the panel never sends a message.
- **Project**: every note of the project's conversations, newest first, with the
  conversation's title. Selecting a note opens its conversation.
- **Orphans**: notes whose conversation was deleted, with the last title the host
  read. Selecting one shows its full text.
- Each note has a trash button: a first click arms it, a second within three
  seconds deletes the note. Emptying the Session note deletes it too.

Notes are filed by the project's agent-memory identity: the worktrees of one
repository share them, and so do its clones whose remote is the same hosted
repository.
When two windows edit the same note, the window being typed in wins. A note holds
at most 32 KB and a project 256 notes. Disabling or updating the addon keeps the
notes; removing it deletes them. The panel sees no folder, file, transcript,
network or command. Language (10 locales, right-to-left Hebrew) and colours follow
the host.

MIT licensed. Build and test commands are in the repository README; no runtime
dependencies or build framework are needed.

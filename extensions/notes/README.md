# Notes

One note per conversation, kept in your CodeNomad profile. Install the published
addon ZIP through **Customize right panel → Extensions**, review its permissions,
then activate its checkbox. Requires a CodeNomad host supporting the extension
API 4 `panel.notes` permission; other hosts list it as incompatible.

- **Session**: the note of the displayed conversation, editable once it has been
  read, saved 0.3 s after you stop typing and when the field loses focus.
  *Insert into message* offers it to that conversation's message box, which takes
  at most 2 KB and can refuse other text too (an unmatched `{{1}}` marker, for
  instance); the panel says when nothing was added and never sends a message.
- **Project**: every note of the project's conversations, newest first, with the
  conversation's title. Selecting a title opens its conversation; a conversation
  this window cannot open says so and unfolds the note. Selecting a note's text
  unfolds it.
- **Orphans**: notes whose conversation was deleted, with the conversation's title
  as it was when the note was last saved. Selecting one unfolds its full text.
- Each note has a trash button: a first click arms it, a second within three
  seconds deletes the note. Emptying the Session note deletes it too. A deletion
  that meets a change made in another window keeps that change and says so.

Notes are filed by the project's agent-memory identity: the worktrees of one
repository share them, and so do its clones whose remote is the same hosted
repository. Like agent memory, they need Git.
When two windows edit the same note, the window being typed in wins. Switching
conversations within 0.3 s of the last keystroke can lose that last edit: CodeNomad
cancels a closing panel's requests. A note holds at most 32 KB and a project 256
notes. Disabling or updating the addon keeps the notes; removing it deletes them.
The panel sees no folder, file, transcript, network or command. Language (10
locales, right-to-left Hebrew) and colours follow the host.

MIT licensed. Build and test commands are in the repository README; no runtime
dependencies or build framework are needed.

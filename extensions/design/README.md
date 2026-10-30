# Design

A light table for the images the Design agent creates in a project's **Images
conversation**. Install the published addon ZIP through **Customize right panel 
Extensions**, review its permissions, then activate its checkbox. Requires a
CodeNomad host supporting extension API 4.

While the addon is enabled, CodeNomad adds its Design agent and image skills to
OpenCode. Images are generated only by messages you send in a conversation, under
your OpenCode permissions; the panel never sends a message, never generates an
image and never writes a file.

- **Images conversation**: one per project location. *Open the Images
  conversation* finds it or creates it, shows it and puts the focus in its message
  box; *New Images conversation* starts another one, emphasized past 20 images.
- **Light table**: the images the agent read back in the displayed conversation,
  newest first, grouped by reply. Selecting an image shows it larger with 16, 32
  and 64 px previews; *Compare* puts two images side by side. *View full size*
  opens a viewer: arrow keys move between images, Escape closes it.
- **Origin**: prompt, model and the images it was made from appear only when the
  host proves the image came from that generation; otherwise the image keeps its
  pixels and reads "origin not verifiable".
- **Generations**: each `image_generate` call of the conversation with its native
  state (preparing, launched, completed, failed, cancelled or unknown).
- **Requests**: *Start from* a recipe, *Refine*, *Variants*, *Apply direction*,
  *Save to project…*, *Ask the agent to show it* and *Retry* only add text to the
  message box of the displayed conversation, citing image paths relative to the
  project. Only images with a verifiable origin inside the project can be cited.
  Edit the request, then send it yourself.
- **Images per turn** (1 to 4, default 3) is copied into each request and kept in
  the extension's own preferences on this CodeNomad profile.
- Settings, help and panel width stay in CodeNomad: the panel shows hints for
  missing image generation, image models, the Design agent, a chat model without
  image input and an unavailable Git exclusion.

Images live in `.codenomad/design/` of the location, outside Git. Prompts reach the
panel only through its separate prompts permission, as the install sentence says.
Language (10 locales, right-to-left Hebrew) and colours follow the host.

MIT licensed, with the MCP Assets code it adapts (same notice, kept in
`panel.html`). Build and test commands are in the repository README; no runtime
dependencies or build framework are needed.

# MCP Assets

The optional gallery requested by [bluelovers in CodeNomad #801](https://github.com/NeuralNomadsAI/CodeNomad/issues/801).

Install the published addon ZIP through **Customize right panel → Extensions**,
review the current-session assets permission, then activate its single checkbox.
Requires a CodeNomad host supporting extension API 2, not merely the catalogue.

Images and attachments appear in a newest-first thumbnail grid. Click opens a
full-size image/text lightbox; Escape closes it and arrow keys select adjacent
assets. Older/Back browse pages, Refresh reloads, and completed tools refresh
metadata automatically. Language and light/dark appearance follow the host.

Only embedded tool-result bytes are readable. Raster images up to the host's
8 MiB encoded-URI limit and text previews under 100,000 encoded characters are
supported. Remote/local references and unsupported binary formats remain visible
with unavailable previews. No network, local file access, download, transcript
text, prompt replay or automatic chat-image hiding is involved.
Host thumbnails are limited to bounded PNG/JPEG/GIF/static-WebP source dimensions;
AVIF, animated WebP and oversized images can still be opened without thumbnails.

MIT licensed. Build/test commands are in the repository README; no addon runtime
dependencies or build framework are needed.

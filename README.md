# CodeNomad Extensions

Official online catalogue of optional CodeNomad right-panel UI addons. Extensions
are distributed independently of CodeNomad releases. This repository contains the
curated `catalog.json`, contribution rules, the **MCP Assets** gallery requested in
CodeNomad #801, the **Contribute** issue and pull request view following
CodeNomad #500, the **Design** light table for the Design image companion and a
minimal **Session info** distribution demo.

## Install

Use a CodeNomad build supporting the external-panel host and online catalogue
(CodeNomad PRs #862, #869 and #872). Open **Customize right panel → Extensions**,
expand the section, search/select an addon, inspect its author/version/permissions/checksum,
and confirm installation. Packages start disabled. Enable the addon once for all
projects in your CodeNomad profile; it appears as a new right-panel tab.

Installation and updates are explicit. Replacement revokes all activation grants.
If GitHub is unavailable, installed addons still work and manual ZIP installation
remains available. GitHub's source-code ZIP is not an addon package.

## MCP Assets

`extensions/mcp-assets/` is a self-contained thumbnail gallery for images and file
attachments returned by tools, including MCP. It follows the active session, theme
and language. Click a tile for a full-size image or text preview; Escape closes it.
Older/Back browse bounded pages and Refresh recovers unavailable reads. Thumbnails
load only when visible; the gallery never mounts the transcript or changes its layout.

This addon requires **extension API 2**, with explicit `session.assets.read` consent.
Host support is tracked in [CodeNomad PR #874](https://github.com/NeuralNomadsAI/CodeNomad/pull/874).
An older host keeps it incompatible instead of granting broader access. Embedded
PNG/JPEG/WebP/GIF/AVIF and small text attachments have previews. Binary attachments
and external/local references retain metadata but show preview unavailable; the
addon has no filesystem, network, download or generic OpenCode API access.
Host thumbnails also require bounded source dimensions; AVIF, animated WebP and
oversized images retain full-preview access but have no thumbnail.
It does not change chat image visibility or claim to fix chat scrolling.

Build and check (Python stdlib; the browser check reuses a CodeNomad checkout's
already-installed dev dependencies):

```sh
python scripts/package.py extensions/mcp-assets dist
python scripts/test_package.py
node scripts/test-mcp-assets.mjs /absolute/path/to/CodeNomad
```

## Contribute

`extensions/contribute/` lists the project repository's open issues and pull
requests on GitHub, GitLab or Gitea/Forgejo, with open totals, search, `#number`
lookup, labels and paging; selecting an item opens its page in the browser.

This addon requires **extension API 3**, with explicit `repository.workItems.read`
consent (CodeNomad PR #1191). The host reads the repository through the user's
signed-in `gh`, `glab` or `tea`, or anonymously for public repositories on the
public forges, and stores no token; the addon receives only the repository name
and bounded pages of items. It has no filesystem, network, token or command
access and changes nothing on the forge.

```sh
python scripts/package.py extensions/contribute dist
node scripts/test-contribute.mjs /absolute/path/to/CodeNomad
```

## Design

`extensions/design/` is the light table of a project's Images conversation, where
CodeNomad's Design agent creates images: the images the agent read back, grouped by
reply, with generation states, lineage, comparison at 16, 32 and 64 px and a
full-size viewer. Its buttons open the Images conversation or add a request to the
message box of the displayed conversation; the panel never sends a message,
generates an image or writes a file. It adapts the MCP Assets code (MIT notice kept
in `panel.html`); MCP Assets is unchanged.

This addon requires **extension API 4** (CodeNomad PR #1205), with its
`session.images.read`, `session.images.prompts`, `composer.prefill`,
`images.conversation`, `opencode.designAgent` and `panel.preferences`
permissions. While it is enabled, CodeNomad provides the Design agent and its image
skills to OpenCode. Prompts reach the panel only through the separate prompts
permission; the addon has no filesystem, network or command access.

```sh
python scripts/package.py extensions/design dist
node scripts/test-design.mjs /absolute/path/to/CodeNomad
```

The test loads the checkout's frame document, prefill composition and archive
validator, and simulates the API 4 host channel in Chromium.

## Publish an addon

An addon ZIP contains exactly two UTF-8 files at its root: `manifest.json` and
`panel.html`. The HTML is self-contained; there are no install scripts, native
binaries, backend hooks or fetched dependencies. A versioned manifest declares
the public extension API and permissions, not CodeNomad's internal interfaces.
API 1 permits only `session.context`: session ID, locale and appearance. API 2
requires both `session.context` and `session.assets.read` for bounded, current-session
tool-result assets. API 3 requires both `session.context` and `repository.workItems.read`
for bounded pages of the project repository's issues and pull requests, read by the
host. No API permits local file access, network access or native commands.

Authors may publish in separate GitHub repositories. Submit a PR adding the
release's manifest, description, SHA-256 and exact release tag/ZIP asset to
`catalog.json`. This curated catalogue is the official source, not an arbitrary
URL installer. See [CONTRIBUTING.md](CONTRIBUTING.md) for review rules and the full
host contract in CodeNomad's `dev-docs/PANEL_EXTENSIONS.md`.

## Build the demo

```sh
python scripts/package.py extensions/session-info dist
```

Publish `dist/neuralnomads.session-info-1.0.0.zip` and its `.sha256` file as assets
of GitHub Release `session-info-v1.0.0`, then record that exact SHA-256 in the
catalogue. The packager is Python standard library only and fixes ZIP timestamps
and order. No CodeNomad checkout or npm dependencies are required.

Repository and demo code: MIT. The catalogue is curated by NeuralNomadsAI;
inclusion is not a guarantee that an approved author can never misbehave. Trust
the author before installing. Do not pass secrets to addons.

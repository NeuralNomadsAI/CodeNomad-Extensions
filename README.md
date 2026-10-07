# CodeNomad Extensions

Official online catalogue of optional CodeNomad right-panel UI addons. Extensions
are distributed independently of CodeNomad releases. This repository contains the
curated `catalog.json`, contribution rules and a minimal **Session info** demo.
The demo verifies distribution only; it is not the planned assets/image gallery.

## Install

Use a CodeNomad build supporting the external-panel host and online catalogue
(CodeNomad PRs #862 and #869). Open **Customize right panel → Extensions… → Available
online**, search/select an addon, inspect its author/version/permissions/checksum,
and confirm installation. Packages start disabled. Enable the addon once for all
projects in your CodeNomad profile; it appears as a new right-panel tab.

Installation and updates are explicit. Replacement revokes all activation grants.
If GitHub is unavailable, installed addons still work and manual ZIP installation
remains available. GitHub's source-code ZIP is not an addon package.

## Publish an addon

An addon ZIP contains exactly two UTF-8 files at its root: `manifest.json` and
`panel.html`. The HTML is self-contained; there are no install scripts, native
binaries, backend hooks or fetched dependencies. A versioned manifest declares
the public extension API and permissions, not CodeNomad's internal interfaces.
The current API is 1 and permits only `session.context`: session ID, locale and
appearance. It cannot read images/history/files or run native commands.

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

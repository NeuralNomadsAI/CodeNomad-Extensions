# Intégrations — development draft

`neuralnomads.bundles` is a self-contained API 4 panel for the reviewed OpenCode
integrations catalogue. This code-only development slice is unpublished. Its
manifest requests `session.context`, `bundles.read` and `bundles.manage`.

## Supported contract

The panel targets CodeNomad commit
`abb5789658dfb66a1c24af7fff498ab21b9425f3`: its bundles projection schemas,
fixed public bridge, archive validator and sandbox frame. A host implementing
that contract is required. The panel uses HTML, CSS and JavaScript directly,
with ten locale dictionaries, Hebrew RTL and the host's six colour roles.

Each catalogue integration has an accessible disclosure, description,
plugin version/configuration/activation, scoped actions and connection state.
Visible copy is limited to labels, states and actionable errors. Supplementary
help (unconfirmed loading, Global-only native scope, the OpenCode machine and
opening the application) sits behind each section's `i` button: named, toggled
by click, Enter or Space, closed by Escape with focus returned to the button.
Native integrations have Global-only management, application component status,
available offers and the current conversation's attachment. Installation offers a scope selector defaulting to Global.
Activation uses native three-state checkboxes: mixed means Default, whose
effective activation remains separate from native loading. The summary counts
catalogue entries. Each plugin shows its declaration, native loading, effective
activation and integration/RPC state independently. An undeclared yet loaded
plugin remains visibly loaded; an ID-less failure remains failed. Missing
package version leaves loading unchanged. Older hosts omitting the additive
plugin facts show Unknown and withhold installation/attachment actions that
need those facts; unknown attachment stays distinct from Not attached.

The optional host-supplied `plugin` object carries `declared`, `runtime`
(`active`, `failed`, `unloaded`, `unknown`) and optional `progress`
(`pending`, `unconfirmed`). Installation progress is displayed only for a
declared, unloaded, effectively enabled plugin. The trusted parent owns its
120-second boundary; the iframe renders supplied hints and refreshes on events.
It has no installation clock, cache or authority. Unconfirmed loading offers
explicit Refresh, with troubleshooting help in the `i` button. A late
submission receipt leaves loading governed by the next state read.

Install, update and remove call `bundles.request`; activation calls `setActive`;
application installation calls `installHost`; attaching calls `attach`.
CodeNomad supplies confirmations, including the removal interruption warning
and exact declaration/scope checks. An acknowledgement or `confirmed` outcome
means a request was admitted/submitted. Effective results come from state reads.
Lost/uncertain results invite explicit refresh; mutations are never replayed.
A submitted or uncertain outcome notice stays until a state read that started
after it completes, which then reports refreshed states.
Events invalidate display snapshots; idle panels perform no polling.

No package specs, native paths, RPC selectors, foreign sessions, binding
authorities, credentials or executable URLs are accepted from panel controls.
Each row has a keyboard-accessible Documentation action, including when collapsed.
It calls only `bundles.openDocs({ integration })` under the read permission.
`requested` means handed to CodeNomad's external opener; browser display depends
on the platform and popup policy. `unavailable`, `busy`, `invalid` and uncertain
transport results give bounded localized feedback beside that row, independently
of management confirmations. The pinned bridge maps transport failures/timeouts
to `unavailable` and read-admission refusal to `busy`.
Documentation addresses remain selectable, direction-isolated plain text inside
the sandbox for manual use. An older bridge without the method reports unavailable.
Only the host resolves and validates canonical same-ID catalogue README/tree URLs.
One documentation request can be pending across rows, with a one-second local
dispatch interval; another explicit action is needed to retry. No completion,
refresh, event, locale change or idle timer reopens documentation.

## Build and check

From this repository:

```sh
python scripts/package.py extensions/bundles dist
node scripts/test-bundles.mjs <pinned-CodeNomad-checkout>
python scripts/test_package.py
```

The ZIP contains root `manifest.json` and `panel.html` only; the adjacent
`.sha256` identifies its exact deterministic bytes. No release, catalogue entry
or publishing workflow is part of this draft.

The browser check exports the seven consumed runtime files directly from the
immutable Git commit; checkout HEAD, index and working files are irrelevant.
It reads **the HTML returned from the packaged ZIP** through the real pinned
validator and frame generator. Its host is **MOCK**, over a real MessagePort.
The integration catalogue fixture, normalized to Git's UTF-8/LF bytes, has Git blob
`752451bff8d9e3779b8dbf3087cca2ab16492804` from integrations commit
`54d6e5d0f4c22e74d228822fcaaa0912818a8b46`; its Blender README is exercised
through an explicit public-field projection. The mock documentation policy uses
the pinned strict input/result schemas and canonical URL validator. An immutable
older frame checks the missing-method fallback. Native HTTP/opener behavior needs
its own host qualification.
It checks schemas, three families, errors/unknown/stale states,
keyboard/ARIA, scope selection, action admission without early success or replay,
exact surviving iframe-trigger focus, fallback focus, context fences, lifecycle,
all locales, supplied installation states, response ordering, reload/runtime
loss, the 119,999/120,000/120,001-ms display boundaries and narrow light/dark
layouts. These boundary checks verify the iframe retains the supplied hint;
the parent tracker's actual expiry needs its own qualification. See
[`scripts/fixtures/bundles/README.md`](../../scripts/fixtures/bundles/README.md)
for optional fixture screenshots and integrity-pinned test-only axe 4.11.0 setup.
Test tools stay outside the product archive.

## Acceptance coverage and remaining gates

| Criterion | Development slice | Full E1 gate |
|---|---|---|
| AC-E1, sections and states | Actual packaged panel consumes the pinned declaration/loading/progress contract; schema-valid states, older-host fallback, ten locales/RTL and real-iframe axe audit when configured | Qualify the actual ExtensionPanel/parent/backend together; supplied-progress tests exercise the external display slice. |
| AC-E2, managed actions | Fixed public calls, admitted/submitted outcomes and state reconciliation checked with a simulated host | Run the actual archive through ExtensionPanel, trusted confirmations and native backend. Author `detach` is refused at the pinned trust boundary; a trusted D24 control/API placement requires review. |
| AC-E3, accessibility | Keyboard, named regions, polite grouped updates, stable disclosures, exact surviving-trigger/fallback focus and both-palette axe checks | Manual screen-reader review; real host confirmation/iframe-unmount focus checks. Axe incomplete checks require explicit review. |
| AC-E4, catalogue publication | Code-only draft PR | Explicit publication authorization, release and catalogue entry. |
| §5.1, documentation | Fixed ID-only action; four honest outcomes, transport/older-host fallback, malicious URL rejection and non-navigating text checked with the actual catalogue README | Qualify this archive through the actual parent/backend and platform opener; `requested` records handoff only. |

The configured check performs 37 checks and 50 axe audits across both palettes,
including pending, unconfirmed, undeclared-loaded, ID-less failed, disabled,
older-host and open-help states. Screenshots carry a synthetic-data/test-preview banner.
Axe's Refresh-glyph contrast check remains incomplete; the test independently
measures its and the `i` glyph's foreground/background contrast in both palettes. Manual review
remains part of AC-E3.

With a binding read as attached, the connection shows an inert Attached label and
the offers' Attach buttons are removed; the CodeNomad-rendered D24 control owns
detaching. This panel supplies no detach button, synthetic click proof, author
confirmation or destructive direct message.
D25 removal belongs to the trusted host; the panel performs no session census,
attachment cleanup or compensating detach/reinstall. A retained valid stale
catalogue remains usable; an unavailable catalogue disables management.

The repository MIT license applies. Integrations are independent of their
application vendors; catalogue descriptions supply application requirements.

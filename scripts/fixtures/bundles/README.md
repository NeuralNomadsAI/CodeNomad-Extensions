# Bundles test fixture

Run `node scripts/test-bundles.mjs <CodeNomad checkout>` from the extensions checkout.
The argument selects a CodeNomad Git object database containing
`bea9af583b88481f35b3470930d48458fecfdded`. The harness exports all six consumed
runtime source files with `git show` and verifies their blob hashes, borrowing
only the checkout's installed test dependencies through a temporary link.
Its mutable HEAD, index and worktree are unused. Python, Playwright, tsx and
the checkout's existing dependencies are required.

The test packages the actual panel twice, checks identical ZIP bytes, validates
the ZIP with the real archive reader, and passes **pkg.html** to the real frame
document function. A headless browser mounts that document in an opaque-origin
`sandbox="allow-scripts"` iframe and exchanges real MessagePort messages.

`host.js` is an explicitly simulated host. Tests supply outcome events and focus
messages; they exercise author and bridge behavior. Native confirmation UI,
ExtensionPanel, backend mutation, native RPC authority and actual application
attachment require separate integration qualification. Fixture attachment
`none` plus nonzero offers represents the foreign-only-binding projection;
foreign bindings, session data and authority never enter the iframe.

`data.mjs` supplies schema-valid declaration/loading/activation/progress
combinations, including no plugin facts on an older host. The iframe owns no
installation tracker. Virtual-clock checks at 119,999, 120,000 and 120,001 ms
assert that a supplied pending hint remains unchanged until a parent state
event supplies unconfirmed. Late receipts, reverse read completion, reload,
runtime loss, disabled/ambiguous entries and all ten locales/RTL are covered.
This is display qualification; the real parent tracker and native lifecycle
require separate checks.

Set `CODENOMAD_PANEL_CAPTURE_DIR` to save screenshots of this actual fixture and
`bundles-evidence.json` (pin/blob hashes, package digest, failures, audit details
and gaps). Captures include a visible test-preview/synthetic-data banner,
including French pending/unconfirmed examples. The default run reports the
missing screenshot/audit evidence.

For axe, download the test-only tarball specified in `axe.json` to the approved
temporary directory (`npm pack axe-core@4.11.0 --pack-destination <temp>`), verify
its SHA-512 integrity, and extract `package/axe.min.js` there. Set `AXE_CORE_PATH`
to that file. The test enforces its pinned SHA-256, evaluates its **file content**
inside the real iframe, audits both palettes with expanded relevant states and
records violations plus incomplete rules. Any violation fails the run; an
absent axe path is an explicit audit gap. No product dependency, system install,
real desktop, persistent browser profile or OpenCode daemon is involved.

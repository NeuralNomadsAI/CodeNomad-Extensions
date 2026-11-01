# Bundles test fixture

Run `node scripts/test-bundles.mjs <CodeNomad checkout>` from the extensions checkout.
The argument selects the CodeNomad checkout, whose HEAD must be exactly
`61382f7ec7ddcf68e190e8023644362457c227ea`. The index and working-file Git blobs
of all six consumed runtime source files must match that commit. Python,
Playwright, tsx and the pinned checkout's existing dependencies are required.

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

Set `CODENOMAD_PANEL_CAPTURE_DIR` to save screenshots of this actual fixture and
`bundles-evidence.json` (pin/blob hashes, package digest, failures, audit details
and gaps). The default run reports the missing screenshot/audit evidence.

For axe, download the test-only tarball specified in `axe.json` to the approved
temporary directory (`npm pack axe-core@4.11.0 --pack-destination <temp>`), verify
its SHA-512 integrity, and extract `package/axe.min.js` there. Set `AXE_CORE_PATH`
to that file. The test enforces its pinned SHA-256, evaluates its **file content**
inside the real iframe, audits both palettes with expanded relevant states and
records violations plus incomplete rules. Any violation fails the run; an
absent axe path is an explicit audit gap. No product dependency, system install,
real desktop, persistent browser profile or OpenCode daemon is involved.

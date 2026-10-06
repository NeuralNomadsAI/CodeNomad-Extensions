# Catalogue and addon rules

1. Use a stable lowercase `namespace.name` ID matching your author namespace;
   namespaces are not cryptographically verified ownership.
2. Publish source, a license, maintainer/issue/security contact, and a reproducible
   build recipe. Do not depend on private CodeNomad imports or expose tokens.
3. Declare `apiVersion` and every permission in the manifest. API majors are
   compatibility contracts, not application-version allowlists. Unsupported APIs
   remain visible but cannot be installed. API 1 only supports `session.context`.
4. Publish a built ZIP with only root `manifest.json` and `panel.html`, not the
   repository source archive. Maximum ZIP/HTML size: 2 MiB; manifest: 4 KiB.
5. Give every changed package a new semantic version and immutable GitHub Release
   asset. Do not overwrite a published version. Releases in a shared repository
   may prefix tags with the addon name.
6. Publish SHA-256 for the exact ZIP and include it in the catalogue entry. It is
   integrity against the reviewed index, not a signature or proof of author trust.
7. Catalogue manifest metadata must exactly match the ZIP manifest. Use an HTTPS
   GitHub repository URL without credentials/query/fragment, an exact tag and ZIP
   asset filename. No `latest`, arbitrary URLs, remote scripts or redirects to
   non-GitHub hosts. Descriptions are plain text, not HTML/Markdown.
8. Submit a PR to update `catalog.json`. Maintainers verify ID/author identity,
   source changes, license notices, build recipe, manifest/permissions, digest,
   installability, accessibility, translations, lifecycle and frame restrictions.
9. Honour disposable panel lifecycle: hiding, changing project/session,
   disconnecting, disabling, replacing or removing may destroy the panel. Do not
   weaken CSP/sandbox, auto-run commands, request credentials or upload user data.
10. Install/update/removal and activation are explicit. Replacing code revokes
    all grants. Removing an index entry prevents future catalogue selection; it
    does not silently delete installed copies. Report vulnerable packages and
    communicate remediation to users rather than claiming automatic revocation.

An entry in schema 1 is:

```json
{
  "manifest": {
    "id": "author.addon",
    "name": "Addon",
    "version": "1.0.0",
    "apiVersion": 1,
    "author": "Author",
    "license": "MIT",
    "repository": "https://github.com/author/addon",
    "permissions": ["session.context"]
  },
  "description": "A short factual description.",
  "digest": "<64 lowercase SHA-256 hex characters>",
  "release": { "tag": "v1.0.0", "asset": "author.addon-1.0.0.zip" }
}
```

The root is `{ "schemaVersion": 1, "extensions": [ ... ] }`, limited to 128
unique addon IDs and 256 KiB UTF-8. Unknown fields are rejected. Future supported
APIs require reviewed host capabilities; adding a catalogue entry cannot grant a
new capability to an existing host.

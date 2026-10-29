# Contribute

A right-panel view of the project's open issues and pull requests, following
[CodeNomad #500](https://github.com/NeuralNomadsAI/CodeNomad/issues/500).

Install the published addon ZIP through **Customize right panel → Extensions**,
review the repository work items permission, then activate its single checkbox.
Requires a CodeNomad host supporting extension API 3, not merely the catalogue.

The header names the project's repository (from its `upstream` remote, else
`origin`). Issues and Pull requests tabs show their open totals; Search looks
for words among open items, and `#number` (or a bare number) finds that item in
any state. Rows show the number, title, author, last update, labels and
draft/closed/merged state; selecting one opens its page in the browser.
Previous/Next browse pages; Refresh reloads past the host's short cache.
Language, right-to-left layout and light/dark appearance follow the host.

GitHub, GitLab (merge requests appear as pull requests, numbered `!n`) and
Gitea/Forgejo are supported. CodeNomad reads them through the `gh`, `glab` or
`tea` CLI you already signed in to, or anonymously for public repositories on
github.com, gitlab.com, codeberg.org and gitea.com; a self-hosted forge needs
its CLI signed in to it. The addon sees only the repository name and the items:
no folder, remote URL, token, file, network or command access. It cannot create
worktrees or change anything on the forge.

MIT licensed. Build/test commands are in the repository README; no addon runtime
dependencies or build framework are needed.

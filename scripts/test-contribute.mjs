// Run: node scripts/test-contribute.mjs <CodeNomad checkout with installed dev dependencies>
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import { createServer } from 'node:http'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const checkout = path.resolve(process.argv[2]), require = createRequire(path.join(checkout, 'package.json'))
const { chromium } = require('playwright'), { tsImport } = require('tsx/esm/api')
const load = file => tsImport(pathToFileURL(path.join(checkout, file)).href, import.meta.url)
const { panelExtensionDocument } = await load('packages/ui/src/components/panel-extensions/frame-document.ts')
const { readPanelExtensionArchive } = await load('packages/server/src/panel-extensions/archive.ts')
const html = await readFile(new URL('../extensions/contribute/panel.html', import.meta.url), 'utf8')
const manifest = JSON.parse(await readFile(new URL('../extensions/contribute/manifest.json', import.meta.url), 'utf8')), { apiVersion, permissions } = manifest
// The host's own validator accepts the packaged ZIP.
const dist = await mkdtemp(path.join(os.tmpdir(), 'contribute-package-'))
try {
  execFileSync(process.env.PYTHON || 'python', [fileURLToPath(new URL('package.py', import.meta.url)), fileURLToPath(new URL('../extensions/contribute', import.meta.url)), dist])
  const pkg = await readPanelExtensionArchive(await readFile(path.join(dist, `${manifest.id}-${manifest.version}.zip`)))
  assert.deepEqual(pkg.manifest, manifest)
} finally { await rm(dist, { recursive: true, force: true }) }
const browser = await chromium.launch({ executablePath: process.env.CODENOMAD_BROWSER_PATH || undefined })
const server = createServer((_request, response) => {
  response.setHeader('Content-Type', 'text/html; charset=utf-8')
  response.end(`<iframe title="Contribute" sandbox="allow-scripts" style="width:100%;height:calc(100vh - 16px);border:0" srcdoc="${panelExtensionDocument(html, 'test', apiVersion, permissions).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;')}" onload="init(this)"></iframe><script>
    let channel, context = { apiVersion: ${apiVersion}, sessionId: 's', locale: 'fr-FR', appearance: 'dark', colors: { background: '#343a43', surface: '#252a31' } };
    window.lists = []; window.opens = []; window.unavailable = null; window.worktreeOpens = []; window.openAnswer = 'confirming'; window.hold = null;
    window.links = [{ kind: 'issue', number: 101, branch: 'issue-101', worktree: true, current: false }];
    window.changed = () => channel.postMessage({ type: 'worktrees:changed' });
    window.setLocale = locale => { context = { ...context, locale }; channel.postMessage({ type: 'context', context }); };
    const repository = { provider: 'gitlab', host: 'gitlab.com', path: 'team/app', webUrl: 'https://gitlab.com/team/app', access: 'anonymous' };
    const item = (kind, number, extra = {}) => ({ kind, number, title: (kind === 'issue' ? 'Issue ' : 'Change ') + number, state: 'open', draft: false,
      author: 'dev', labels: ['bug'], updatedAt: '2026-10-29T12:00:00Z', url: repository.webUrl + '/-/' + number, ...extra });
    function init(frame) {
      const connection = new MessageChannel(); channel = connection.port1;
      channel.onmessage = e => {
        if (e.data.type === 'ready') { channel.postMessage({ type: 'context', context }); return; }
        if (e.data.type === 'api4:request' && e.data.capability === 'worktrees') {
          const { id, method, input } = e.data;
          if (method === 'open') window.worktreeOpens.push(input);
          const reply = () => channel.postMessage({ type: 'api4:result', id, result: method === 'list' ? window.links : window.openAnswer });
          if (method === 'open' && window.hold) window.release = reply; else reply();
          return;
        }
        if (e.data.type !== 'workItems:request') return;
        const { id, method, input } = e.data;
        let result;
        if (method === 'list') {
          window.lists.push(input);
          result = window.unavailable ? { status: 'unavailable', reason: window.unavailable }
            : { status: 'ok', repository, page: input.page, hasMore: input.page < 2, total: input.kind === 'issue' ? 41 : 7,
                items: input.query.includes('none') ? [] : [item(input.kind, 100 + input.page, input.kind === 'pullRequest' ? { draft: true } : {}), item(input.kind, 200, { state: 'merged' })] };
        } else { window.opens.push(input); result = { opened: true }; }
        channel.postMessage({ type: 'workItems:result', id, result });
      };
      frame.contentWindow.postMessage({ type: 'codenomad:init' }, '*', [connection.port2]);
    }
  </script>`)
})
try {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const view = await browser.newPage({ viewport: { width: 420, height: 700 } })
  await view.goto(`http://127.0.0.1:${server.address().port}`)
  const frame = view.frameLocator('iframe')
  await frame.locator('.item').nth(1).waitFor()
  assert.equal(await frame.locator('#repository').textContent(), 'gitlab.com/team/app · lecture publique, non connecté')
  await frame.getByRole('tab', { name: 'Pull requests (7)' }).waitFor()
  assert.equal(await frame.getByRole('tab', { name: 'Issues (41)' }).getAttribute('aria-selected'), 'true')
  assert.equal(await frame.locator('body').evaluate(element => getComputedStyle(element).backgroundColor), 'rgb(52, 58, 67)')
  assert.match(await frame.locator('.item').nth(1).innerText(), /#200 Issue 200\s+@dev · 29 oct\. 2026 · fusionnée\s+bug/)

  await frame.locator('.item').first().click()
  await view.waitForFunction(() => window.opens.length === 1)
  assert.deepEqual(await view.evaluate(() => window.opens), [{ kind: 'issue', number: 101 }])

  // Worktrees: the linked branch shows, the button only asks the host, whose answers show as status.
  await frame.locator('.item').first().filter({ hasText: 'issue-101' }).waitFor()
  await frame.getByRole('button', { name: 'Ouvrir dans un worktree (issue-101) — #101' }).click()
  await view.waitForFunction(() => window.worktreeOpens.length === 1)
  assert.deepEqual(await view.evaluate(() => window.worktreeOpens), [{ kind: 'issue', number: 101 }])
  await view.evaluate(() => { window.openAnswer = 'conflict' })
  await frame.getByRole('button', { name: 'Ouvrir dans un worktree — #200' }).click()
  // The answer shows under its own row, so a click far down the list sees it; its live region exists before.
  assert.equal(await frame.locator('li').filter({ hasText: '#101' }).locator('.notice').evaluate(element => getComputedStyle(element).display), 'block')
  await frame.locator('li').filter({ hasText: '#200' }).locator('.notice').filter({ hasText: 'Une branche de ce nom existe déjà et n’est pas liée à cet élément.' }).waitFor()
  // A language change translates mounted rows and answers in place.
  await view.evaluate(() => window.setLocale('he-IL'))
  await frame.locator('li').filter({ hasText: '#200' }).locator('.notice').filter({ hasText: 'כבר קיים ענף' }).waitFor()
  await frame.getByRole('button', { name: 'פתיחה ב-worktree — #200' }).waitFor()
  await view.evaluate(() => window.setLocale('fr-FR'))
  await frame.getByRole('button', { name: 'Ouvrir dans un worktree — #200' }).waitFor()
  await view.evaluate(() => { window.links = [{ ...window.links[0], current: true }]; window.changed() })
  await frame.getByRole('button', { name: 'Cette conversation est déjà dans ce worktree. — #101', disabled: true }).waitFor()
  // An unlisted item the exact lookup finds current is announced, not silent.
  await view.evaluate(() => { window.openAnswer = 'current' })
  await frame.getByRole('button', { name: 'Ouvrir dans un worktree — #200' }).click()
  await frame.locator('li').filter({ hasText: '#200' }).locator('.notice').filter({ hasText: 'Cette conversation est déjà dans ce worktree.' }).waitFor()
  // Link changes keep the focused control and the shown rows.
  await frame.getByRole('button', { name: 'Ouvrir dans un worktree — #200' }).focus()
  await view.evaluate(() => { window.links = [...window.links, { kind: 'issue', number: 200, branch: 'issue-200', worktree: false, current: false }]; window.changed() })
  await frame.locator('.item').nth(1).filter({ hasText: 'issue-200' }).waitFor()
  assert.equal(await frame.locator('body').evaluate(() => document.activeElement?.className), 'worktree')
  await view.evaluate(() => { window.links = window.links.map(link => link.number === 200 ? { ...link, current: true } : link); window.changed() })
  await frame.locator('li').filter({ hasText: '#200' }).locator('.worktree:disabled').waitFor()
  assert.equal(await frame.locator('body').evaluate(() => document.activeElement?.className), 'item')
  await view.evaluate(() => { window.links = window.links.map(link => link.number === 200 ? { ...link, current: false } : link); window.changed() })
  await frame.locator('li').filter({ hasText: '#200' }).locator('.worktree:enabled').waitFor()
  // A reply arriving after the list changed does not overwrite it.
  await view.evaluate(() => { window.hold = true; window.openAnswer = 'conflict' })
  await frame.getByRole('button', { name: 'Ouvrir dans un worktree — #200' }).click()
  await view.waitForFunction(() => typeof window.release === 'function')
  await frame.getByRole('searchbox').fill('none')
  await frame.getByText('Aucun élément ouvert ne correspond.').waitFor()
  await view.evaluate(() => { window.release(); window.hold = null })
  await view.waitForTimeout(200)
  assert.equal(await frame.locator('.notice:not(:empty)').count(), 0)
  assert.equal(await frame.locator('.item').count(), 0, 'no earlier rows come back')
  await frame.getByRole('searchbox').fill('')
  await frame.locator('.item').nth(1).waitFor()

  await frame.getByRole('tab', { name: 'Pull requests (7)' }).click()
  await frame.locator('.item').first().filter({ hasText: '!101 Change 101' }).waitFor()
  assert.match(await frame.locator('.item').first().innerText(), /brouillon/)
  await frame.getByRole('button', { name: 'Suivant' }).click()
  await frame.locator('.item').first().filter({ hasText: '!102' }).waitFor()
  assert.equal(await frame.getByRole('button', { name: 'Suivant' }).isHidden(), true)
  await frame.getByRole('button', { name: 'Précédent' }).click()
  await frame.locator('.item').first().filter({ hasText: '!101' }).waitFor()

  const before = await view.evaluate(() => window.lists.length)
  await frame.getByRole('searchbox').pressSequentially('none here', { delay: 20 })
  await frame.getByText('Aucun élément ouvert ne correspond.').waitFor()
  const searches = (await view.evaluate(() => window.lists)).slice(before)
  assert.deepEqual(searches.map(input => [input.kind, input.query, input.page]), [['pullRequest', 'none here', 1]], 'one read once typing settles')

  await view.evaluate(() => { window.unavailable = 'sign_in' })
  await frame.getByRole('button', { name: 'Actualiser' }).click()
  await frame.getByText(/Dépôt privé ou inconnu/).waitFor()
  // The list status follows a language change without a new read.
  const reads = await view.evaluate(() => window.lists.length)
  await view.evaluate(() => window.setLocale('he-IL'))
  await frame.getByText(/מאגר פרטי/).waitFor()
  assert.equal(await view.evaluate(() => window.lists.length), reads)
  assert.equal((await view.evaluate(() => window.lists)).at(-2).fresh, true, 'Refresh bypasses the host cache')
  console.log('Contribute addon checks passed')
} finally {
  await browser.close()
  await new Promise(resolve => server.close(resolve))
}

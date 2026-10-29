// Run: node scripts/test-contribute.mjs <CodeNomad checkout with installed dev dependencies>
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const checkout = path.resolve(process.argv[2]), require = createRequire(path.join(checkout, 'package.json'))
const { chromium } = require('playwright'), { tsImport } = require('tsx/esm/api')
const { panelExtensionDocument } = await tsImport(pathToFileURL(path.join(checkout, 'packages/ui/src/components/panel-extensions/frame-document.ts')).href, import.meta.url)
const html = await readFile(new URL('../extensions/contribute/panel.html', import.meta.url), 'utf8')
const browser = await chromium.launch({ executablePath: process.env.CODENOMAD_BROWSER_PATH || undefined })
const server = createServer((_request, response) => {
  response.setHeader('Content-Type', 'text/html; charset=utf-8')
  response.end(`<iframe title="Contribute" sandbox="allow-scripts" style="width:100%;height:calc(100vh - 16px);border:0" srcdoc="${panelExtensionDocument(html, 'test', 3).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;')}" onload="init(this)"></iframe><script>
    let channel, context = { apiVersion: 3, sessionId: 's', locale: 'fr-FR', appearance: 'dark', colors: { background: '#343a43', surface: '#252a31' } };
    window.lists = []; window.opens = []; window.unavailable = null;
    const repository = { provider: 'gitlab', host: 'gitlab.com', path: 'team/app', webUrl: 'https://gitlab.com/team/app', access: 'anonymous' };
    const item = (kind, number, extra = {}) => ({ kind, number, title: (kind === 'issue' ? 'Issue ' : 'Change ') + number, state: 'open', draft: false,
      author: 'dev', labels: ['bug'], updatedAt: '2026-10-29T12:00:00Z', url: repository.webUrl + '/-/' + number, ...extra });
    function init(frame) {
      const connection = new MessageChannel(); channel = connection.port1;
      channel.onmessage = e => {
        if (e.data.type === 'ready') { channel.postMessage({ type: 'context', context }); return; }
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
  assert.equal((await view.evaluate(() => window.lists)).at(-2).fresh, true, 'Refresh bypasses the host cache')
  console.log('Contribute addon checks passed')
} finally {
  await browser.close()
  await new Promise(resolve => server.close(resolve))
}

// Run: node scripts/test-notes.mjs <CodeNomad checkout with installed dev dependencies>
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const checkout = path.resolve(process.argv[2]), require = createRequire(path.join(checkout, 'package.json'))
const { chromium } = require('playwright'), { tsImport } = require('tsx/esm/api')
const { panelExtensionDocument } = await tsImport(pathToFileURL(path.join(checkout, 'packages/ui/src/components/panel-extensions/frame-document.ts')).href, import.meta.url)
const html = await readFile(new URL('../extensions/notes/panel.html', import.meta.url), 'utf8')
const { permissions } = JSON.parse(await readFile(new URL('../extensions/notes/manifest.json', import.meta.url), 'utf8'))
const browser = await chromium.launch({ executablePath: process.env.CODENOMAD_BROWSER_PATH || undefined })
const server = createServer((_request, response) => {
  response.setHeader('Content-Type', 'text/html; charset=utf-8')
  response.end(`<iframe title="Notes" sandbox="allow-scripts" style="width:100%;height:calc(100vh - 16px);border:0" srcdoc="${panelExtensionDocument(html, 'test', 4, permissions).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;')}" onload="init(this)"></iframe><script>
    // The host's notes store for one project, answering as the API 4 channel does.
    const hour = 3600e3, displayed = 'ses_a';
    window.notes = new Map([['ses_b', { title: 'Bêta', text: 'Autre note', revision: 5, updated: Date.now() - hour, orphan: false }],
      ['ses_old', { title: 'Ancienne', text: 'Ligne 1\\nLigne 2\\nLigne 3\\nLigne 4', revision: 2, updated: Date.now() - 50 * hour, orphan: true }]]);
    window.calls = [];
    let channel, context = { apiVersion: 4, sessionId: displayed, locale: 'fr-FR', appearance: 'dark', colors: { background: '#343a43', surface: '#252a31' } };
    const changed = () => setTimeout(() => channel.postMessage({ type: 'notes:changed' }), 20);
    function answer(capability, method, input) {
      window.calls.push({ capability, method, input });
      if (capability === 'composer') return 'added';
      const current = notes.get(input.sessionID ?? displayed);
      if (method === 'get') return current ? { text: current.text, revision: current.revision } : null;
      if (method === 'list') return { notes: [...notes].sort((a, b) => b[1].updated - a[1].updated).map(([sessionID, note]) => ({ sessionID, ...note })), cursor: null };
      if (method === 'open') return { opened: true };
      if ((current?.revision ?? 0) !== input.revision) return method === 'delete' ? { status: 'conflict' } : { status: 'conflict', note: current ? { text: current.text, revision: current.revision } : null };
      changed();
      if (method === 'delete' || !input.text) { notes.delete(input.sessionID ?? displayed); return method === 'delete' ? { status: 'deleted' } : { status: 'saved', revision: 0 }; }
      const revision = (current?.revision ?? 0) + 100;
      notes.set(displayed, { title: 'Alpha', text: input.text, revision, updated: Date.now(), orphan: false });
      return { status: 'saved', revision };
    }
    function init(frame) {
      const connection = new MessageChannel(); channel = connection.port1;
      channel.onmessage = e => {
        if (e.data.type === 'ready') { channel.postMessage({ type: 'context', context }); return; }
        if (e.data.type !== 'api4:request') return;
        channel.postMessage({ type: 'api4:result', id: e.data.id, result: answer(e.data.capability, e.data.method, e.data.input) });
      };
      frame.contentWindow.postMessage({ type: 'codenomad:init' }, '*', [connection.port2]);
    }
  </script>`)
})
const calls = (view, method) => view.evaluate(name => window.calls.filter(call => call.method === name).map(call => call.input), method)
try {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const view = await browser.newPage({ viewport: { width: 380, height: 640 } })
  await view.goto(`http://127.0.0.1:${server.address().port}`)
  const frame = view.frameLocator('iframe')
  await frame.getByRole('tab', { name: 'Projet (1)' }).waitFor()
  await frame.getByRole('tab', { name: 'Orphelines (1)' }).waitFor()
  assert.equal(await frame.getByRole('tab', { name: 'Session' }).getAttribute('aria-selected'), 'true')
  assert.equal(await frame.locator('body').evaluate(element => getComputedStyle(element).backgroundColor), 'rgb(52, 58, 67)')
  assert.equal(await frame.getByRole('button', { name: 'Supprimer' }).isDisabled(), true, 'nothing to delete yet')

  // Autosave once typing settles: one write at revision 0, then the host's change notice refreshes the counts.
  const editor = frame.getByRole('textbox', { name: 'Notes' })
  await editor.pressSequentially('Plan du jour', { delay: 15 })
  await frame.getByText('Enregistré', { exact: true }).waitFor()
  assert.deepEqual(await calls(view, 'set'), [{ text: 'Plan du jour', revision: 0 }])
  await frame.getByRole('tab', { name: 'Projet (2)' }).waitFor()

  // Another window wrote meanwhile: the typed text wins at the revision the conflict returned.
  await view.evaluate(() => { const note = window.notes.get('ses_a'); window.notes.set('ses_a', { ...note, text: 'Ailleurs', revision: 777 }) })
  await editor.pressSequentially(' !', { delay: 15 })
  await frame.getByText('Enregistré', { exact: true }).waitFor()
  assert.deepEqual((await calls(view, 'set')).slice(1), [{ text: 'Plan du jour !', revision: 100 }, { text: 'Plan du jour !', revision: 777 }])

  await frame.getByRole('button', { name: 'Insérer dans le message' }).click()
  await frame.getByText('Ajoutée à la zone de saisie.').waitFor()
  assert.deepEqual(await calls(view, 'prefill'), [{ text: 'Plan du jour !' }])

  // Project: newest first, the displayed conversation marked; another one opens through the host.
  await frame.getByRole('tab', { name: 'Session' }).press('ArrowRight')
  assert.equal(await frame.getByRole('tab', { name: 'Projet (2)' }).getAttribute('aria-selected'), 'true')
  const cards = frame.locator('.note')
  assert.match(await cards.nth(0).innerText(), /^Alpha\s+maintenant · affichée\s+Plan du jour !$/)
  assert.match(await cards.nth(1).innerText(), /^Bêta\s+il y a 1 heure\s+Autre note$/)
  await cards.nth(1).click()
  await view.waitForFunction(() => window.calls.some(call => call.method === 'open'))
  assert.deepEqual(await calls(view, 'open'), [{ sessionID: 'ses_b' }])

  // Orphans: read-only, expandable, deleted after a confirming second click.
  await frame.getByRole('tab', { name: 'Orphelines (1)' }).click()
  const orphan = frame.locator('.note').first()
  assert.match(await orphan.innerText(), /^Ancienne\s+avant-hier · conversation supprimée/)
  await orphan.click()
  assert.equal(await orphan.getAttribute('aria-expanded'), 'true')
  await frame.getByRole('button', { name: 'Supprimer' }).click()
  assert.deepEqual(await calls(view, 'delete'), [], 'the first click only arms')
  await frame.getByRole('button', { name: 'Supprimer ?' }).click()
  await frame.getByText('Aucune note orpheline.').waitFor()
  assert.deepEqual(await calls(view, 'delete'), [{ sessionID: 'ses_old', revision: 2 }])
  await frame.getByRole('tab', { name: 'Orphelines (0)' }).waitFor()

  // Clearing the session note deletes it on the host.
  await frame.getByRole('tab', { name: 'Session' }).click()
  await frame.getByRole('button', { name: 'Supprimer' }).click()
  await frame.getByRole('button', { name: 'Supprimer ?' }).click()
  await frame.getByRole('tab', { name: 'Projet (1)' }).waitFor()
  assert.equal(await editor.inputValue(), '')
  assert.equal(await view.evaluate(() => window.notes.has('ses_a')), false)
  console.log('Notes addon checks passed')
} finally {
  await browser.close()
  await new Promise(resolve => server.close(resolve))
}

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
    window.calls = []; window.openable = true;
    // The first read waits until the test releases it.
    window.getGate = new Promise(resolve => { window.releaseGet = resolve });
    let channel, context = { apiVersion: 4, sessionId: new URLSearchParams(location.search).get('session') ?? displayed, locale: 'fr-FR', appearance: 'dark', colors: { background: '#343a43', surface: '#252a31' } };
    const changed = () => setTimeout(() => channel.postMessage({ type: 'notes:changed' }), 20);
    async function answer(capability, method, input) {
      window.calls.push({ capability, method, input });
      if (capability === 'composer') return 'added';
      const current = notes.get(input.sessionID ?? displayed);
      if (method === 'get') await window.getGate;
      if (method === 'get') return current ? { text: current.text, revision: current.revision } : null;
      if (method === 'list') return { notes: [...notes].sort((a, b) => b[1].updated - a[1].updated).map(([sessionID, note]) => ({ sessionID, ...note })), cursor: null };
      if (method === 'open') return { opened: window.openable };
      if ((current?.revision ?? 0) !== input.revision) return method === 'delete' ? { status: 'conflict' } : { status: 'conflict', note: current ? { text: current.text, revision: current.revision } : null };
      changed();
      if (method === 'delete' || !input.text) { notes.delete(input.sessionID ?? displayed); return method === 'delete' ? { status: 'deleted' } : { status: 'saved', revision: 0 }; }
      const revision = (current?.revision ?? 0) + 100;
      notes.set(displayed, { title: 'Alpha', text: input.text, revision, updated: Date.now(), orphan: false });
      return { status: 'saved', revision };
    }
    function init(frame) {
      const connection = new MessageChannel(); channel = connection.port1;
      channel.onmessage = async e => {
        if (e.data.type === 'ready') { channel.postMessage({ type: 'context', context }); return; }
        if (e.data.type !== 'api4:request') return;
        channel.postMessage({ type: 'api4:result', id: e.data.id, result: await answer(e.data.capability, e.data.method, e.data.input) });
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

  // Nothing can be typed over a note that has not been read yet.
  const editor = frame.getByRole('textbox', { name: 'Notes' })
  assert.equal(await editor.isEditable(), false, 'read-only until the first read')
  await view.evaluate(() => window.releaseGet())
  await view.waitForFunction(() => true)
  await frame.locator('#text:not([readonly])').waitFor()

  // Autosave once typing settles: one write at revision 0, then the host's change notice refreshes the counts.
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
  const cards = frame.locator('#notes li')
  await cards.first().filter({ hasText: 'Plan du jour !' }).waitFor()
  assert.match(await cards.nth(0).innerText(), /^Alpha\s+maintenant · affichée\s+Plan du jour !$/)
  assert.match(await cards.nth(1).innerText(), /^Bêta\s+il y a 1 heure\s+Autre note$/)
  await cards.nth(1).click()
  await view.waitForFunction(() => window.calls.some(call => call.method === 'open'))
  assert.deepEqual(await calls(view, 'open'), [{ sessionID: 'ses_b' }])
  await view.evaluate(() => { window.openable = false })
  await cards.nth(1).click()
  await frame.getByText('Cette conversation ne peut pas être ouverte d’ici.').waitFor()

  // Orphans: read-only, expandable, deleted after a confirming second click.
  await frame.getByRole('tab', { name: 'Orphelines (1)' }).click()
  const orphan = frame.locator('.note').first()
  assert.match(await orphan.innerText(), /^Ancienne\s+avant-hier · conversation supprimée/)
  await orphan.click()
  assert.equal(await orphan.getAttribute('aria-expanded'), 'true')
  // A refresh keeps the expanded note and the keyboard focus.
  await view.evaluate(() => channel.postMessage({ type: 'notes:changed' }))
  await view.waitForTimeout(400)
  assert.equal(await orphan.getAttribute('aria-expanded'), 'true')
  assert.equal(await orphan.evaluate(element => document.activeElement === element), true)
  // A held Enter arms once and never confirms.
  await frame.locator('li[data-session="ses_old"] .trash').focus()
  await view.keyboard.down('Enter'); await view.keyboard.down('Enter'); await view.keyboard.down('Enter'); await view.keyboard.up('Enter')
  await view.waitForTimeout(300)
  assert.deepEqual(await calls(view, 'delete'), [], 'a repeated key never deletes')
  await view.waitForTimeout(3200)
  await frame.getByRole('button', { name: 'Supprimer' }).click()
  assert.deepEqual(await calls(view, 'delete'), [], 'the first click only arms')
  await frame.getByRole('button', { name: 'Supprimer ?' }).click()
  await frame.getByText('Aucune note orpheline.').waitFor()
  assert.deepEqual(await calls(view, 'delete'), [{ sessionID: 'ses_old', revision: 2 }])
  await frame.getByRole('tab', { name: 'Orphelines (0)' }).waitFor()

  // The message box takes at most 2 KB: refused before anything is sent.
  await frame.getByRole('tab', { name: 'Session' }).click()
  const prefills = (await calls(view, 'prefill')).length
  await editor.fill('x'.repeat(2100))
  await frame.getByText('Enregistré', { exact: true }).waitFor()
  await frame.getByRole('button', { name: 'Insérer dans le message' }).click()
  await frame.getByText('Trop longue pour la zone de saisie (2 Ko max).').waitFor()
  assert.equal((await calls(view, 'prefill')).length, prefills)

  // An armed deletion holds only for the revision it was armed against.
  await frame.getByRole('button', { name: 'Supprimer' }).click()
  await view.evaluate(() => { const note = window.notes.get('ses_a'); window.notes.set('ses_a', { ...note, text: 'Remplacée', revision: 4000 }); channel.postMessage({ type: 'notes:changed' }) })
  await view.waitForFunction(() => true)
  await frame.locator('#text').evaluate(element => new Promise(resolve => { const check = () => element.value === 'Remplacée' ? resolve() : requestAnimationFrame(check); check() }))
  const deletions = (await calls(view, 'set')).filter(input => input.text === '').length
  await frame.getByRole('button', { name: 'Supprimer ?' }).click()
  await view.waitForTimeout(500)
  assert.equal((await calls(view, 'set')).filter(input => input.text === '').length, deletions, 'never deletes a revision it did not show when armed')
  assert.equal(await editor.inputValue(), 'Remplacée')
  assert.equal(await frame.locator('#saved').textContent(), 'Modifiée dans une autre fenêtre : elle n’a pas été supprimée.')

  // A deletion that meets another window's change keeps and shows it.
  await frame.getByRole('button', { name: 'Supprimer' }).click()
  await view.evaluate(() => { const note = window.notes.get('ses_a'); window.notes.set('ses_a', { ...note, text: 'Ailleurs', revision: 5000 }) })
  await frame.getByRole('button', { name: 'Supprimer ?' }).click()
  await frame.locator('#text').evaluate(element => new Promise(resolve => { const check = () => element.value === 'Ailleurs' ? resolve() : requestAnimationFrame(check); check() }))
  assert.equal(await frame.locator('#saved').textContent(), 'Modifiée dans une autre fenêtre : elle n’a pas été supprimée.')

  // Clearing the session note deletes it on the host.
  await frame.getByRole('button', { name: 'Supprimer' }).click()
  await frame.getByRole('button', { name: 'Supprimer ?' }).click()
  await frame.getByRole('tab', { name: 'Projet (1)' }).waitFor()
  assert.equal(await editor.inputValue(), '')
  assert.equal(await view.evaluate(() => window.notes.has('ses_a')), false)
  // The host's info view is no conversation: no editor, the lists stay available.
  const info = await browser.newPage({ viewport: { width: 380, height: 640 } })
  await info.goto(`http://127.0.0.1:${server.address().port}/?session=info`)
  const infoFrame = info.frameLocator('iframe')
  await infoFrame.getByText('Ouvrez une conversation pour écrire sa note.').waitFor()
  assert.equal(await infoFrame.getByRole('textbox', { name: 'Notes' }).count(), 0)
  await infoFrame.getByRole('tab', { name: /^Projet/ }).click()
  await infoFrame.locator('.note').first().waitFor()
  console.log('Notes addon checks passed')
} finally {
  await browser.close()
  await new Promise(resolve => server.close(resolve))
}

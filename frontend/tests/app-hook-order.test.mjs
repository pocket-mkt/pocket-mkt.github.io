import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('App hooks always execute before login/bootstrap early returns', async () => {
  const source = await readFile(new URL('../src/App.jsx', import.meta.url), 'utf8');
  const app = source.slice(source.indexOf('export function App() {'));
  const gate = app.indexOf('  if (configError) return');
  assert.ok(gate > 0);
  const after = app.slice(gate);
  assert.doesNotMatch(after, /\buse(?:Ref|State|Effect|Memo|Callback|Reducer|LayoutEffect|ActiveResource)\s*\(/, 'Hooks after early returns crash when bootstrap becomes ready');
  for (const name of ['copyPlansRef', 'copyBusyRef']) {
    assert.ok(app.indexOf('const ' + name + ' = useRef(') < gate, name + ' must be unconditional');
  }
});

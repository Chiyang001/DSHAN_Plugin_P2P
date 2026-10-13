import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { bundlePatchPaths, loadOverlayPatches, composeEntries } from '@deepseek-ai/dsh-app-boot';

test('plugin manifest declares a loadable Harness bundle with the peer component', () => {
  const packageDir = fileURLToPath(new URL('../', import.meta.url));
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.ok(manifest.dsh.bundle, 'plugin manager requires dsh.bundle');
  const paths = bundlePatchPaths(packageDir, manifest.dsh.bundle);
  const patches = paths.flatMap(path => loadOverlayPatches('dsh', path));
  assert.ok(patches.some(patch => patch.insert?.some(row => row.id === 'dsh-peer' && row.name === 'dsh-peer')));
  assert.ok(manifest.files.includes('cordis.patch.yml'));
});


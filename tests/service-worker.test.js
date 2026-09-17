import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile, stat } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const source = await readFile(new URL('sw.js', root), 'utf8');
const manifest = JSON.parse(await readFile(new URL('manifest.webmanifest', root), 'utf8'));
const expectedAssets = [
  './', './index.html', './styles.css', './src/app.js', './src/engine.js',
  './src/game.js', './src/puzzles.js', './favicon.svg', './manifest.webmanifest',
  './icons/icon-192.png', './icons/icon-512.png',
];

function worker(scope = 'https://pankajarm.github.io/sudoku/') {
  const listeners = new Map(), cachesByName = new Map();
  const state = { scope, fetched: [], precached: [], deleted: [], opened: [],
    offline: false, storageDenied: false, downloadFailed: false, claimed: 0, skipped: 0 };
  const deny = () => { if (state.storageDenied) throw new Error('Storage denied'); };
  vm.runInNewContext(source, {
    URL, Request, Response,
    self: {
      registration: { scope },
      clients: { claim: async () => { state.claimed++; } },
      skipWaiting: () => { state.skipped++; },
      addEventListener: (name, handler) => listeners.set(name, handler),
    },
    caches: {
      async open(name) {
        deny();
        state.opened.push(name);
        if (!cachesByName.has(name)) cachesByName.set(name, new Map());
        const entries = cachesByName.get(name);
        return {
          async addAll(requests) {
            if (state.downloadFailed) throw new Error('An asset could not be downloaded');
            for (const request of requests) {
              state.precached.push({ url: request.url, cache: request.cache });
              entries.set(request.url, `cached:${request.url}`);
            }
          },
          async match(url) {
            const value = entries.get(url);
            return value === undefined ? undefined : new Response(value);
          },
        };
      },
      async keys() { deny(); return [...cachesByName.keys()]; },
      async delete(name) { deny(); state.deleted.push(name); return cachesByName.delete(name); },
    },
    async fetch(request) {
      state.fetched.push(request.url);
      if (state.offline) throw new Error('Network unavailable');
      return new Response(`network:${request.url}`);
    },
  });
  return {
    state, cachesByName,
    async lifecycle(name) {
      let completion;
      listeners.get(name)({ waitUntil(promise) { completion = promise; } });
      await completion;
    },
    async request(path = './', { mode = 'navigate', method = 'GET', range = false } = {}) {
      let response;
      listeners.get('fetch')({
        request: { url: new URL(path, scope).href, method, mode,
          headers: new Headers(range ? { Range: 'bytes=0-20' } : {}) },
        respondWith(promise) { response = promise; },
      });
      return response === undefined ? null : await response;
    },
  };
}

test('precache contains every local runtime asset at either a project or root scope', async () => {
  for (const scope of ['https://pankajarm.github.io/sudoku/', 'https://example.com/']) {
    const app = worker(scope);
    await app.lifecycle('install');
    assert.deepEqual(app.state.precached.map(({ url }) => url).sort(),
      expectedAssets.map((path) => new URL(path, scope).href).sort());
    for (const { url, cache } of app.state.precached) {
      assert.equal(new URL(url).origin, new URL(scope).origin);
      assert.ok(url.startsWith(scope), 'an asset must stay within this app scope');
      assert.equal(cache, 'reload', 'a release must not use stale HTTP cache responses');
    }
    assert.equal(app.state.skipped, 0, 'an update must not replace a game in an open tab');
  }
  for (const path of expectedAssets) {
    const file = new URL(path === './' ? './index.html' : path, root);
    assert.ok((await stat(file)).isFile(), `${path} must exist in the repository`);
    assert.ok((await stat(file)).size > 0, `${path} must not be empty`);
  }
});

test('manifest uses relative app URLs and includes local, precached install icons', async () => {
  assert.equal(manifest.scope, './');
  assert.equal(manifest.start_url, './');
  assert.equal(manifest.id, './');
  assert.equal(manifest.display, 'standalone');
  for (const size of ['192x192', '512x512']) {
    const icon = manifest.icons.find((item) => item.sizes === size);
    assert.ok(icon, `an install icon is required at ${size}`);
    assert.equal(icon.type, 'image/png');
  }
  for (const icon of manifest.icons) {
    assert.ok(icon.src.startsWith('./'));
    assert.ok(expectedAssets.includes(icon.src));
    assert.ok((await stat(new URL(icon.src, root))).isFile());
  }
});

test('activation removes only older caches for the exact registration scope', async () => {
  const app = worker();
  await app.lifecycle('install');
  const current = app.state.opened[0];
  const ownOld = `sudoku:${encodeURIComponent(app.state.scope)}:old-release`;
  const otherProject = `sudoku:${encodeURIComponent('https://pankajarm.github.io/other/')}:v1`;
  const similarPath = `sudoku:${encodeURIComponent('https://pankajarm.github.io/sudoku-copy/')}:v1`;
  for (const name of [ownOld, otherProject, similarPath, 'unrelated-app']) {
    app.cachesByName.set(name, new Map());
  }
  await app.lifecycle('activate');
  assert.deepEqual(app.state.deleted, [ownOld]);
  for (const name of [current, otherProject, similarPath, 'unrelated-app']) {
    assert.ok(app.cachesByName.has(name));
  }
  assert.equal(app.state.claimed, 1);
});

test('cached pages and assets work offline, including query strings and direct asset navigation', async () => {
  const app = worker();
  await app.lifecycle('install');
  app.state.offline = true;
  for (const page of ['./', './?daily=1', './index.html?source=home#puzzle=123']) {
    assert.equal(await (await app.request(page)).text(), `cached:${app.state.scope}index.html`);
  }
  for (const path of expectedAssets.filter((path) => path !== './')) {
    assert.equal(await (await app.request(path, { mode: 'cors' })).text(),
      `cached:${new URL(path, app.state.scope).href}`);
  }
  assert.equal(await (await app.request('./favicon.svg')).text(), `cached:${app.state.scope}favicon.svg`);
  assert.equal(app.state.fetched.length, 0);
});

test('worker leaves external origins, other projects, unknown paths and non-GET requests alone', async () => {
  const app = worker();
  for (const path of ['https://example.com/sudoku/index.html', '../other/index.html',
    './unknown.html', './sw.js', './src/unknown.js']) {
    assert.equal(await app.request(path), null);
  }
  assert.equal(await app.request('./', { method: 'POST' }), null);
  assert.equal(await app.request('./favicon.svg', { range: true }), null);
  assert.equal(app.state.opened.length, 0);
  assert.equal(app.state.fetched.length, 0);
});

test('evicted cache entries fall back to the network', async () => {
  const app = worker();
  await app.lifecycle('install');
  app.cachesByName.get(app.state.opened[0]).clear();
  const response = await app.request('./src/app.js', { mode: 'cors' });
  assert.equal(await response.text(), `network:${app.state.scope}src/app.js`);
});

test('offline cache misses return useful navigation and asset failures', async () => {
  const app = worker();
  app.state.offline = true;
  const page = await app.request('./');
  assert.equal(page.status, 503);
  assert.match(page.headers.get('Content-Type'), /^text\/html/);
  assert.match(await page.text(), /Reconnect to load Sudoku/);
  const asset = await app.request('./src/app.js', { mode: 'cors' });
  assert.equal(asset.status, 503);
  assert.match(asset.headers.get('Content-Type'), /^text\/plain/);
  assert.match(await asset.text(), /unavailable offline/);
});

test('unavailable CacheStorage preserves online play and does not block activation', async () => {
  const app = worker();
  app.state.storageDenied = true;
  assert.equal(await (await app.request('./')).text(), `network:${app.state.scope}`);
  await app.lifecycle('activate');
  assert.equal(app.state.claimed, 1);
  app.state.offline = true;
  assert.equal((await app.request('./')).status, 503);
  await assert.rejects(app.lifecycle('install'), /Storage denied/);
  assert.equal(app.state.skipped, 0);
});

test('an incomplete release fails installation without forcing the old worker out', async () => {
  const app = worker();
  app.state.downloadFailed = true;
  await assert.rejects(app.lifecycle('install'), /could not be downloaded/);
  assert.equal(app.state.skipped, 0);
  assert.equal(app.state.deleted.length, 0);
});

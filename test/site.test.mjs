/** Packaging and real HTTP-response checks; not a substitute for browser navigation. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, access} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
import {createStaticServer} from '../scripts/serve.mjs';

const root = new URL('../', import.meta.url);
const read = name => readFile(new URL(name, root), 'utf8');
const html = await read('index.html');
const markup = html.slice(0, html.indexOf('<script>'));
const pkg = JSON.parse(await read('package.json'));
async function withServer(fn, base = '/') {
  const server = await createStaticServer({root:fileURLToPath(root), base});
  await new Promise((resolve, reject) => {server.once('error', reject);server.listen(0, '127.0.0.1', resolve);});
  try {await fn(`http://127.0.0.1:${server.address().port}${base}`);}
  finally {await new Promise(resolve => {server.close(resolve);server.closeAllConnections();});}
}

test('Pages entry is complete and byte-identical to the offline copy', async () => {
  assert.equal(html, await read('Wii-SD-Manager.html'));
  assert.ok(html.startsWith('<!doctype html>'));
  assert.ok(html.endsWith('</html>\n'));
  assert.ok(html.includes("document.documentElement.dataset.ready='true'"));
});
test('production HTML has no remote or separate script/style/image dependencies', () => {
  assert.doesNotMatch(html, /<script\b[^>]*\bsrc\s*=/i);
  assert.doesNotMatch(markup, /<link\b[^>]*rel="stylesheet"/i);
  for (const match of markup.matchAll(/<(?:link|img|iframe|source)\b[^>]*(?:href|src)="([^"]+)"/gi)) {
    assert.ok(match[1].startsWith('data:') || match[1].startsWith('#'), match[1]);
  }
  assert.doesNotMatch(markup, /<base\b/i);
});
test('bundled scripts have valid classic JavaScript syntax without module imports', () => {
  const scripts = [...html.matchAll(/<script>\n([\s\S]*?)<\/script>/g)];
  assert.equal(scripts.length, 2);
  for (const [, source] of scripts) {new vm.Script(source);assert.doesNotMatch(source,/^import /m);}
});
test('GitHub Pages bypass marker is present and empty', async () => {
  assert.equal(await read('.nojekyll'), '');
});
test('the package does not configure an unintended custom domain', async () => {
  await assert.rejects(access(new URL('CNAME', root)), {code:'ENOENT'});
});
test('visible release version matches package metadata', () => {
  assert.ok(markup.includes(`Menu Edition v${pkg.version}`));
  assert.ok(markup.includes(`Wii SD Manager · v${pkg.version}`));
});
test('both source and generated documents retain all channels and dialogs', async () => {
  assert.equal([...markup.matchAll(/class="channel-page"/g)].length, 4);
  assert.equal([...markup.matchAll(/class="channel empty-channel"/g)].length, 46);
  for (const id of ['dropZone','infoChannel','applyDialog','applyConfirmBtn','openSmallZipBtn','infoCloseBtn','infoGotItBtn','exportBtn','uploadHelpDialog']) {
    assert.ok(markup.includes(`id="${id}"`), id);
  }
  assert.ok((await read('template.html')).includes('<!-- EMPTY_CHANNELS -->'));
});
test('modular development HTML references bundled, relative files', async () => {
  const dev = await read('dev.html');
  for (const file of ['styles.css','vendor/jszip.min.js','app.js']) {
    assert.ok(dev.includes(`"${file}"`));await access(new URL(file, root));
  }
  assert.ok(dev.includes('type="module" src="app.js"'));
});
test('all application module imports resolve inside this repository', async () => {
  for (const name of ['core.js','model.js','disk-io.js','folder-model.js','upload-specs.js','app.js']) {
    for (const [, dependency] of (await read(name)).matchAll(/^import[^;]*from\s*['"]([^'"]+)['"]/gm)) {
      assert.ok(dependency.startsWith('./'));await access(new URL(dependency, root));
    }
  }
});
test('runtime code contains no analytics, upload endpoint or network API', async () => {
  for (const name of ['core.js','model.js','disk-io.js','folder-model.js','upload-specs.js','app.js']) {
    assert.doesNotMatch(await read(name), /\b(?:fetch|XMLHttpRequest|WebSocket|sendBeacon)\s*[.(]/);
  }
});
test('third-party licensing notices survive the standalone build', async () => {
  const notices = await read('vendor/THIRD-PARTY-NOTICES.txt');
  assert.ok(html.includes(notices));assert.ok(notices.includes('The MIT License'));
});
test('no npm runtime dependency is needed to host or build', async () => {
  assert.equal(Object.keys(pkg.dependencies || {}).length, 0);
  assert.equal(Object.keys(pkg.devDependencies || {}).length, 0);
  const lock = JSON.parse(await read('package-lock.json'));
  assert.equal(lock.version, pkg.version);assert.deepEqual(Object.keys(lock.packages), ['']);
});
test('deployment instructions and user documentation are shipped', async () => {
  for (const name of ['README.md','START-HERE.md','docs/DEPLOYMENT.md','docs/DEVELOPMENT.md','docs/USER-GUIDE.md','UPLOAD-GUIDE.md','SECURITY.md','PRIVACY.md','LICENSING.md']) {
    assert.ok((await read(name)).length > 80, name);
  }
  const deployment = await read('docs/DEPLOYMENT.md');
  assert.ok(deployment.includes('https://sjoeen.github.io/wii-game-manager/'));assert.ok(deployment.includes('sjoeen/wii-game-manager'));assert.ok(deployment.includes('Deploy from a branch'));
  assert.ok(deployment.includes('/(root)'));
});
test('CI checks do not request deployment write access or custom secrets', async () => {
  const workflow = await read('.github/workflows/checks.yml');
  assert.ok(workflow.includes('contents: read'));assert.ok(workflow.includes('npm run verify'));
  assert.doesNotMatch(workflow, /contents: write|pages: write|secrets\./);
});
test('HTTP GET / serves the exact production bytes and HTML MIME type', async () => {
  await withServer(async url => {
    const response = await fetch(url);assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /^text\/html/);
    assert.equal(await response.text(), html);
  });
});
test('HTTP HEAD has the correct size with no response body', async () => {
  await withServer(async url => {
    const response = await fetch(url, {method:'HEAD'});
    assert.equal(response.status,200);assert.equal(Number(response.headers.get('content-length')),Buffer.byteLength(html));
    assert.equal(await response.text(),'');
  });
});
test('the offline HTML can also be served directly', async () => {
  await withServer(async url => {const response=await fetch(url+'Wii-SD-Manager.html');assert.equal(response.status,200);assert.equal(await response.text(),html);});
});
test('modular JS/CSS resources serve with suitable types and unchanged bytes', async () => {
  await withServer(async url => {
    for (const name of ['app.js','core.js','model.js','disk-io.js','folder-model.js','upload-specs.js','vendor/jszip.min.js','styles.css','dev.html']) {
      const response=await fetch(url+name);assert.equal(response.status,200,name);assert.equal(await response.text(),await read(name));
      assert.match(response.headers.get('content-type'), name.endsWith('.js') ? /javascript/ : name.endsWith('.css') ? /text\/css/ : /text\/html/);
    }
  });
});
test('encoded fixture filenames and ZIP downloads are served correctly', async () => {
  await withServer(async url => {
    for (const name of ['demo/Demo-SD-card.zip','demo/New-Game [DEME03].wbfs']) {
      const response=await fetch(url+name.split('/').map(encodeURIComponent).join('/'));
      assert.equal(response.status,200);assert.deepEqual(Buffer.from(await response.arrayBuffer()),await readFile(new URL(name,root)));
    }
  });
});
test('the self-contained homepage works at a project-style subpath too', async () => {
  await withServer(async url => {const response=await fetch(url);assert.equal(response.status,200);assert.equal(await response.text(),html);}, '/wii-game-manager/');
});
test('a missing path returns the custom 404 page with a real 404 status', async () => {
  await withServer(async url => {
    const response=await fetch(url+'missing-page');assert.equal(response.status,404);
    assert.equal(await response.text(),await read('404.html'));
    assert.match(await read('404.html'),/href="\/wii-game-manager\/"/);
  });
});
test('local server is read-only and does not expose private dot paths', async () => {
  await withServer(async url => {
    assert.equal((await fetch(url,{method:'POST',body:'not an upload'})).status,405);
    for (const name of ['.env','.git/config','%2e%2e%2foutside','%5csecret']) assert.equal((await fetch(url+name)).status,404,name);
  });
});
test('local server rejects invalid mount configuration', async () => {
  for (const base of ['wii','/wii','/../','//','/a?b/']) await assert.rejects(createStaticServer({base}), /Base must/);
});

test('build freshness check rejects a stale homepage and rebuild restores exact bytes', async () => {
  const {mkdtemp, copyFile, writeFile, rm} = await import('node:fs/promises');
  const {tmpdir} = await import('node:os');
  const path = await import('node:path');
  const {spawnSync} = await import('node:child_process');
  const {mkdir} = await import('node:fs/promises');
  const directory = await mkdtemp(path.join(tmpdir(), 'wii-build-check-'));
  try {
    await mkdir(path.join(directory, 'vendor'));
    for (const name of ['package.json','build.mjs','template.html','styles.css','app.js','core.js','model.js','disk-io.js','folder-model.js','upload-specs.js','vendor/jszip.min.js','vendor/THIRD-PARTY-NOTICES.txt','index.html','Wii-SD-Manager.html','dev.html','UPLOAD-GUIDE.md','.nojekyll']) {
      await copyFile(new URL(name,root),path.join(directory,name));
    }
    const run = args => spawnSync(process.execPath,[path.join(directory,'build.mjs'),...args],{cwd:directory,encoding:'utf8'});
    assert.equal(run(['--check']).status,0);
    await writeFile(path.join(directory,'index.html'), html + '<!-- stale -->');
    const stale=run(['--check']);assert.equal(stale.status,1);assert.match(stale.stderr,/Out of date or missing: index.html/);
    assert.equal(run([]).status,0);
    assert.equal(await readFile(path.join(directory,'index.html'),'utf8'),html);
    assert.equal(run(['--check']).status,0);
  } finally {await rm(directory,{recursive:true,force:true});}
});


test('package and lock metadata identify the requested project repository', async () => {
  assert.equal(pkg.name, 'wii-game-manager');
  assert.equal(pkg.homepage, 'https://sjoeen.github.io/wii-game-manager/');
  assert.equal(pkg.repository.url, 'https://github.com/sjoeen/wii-game-manager.git');
  const lock = JSON.parse(await read('package-lock.json'));
  assert.equal(lock.name, pkg.name);assert.equal(lock.packages[''].name, pkg.name);
  assert.equal(lock.packages[''].version, pkg.version);
});
test('project preview command mounts the same path as the published project', () => {
  assert.equal(pkg.scripts['start:pages'], 'node scripts/serve.mjs --base /wii-game-manager/');
});
test('project URL without trailing slash redirects into the project', async () => {
  await withServer(async url => {
    const response = await fetch(url.slice(0, -1), {redirect:'manual'});
    assert.equal(response.status, 308);assert.equal(response.headers.get('location'), '/wii-game-manager/');
  }, '/wii-game-manager/');
});
test('development assets and encoded demo downloads stay within the project subpath', async () => {
  await withServer(async url => {
    for (const name of ['dev.html','app.js','core.js','model.js','disk-io.js','folder-model.js','upload-specs.js','styles.css','vendor/jszip.min.js','demo/Demo-SD-card.zip','demo/New-Game [DEME03].wbfs']) {
      const response = await fetch(url + name.split('/').map(encodeURIComponent).join('/'));
      assert.equal(response.status, 200, name);
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), await readFile(new URL(name,root)));
    }
  }, '/wii-game-manager/');
});
test('nested project 404 returns to this app instead of the account homepage', async () => {
  await withServer(async url => {
    const missing = url + 'missing/deeper/page';
    const response = await fetch(missing);assert.equal(response.status,404);
    const page = await response.text();
    const href = page.match(/<a href="([^"]+)"/)[1];
    const home = new URL(href, missing).href;
    assert.equal(home, url);
    const back = await fetch(home);assert.equal(back.status,200);
    assert.equal(await back.text(),html);
  }, '/wii-game-manager/');
});

test('empty-card creation has no UI or action in the released app', async()=>{
  assert.doesNotMatch(markup,/startEmptyBtn|Start empty library|empty-start-box/);
  assert.doesNotMatch(await read('app.js'),/startEmptyLibrary|createEmpty/);
  assert.match(markup,/Open SD \/ USB/);
});

/** Local source-view rendering review; no strategy, candles, fills or performance calculations. */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';

const data = JSON.parse(fs.readFileSync('docs/xo-published-setups/publications.json'));
const output = path.resolve('.tmp/xo-published-setups-browser');
const profile = path.join(output, `browser-${Date.now()}`);
fs.mkdirSync(profile, {recursive: true});
const docs = path.resolve('docs');
const types = {'.html': 'text/html; charset=utf-8', '.json': 'application/json', '.webp': 'image/webp'};
const server = http.createServer((request, response) => {
  const relative = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
  const target = path.resolve(docs, '.' + relative);
  if (!target.startsWith(docs + path.sep) || !fs.existsSync(target) || !fs.statSync(target).isFile()) {
    response.writeHead(404).end(); return;
  }
  response.writeHead(200, {'Content-Type': types[path.extname(target)] ?? 'application/octet-stream'});
  fs.createReadStream(target).pipe(response);
});
await new Promise((resolve, reject) => {server.once('error', reject); server.listen(0, '127.0.0.1', resolve);});
const origin = `http://127.0.0.1:${server.address().port}`;
const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', '--no-sandbox', '--no-first-run', '--disable-gpu', '--disable-background-networking',
  '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank',
], {windowsHide: true, stdio: 'ignore'});
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
let socket, call;
const exceptions = [], reviewed = [], screenshots = [];
try {
  let port;
  for (let attempt = 0; attempt < 80; attempt++) {
    const file = path.join(profile, 'DevToolsActivePort');
    if (fs.existsSync(file)) {port = Number(fs.readFileSync(file, 'utf8').split('\n')[0]); break;}
    await pause(150);
  }
  assert.ok(port, 'Local review browser did not start');
  const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, {method: 'PUT'})).json();
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {socket.addEventListener('open', resolve, {once: true}); socket.addEventListener('error', reject, {once: true});});
  let sequence = 0; const pending = new Map();
  call = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timeout = setTimeout(() => {pending.delete(id); reject(Error(`Browser timeout: ${method}`));}, 15000);
    pending.set(id, {resolve: value => {clearTimeout(timeout); resolve(value);}, reject: error => {clearTimeout(timeout); reject(error);}});
    socket.send(JSON.stringify({id, method, params}));
  });
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.id) {const waiter = pending.get(message.id); pending.delete(message.id); message.error ? waiter?.reject(Error(JSON.stringify(message.error))) : waiter?.resolve(message.result);}
    if (message.method === 'Runtime.exceptionThrown') exceptions.push(message.params.exceptionDetails);
  });
  const evaluate = async expression => {
    const result = await call('Runtime.evaluate', {expression, awaitPromise: true, returnByValue: true});
    assert.ok(!result.exceptionDetails, JSON.stringify(result.exceptionDetails)); return result.result.value;
  };
  await call('Runtime.enable'); await call('Page.enable'); await call('Network.enable');
  await call('Network.setBlockedURLs', {urls: ['https://*', 'http://x.com/*']});
  await call('Page.navigate', {url: `${origin}/xo-published-setups/index.html?asset=ETH&post=1948134865355829359`});
  for (let attempt = 0; attempt < 80; attempt++) {
    if (await evaluate(`document.readyState === 'complete' && typeof renderAsset === 'function'`)) break;
    await pause(100);
  }
  const imageReady = async () => {
    for (let attempt = 0; attempt < 80; attempt++) {
      if (await evaluate(`$('image').hidden || $('image').complete && $('image').naturalWidth > 0`)) return;
      await pause(50);
    }
    throw Error('An original image did not load');
  };
  for (const record of data.publications) {
    await evaluate(`$('asset').value=${JSON.stringify(record.assets[0])}; $('frame').value='all'; renderAsset(${JSON.stringify(record.postId)});`);
    const rendered = await evaluate(`({postId:$('publication').dataset.postId,source:$('source').href,summary:$('summary').textContent,history:[...$('history').children].map(b=>b.dataset.postId),count:$('photo').options.length})`);
    assert.equal(rendered.postId, record.postId); assert.equal(rendered.source, record.sourceUrl); assert.equal(rendered.summary, record.summary);
    const history = data.publications.filter(item => item.assets.includes(record.assets[0]) && item.publishedAt <= record.publishedAt);
    assert.deepEqual(rendered.history, history.map(item => item.postId));
    const images = data.images.filter(image => image.postId === record.postId);
    assert.equal(rendered.count, images.length);
    for (let index = 0; index < images.length; index++) {
      await evaluate(`$('photo').value=${JSON.stringify(String(index))}; renderImage();`); await imageReady();
      const actual = await evaluate(`({sha256:$('image').dataset.sha256,source:new URL($('image').src).pathname,note:$('imageNote').textContent})`);
      assert.equal(actual.sha256, images[index].sha256);
      assert.equal(actual.source, new URL(images[index].localUrl, `${origin}/xo-published-setups/index.html`).pathname);
      assert.equal(actual.note, images[index].observation.notes);
    }
    reviewed.push({postId: record.postId, images: images.length, chronology: true});
  }
  for (const asset of ['BNB', 'XRP']) {
    await evaluate(`$('asset').value=${JSON.stringify(asset)}; renderAsset();`);
    assert.equal(await evaluate(`$('publication').hidden && !$('empty').hidden && $('post').options.length === 0`), true);
  }
  for (const frame of data.timeframes) {
    await evaluate(`$('asset').value='ETH'; $('frame').value=${JSON.stringify(frame)}; renderAsset('1948409297148285397');`);
    const matches = data.images.filter(image => image.postId === '1948409297148285397' && image.observation.chartTimeframe === frame);
    assert.equal(await evaluate(`$('photo').options.length`), matches.length);
  }
  for (const width of [1440, 390]) {
    await call('Emulation.setDeviceMetricsOverride', {width, height: 1100, deviceScaleFactor: 1, mobile: width === 390});
    await evaluate(`$('asset').value='ETH'; $('frame').value='all'; renderAsset('1948409297148285397'); $('photo').value='0'; renderImage();`); await imageReady();
    assert.equal(await evaluate(`document.documentElement.scrollWidth <= innerWidth`), true, `Horizontal overflow at ${width}`);
    const file = path.join(output, `source-ETH-1H-${width}.png`);
    const screenshot = await call('Page.captureScreenshot', {format: 'png', captureBeyondViewport: true});
    fs.writeFileSync(file, Buffer.from(screenshot.data, 'base64')); screenshots.push(file);
  }
  await evaluate(`$('asset').value='ETH'; $('frame').value='all'; renderAsset('1948134865355829359'); $('photo').value='3'; renderImage();`); await imageReady();
  const recoveredText = await evaluate(`$('imageFacts').textContent`);
  assert.match(recoveredText, /3842\.54/); assert.match(recoveredText, /3539\.4/);
  assert.match(recoveredText, /current Price/); assert.doesNotMatch(recoveredText, /exit Price/);
  assert.equal(exceptions.length, 0, JSON.stringify(exceptions));
  fs.writeFileSync(`${output}/review.json`, JSON.stringify({reviewedAt: new Date().toISOString(),
    publicationVersions: reviewed.length, originalImageReferences: reviewed.reduce((sum, item) => sum + item.images, 0),
    reviewed, screenshots, exceptions, timeframeFilterUsesPrintedSourceOnly: true,
    viewportWidths: [1440, 390], scope: 'Original-source UI and chronology review only. No trading simulation or performance validation.'}, null, 2) + '\n');
  console.log(JSON.stringify({publicationVersions: reviewed.length, originalImageReferences: data.images.length, exceptions: exceptions.length, output}));
} finally {
  if (call) await call('Browser.close').catch(() => {});
  socket?.close();
  if (chrome.exitCode === null) chrome.kill();
  server.closeAllConnections();
  server.close();
}
// All outputs above are synchronous and the owned browser has been closed.
// Undici's DevTools socket can retain a shutdown timer after Chrome exits.
process.exit(0);

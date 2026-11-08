import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

/** Run after the browser driver installs its custom weighted-flow study.
 * Exercises actual app download, removal, file import and the separate host.
 * Never publishes, signs a payment or changes server-owned records. */
export async function runIndicatorPortabilityBrowser({ call, ev, until, field, button, click, checked, shot, origin, manifestId }) {
  const root = path.resolve(process.cwd());
  const tempRoot = path.join(root, '.tmp');
  fs.mkdirSync(tempRoot, { recursive: true });
  const downloadPath = fs.mkdtempSync(path.join(tempRoot, 'indicator-portability-browser-'));
  assert.ok(downloadPath.startsWith(root + path.sep), 'Keep exported test packages within the workspace');
  const id = manifestId ?? await ev(`(()=>{const card=[...document.querySelectorAll('[data-installed-indicator]')].find(item=>item.querySelector('h4')?.textContent.trim()==='Browser weighted flow');return card?.dataset.installedIndicator??null;})()`) ?? 'qa.browser-weighted-flow';
  assert.match(id, /^[a-z0-9][a-z0-9._-]{2,95}$/, 'Only an admitted manifest identity may select the installed indicator');
  const selector = `[data-installed-indicator="${id}"]`;
  const scope = `document.querySelector(${JSON.stringify(selector)})`;
  await until(`document.querySelector(${JSON.stringify(selector)})`, 'The custom creator package must be installed before portability acceptance');
  await call('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath, eventsEnabled: true });
  await button('Export', scope);

  let exportedPath;
  for (let attempt = 0; attempt < 100; attempt++) {
    const files = fs.readdirSync(downloadPath).filter(name => name.endsWith('.pulse-indicator.json'));
    if (files.length) { exportedPath = path.join(downloadPath, files[0]); if (fs.statSync(exportedPath).size > 0) break; }
    await pause(100);
  }
  assert.ok(exportedPath && fs.existsSync(exportedPath), 'Export must produce an actual JSON download');
  const bytes = fs.readFileSync(exportedPath, 'utf8');
  const manifest = JSON.parse(bytes);
  assert.equal(manifest.id, id);
  assert.ok(['pulse-indicator-v2', 'pulse-indicator-v3'].includes(manifest.format));
  assert.equal(manifest.kernel, 'formula-v1');
  assert.equal(manifest.formula.output.accumulation, 'bar');
  assert.equal(manifest.formula.output.unit, 'volume');
  assert.equal(manifest.formula.expression.replace(/[()\s]/g, ''), 'buy*2-sell');
  if (manifest.format === 'pulse-indicator-v3') {
    assert.deepEqual(manifest.study.transforms, [], 'This creator path exports the deliberately unsmoothed weighted formula');
    assert.equal(manifest.study.plot, 'histogram');
    assert.equal(manifest.study.gapPolicy, 'reset');
    assert.equal(manifest.study.warmup, 'full-window');
  }
  const netlistHash = createHash('sha256').update(manifest.runtime.netlist).digest('hex');
  checked('custom_formula_actual_ui_export_download', { manifestId: id, version: manifest.version, bytes: Buffer.byteLength(bytes), netlistHash });

  await button('Remove', scope);
  await until(`!document.querySelector(${JSON.stringify(selector)})`, 'Remove must remove the installed custom tool before reimport');
  async function upload(selector, filename) {
    const { root: documentRoot } = await call('DOM.getDocument', { depth: 0 });
    const { nodeId } = await call('DOM.querySelector', { nodeId: documentRoot.nodeId, selector });
    assert.ok(nodeId, 'Missing actual file input: ' + selector);
    await call('DOM.setFileInputFiles', { nodeId, files: [filename] });
  }
  async function openDetails(summaryText) {
    const targetId = 'qa-portability-details-' + Date.now();
    const target = await ev(`(()=>{const summary=[...document.querySelectorAll('summary')].find(item=>item.textContent.trim().startsWith(${JSON.stringify(summaryText)}));if(!summary)return 'missing';if(summary.parentElement.open)return 'open';summary.id=${JSON.stringify(targetId)};return 'closed';})()`);
    assert.notEqual(target, 'missing', 'Missing actual disclosure: ' + summaryText);
    if (target === 'closed') await click('#' + targetId);
  }
  await openDetails('Move a saved indicator between apps');
  await upload('[data-indicator-market] input[type="file"]', exportedPath);
  await until(`document.querySelector(${JSON.stringify(selector)})`, 'Reimport must reinstall the downloaded custom version');
  await until(`JSON.parse(localStorage.getItem('pulse-indicators-v1')??'[]').some(item=>item.id===${JSON.stringify(id)})`, 'Imported package must persist to the actual installed library');
  const restored = await ev(`JSON.parse(localStorage.getItem('pulse-indicators-v1')??'[]').find(item=>item.id===${JSON.stringify(id)})`);
  assert.deepEqual(restored, manifest, 'Actual UI reimport must preserve the exact exported version and numerical netlist');
  checked('custom_formula_actual_ui_remove_import_restores_exact_package', { manifestId: id, version: manifest.version });
  await shot('custom-formula-export-import', '[data-indicator-market]');

  await call('Page.navigate', { url: origin + '/indicator-market/portable-host.html' });
  await until('document.querySelector("#package")&&document.querySelector("#run")', 'Independent portable host did not load');
  await openDetails('Developer check: one-bar circuit inputs');
  await upload('#package', exportedPath);
  await until(`document.querySelector('#identity').textContent.includes(${JSON.stringify(manifest.title)})&&!document.querySelector('#run').disabled`, 'Independent host must accept the actual app-exported package');
  const inputLabel = inputId => ev(`document.querySelector(${JSON.stringify('#' + inputId)}).closest('label').textContent.trim()`);
  const buyLabel = await inputLabel('buy'), sellLabel = await inputLabel('sell'), priorLabel = await inputLabel('prior');
  const circuitButton = await ev('document.querySelector("#run").textContent.trim()');
  const cases = [{ buy: 120, sell: 80, expected: 160 }, { buy: 10, sell: 80, expected: -60 }, { buy: 0, sell: 0, expected: 0 }];
  for (const sample of cases) {
    await field(buyLabel, sample.buy);
    await field(sellLabel, sample.sell);
    await field(priorLabel, 20);
    await button(circuitButton);
    const result = await ev(`({error:document.getElementById('error').textContent,result:document.getElementById('result').textContent})`);
    assert.equal(result.error, '', 'Independent host must calculate without an error');
    const numeric = JSON.parse(result.result);
    assert.equal(numeric.value, sample.expected);
    assert.equal(numeric.unit, 'volume');
  }
  assert.deepEqual(await ev(`performance.getEntriesByType('resource').filter(item=>new URL(item.name).pathname.includes('/v1/')).map(item=>item.name)`), [], 'Independent numeric host must not call the PULSE API');
  assert.deepEqual(await ev('window.__pulseTerminalWalletCalls??[]'), [], 'Independent numeric host must not use the wallet');
  checked('independent_host_custom_export_three_numerical_vectors_without_api_or_wallet', { manifestId: id, cases });

  let seriesCases = 0;
  if (manifest.format === 'pulse-indicator-v3') {
    const step = 60_000;
    const runSeries = async (rows, missingIntervals = []) => {
      await field(await inputLabel('bars'), JSON.stringify(rows));
      await field(await inputLabel('interval'), step);
      await field(await inputLabel('gaps'), JSON.stringify(missingIntervals));
      await button('Run imported study');
      const state = await ev(`({error:document.getElementById('error').textContent,result:document.getElementById('series-result').textContent})`);
      assert.equal(state.error, '', 'Independent host must evaluate the imported causal recipe');
      return JSON.parse(state.result);
    };
    const baseRows = cases.map((sample, index) => ({ ts: (index + 1) * step, end: (index + 2) * step, buy: sample.buy, sell: sample.sell }));
    const original = await runSeries(baseRows);
    assert.equal(original.length, cases.length);
    original.forEach((point, index) => assert.ok(Math.abs(point.value - cases[index].expected) < 0.01, 'The whole exported v3 recipe must reproduce weighted-flow values within input quantization'));
    checked('independent_host_actual_exported_v3_series_three_vectors', { manifestId: id, bars: original.length, transforms: manifest.study.transforms });
    seriesCases++;

    // These are explicit arithmetic QA recipe variants of the genuinely
    // exported kernel, not fabricated market history or additional UI exports.
    const sourceRows = [[1, 3, 1], [2, 1, 3], [3, 1, 5], [4, 0, 4], [5, 4, 0], [7, 2, 0], [8, 0, 1], [9, 1, 0]]
      .map(([minute, buy, sell]) => ({ ts: minute * step, end: (minute + 1) * step, buy, sell }));
    const gaps = [{ start: 6 * step, end: 7 * step }];
    const raw = [5, -1, -3, -4, 8, 4, -1, 2];
    const variants = [
      { kind: 'sum', period: 3, expected: [undefined, undefined, 1, -8, 1, undefined, undefined, 5] },
      { kind: 'sma', period: 3, expected: [undefined, undefined, 1 / 3, -8 / 3, 1 / 3, undefined, undefined, 5 / 3] },
      { kind: 'ema', period: 3, expected: [undefined, undefined, 1 / 3, -11 / 6, 37 / 12, undefined, undefined, 5 / 3] },
      { kind: 'cumulative', expected: [5, 4, 1, -3, 5, 4, 3, 5] },
    ];
    for (const variant of variants) {
      const recipe = structuredClone(manifest);
      recipe.study = { transforms: [variant.kind === 'cumulative' ? { kind: 'cumulative' } : { kind: variant.kind, period: variant.period }], plot: 'histogram', signal: { kind: 'cross-above', threshold: 0, label: 'QA crossing above zero' }, gapPolicy: 'reset', warmup: 'full-window' };
      const recipePath = path.join(downloadPath, 'qa-' + variant.kind + '.pulse-indicator.json');
      fs.writeFileSync(recipePath, JSON.stringify(recipe));
      await upload('#package', recipePath);
      await until('!document.querySelector("#run-series").disabled&&!document.querySelector("#error").textContent', 'Independent host must load the derived ' + variant.kind + ' recipe');
      const result = await runSeries(sourceRows, gaps);
      assert.equal(result.length, sourceRows.length);
      for (let index = 0; index < result.length; index++) {
        const point = result[index], expected = variant.expected[index];
        assert.equal(point.ts, sourceRows[index].ts);
        assert.ok(Math.abs(point.rawValue - raw[index]) < 1e-8, 'The exported NAND kernel must retain its arithmetic under a different recipe');
        if (expected === undefined) assert.equal(point.value, undefined, 'Warm-up must stay unknown instead of using a partial window');
        else assert.ok(Math.abs(point.value - expected) < 1e-8, `${variant.kind} output differs at source bar ${index}`);
      }
      assert.equal(result[4].signal, true, 'A real negative-to-positive crossing must be observed');
      assert.equal(result[5].reset, true, 'The verified source gap must reset all host state');
      const firstAfterGap = variant.kind === 'cumulative' ? 5 : 7;
      assert.equal(result[firstAfterGap].signal, undefined, 'The first resolved post-gap output cannot invent a crossover');
      checked('independent_host_v3_' + variant.kind + '_full_window_gap_reset_and_crossover', { manifestId: id, source: 'explicit arithmetic QA fixture using the actual exported kernel', bars: result.length, gapIntervals: gaps.length });
      seriesCases++;
    }
  }

  // A forward reference is structurally invalid regardless of the chosen inputs.
  const tampered = structuredClone(manifest);
  tampered.runtime.netlist = '0x00ffffff000000' + manifest.runtime.netlist.slice(16);
  const tamperedPath = path.join(downloadPath, 'tampered.pulse-indicator.json');
  fs.writeFileSync(tamperedPath, JSON.stringify(tampered));
  await upload('#package', tamperedPath);
  await until('document.querySelector("#run").disabled&&document.querySelector("#error").textContent.includes("forward")', 'Independent host must reject the tampered forward-reference circuit');
  checked('independent_host_rejects_tampered_custom_circuit');

  await upload('#package', exportedPath);
  await until('!document.querySelector("#run").disabled&&!document.querySelector("#error").textContent', 'Original package must remain recoverable after rejection');
  await field(buyLabel, 120); await field(sellLabel, 80);
  await button(circuitButton);
  assert.equal(await ev('JSON.parse(document.querySelector("#result").textContent).value'), 160);
  await shot('independent-host-custom-formula', 'main');
  return { manifestId: id, version: manifest.version, format: manifest.format, exportedFile: path.relative(root, exportedPath), netlistHash, numericalVectors: cases.length, seriesCases };
}

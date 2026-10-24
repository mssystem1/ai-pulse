/** Publish the original-source review. Does not import, run or score a trading strategy. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';

const archive = 'docs/backtests/xo-trade-record-audit';
const supplement = `${archive}/eth-rotation-2026-10-22`;
const recovery = `${archive}/eth-recovered-media-2026-10-24`;
const origin = `${archive}/eth-origin-2026-10-24`;
const output = 'docs/xo-published-setups';
const inputs = new Map();
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function read(file) {
  const bytes = fs.readFileSync(file);
  inputs.set(file, digest(bytes));
  return JSON.parse(bytes);
}
const originals = [read(`${archive}/initial-records.json`), read(`${archive}/chain-records.json`)];
const eth = read(`${supplement}/records.json`);
const oldMedia = read(`${archive}/media-manifest.json`).images;
const ethMedia = read(`${supplement}/media-manifest.json`).images;
const oldNotes = read(`${archive}/chart-inspections.json`).observations;
const ethNotes = read(`${supplement}/chart-inspections.json`).images;
const recovered = read(`${recovery}/capture.json`);
const recoveredNote = read(`${recovery}/observations.json`);
const originRecords = read(`${origin}/records.json`);
const originMedia = read(`${origin}/media-manifest.json`).images;
const originNotes = read(`${origin}/chart-inspections.json`).images;
const originPages = read(`${origin}/source-pages.json`).pages;
for (const record of originRecords.records) {
  const page = originPages.find(item => item.url === record.url);
  assert.ok(page, `Missing direct original page metadata: ${record.postId}`);
  assert.equal(page.canonical, record.url);
  assert.equal(page.author, 'https://x.com/Trader_XO');
  assert.equal(page.publishedDate.slice(0, 16), record.idTimestampInferredUTC.slice(0, 16));
  assert.deepEqual(page.ownMediaIds, record.mediaIds);
  assert.equal(page.ownPhotoLinks.length, record.ownPhotoCount);
}
const oldVersion = '2072373535574511834', editedVersion = '2072376414956130393';
const originalIds = new Set(originals.flatMap(source => source.records.map(record => record.postId)));
const allRecords = [...originals.flatMap(source => source.records), ...eth.records, ...originRecords.records];
const byId = new Map(allRecords.map(record => [record.postId, record]));
assert.equal(byId.size, allRecords.length, 'Source versions must remain distinct');

const publications = allRecords.map(record => {
  assert.equal(record.author, 'Trader_XO');
  assert.equal(record.directPrimaryPageRead, true);
  assert.equal(record.url, `https://x.com/Trader_XO/status/${record.postId}`);
  assert.equal(record.idTimestampInferredUTC, new Date(Number((BigInt(record.postId) >> 22n) + 1288834974657n)).toISOString());
  const predecessors = (record.linkedPosts ?? []).map(url => url.split('/').at(-1))
    .filter(id => byId.has(id) && BigInt(id) < BigInt(record.postId));
  return {
    postId: record.postId, sourceUrl: record.url, author: record.author,
    publishedAt: record.idTimestampInferredUTC,
    timestampMeaning: 'Publication/version creation time, not order or fill time. Displayed source minute corroborates the ID timestamp.',
    canonicalPostId: record.postId === editedVersion ? oldVersion : record.postId,
    supersededBy: record.editRelation?.supersededBy ?? null,
    assets: record.postId === '2072749403106841058' ? ['HYPE'] : record.assets ?? ['ETH'],
    contextAssets: record.postId === '2072749403106841058' ? ['BTC'] : [],
    kind: record.kind,
    summary: record.postId === oldVersion
      ? record.summary.replace(/ The later version adds a short-closure statement\.$/, '')
      : record.summary,
    publishedReferences: record.levels ?? record.publishedLevels ?? record.reportedRegions ?? {},
    gaps: record.gaps,
    laterResolutions: record.postId === recovered.postId
      ? ['The fourth original media URL was recovered on 24 October 2026. Its position card is included below. The earlier capture is unchanged.'] : [],
    predecessors,
    sourceRecordFile: originalIds.has(record.postId)
      ? `${archive}/${originals[0].records.some(item => item.postId === record.postId) ? 'initial-records.json' : 'chain-records.json'}`
      : `${originRecords.records.some(item => item.postId === record.postId) ? origin : supplement}/records.json`,
  };
}).sort((a, b) => a.publishedAt.localeCompare(b.publishedAt));

function initialObservation(media) {
  const mediaId = new URL(media.sourceUrl).pathname.split('/').at(-1);
  const note = oldNotes.find(item => item.mediaId === mediaId);
  assert.ok(note, `Missing original visual observation: ${mediaId}`);
  return {mediaId, kind: note.kind, notes: note.notes, reported: note.visibleNumbers,
    approximateReadings: note.approximateReadings, chartCreatedAtUTC: note.chartCreatedAtUTC,
    chartTimeframe: ['HMKMjMeXYAA8f40', 'HL1nDt4XgAArr6f'].includes(mediaId) ? '1D' : null};
}
function ethObservation(media) {
  const note = ethNotes.find(item => item.mediaId === media.mediaId);
  assert.ok(note, `Missing ETH visual observation: ${media.mediaId}`);
  return {mediaId: media.mediaId, kind: note.kind,
    notes: note.observed ?? note.executionCaveat,
    reported: note.reported ?? {visibleReferences: note.exactVisibleReferences ?? []},
    approximateReadings: {}, chartCreatedAtUTC: null,
    printedChartCapture: note.chartCapture ?? null,
    chartTimeframe: media.mediaId === 'Gwoj7R5XAAAG_Ad' ? '1H' : null};
}
const imageSources = [
  ...oldMedia.map(media => ({...media, photoOrdinal: media.sourcePhotoOrdinal, observation: initialObservation(media)})),
  ...ethMedia.map(media => ({...media, observation: ethObservation(media)})),
  {...recovered, photoOrdinal: recovered.sourcePhotoOrdinal, observation: recoveredNote},
  ...originMedia.map(media => {
    const observation = originNotes.find(note => note.mediaId === media.mediaId);
    assert.ok(observation, `Missing original predecessor image inspection: ${media.mediaId}`);
    return {...media, observation};
  }),
];
const seenImages = new Set();
const images = imageSources.map(media => {
  assert.ok(byId.has(media.postId));
  const key = `${media.postId}:${media.photoOrdinal}`;
  assert.ok(!seenImages.has(key), `Duplicate own-photo reference: ${key}`);
  seenImages.add(key);
  const absolute = path.resolve(media.file), archiveRoot = path.resolve(archive) + path.sep;
  assert.ok(absolute.startsWith(archiveRoot));
  const bytes = fs.readFileSync(absolute);
  assert.equal(bytes.length, media.bytes);
  assert.equal(digest(bytes), media.sha256, `Changed original image: ${media.file}`);
  assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
  assert.equal(bytes.toString('ascii', 8, 12), 'WEBP');
  const originalUrl = new URL(media.sourceUrl);
  assert.equal(originalUrl.protocol, 'https:');
  assert.equal(originalUrl.hostname, 'pbs.twimg.com');
  const createdAt = media.observation.chartCreatedAtUTC;
  if (createdAt) assert.ok(Date.parse(createdAt) <= Date.parse(byId.get(media.postId).idTimestampInferredUTC));
  return {postId: media.postId, photoOrdinal: media.photoOrdinal,
    originalUrl: media.sourceUrl,
    localUrl: path.relative(output, media.file).split(path.sep).join('/'),
    sha256: media.sha256, bytes: media.bytes, observation: media.observation};
});
for (const record of publications) {
  const photos = images.filter(image => image.postId === record.postId);
  const expected = ({'2072376414956130393': 4, '2072749403106841058': 2,
    '2073713750675218879': 2, '2072657962145906964': 4})[record.postId] ?? byId.get(record.postId).ownPhotoCount;
  assert.equal(photos.length, expected, `Incomplete own photos: ${record.postId}`);
}
const data = {schema: 'xo-published-setups-v1', assets: ['BTC', 'ETH', 'HYPE', 'SOL', 'BNB', 'XRP'],
  timeframes: ['15m', '1H', '4H', '1D', '1W'], publications, images,
  scope: 'Original publication and management review. Unchanged original images, not generated signals, backtest fills, current trading recommendations or private account records.'};
fs.mkdirSync(output, {recursive: true});
const templateFile = 'scripts/templates/global-xo-publications.html';
const template = fs.readFileSync(templateFile, 'utf8');
assert.equal(template.split('__PUBLICATIONS__').length, 2);
fs.writeFileSync(`${output}/publications.json`, JSON.stringify(data, null, 2) + '\n');
fs.writeFileSync(`${output}/index.html`, template.replace('__PUBLICATIONS__', JSON.stringify(data).replaceAll('<', '\\u003c')));
const manifest = {generatedAt: new Date().toISOString(), schema: data.schema,
  publicationVersions: publications.length,
  canonicalPosts: new Set(publications.map(item => item.canonicalPostId)).size,
  ownImageReferences: images.length,
  uniqueImageByteHashes: new Set(images.map(item => item.sha256)).size,
  inputs: Object.fromEntries(inputs),
  builderSha256: digest(fs.readFileSync(import.meta.filename)),
  templateSha256: digest(fs.readFileSync(templateFile)),
  outputSha256: digest(fs.readFileSync(`${output}/index.html`)),
  dataSha256: digest(fs.readFileSync(`${output}/publications.json`)),
  checks: 'All original record identities, source-version timestamps, own-photo counts, retained image byte hashes and known image creation times reconciled. No strategy execution or performance calculation.'};
fs.writeFileSync(`${output}/manifest.json`, JSON.stringify(manifest, null, 2) + '\n');
console.log(JSON.stringify({output, publicationVersions: manifest.publicationVersions,
  canonicalPosts: manifest.canonicalPosts, ownImageReferences: manifest.ownImageReferences,
  uniqueImageByteHashes: manifest.uniqueImageByteHashes}));

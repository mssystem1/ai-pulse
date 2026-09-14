import test from 'node:test';
import assert from 'node:assert/strict';
import { parseBackfillOptions } from './publicActivityBackfillOptions.js';

test('backfill remains read-only and in current namespace by default', () => {
  assert.deepEqual(parseBackfillOptions([], 'pulse:local'), {write:false, targetNamespace:'pulse:local', sourceNamespaces:['pulse:local']});
});
test('cross-namespace publication requires explicit target and deduplicates sources', () => {
  assert.throws(() => parseBackfillOptions(['--write','--source-namespace','pulse:production'], 'pulse:local'));
  assert.deepEqual(parseBackfillOptions(['--write','--source-namespace','pulse:local','--source-namespace','pulse:local','--source-namespace','pulse:production','--target-namespace','pulse:production'], 'pulse:local'), {write:true,targetNamespace:'pulse:production',sourceNamespaces:['pulse:local','pulse:production']});
});
test('backfill rejects missing, wildcard and unsupported arguments', () => {
  for (const args of [['--source-namespace'],['--target-namespace','--write'],['--source-namespace','pulse:*'],['--unknown']]) assert.throws(()=>parseBackfillOptions(args,'pulse:local'));
});

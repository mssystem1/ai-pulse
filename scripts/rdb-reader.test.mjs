import test from "node:test";
import assert from "node:assert/strict";
import { redisCrc64, readRdb } from "./rdb-reader.mjs";
const string = text => { const b = Buffer.from(text); assert.ok(b.length < 64); return Buffer.concat([Buffer.from([b.length]), b]); };
function file(payload) { const body = Buffer.concat([Buffer.from("REDIS0014"), payload, Buffer.from([255])]); const crc = Buffer.alloc(8); crc.writeBigUInt64LE(redisCrc64(body)); return Buffer.concat([body, crc]); }
test("CRC64 matches Redis's published reference vector", () => assert.equal(redisCrc64(Buffer.from("123456789")), 0xe9c6d914c4b8d9can));
test("decodes text, integer strings, hash fields and expiration without changing them", () => {
  const expiration = Buffer.alloc(8); expiration.writeBigUInt64LE(1800000000000n);
  const decoded = readRdb(file(Buffer.concat([Buffer.from([254, 0, 252]), expiration, Buffer.from([0]), string("key"), Buffer.from([192, 255]), Buffer.from([4]), string("hash"), Buffer.from([1]), string("field"), string("value")])));
  assert.equal(decoded.checksum, "verified"); assert.equal(decoded.records.length, 2);
  assert.equal(decoded.records[0].value.toString(), "-1"); assert.equal(decoded.records[0].expiresAt, 1800000000000);
  assert.equal(decoded.records[1].value[0][1].toString(), "value"); assert.equal(decoded.records[1].expiresAt, null);
});
test("unknown types, corruption, truncation and duplicates fail closed", () => {
  assert.throws(() => readRdb(file(Buffer.from([16]))), /Unsupported RDB type/);
  const original = file(Buffer.concat([Buffer.from([0]), string("key"), string("value")]));
  const corrupt = Buffer.from(original); corrupt[12] ^= 1;
  assert.throws(() => readRdb(corrupt), /checksum/);
  assert.throws(() => readRdb(original.subarray(0, -1)), /checksum/);
  const entry = Buffer.concat([Buffer.from([0]), string("key"), string("v")]);
  assert.throws(() => readRdb(file(Buffer.concat([entry, entry]))), /Duplicate/);
});
test("preserves list order, hash fields, set members, zset scores and Unicode", () => {
  const score = Buffer.alloc(8); score.writeDoubleLE(0.125);
  const decoded = readRdb(file(Buffer.concat([
    Buffer.from([1]), string("list"), Buffer.from([2]), string("second"), string("first"),
    Buffer.from([2]), string("set"), Buffer.from([2]), string("β"), string("a"),
    Buffer.from([5]), string("zset"), Buffer.from([1]), string("member"), score,
    Buffer.from([4]), string("hash"), Buffer.from([2]), string("b"), string("two"), string("a"), string("one"),
  ])));
  assert.deepEqual(decoded.records[0].value.map(b => b.toString()), ["second", "first"]);
  assert.deepEqual(decoded.records[1].value.map(b => b.toString()), ["β", "a"]);
  assert.equal(decoded.records[2].value[0][1], 0.125);
  assert.deepEqual(decoded.records[3].value.map(pair => pair.map(b => b.toString())), [["b", "two"], ["a", "one"]]);
});
test("decodes LZF literals and overlapping references; rejects malformed references", () => {
  const prefix = Buffer.concat([Buffer.from([0]), string("compressed")]);
  const valid = Buffer.concat([prefix, Buffer.from([195, 6, 6, 2, 97, 98, 99, 32, 2])]);
  assert.equal(readRdb(file(valid)).records[0].value.toString(), "abcabc");
  const invalid = Buffer.concat([prefix, Buffer.from([195, 2, 3, 32, 2])]);
  assert.throws(() => readRdb(file(invalid)), /Invalid LZF reference/);
});
test("exporter-disabled checksum is explicit, not reported as integrity verified", () => {
  const bytes = file(Buffer.concat([Buffer.from([0]), string("key"), string("value")]));
  bytes.fill(0, bytes.length - 8);
  assert.equal(readRdb(bytes).checksum, "disabled_by_exporter");
});

// Read-only decoder for the plain Redis data types used by PULSE's Upstash
// export. Unknown encodings fail closed; this is not a general Redis importer.
// Format reference: redis/redis src/rdb.h; CRC64-Jones uses Redis's zero seed.
const crcTable = Array.from({ length: 256 }, (_, byte) => {
  let value = BigInt(byte);
  for (let bit = 0; bit < 8; bit++) value = (value >> 1n) ^ (value & 1n ? 0x95ac9329ac4bc9b5n : 0n);
  return value;
});
export function redisCrc64(bytes) {
  let crc = 0n;
  for (const byte of bytes) crc = crcTable[Number((crc ^ BigInt(byte)) & 255n)] ^ (crc >> 8n);
  return crc;
}
function inflateLzf(input, size) {
  if (size > 128 * 1024 * 1024) throw new Error("Oversized compressed RDB string");
  const output = Buffer.alloc(size);
  let i = 0, o = 0;
  while (i < input.length) {
    const control = input[i++];
    if (control < 32) {
      const count = control + 1;
      if (i + count > input.length || o + count > size) throw new Error("Invalid LZF literal");
      input.copy(output, o, i, i + count); i += count; o += count;
    } else {
      let count = control >> 5;
      let from = o - ((control & 31) << 8) - 1;
      if (count === 7) { if (i >= input.length) throw new Error("Truncated LZF length"); count += input[i++]; }
      if (i >= input.length) throw new Error("Truncated LZF reference");
      from -= input[i++]; count += 2;
      if (from < 0 || o + count > size) throw new Error("Invalid LZF reference");
      for (let n = 0; n < count; n++) output[o++] = output[from++];
    }
  }
  if (o !== size) throw new Error("LZF size mismatch");
  return output;
}
export function readRdb(buffer) {
  if (buffer.length < 18 || !/^REDIS\d{4}$/.test(buffer.subarray(0, 9).toString())) throw new Error("Invalid RDB header");
  const version = Number(buffer.subarray(5, 9).toString());
  if (version < 5 || version > 14) throw new Error(`Unsupported RDB version ${version}`);
  const expected = buffer.readBigUInt64LE(buffer.length - 8);
  if (expected !== 0n && redisCrc64(buffer.subarray(0, -8)) !== expected) throw new Error("RDB checksum mismatch; no restore is safe");
  let offset = 9, db = 0, expiresAt = null;
  const records = [], auxiliary = {}, keys = new Set();
  function bytes(count) {
    if (!Number.isSafeInteger(count) || count < 0 || offset + count > buffer.length - 8) throw new Error(`Truncated RDB at offset ${offset}`);
    const result = buffer.subarray(offset, offset + count); offset += count; return result;
  }
  function length(allowEncoded = false) {
    const first = bytes(1)[0], mode = first >> 6;
    if (mode === 0) return { value: first, encoded: false };
    if (mode === 1) return { value: ((first & 63) << 8) + bytes(1)[0], encoded: false };
    if (mode === 3) {
      if (!allowEncoded) throw new Error(`Unexpected encoded length at ${offset - 1}`);
      return { value: first & 63, encoded: true };
    }
    const value = first === 128 ? bytes(4).readUInt32BE() : first === 129 ? Number(bytes(8).readBigUInt64BE()) : NaN;
    if (!Number.isSafeInteger(value) || value < 0) throw new Error("Invalid RDB length");
    return { value, encoded: false };
  }
  function string() {
    const n = length(true);
    if (!n.encoded) return bytes(n.value);
    if (n.value <= 2) { const raw = bytes(2 ** n.value); return Buffer.from(String(raw.readIntLE(0, raw.length))); }
    if (n.value === 3) { const compressed = length().value, expanded = length().value; return inflateLzf(bytes(compressed), expanded); }
    throw new Error(`Unsupported string encoding ${n.value}`);
  }
  function count() { const n = length().value; if (n > buffer.length) throw new Error("Invalid collection length"); return n; }
  while (offset < buffer.length - 8) {
    const start = offset, type = bytes(1)[0];
    if (type === 255) {
      if (offset !== buffer.length - 8) throw new Error("Trailing bytes after RDB end");
      return { version, checksum: expected === 0n ? "disabled_by_exporter" : "verified", auxiliary, records };
    }
    if (type === 250) { const name = string().toString(); auxiliary[name] = string().toString(); continue; }
    if (type === 254) { db = count(); continue; }
    if (type === 251) { count(); count(); continue; }
    if (type === 252) { expiresAt = Number(bytes(8).readBigUInt64LE()); if (!Number.isSafeInteger(expiresAt)) throw new Error("Invalid expiration"); continue; }
    if (type === 253) { expiresAt = bytes(4).readUInt32LE() * 1000; continue; }
    if (type === 248) { count(); continue; }
    if (type === 249) { bytes(1); continue; }
    if (![0, 1, 2, 3, 4, 5].includes(type)) throw new Error(`Unsupported RDB type ${type} at offset ${start}; decoded ${records.length} records; restore refused`);
    const key = string(), signature = `${db}:${key.toString("base64")}`;
    if (keys.has(signature)) throw new Error("Duplicate database key in export");
    keys.add(signature);
    let value;
    if (type === 0) value = string();
    else {
      value = [];
      for (let i = 0, n = count(); i < n; i++) {
        const member = string();
        if (type === 4) value.push([member, string()]);
        else if (type === 3 || type === 5) {
          let score;
          if (type === 5) score = bytes(8).readDoubleLE();
          else { const size = bytes(1)[0]; score = size === 254 ? Infinity : size === 255 ? -Infinity : size === 253 ? NaN : Number(bytes(size).toString()); }
          if (Number.isNaN(score)) throw new Error("Invalid sorted-set score");
          value.push([member, score]);
        } else value.push(member);
      }
    }
    records.push({ db, key, type: ["string", "list", "set", "zset", "hash", "zset"][type], value, expiresAt });
    expiresAt = null;
  }
  throw new Error("RDB end marker is missing");
}

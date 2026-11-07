/** Independent TAP-02 combinational host. No PULSE API, app bundle or wallet. */
export function evaluatePortableCircuit(manifest, buy, sell, previous = 0) {
  const r = manifest?.runtime;
  if (manifest?.format !== "pulse-indicator-v1" || !["executed-cvd-v1", "buy-participation-v1"].includes(manifest.kernel) || r?.format !== "tap-02-nand" || r.bitOrder !== "least-significant-first" || !/^0x(?:00[\da-f]{12}){1,40000}$/i.test(r.netlist ?? "")) throw Error("Unsupported or malformed portable circuit");
  const cvd = manifest.kernel === "executed-cvd-v1";
  if (r.inputBits !== (cvd ? 64 : 32) || r.outputBits !== (cvd ? 64 : 14)) throw Error("Circuit numeric ports do not match the selected formula");
  if (![buy, sell].every(n => Number.isInteger(n) && n >= 0 && n <= 65535) || !Number.isInteger(previous) || previous < -2147483648 || previous > 2147483647 || cvd && (previous + buy - sell < -2147483648 || previous + buy - sell > 2147483647)) throw Error("Use uint16 buy/sell amounts and a non-overflowing signed int32 prior delta");
  if (!cvd && buy + sell === 0) throw Error("Buyer share requires executed volume");
  const bytes = r.netlist.slice(2), gates = bytes.length / 14, signals = new Uint8Array(2 + r.inputBits + gates); signals[1] = 1;
  for (let bit = 0; bit < 16; bit++) { signals[2 + bit] = buy >>> bit & 1; signals[18 + bit] = sell >>> bit & 1; }
  if (cvd) for (let bit = 0; bit < 32; bit++) signals[34 + bit] = previous >>> bit & 1;
  for (let i = 0; i < gates; i++) {
    const at = i * 14, a = parseInt(bytes.slice(at + 2, at + 8), 16), b = parseInt(bytes.slice(at + 8, at + 14), 16), id = 2 + r.inputBits + i;
    if (a >= id || b >= id) throw Error("Circuit contains a forward or out-of-range reference");
    signals[id] = 1 - (signals[a] & signals[b]);
  }
  const offset = signals.length - r.outputBits;
  const word = (start, width, signed = false) => { let n = 0; for (let bit = 0; bit < width; bit++) n += signals[offset + start + bit] * 2 ** bit; return signed && n >= 2 ** (width - 1) ? n - 2 ** width : n; };
  return cvd ? { delta: word(0, 32, true), cvd: word(32, 32, true) } : { buyerSharePercent: word(0, 14) / 100 };
}

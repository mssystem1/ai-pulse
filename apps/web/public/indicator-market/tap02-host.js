/** Independent TAP-02 combinational host. No PULSE API, app bundle or wallet. */
export function evaluatePortableCircuit(manifest, buy, sell, previous = 0) {
  const r = manifest?.runtime;
  const custom=manifest?.format === "pulse-indicator-v2" && manifest.kernel === "formula-v1";
  if (!(custom || manifest?.format === "pulse-indicator-v1" && ["executed-cvd-v1", "buy-participation-v1"].includes(manifest.kernel)) || r?.format !== "tap-02-nand" || r.bitOrder !== "least-significant-first" || !/^0x(?:00[\da-f]{12}){1,40000}$/i.test(r.netlist ?? "")) throw Error("Unsupported or malformed portable circuit");
  const cvd = manifest.kernel === "executed-cvd-v1";
  if (r.inputBits !== (cvd || custom ? 64 : 32) || r.outputBits !== (cvd ? 64 : custom ? 32 : 14)) throw Error("Circuit numeric ports do not match the selected formula");
  if (![buy, sell].every(n => Number.isInteger(n) && n >= 0 && n <= 65535) || !Number.isInteger(previous) || previous < -2147483648 || previous > 2147483647 || cvd && (previous + buy - sell < -2147483648 || previous + buy - sell > 2147483647)) throw Error("Use uint16 buy/sell amounts and a non-overflowing signed int32 prior delta");
  if (!cvd && !custom && buy + sell === 0) throw Error("Buyer share requires executed volume");
  const expected=custom?formulaValue(manifest.formula,buy,sell)+(manifest.formula.output.accumulation==="cumulative"?previous:0):undefined;
  if(expected!==undefined&&(!Number.isSafeInteger(expected)||expected < -2147483648||expected>2147483647))throw Error("Custom formula accumulation overflows int32");
  const bytes = r.netlist.slice(2), gates = bytes.length / 14, signals = new Uint8Array(2 + r.inputBits + gates); signals[1] = 1;
  for (let bit = 0; bit < 16; bit++) { signals[2 + bit] = buy >>> bit & 1; signals[18 + bit] = sell >>> bit & 1; }
  if (cvd || custom) for (let bit = 0; bit < 32; bit++) signals[34 + bit] = previous >>> bit & 1;
  for (let i = 0; i < gates; i++) {
    const at = i * 14, a = parseInt(bytes.slice(at + 2, at + 8), 16), b = parseInt(bytes.slice(at + 8, at + 14), 16), id = 2 + r.inputBits + i;
    if (a >= id || b >= id) throw Error("Circuit contains a forward or out-of-range reference");
    signals[id] = 1 - (signals[a] & signals[b]);
  }
  const offset = signals.length - r.outputBits;
  if(offset<2+r.inputBits)throw Error("Circuit has insufficient output signals");
  const word = (start, width, signed = false) => { let n = 0; for (let bit = 0; bit < width; bit++) n += signals[offset + start + bit] * 2 ** bit; return signed && n >= 2 ** (width - 1) ? n - 2 ** width : n; };
  if(custom){const value=word(0,32,true);if(value!==expected)throw Error("Imported circuit disagrees with its formula");return {value,label:String(manifest.formula.output.label).slice(0,80),unit:manifest.formula.output.unit};}
  return cvd ? { delta: word(0, 32, true), cvd: word(32, 32, true) } : { buyerSharePercent: word(0, 14) / 100 };
}

/** Independent bounded arithmetic reference; never eval/Function or imports. */
function formulaValue(formula,buy,sell){
  const expression=formula?.expression;
  if(formula?.language!=="pulse-flow-expr-v1"||typeof expression!=="string"||expression.length>512||/[^a-z0-9_+*/(),\s-]/.test(expression)||!["bar","cumulative"].includes(formula?.output?.accumulation))throw Error("Unsupported custom expression");
  const tokens=expression.match(/[a-z_]+|[0-9]+|[+*/(),-]/g)??[];if(tokens.length>128)throw Error("Expression limit exceeded");let at=0,nodes=0;
  const bound=v=>{if(!Number.isSafeInteger(v)||v < -2147483648||v>2147483647)throw Error("Custom formula intermediate overflows int32");return v;};
  const need=t=>{if(tokens[at++]!==t)throw Error("Malformed custom formula");};
  function primary(depth){if(depth>16||++nodes>64)throw Error("Expression complexity limit exceeded");const t=tokens[at++];if(t==="+")return primary(depth+1);if(t==="-")return bound(-primary(depth+1));if(t==="("){const v=sum(depth+1);need(")");return v;}if(t==="buy")return buy;if(t==="sell")return sell;if(/^\d+$/.test(t??""))return bound(Number(t));if(["abs","min","max","clamp"].includes(t)){need("(");const a=sum(depth+1);if(t==="abs"){need(")");return bound(Math.abs(a));}need(",");const b=sum(depth+1);if(t==="clamp"){need(",");const c=sum(depth+1);need(")");return bound(Math.min(Math.max(a,b),c));}need(")");return bound(t==="min"?Math.min(a,b):Math.max(a,b));}throw Error("Unsupported expression token");}
  function product(depth){let a=primary(depth);while(tokens[at]==="*"||tokens[at]==="/"){const op=tokens[at++],b=primary(depth+1);if(op==="/"&&b===0)throw Error("Division by zero is unknown");a=bound(op==="*"?a*b:Math.trunc(a/b));}return a;}
  function sum(depth){let a=product(depth);while(tokens[at]==="+"||tokens[at]==="-"){const op=tokens[at++],b=product(depth+1);a=bound(op==="+"?a+b:a-b);}return a;}
  const result=sum(0);if(at!==tokens.length)throw Error("Unexpected expression token");return result;
}

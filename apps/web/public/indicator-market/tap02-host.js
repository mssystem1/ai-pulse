/** Independent TAP-02 combinational host. No PULSE API, app bundle or wallet. */
export function evaluatePortableCircuit(manifest, buy, sell, previous = 0) {
  const r = manifest?.runtime;
  const custom=["pulse-indicator-v2","pulse-indicator-v3"].includes(manifest?.format) && manifest.kernel === "formula-v1";
  if (!(custom || manifest?.format === "pulse-indicator-v1" && ["executed-cvd-v1", "buy-participation-v1"].includes(manifest.kernel)) || r?.format !== "tap-02-nand" || r.bitOrder !== "least-significant-first" || !/^0x(?:00[\da-f]{12}){1,40000}$/i.test(r.netlist ?? "")) throw Error("Unsupported or malformed portable circuit");
  if(manifest?.format==="pulse-indicator-v3"){studyDefinition(manifest.study);if(manifest.formula?.output?.accumulation!=="bar")throw Error("Study kernels must use per-bar accumulation; declare cumulative state as a series transform");}
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
  if(formula?.language!=="pulse-flow-expr-v1"||typeof expression!=="string"||expression.length>512||/[^a-z0-9_+*/(),\s-]/.test(expression)||!["bar","cumulative"].includes(formula?.output?.accumulation)||!["volume","ratio","bps","scalar"].includes(formula?.output?.unit)||typeof formula?.output?.label!=="string"||formula.output.label.length<2||formula.output.label.length>80)throw Error("Unsupported custom expression");
  const tokens=expression.match(/[a-z_]+|[0-9]+|[+*/(),-]/g)??[];if(tokens.length>128)throw Error("Expression limit exceeded");let at=0,nodes=0;
  const bound=v=>{if(!Number.isSafeInteger(v)||v < -2147483648||v>2147483647)throw Error("Custom formula intermediate overflows int32");return v;};
  const need=t=>{if(tokens[at++]!==t)throw Error("Malformed custom formula");};
  function primary(depth){if(depth>16||++nodes>64)throw Error("Expression complexity limit exceeded");const t=tokens[at++];if(t==="+")return primary(depth+1);if(t==="-")return bound(-primary(depth+1));if(t==="("){const v=sum(depth+1);need(")");return v;}if(t==="buy")return buy;if(t==="sell")return sell;if(/^\d+$/.test(t??""))return bound(Number(t));if(["abs","min","max","clamp"].includes(t)){need("(");const a=sum(depth+1);if(t==="abs"){need(")");return bound(Math.abs(a));}need(",");const b=sum(depth+1);if(t==="clamp"){need(",");const c=sum(depth+1);need(")");return bound(Math.min(Math.max(a,b),c));}need(")");return bound(t==="min"?Math.min(a,b):Math.max(a,b));}throw Error("Unsupported expression token");}
  function product(depth){let a=primary(depth);while(tokens[at]==="*"||tokens[at]==="/"){const op=tokens[at++],b=primary(depth+1);if(op==="/"&&b===0)throw Error("Division by zero is unknown");a=bound(op==="*"?a*b:Math.trunc(a/b));}return a;}
  function sum(depth){let a=product(depth);while(tokens[at]==="+"||tokens[at]==="-"){const op=tokens[at++],b=product(depth+1);a=bound(op==="+"?a+b:a-b);}return a;}
  const result=sum(0);if(at!==tokens.length)throw Error("Unexpected expression token");return result;
}

function object(value){if(!value||typeof value!=="object"||Array.isArray(value))throw Error("Study object required");return value;}
function exact(value,required,optional=[]){if(required.some(key=>!(key in value))||Object.keys(value).some(key=>![...required,...optional].includes(key)))throw Error("Unknown or missing study fields");}
/** Independent admission of the public pipeline, without a PULSE import. */
function studyDefinition(input){
  const value=object(input);exact(value,["transforms","plot","gapPolicy","warmup"],["signal"]);
  if(!["line","histogram"].includes(value.plot)||value.gapPolicy!=="reset"||value.warmup!=="full-window")throw Error("Unsupported study plot, gap or warm-up policy");
  if(!Array.isArray(value.transforms)||value.transforms.length>4)throw Error("Use at most four study transforms");
  const transforms=value.transforms.map(raw=>{const step=object(raw);if(step.kind==="cumulative"){exact(step,["kind"]);return{kind:step.kind};}exact(step,["kind","period"]);if(!["ema","sma","sum"].includes(step.kind)||!Number.isInteger(step.period)||step.period<2||step.period>200)throw Error("Study periods must be integers from 2 to 200 source bars");return{kind:step.kind,period:step.period};});
  let signal;
  if(value.signal!==undefined){const condition=object(value.signal);exact(condition,["kind","threshold","label"]);if(!["above","below","cross-above","cross-below"].includes(condition.kind)||typeof condition.threshold!=="number"||!Number.isFinite(condition.threshold)||Math.abs(condition.threshold)>1e12||typeof condition.label!=="string"||condition.label.length<2||condition.label.length>80||/[\x00-\x1f\x7f]/.test(condition.label))throw Error("Invalid study threshold condition");signal={...condition};}
  return{transforms,plot:value.plot,...(signal?{signal}:{}),gapPolicy:"reset",warmup:"full-window"};
}

/** Run a v3 study over raw executed-volume source bars. The imported NAND
 * kernel runs once per bar using that bar's shared uint16 quantity scale.
 * Declared rolling state is causal host logic, not an on-chain history claim.
 * Callers are responsible for authenticated timestamps and market provenance. */
export function evaluatePortableStudySeries(manifest,samples,options={}){
  if(manifest?.format!=="pulse-indicator-v3"||manifest.kernel!=="formula-v1"||manifest.formula?.output?.accumulation!=="bar")throw Error("A v3 portable study with a per-bar kernel is required");
  const runtime=manifest.runtime;
  if(runtime?.format!=="tap-02-nand"||runtime.bitOrder!=="least-significant-first"||runtime.inputBits!==64||runtime.outputBits!==32||!/^0x(?:00[\da-f]{12}){32,40000}$/i.test(runtime.netlist??""))throw Error("Unsupported or malformed portable circuit");
  const study=studyDefinition(manifest.study),interval=options.intervalMs,gaps=options.missingIntervals??[];
  if(interval!==undefined&&(!Number.isSafeInteger(interval)||interval<1||interval>31*86400000))throw Error("Invalid source-bar interval");
  if(!Array.isArray(gaps)||gaps.length>1024||gaps.some(gap=>!Number.isSafeInteger(gap.start)||!Number.isSafeInteger(gap.end)||gap.start<0||gap.end<=gap.start))throw Error("Invalid missing source intervals");
  if(!Array.isArray(samples)||samples.length>1024||samples.some((point,index)=>!point||!Number.isSafeInteger(point.ts)||point.ts<0||index>0&&point.ts<=samples[index-1].ts||![point.buy,point.sell].every(n=>typeof n==="number"&&Number.isFinite(n)&&n>=0&&n<=1e100)||point.end!==undefined&&(!Number.isSafeInteger(point.end)||point.end<=point.ts)))throw Error("Use at most 1024 ordered, finite executed-volume source bars");
  const states=study.transforms.map(()=>({values:[],ema:undefined,total:0}));let prior,previousEnd;
  const reset=()=>{for(const state of states){state.values=[];state.ema=undefined;state.total=0;}prior=undefined;};
  return samples.map(point=>{
    const knownEnd=point.end??(interval?point.ts+interval:undefined),pointEnd=knownEnd??point.ts+1;
    const startsSegment=previousEnd!==undefined&&point.ts>previousEnd;previousEnd=knownEnd;
    const partial=Boolean(interval&&knownEnd!==undefined&&knownEnd-point.ts<interval);
    const missing=gaps.some(gap=>gap.start<pointEnd&&gap.end>point.ts);
    if(startsSegment||missing)reset();
    if(missing)return{ts:point.ts,reset:true,...(partial?{partial:true}:{})};
    if(partial&&study.transforms.length>0){reset();return{ts:point.ts,reset:true,partial:true};}
    const max=Math.max(point.buy,point.sell),quantum=max>0?max/65535:1;
    const buy=Math.min(65535,Math.round(point.buy/quantum)),sell=Math.min(65535,Math.round(point.sell/quantum));
    let decoded;
    try{decoded=evaluatePortableCircuit(manifest,buy,sell,0).value*(manifest.formula.output.unit==="volume"?quantum:1);}catch(error){if(error.message!=="Division by zero is unknown")throw error;reset();return{ts:point.ts,...(startsSegment?{reset:true}:{}),...(partial?{partial:true}:{})};}
    const rawValue=decoded;let current=decoded;
    for(let i=0;i<study.transforms.length;i++){
      const step=study.transforms[i],state=states[i];if(current===undefined)break;
      if(step.kind==="cumulative"){state.total+=current;current=state.total;}else{
        state.values.push(current);if(state.values.length>step.period)state.values.shift();
        if(state.values.length<step.period){current=undefined;continue;}
        if(step.kind==="ema"){state.ema=state.ema===undefined?state.values.reduce((sum,value)=>sum+value,0)/step.period:current*(2/(step.period+1))+state.ema*(1-2/(step.period+1));current=state.ema;}else{current=state.values.reduce((sum,value)=>sum+value,0);if(step.kind==="sma")current/=step.period;}
      }
      if(!Number.isFinite(current))throw Error("Study series output exceeds finite numeric range");
    }
    if(current===undefined)return{ts:point.ts,rawValue,...(startsSegment?{reset:true}:{}),...(partial?{partial:true}:{})};
    const condition=study.signal;
    const signal=!condition?undefined:condition.kind==="above"?current>condition.threshold:condition.kind==="below"?current<condition.threshold:partial||prior===undefined?undefined:condition.kind==="cross-above"?prior<=condition.threshold&&current>condition.threshold:prior>=condition.threshold&&current<condition.threshold;
    prior=partial?undefined:current;
    return{ts:point.ts,rawValue,value:current,...(signal===undefined?{}:{signal}),...(startsSegment?{reset:true}:{}),...(partial?{partial:true}:{})};
  });
}

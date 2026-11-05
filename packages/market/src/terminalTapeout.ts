import {createHash} from "node:crypto";

export const TERMINAL_TAPEOUT_XLAYER={chainId:196 as const,factory:"0x1f09daefa827f02cbb40967cc91b259763760761",processor:"0x839bdd6fa7a66416a609a735e11de5411b98574e",circuitId:"2" as const};
export type TerminalTapeoutRead={version:"tapeout-xlayer-nand-v1";chainId:196;processor:string;circuitId:"2";factory:string;blockNumber:string;blockHash:string;observedAt:number;netlist:string;codeHash:string;truthTable:readonly number[];verified:true;endpoints:string[]};
const ENDPOINTS=["https://rpc.xlayer.tech","https://tapeout.net/rpc-xlayer"];
const expectedNetlist="0x000000020000030000000400000400000005000005";
const word=(n:number)=>n.toString(16).padStart(64,"0");
class TapeoutTransientReadError extends Error {}
function transientRead(error:unknown){
  if(error instanceof TapeoutTransientReadError)return true;
  if(!(error instanceof Error))return false;
  const code=(error as Error&{code?:string;cause?:{code?:string}}).code??(error as Error&{cause?:{code?:string}}).cause?.code;
  return ["TypeError","AbortError","TimeoutError"].includes(error.name)||["ECONNRESET","ETIMEDOUT","EAI_AGAIN","ENETUNREACH","UND_ERR_CONNECT_TIMEOUT","UND_ERR_SOCKET"].includes(code??"");
}
function bytes(result:unknown){if(typeof result!=="string"||!/^0x(?:[0-9a-fA-F]{2})*$/.test(result)||result.length<130)throw Error("Invalid Tapeout byte result");const offset=Number(BigInt(`0x${result.slice(2,66)}`))*2+2;if(offset+64>result.length)throw Error("Invalid Tapeout ABI offset");const count=Number(BigInt(`0x${result.slice(offset,offset+64)}`));if(count>4096||offset+64+count*2>result.length)throw Error("Invalid Tapeout ABI size");return `0x${result.slice(offset+64,offset+64+count*2)}`.toLowerCase();}

/** TAP-02 NAND records: opcode 0 followed by two uint24 signal references.
 * Inputs are signals 2 and 3, output is final signal. Imported shape is bounded. */
export function evaluateTerminalTapeoutNand(component:Pick<TerminalTapeoutRead,"netlist"|"verified">,a:boolean,b:boolean):boolean{
  if(component.verified!==true||component.netlist.toLowerCase()!==expectedNetlist)throw Error("Unverified Tapeout component");
  const raw=Buffer.from(component.netlist.slice(2),"hex"),signals=[false,true,a,b];
  for(let at=0;at<raw.length;at+=7){if(raw[at]!==0)throw Error("Unsupported Tapeout opcode");const left=raw.readUIntBE(at+1,3),right=raw.readUIntBE(at+4,3);if(left>=signals.length||right>=signals.length)throw Error("Noncausal Tapeout reference");signals.push(!(signals[left]&&signals[right]));}
  return signals.at(-1)!;
}

/** Actual registered circuit import. Only fixed unsigned public calls are sent;
 * market observations, wallet addresses and private rule parameters stay local. */
export async function fetchTerminalTapeoutComponent(input:{fetchImpl?:typeof fetch;now?:number;timeoutMs?:number}={}):Promise<TerminalTapeoutRead>{
  const fetchImpl=input.fetchImpl??fetch,deadline=Date.now()+Math.min(20000,Math.max(1000,input.timeoutMs??16000));let id=0;
  async function rpc(endpoint:string,method:string,params:unknown[]){
    for(let attempt=0;attempt<2;attempt++){
      const remaining=deadline-Date.now();if(remaining<=0||id>=64)throw Error("Tapeout read bound exceeded");
      try{
        const response=await fetchImpl(endpoint,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",id:++id,method,params}),signal:AbortSignal.timeout(Math.min(remaining,6000))});
        if(!response.ok){if([408,425,429,500,502,503,504].includes(response.status))throw new TapeoutTransientReadError(`Tapeout source HTTP ${response.status}`);throw Error(`Tapeout source HTTP ${response.status}`);}
        const text=await response.text();if(text.length>131072)throw Error("Tapeout response bound exceeded");const body=JSON.parse(text);if(body.error||body.result===undefined)throw Error("Tapeout public view failed");return body.result;
      }catch(error){
        // Retry the exact pinned unsigned read once only for transport failures.
        // A changed component, malformed ABI/JSON or a failed truth check is
        // semantic rejection and is never retried into an accepted result.
        if(attempt!==0||!transientRead(error)||Date.now()>=deadline)throw error;
      }
    }
    throw Error("Tapeout read failed");
  }
  const chains=await Promise.all(ENDPOINTS.map(e=>rpc(e,"eth_chainId",[])));if(chains.some(c=>c!=="0xc4"))throw Error("Tapeout chain mismatch");
  const heads=await Promise.all(ENDPOINTS.map(e=>rpc(e,"eth_blockNumber",[])));if(heads.some(h=>typeof h!=="string"||!/^0x[0-9a-f]+$/i.test(h)))throw Error("Invalid Tapeout chain head");const height=heads.map(h=>BigInt(h)).reduce((a,b)=>a<b?a:b)-2n;if(height<=0n)throw Error("Invalid Tapeout pin");const pin=`0x${height.toString(16)}`;
  const {factory,processor}=TERMINAL_TAPEOUT_XLAYER;
  const reads=await Promise.all(ENDPOINTS.map(async endpoint=>{
    const call=(to:string,data:string)=>rpc(endpoint,"eth_call",[{to,data},pin]);
    const [block,registered,code,shape,netlist,...evaluations]=await Promise.all([
      rpc(endpoint,"eth_getBlockByNumber",[pin,false]),call(factory,`0x4bc7cbbd${word(0)}`),rpc(endpoint,"eth_getCode",[processor,pin]),call(processor,`0x084d60f1${word(2)}`),call(processor,`0x3fc4be56${word(2)}`),
      ...[0,1,2,3].map(n=>call(processor,`0x934d06ea${word(2)}${word(64)}${word(1)}${n.toString(16).padStart(2,"0")}${"0".repeat(62)}`)),
    ]);
    if(!block?.hash||block.number!==pin||typeof registered!=="string"||`0x${registered.slice(-40)}`.toLowerCase()!==processor||typeof code!=="string"||code.length<10)throw Error("Tapeout registration/code mismatch");
    if(shape!==`0x${word(2)}${word(1)}${word(0)}${word(3)}`||bytes(netlist)!==expectedNetlist)throw Error("Tapeout imported circuit shape changed");
    const truthTable=evaluations.map(result=>{const v=bytes(result);if(v!=="0x00"&&v!=="0x01")throw Error("Tapeout invalid truth output");return v==="0x01"?1:0;});
    if(truthTable.join()!=="1,1,1,0")throw Error("Tapeout NAND truth mismatch");
    return {hash:String(block.hash).toLowerCase(),code:String(code).toLowerCase(),truthTable};
  }));
  if(reads[0].hash!==reads[1].hash||reads[0].code!==reads[1].code)throw Error("Tapeout endpoints disagree at pinned block");
  const check=await Promise.all(ENDPOINTS.map(e=>rpc(e,"eth_getBlockByNumber",[pin,false])));if(check.some(b=>b?.hash?.toLowerCase()!==reads[0].hash))throw Error("Tapeout pin changed during read");
  return {version:"tapeout-xlayer-nand-v1",...TERMINAL_TAPEOUT_XLAYER,blockNumber:height.toString(),blockHash:reads[0].hash,observedAt:input.now??Date.now(),netlist:expectedNetlist,codeHash:`sha256:${createHash("sha256").update(Buffer.from(reads[0].code.slice(2),"hex")).digest("hex")}`,truthTable:reads[0].truthTable,verified:true,endpoints:[...ENDPOINTS]};
}

import {config} from "dotenv";
import assert from "node:assert/strict";
import {mkdir,readFile,writeFile} from "node:fs/promises";
import {createPublicClient,createWalletClient,http,parseAbi,parseEther,formatEther,encodeFunctionData,decodeEventLog,keccak256,type Hex} from "viem";
import {privateKeyToAccount} from "viem/accounts";
import {indicatorMarketCatalog,exportIndicatorPackage} from "../packages/domain/src/indicatorMarket.js";
import {INDICATOR_TAPEOUT_XLAYER,indicatorTapeoutCalldata,verifyIndicatorDeployment} from "../packages/market/src/indicatorTapeout.js";
config({quiet:true});
const execute=process.argv.includes("--execute"),capArgument=process.argv.find(a=>a.startsWith("--max-okb="))?.slice(10);
if(execute)assert(capArgument,"Execution needs an explicitly authorized --max-okb cap");
const cap=parseEther(capArgument??"0.020"),account=privateKeyToAccount(process.env.TEST_WALLET_PRIVATE_KEY as Hex);
assert.equal(account.address.toLowerCase(),process.env.TEST_WALLET_ADDRESS?.toLowerCase());
const chain={id:196,name:"X Layer",nativeCurrency:{name:"OKB",symbol:"OKB",decimals:18},rpcUrls:{default:{http:[...INDICATOR_TAPEOUT_XLAYER.rpcUrls]}}};
const client=createPublicClient({chain,transport:http(INDICATOR_TAPEOUT_XLAYER.rpcUrls[0],{timeout:20000,retryCount:1})}),wallet=createWalletClient({account,chain,transport:http(INDICATOR_TAPEOUT_XLAYER.rpcUrls[0])});
assert.equal(await client.getChainId(),196);
const folder=".tmp/indicator-market-v2";await mkdir(folder,{recursive:true});
const markerPath=folder+"/registration-progress.json";
type Intent={name:string;hash:Hex;nonce:number;to:Hex;value:string;gas:string;gasPrice:string;state:"prepared"|"confirmed";actualCost?:string};
let progress:{owner:string;factory:string;processor?:Hex;transistors?:Hex;intents:Intent[];registrations:any[]};
try{progress=JSON.parse(await readFile(markerPath,"utf8"));assert.equal(progress.owner,account.address);assert.equal(progress.factory,INDICATOR_TAPEOUT_XLAYER.factory);}catch(error:any){if(error.code!=="ENOENT")throw error;progress={owner:account.address,factory:INDICATOR_TAPEOUT_XLAYER.factory,intents:[],registrations:[]};}
const persist=()=>writeFile(markerPath,JSON.stringify(progress,null,2));
const manifests=indicatorMarketCatalog();
for(const manifest of manifests)await writeFile(`${folder}/${manifest.id}.pulse-indicator.json`,exportIndicatorPackage(manifest));
const factory=INDICATOR_TAPEOUT_XLAYER.factory as Hex,fa=parseAbi(["function deployFee() view returns(uint256)","function createCPU(string,string,string,uint256,uint256) payable returns(address transistors,address circuits)","event CPUCreated(address indexed circuits,address indexed transistors,address indexed creator,string name,uint256 supply,uint256 mintPrice)"]);
const deployFee=await client.readContract({address:factory,abi:fa,functionName:"deployFee"});
const creationData=encodeFunctionData({abi:fa,functionName:"createCPU",args:["PULSE Financial Indicators","PULSE","Portable financial computations for Trading Terminal and compatible Tapeout applications",1000000n,0n]});
const [creationGas,gasPrice,balance]=await Promise.all([client.estimateGas({account:account.address,to:factory,data:creationData,value:deployFee}),client.getGasPrice(),client.getBalance({address:account.address})]);
console.log(JSON.stringify({execute,chainId:196,owner:account.address,capOKB:formatEther(cap),balanceOKB:formatEther(balance),deployFeeOKB:formatEther(deployFee),creationEstimatedGas:String(creationGas),creationEstimatedGasOKB:formatEther(creationGas*gasPrice),circuits:manifests.map(m=>({id:m.id,gates:(m.runtime.netlist.length-2)/14}))}));
if(!execute)process.exit(0);
async function transact(name:string,to:Hex,data:Hex,value:bigint){
  let intent=progress.intents.find(i=>i.name===name);
  if(!intent){
    const [estimate,price,nonce]=await Promise.all([client.estimateGas({account:account.address,to,data,value}),client.getGasPrice(),client.getTransactionCount({address:account.address,blockTag:"pending"})]);
    const gas=estimate*12n/10n+20000n,gasPrice=price*12n/10n;
    const used=progress.intents.reduce((n,i)=>n+BigInt(i.actualCost??(BigInt(i.value)+BigInt(i.gas)*BigInt(i.gasPrice)).toString()),0n);
    assert(used+value+gas*gasPrice<=cap,"Authorized cumulative OKB cap would be exceeded; no transaction sent");
    assert(await client.getBalance({address:account.address})>=value+gas*gasPrice,"Insufficient OKB; no transaction sent");
    const raw=await wallet.signTransaction({account,chain,to,data,value,gas,gasPrice,nonce,type:"legacy"});
    intent={name,hash:keccak256(raw),nonce,to,value:String(value),gas:String(gas),gasPrice:String(gasPrice),state:"prepared"};progress.intents.push(intent);await persist();
    await client.sendRawTransaction({serializedTransaction:raw});
  }
  // An uncertain original operation is reconciled by its saved hash, never repaid.
  const receipt=await client.waitForTransactionReceipt({hash:intent.hash,timeout:180000,confirmations:2});
  assert.equal(receipt.status,"success",`${name} reverted; inspect the original receipt before retrying`);
  intent.state="confirmed";intent.actualCost=(BigInt(intent.value)+receipt.gasUsed*receipt.effectiveGasPrice).toString();await persist();console.log(JSON.stringify({operation:name,transaction:intent.hash,block:String(receipt.blockNumber),costOKB:formatEther(BigInt(intent.actualCost))}));return receipt;
}
if(!progress.processor){
  const receipt=await transact("create-pulse-processor",factory,creationData,deployFee);
  for(const log of receipt.logs)try{const e=decodeEventLog({abi:fa,data:log.data,topics:log.topics});if(e.eventName==="CPUCreated"&&log.address.toLowerCase()===factory&&e.args.creator.toLowerCase()===account.address.toLowerCase()){progress.processor=e.args.circuits;progress.transistors=e.args.transistors;}}catch{}
  assert(progress.processor&&progress.transistors,"Creation receipt did not prove the expected PULSE processor");await persist();
}
const processor=progress.processor,transistors=progress.transistors!;
const pa=parseAbi(["function factory() view returns(address)","function transistors() view returns(address)","function TAPEOUT_FEE() view returns(uint256)","event TapedOut(uint256 indexed circuitId,address indexed author,uint32 gateCount,uint32 nState)"]);
const ta=parseAbi(["function circuits() view returns(address)","function balanceOf(address,uint256) view returns(uint256)","function mintPrice() view returns(uint256)","function protocolFee() view returns(uint256)","function mint(uint256,uint256) payable"]);
assert.equal((await client.readContract({address:processor,abi:pa,functionName:"factory"})).toLowerCase(),factory);
assert.equal((await client.readContract({address:processor,abi:pa,functionName:"transistors"})).toLowerCase(),transistors.toLowerCase());
assert.equal((await client.readContract({address:transistors,abi:ta,functionName:"circuits"})).toLowerCase(),processor.toLowerCase());
const [mintPrice,protocolFee,tapeoutFee]=await Promise.all([client.readContract({address:transistors,abi:ta,functionName:"mintPrice"}),client.readContract({address:transistors,abi:ta,functionName:"protocolFee"}),client.readContract({address:processor,abi:pa,functionName:"TAPEOUT_FEE"})]);
assert.equal(mintPrice,0n,"Unexpected mint unit price; no further transactions sent");
const needed=manifests.filter(m=>!progress.registrations.some(r=>r.id===m.id)).reduce((n,m)=>n+BigInt((m.runtime.netlist.length-2)/14),0n),held=await client.readContract({address:transistors,abi:ta,functionName:"balanceOf",args:[account.address,0n]});
if(needed>held)await transact("mint-numerical-nand-parts",transistors,encodeFunctionData({abi:ta,functionName:"mint",args:[0n,needed-held]}),protocolFee);
for(const manifest of manifests){
  const existing=progress.registrations.find(r=>r.id===manifest.id);
  let reference=existing?.reference;
  if(!reference){const receipt=await transact(`register-${manifest.id}`,processor,indicatorTapeoutCalldata(manifest) as Hex,tapeoutFee);let circuitId:string|undefined;
    for(const log of receipt.logs)try{const e=decodeEventLog({abi:pa,data:log.data,topics:log.topics});if(e.eventName==="TapedOut"&&log.address.toLowerCase()===processor.toLowerCase()&&e.args.author.toLowerCase()===account.address.toLowerCase())circuitId=e.args.circuitId.toString();}catch{}
    assert(circuitId,"Registration receipt does not identify the expected numerical circuit");reference={processor,circuitId,transactionHash:receipt.transactionHash};progress.registrations.push({id:manifest.id,reference});await persist();}
  const verification=await verifyIndicatorDeployment(manifest,reference,{timeoutMs:60000});
  const record=progress.registrations.find(r=>r.id===manifest.id);record.verification=verification;await persist();await writeFile(`${folder}/${manifest.id}.registration.json`,JSON.stringify(verification,null,2));console.log(JSON.stringify({id:manifest.id,processor,circuitId:reference.circuitId,verified:true,vectors:verification.vectorCount}));
}

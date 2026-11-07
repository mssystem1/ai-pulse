import { config } from "dotenv";
import { createPublicClient, http, parseAbi, formatEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { mkdir, writeFile } from "node:fs/promises";
import { indicatorMarketCatalog } from "../packages/domain/src/indicatorMarket.js";
import { INDICATOR_TAPEOUT_XLAYER, indicatorTapeoutCalldata } from "../packages/market/src/indicatorTapeout.js";
config({ quiet: true });
const account = privateKeyToAccount(process.env.TEST_WALLET_PRIVATE_KEY as `0x${string}`);
if(account.address.toLowerCase() !== process.env.TEST_WALLET_ADDRESS?.toLowerCase())throw Error("Configured test signer mismatch");
const client = createPublicClient({ transport: http(INDICATOR_TAPEOUT_XLAYER.rpcUrls[0], {timeout:20000,retryCount:1}) });
const processor = INDICATOR_TAPEOUT_XLAYER.defaultProcessor as `0x${string}`;
const processorAbi = parseAbi(["function transistors() view returns (address)","function TAPEOUT_FEE() view returns (uint256)","function factory() view returns (address)"]);
const [chainId,transistors,tapeoutFee,factory,nativeBalance,gasPrice] = await Promise.all([client.getChainId(),client.readContract({address:processor,abi:processorAbi,functionName:"transistors"}),client.readContract({address:processor,abi:processorAbi,functionName:"TAPEOUT_FEE"}),client.readContract({address:processor,abi:processorAbi,functionName:"factory"}),client.getBalance({address:account.address}),client.getGasPrice()]);
if(chainId!==196||factory.toLowerCase()!==INDICATOR_TAPEOUT_XLAYER.factory)throw Error("Unexpected deployed factory/chain");
const abi = parseAbi(["function mintPrice() view returns (uint256)","function protocolFee() view returns (uint256)","function supplyCap() view returns (uint256)","function minted() view returns (uint256)","function balanceOf(address,uint256) view returns (uint256)","function circuits() view returns (address)","function mint(uint256,uint256) payable"]);
const [mintPrice,protocolFee,supplyCap,minted,nandBalance,tokenProcessor] = await Promise.all(["mintPrice","protocolFee","supplyCap","minted"].map(functionName=>client.readContract({address:transistors,abi,functionName:functionName as "mintPrice"})).concat([client.readContract({address:transistors,abi,functionName:"balanceOf",args:[account.address,0n]})]) as any).then(async(values:any[])=>[...values,await client.readContract({address:transistors,abi,functionName:"circuits"})]);
if(String(tokenProcessor).toLowerCase()!==processor.toLowerCase())throw Error("Transistor/processor mismatch");
const manifests=indicatorMarketCatalog();
const items=[];
for(const manifest of manifests){
  const gates=BigInt((manifest.runtime.netlist.length-2)/14),missing=gates>BigInt(nandBalance)?gates-BigInt(nandBalance):0n,mintValue=missing?missing*BigInt(mintPrice)+BigInt(protocolFee):0n;
  let mintGas:string|undefined,simulateError:string|undefined;
  if(missing&&BigInt(minted)+missing<=BigInt(supplyCap))try{mintGas=(await client.estimateContractGas({address:transistors,abi,functionName:"mint",args:[0n,missing],account:account.address,value:mintValue})).toString();}catch(error:any){simulateError=String(error.shortMessage??error.message).slice(0,200);}
  const payload=indicatorTapeoutCalldata(manifest); let tapeoutGas:string|undefined;
  if(missing===0n)try{tapeoutGas=(await client.estimateGas({account:account.address,to:processor,data:payload as `0x${string}`,value:tapeoutFee})).toString();}catch(error:any){simulateError=String(error.shortMessage??error.message).slice(0,200);}
  items.push({id:manifest.id,gates:gates.toString(),netlistBytes:(manifest.runtime.netlist.length-2)/2,missingNand:missing.toString(),mintValueWei:mintValue.toString(),tapeoutFeeWei:tapeoutFee.toString(),totalProtocolValueOKB:formatEther(mintValue+tapeoutFee),mintGas,tapeoutGas,simulateError,supplyAvailable:BigInt(minted)+missing<=BigInt(supplyCap)});
}
const quote={at:new Date().toISOString(),chainId,owner:account.address,factory,processor,transistors,nativeBalanceOKB:formatEther(nativeBalance),gasPriceWei:gasPrice.toString(),mintPriceWei:String(mintPrice),protocolFeeWei:String(protocolFee),nandBalance:String(nandBalance),items,transactionsSent:0};
await mkdir('.tmp/indicator-market-v2',{recursive:true});await writeFile('.tmp/indicator-market-v2/xlayer-quote.json',JSON.stringify(quote,null,2));console.log(JSON.stringify(quote,null,2));

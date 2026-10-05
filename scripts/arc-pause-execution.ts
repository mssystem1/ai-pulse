/** Restore only Arc's execution pause. Default is read-only; receipts are durable. */
import {config} from "dotenv";
import {encodeFunctionData,parseAbi,type Hex} from "viem";
import {qualificationJournal} from "./arc-qualification-journal.js";
async function main(){
  config({quiet:true});
  const {loadConfig}=await import("../packages/config/src/index.js");
  const {executionContracts}=await import("../apps/api/src/executionContracts.js");
  const cfg=loadConfig(),contracts=executionContracts("arc"),broadcast=process.argv.includes("--broadcast");
  const q=await qualificationJournal({path:"packages/contracts/deployments/5042-pause-restoration.json",rpcUrl:cfg.ARC_RPC_URL,
    privateKey:cfg.TEST_WALLET_PRIVATE_KEY as Hex,owner:cfg.TEST_WALLET_ADDRESS,broadcast,budgetUSDC:"0.03",targets:[contracts.registry]});
  const abi=parseAbi(["function admin() view returns(address)","function automationPaused() view returns(bool)","function pauseAutomation(bool)"]);
  try{
    await q.reconcile();
    if((await q.client.readContract({address:contracts.registry,abi,functionName:"admin"})).toLowerCase()!==q.account.address.toLowerCase())
      throw new Error("Qualification pause signer is not the registry admin");
    const paused=await q.client.readContract({address:contracts.registry,abi,functionName:"automationPaused"});
    console.log(JSON.stringify({chainId:5042,registry:contracts.registry,paused,broadcast}));
    if(!broadcast||paused)return;
    // A fresh label is essential: a historical pause receipt does not prove
    // that the registry is still paused after a subsequent resume.
    await q.send(`pause-${q.journal.entries.length+1}`,contracts.registry,encodeFunctionData({abi,functionName:"pauseAutomation",args:[true]}));
    if(!await q.client.readContract({address:contracts.registry,abi,functionName:"automationPaused"}))throw new Error("Qualification pause restoration failed");
    console.log(JSON.stringify({registryPaused:true}));
  }finally{await q.close();}
}
main().then(()=>process.exit(0)).catch(error=>{console.error(error instanceof Error&&error.message.startsWith("Qualification ")?error.message:"Arc pause check stopped; reconcile its public journal before retrying.");process.exit(1);});

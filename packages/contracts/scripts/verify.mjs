import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const network = process.argv[2];
const chainIds={xlayer:196,base:8453,arbitrum:42161};
const chainId=chainIds[network];if(!chainId)throw new Error("Usage: node scripts/verify.mjs <xlayer|base|arbitrum>");
const root=resolve(import.meta.dirname,"..");
const manifestPath=resolve(root,"deployments",`${chainId}.json`);const manifest=JSON.parse(await readFile(manifestPath,"utf8"));
const stdJsonInput=JSON.parse(await readFile(resolve(root,"artifacts/standard-input.json"),"utf8"));
const compilerVersion=(await readFile(resolve(root,"artifacts/compiler-version.txt"),"utf8")).trim();
const contracts=[
  ["registry","PulseRegistryV1.sol:PulseRegistryV1"],
  ["oracleRouter","OracleRouterV1.sol:OracleRouterV1"],
  ["executionAdapter","OkxSwapAdapterV1.sol:OkxSwapAdapterV1"],
  ["spotFactory","SpotOrderAccountFactoryV1.sol:SpotOrderAccountFactoryV1"],
  ["autopilotFactory","AutopilotVaultFactoryV1.sol:AutopilotVaultFactoryV1"],
];
const results={};
for(const [key,identifier] of contracts){const deployment=manifest.contracts[key];if(!deployment?.address)throw new Error(`Manifest missing ${key}`);const response=await fetch(`https://sourcify.dev/server/v2/verify/${chainId}/${deployment.address}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({stdJsonInput,compilerVersion,contractIdentifier:identifier,creationTransactionHash:deployment.txHash})});const submitted=await response.json().catch(()=>({}));if(response.status===409){results[key]={status:"already_verified",address:deployment.address};console.log(`${network} ${key} already verified at ${deployment.address}`);continue;}if(!response.ok||!submitted.verificationId)throw new Error(`${key} verification submission failed (${response.status}): ${JSON.stringify(submitted)}`);let final;for(let attempt=0;attempt<60;attempt++){await new Promise((resolve)=>setTimeout(resolve,2000));const status=await fetch(`https://sourcify.dev/server/v2/verify/${submitted.verificationId}`);final=await status.json().catch(()=>({}));if(final.isJobCompleted===true)break;}if(!final?.isJobCompleted||final.error||!final.contract?.match)throw new Error(`${key} verification failed: ${JSON.stringify(final)}`);results[key]={status:"verified",address:deployment.address,verificationId:submitted.verificationId,result:final};console.log(`${network} ${key} verified at ${deployment.address}`);}
manifest.verification={provider:"Sourcify v2",verifiedAt:new Date().toISOString(),results};await writeFile(manifestPath,JSON.stringify(manifest,null,2));

/** Read-only CDP crawler validation; no signer, settlement, or indexing writes. */
import {mkdirSync,writeFileSync} from 'node:fs';
const origin=(process.argv[2]||'https://pulse-api-production-7aae.up.railway.app').replace(/\/$/,''),rows=[];
const services=[['Global Quick','/v1/analysis/spot/standard'],['Global Pro','/v1/analysis/spot/premium'],['Prediction Quick','/v1/analysis/prediction/standard'],['Prediction Pro','/v1/analysis/prediction/premium'],['Risk Guard','/v1/preflight']];
const results=await Promise.allSettled(['base','arbitrum'].map(async network=>{
  for(const [service,path] of services){
    const resource=origin+'/'+network+path;
    try{
      const response=await fetch('https://api.cdp.coinbase.com/platform/v2/x402/validate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({resource,method:'POST'}),signal:AbortSignal.timeout(45000)}),body=await response.json();
      rows.push({network,service,resource,httpStatus:response.status,ready:response.ok&&body.valid===true&&body.simulation?.outcome==='accepted',indexed:body.index?.active===true,result:body});
    }catch(error){rows.push({network,service,resource,ready:false,indexed:false,error:error.message});}
  }
}));
const executionErrors=results.filter(result=>result.status==='rejected').map(result=>String(result.reason));
const summary={checkedAt:new Date().toISOString(),origin,payments:0,indexingMutations:0,total:rows.length,ready:rows.filter(row=>row.ready).length,indexed:rows.filter(row=>row.indexed).length,failures:rows.filter(row=>!row.ready).map(row=>({network:row.network,service:row.service,status:row.result?.statusCode,error:row.error||row.result?.errorMessage||row.result?.simulation?.rejectionReason})),executionErrors};
mkdirSync('.tmp/asp-audit/public',{recursive:true});writeFileSync('.tmp/asp-audit/public/bazaar-discovery-audit.json',JSON.stringify({...summary,rows},null,2));
console.log(JSON.stringify(summary));process.exitCode=rows.length!==10||summary.ready!==10||executionErrors.length?1:0;

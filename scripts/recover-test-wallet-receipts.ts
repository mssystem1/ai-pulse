// Recover the original funded acceptance receipts; never signs or pays.
// Source namespace stays intact. A separate --target-namespace explicitly
// migrates these proven portable entitlements into the deployed workspace.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createPublicClient,http,decodeEventLog,parseAbi} from 'viem';
import {getNetwork} from '../packages/config/src/index.js';
import {createFormulaIndicatorPackage,exportIndicatorPackage} from '../packages/domain/src/indicatorMarket.js';
import {emptyTerminalWorkspace} from '../apps/api/src/terminalStore.js';
import {runNativeRedisCommand,closeNativeRedisConnections} from '../apps/api/src/nativeRedis.js';

const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
const owner=process.env.TEST_WALLET_ADDRESS!.toLowerCase();assert.match(owner,/^0x[0-9a-f]{40}$/);
const sourceNamespace='pulse:local',targetNamespace=process.argv.find(v=>v.startsWith('--target-namespace='))?.split('=')[1]??sourceNamespace;
assert(['pulse:local','pulse:production'].includes(targetNamespace));
const folder='.tmp/test-wallet-recovery';mkdirSync(folder,{recursive:true});
const abi=parseAbi(['event Transfer(address indexed from,address indexed to,uint256 value)','event AuthorizationUsed(address indexed authorizer,bytes32 indexed nonce)']);
const asset=getNetwork('base').paymentAsset.address!;
const client=createPublicClient({transport:http(process.env.BASE_RPC_URL,{timeout:20000,retryCount:1})});
async function proof(transaction:string,payee:string,amount:string,nonce?:string){
 assert.match(transaction,/^0x[\da-f]{64}$/i);assert.match(payee,/^0x[\da-f]{40}$/i);
 let receipt,block;
 try{receipt=await client.getTransactionReceipt({hash:transaction as `0x${string}`});block=await client.getBlock({blockHash:receipt.blockHash});}catch{throw Error('Original Base receipt/block is unavailable; recovery stopped without a new payment');}
 assert.equal(receipt.status,'success');let transfers=0;const nonces:string[]=[];
 for(const log of receipt.logs.filter(log=>log.address.toLowerCase()===asset.toLowerCase()))try{
  const e=decodeEventLog({abi,data:log.data,topics:log.topics});
  if(e.eventName==='Transfer'&&e.args.from.toLowerCase()===owner&&e.args.to.toLowerCase()===payee.toLowerCase()&&e.args.value.toString()===amount)transfers++;
  if(e.eventName==='AuthorizationUsed'&&e.args.authorizer.toLowerCase()===owner)nonces.push(e.args.nonce);
 }catch{}
 assert.equal(transfers,1,'Receipt must prove one exact owner-to-payee transfer');assert.equal(nonces.length,1,'Receipt must prove one unique owner authorization');if(nonce)assert.equal(nonces[0].toLowerCase(),nonce.toLowerCase());
 return {transaction:transaction.toLowerCase(),nonce:nonces[0].toLowerCase(),blockNumber:receipt.blockNumber.toString(),blockHash:receipt.blockHash,settledAt:new Date(Number(block.timestamp)*1000).toISOString()};
}
const key=(namespace:string,kind:string,id:string)=>`${namespace}:terminal:${kind}:${hash(id)}`;
const day=86400000,zero='0x'+'0'.repeat(40);
const receiptItems=[];
for(const file of ['service-purchase-v2.json','browser-service-purchase.json']){
 const marker=JSON.parse(readFileSync('.tmp/indicator-market-e2e/'+file,'utf8')),q=marker.quote;
 assert.equal(q.owner,owner);assert.equal(q.network,'base');assert.equal(q.asset.toLowerCase(),asset.toLowerCase());assert.equal(q.simulated,false);assert.equal(q.amountAtomic,'1000');assert.equal(q.priceUsdc,'0.001');assert(['2.0.0','4.0.0'].includes(q.version));assert.equal(q.payee,q.publisher);
 const manifest=createFormulaIndicatorPackage({id:'qa.service.'+q.publisher.slice(2).toLowerCase(),title:'QA weighted execution service',author:'PULSE QA creator',description:'Temporary QA service: actual custom weighted flow. Public formula; removed after validation.',version:q.version,expression:'buy*2-sell',output:{label:'Weighted flow',unit:'volume',accumulation:'bar'}});
 const bytes=exportIndicatorPackage(manifest);assert.equal(hash(bytes),q.sha256);assert.equal(q.listingId,'pmi_'+hash(q.publisher+':'+manifest.id+':'+manifest.version).slice(0,32));
 const verified=await proof(marker.transaction,q.payee,q.amountAtomic,marker.nonce);
 assert(Date.parse(verified.settledAt)>=Date.parse(q.createdAt)-300000&&Date.parse(verified.settledAt)<=Date.parse(q.expiresAt)+120000,'Settlement is outside the recorded original quote');
 if(marker.validBefore)assert(Date.parse(verified.settledAt)/1000<=Number(marker.validBefore));
 const {path:_path,resource:_resource,platformFeeAtomic:_fee,creatorReceivesAtomic:_amount,priceUsd:_price,assetSymbol:_symbol,...original}=q;
 const purchase={...original,state:'granted',packageRef:q.sha256,publisherName:manifest.author,nonce:verified.nonce,paymentId:hash(`${q.network}:${owner}:${q.asset}:${verified.nonce}`),settlementTx:verified.transaction,grantedAt:verified.settledAt,recovery:{sourceNamespace,proof:'original-quote-and-confirmed-authorization',originalGrantTimeUnknown:true,settlementBlock:verified.blockNumber}};
 const sale={id:q.id,listingId:q.listingId,publisher:q.publisher,publisherName:manifest.author,buyer:owner,title:q.title,version:q.version,sha256:q.sha256,amountAtomic:q.amountAtomic,priceUsdc:q.priceUsdc,asset:q.asset,network:'base',settlementTx:verified.transaction,at:verified.settledAt,simulated:false};
 receiptItems.push({purchase,sale,bytes,proof:verified});
}
const passMarker=JSON.parse(readFileSync('.tmp/terminal-base-acceptance/purchase.json','utf8'));
assert.equal(passMarker.owner.toLowerCase(),owner);assert.equal(passMarker.network,'base');assert.equal(passMarker.duration,'24h');assert.equal(passMarker.amount,'1500000');assert.equal(passMarker.httpStatus,201);
const passProof=await proof(passMarker.transaction,process.env.PAY_TO_ADDRESS!,'1500000');
const documentation=readFileSync('docs/TRADING_TERMINAL_ACCEPTANCE_2026-11-04.md','utf8');
const stamp=(label:string)=>{const match=new RegExp('\\| '+label+' \\| (\\d{4}-\\d\\d-\\d\\d \\d\\d:\\d\\d:\\d\\d\\.\\d{3}) UTC \\|').exec(documentation);assert(match,'Original documented '+label+' is missing');return match[1].replace(' ','T')+'Z';};
const purchasedAt=stamp('Activation'),expiresAt=stamp('Expiry');assert.equal(Date.parse(expiresAt)-Date.parse(purchasedAt),day);assert(Date.parse(expiresAt)<Date.now());assert(Math.abs(Date.parse(purchasedAt)-Date.parse(passProof.settledAt))<300000);
// November 4's original opaque payment ID/header is unavailable. Keep an
// explicitly reconstructed identity rather than pretending to know that ID.
const paymentId='recovered:base:'+passProof.transaction;
const grant={id:'recovered_tp_'+hash(owner+':'+passProof.transaction).slice(0,32),requestId:passMarker.requestId,duration:'24h',priceUsd:'1.5',amountAtomic:'1500000',network:'base',asset,paymentId,purchasedAt,startsAt:purchasedAt,expiresAt,simulated:false,recovery:{sourceNamespace,proof:'original-acceptance-marker-documentation-and-confirmed-settlement',settlementTx:passProof.transaction,originalOpaqueIdentityUnavailable:true}};
const plan={version:'test-wallet-receipt-recovery-v1',owner,sourceNamespace,targetNamespace,receiptItems,grant,passProof};
const serialized=JSON.stringify(plan,null,2)+'\n',planHash=hash(serialized);
if(!process.argv.includes('--apply')){
 writeFileSync(folder+'/receipt-plan.json',serialized);console.log(JSON.stringify({planSha256:planHash,sourceNamespace,targetNamespace,verifiedIndicatorPurchases:receiptItems.length,exactPackageBytes:true,expiredPassHistory:true,newPaidTimeGranted:false,paymentsSigned:false}));
}else{
 assert(process.argv.includes('--plan-sha256='+planHash),'Receipt apply requires the exact verified plan hash');
 const url=process.env.REDIS_PUBLIC_URL!;assert(url);const command=(...args:any[])=>runNativeRedisCommand(url,args,20000);
 const outcomes:any[]=[];
 const cas=`local old=redis.call('GET',KEYS[1]);if (old or '')~=ARGV[1] then return 0 end;if old then redis.call('SET',KEYS[1],ARGV[2],'KEEPTTL') else redis.call('SET',KEYS[1],ARGV[2],'PXAT',ARGV[3]) end;return 1`;
 async function merge(namespace:string,account:string,expiry:number,apply:(workspace:any)=>void){
  const storageKey=key(namespace,'owner',account);
  for(let attempt=0;attempt<12;attempt++){
   const raw=await command('GET',storageKey),current=raw?JSON.parse(String(raw)):emptyTerminalWorkspace(account);assert.equal(current.owner,account);
   const before=JSON.stringify(current);apply(current);if(JSON.stringify(current)===before)return false;
   current.revision=(current.revision??0)+1;
   if(Number(await command('EVAL',cas,1,storageKey,raw??'',JSON.stringify(current),expiry))===1)return true;
  }throw Error('Concurrent workspace updates prevented recovery; existing data was preserved');
 }
 try{
  assert.equal(await command('PING'),'PONG');
  for(const namespace of [...new Set([sourceNamespace,targetNamespace])]){
   const registry=key(namespace,'indicator-registry','v1'),commerce=key(namespace,'indicator-commerce','v1');
   for(const item of receiptItems){
    const packageKey=key(registry,'package',item.purchase.packageRef),existing=await command('GET',packageKey),value=JSON.stringify({bytes:item.bytes});
    if(existing)assert.equal(JSON.parse(String(existing)).bytes,item.bytes,'Existing package conflicts with original paid bytes');
    else{const result=await command('SET',packageKey,value,'NX','PXAT',Date.parse(item.proof.settledAt)+3650*day);if(result!=='OK'){const winner=await command('GET',packageKey);assert.equal(JSON.parse(String(winner)).bytes,item.bytes);}}
   }
   const latest=Math.max(...receiptItems.map(item=>Date.parse(item.proof.settledAt)));
   const commerceChanged=await merge(commerce,owner,latest+3650*day,current=>{
    current.indicatorPurchases??=[];
    for(const item of receiptItems){const old=current.indicatorPurchases.find((p:any)=>p.id===item.purchase.id||p.listingId===item.purchase.listingId&&p.state==='granted');if(old){assert.equal(old.sha256,item.purchase.sha256);assert.equal(old.settlementTx?.toLowerCase(),item.purchase.settlementTx);assert.equal(old.state,'granted');}else current.indicatorPurchases.push(item.purchase);}
   });
   const registryChanged=await merge(registry,zero,latest+365*day,current=>{
    current.indicatorSales??=[];current.indicatorClaims??={};
    for(const item of receiptItems){const old=current.indicatorSales.find((s:any)=>s.id===item.sale.id);if(old){assert.equal(old.buyer,owner);assert.equal(old.sha256,item.sale.sha256);assert.equal(old.settlementTx?.toLowerCase(),item.sale.settlementTx);}else current.indicatorSales.push(item.sale);
     const paymentId=item.purchase.paymentId,claimed=current.indicatorClaims[paymentId];assert(!claimed||claimed===item.purchase.id,'Original authorization is bound to another receipt');current.indicatorClaims[paymentId]=item.purchase.id;}
   });
   const passChanged=await merge(namespace,owner,Date.parse(grant.expiresAt)+180*day,current=>{
    const old=current.grants.find((g:any)=>g.requestId===grant.requestId);if(old){assert.equal(old.duration,grant.duration);assert.equal(old.expiresAt,grant.expiresAt);return;}
    current.grants.push(grant);
   });
   outcomes.push({namespace,commerceChanged,registryChanged,passChanged,indicatorPurchases:2,expiredPassRecords:1});
   writeFileSync(folder+'/receipt-apply-results.json',JSON.stringify({owner,planSha256:planHash,outcomes},null,2)+'\n');
  }
  console.log(JSON.stringify({outcomes,newPaidTimeGranted:false,listingsRepublished:false,paymentsSigned:false,tradesPlaced:false}));
 }finally{closeNativeRedisConnections();}
}

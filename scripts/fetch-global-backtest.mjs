/** Public OHLCV only. Resumable, bounded, no credentials or account endpoints. */
import fs from 'node:fs';
import crypto from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';

const out='.tmp/global-backtest';fs.mkdirSync(out,{recursive:true});
const end=Date.parse('2026-10-21T00:00:00Z');
const specs={'15m':'2025-07-20T00:00:00Z','1Dutc':'2024-05-01T00:00:00Z','1Wutc':'2016-01-01T00:00:00Z','1Mutc':'2016-01-01T00:00:00Z'};
for(const [bar,start] of Object.entries(specs)){
  const file=`${out}/${bar}.json`,old=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):[];
  const rows=new Map(old.map(r=>[r[0],r]));let cursor=old.length?Math.min(...old.map(r=>r[0])):end;
  while(cursor>Date.parse(start)){
    const url=new URL('https://www.okx.com/api/v5/market/history-candles');
    for(const [k,v]of Object.entries({instId:'BTC-USDT',bar,limit:'100',after:String(cursor)}))url.searchParams.set(k,v);
    let data;
    for(let attempt=0;attempt<5;attempt++){
      try{const response=await fetch(url,{signal:AbortSignal.timeout(20000)});const body=await response.json();if(!response.ok||body.code!=='0')throw Error(`OKX ${response.status} ${body.code}: ${body.msg}`);data=body.data;break;}
      catch(e){if(attempt===4)throw e;await delay(1000*2**attempt);}
    }
    if(!data.length)break;
    const next=Math.min(...data.map(r=>Number(r[0])));if(next>=cursor)throw Error(`Nonadvancing pagination: ${bar}`);
    for(const r of data)if(r[8]==='1'&&Number(r[0])<end)rows.set(Number(r[0]),r.slice(0,6).map(Number));
    cursor=next;fs.writeFileSync(file,JSON.stringify([...rows.values()].sort((a,b)=>a[0]-b[0])));
    if(rows.size%1000<100)console.log(JSON.stringify({bar,rows:rows.size,earliest:new Date(cursor).toISOString()}));
    await delay(150);
  }
  console.log(JSON.stringify({bar,complete:true,rows:rows.size}));
}
const manifest={source:'https://www.okx.com/api/v5/market/history-candles',instrument:'BTC-USDT',requestedEnd:new Date(end).toISOString(),downloadedAt:new Date().toISOString(),files:Object.keys(specs).map(bar=>{const path=`${out}/${bar}.json`,bytes=fs.readFileSync(path),rows=JSON.parse(bytes);return {bar,path,rows:rows.length,first:rows[0]?.[0],last:rows.at(-1)?.[0],sha256:crypto.createHash('sha256').update(bytes).digest('hex')};})};
fs.writeFileSync(`${out}/manifest.json`,JSON.stringify(manifest,null,2));console.log(JSON.stringify(manifest));

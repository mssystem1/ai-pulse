import fs from 'node:fs';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import {candleCloseTime} from '../packages/schemas/dist/index.js';

export function aggregateCandles(bars,size){
  const duration=size*900000,groups=new Map();
  for(const c of bars){const ts=Math.floor(c.ts/duration)*duration;const group=groups.get(ts)??[];group.push(c);groups.set(ts,group);}
  return [...groups].flatMap(([ts,group])=>group.length===size&&group.every((c,i)=>c.ts===ts+i*900000)?[{ts,open:group[0].open,high:Math.max(...group.map(c=>c.high)),low:Math.min(...group.map(c=>c.low)),close:group.at(-1).close,volume:group.reduce((s,c)=>s+c.volume,0),confirmed:true}]:[]);
}
export function loadBacktestData(file='docs/backtests/data/btc-okx-20261020.json.gz'){
  const archive=JSON.parse(zlib.gunzipSync(fs.readFileSync(file))),frames={};
  for(const f of archive.manifest.files){
    const rows=archive.frames[f.bar];
    if(!rows?.length||rows.length!==f.rows||crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex')!==f.sha256)throw Error(`Data hash/count mismatch: ${f.bar}`);
    frames[f.bar]=rows.map(([ts,open,high,low,close,volume],i)=>{
      if(![ts,open,high,low,close,volume].every(Number.isFinite)||Math.min(open,high,low,close)<=0||volume<0||high<Math.max(open,close)||low>Math.min(open,close)||high<low||i>0&&candleCloseTime(rows[i-1][0],f.bar)!==ts)throw Error(`Malformed or noncontiguous ${f.bar} bar: ${ts}`);
      return {ts,open,high,low,close,volume,confirmed:true};
    });
  }
  frames['1H']=aggregateCandles(frames['15m'],4);frames['4H']=aggregateCandles(frames['15m'],16);
  const days=new Map(frames['1Dutc'].map(c=>[c.ts,c]));let dailyComparisons=0;
  for(const day of aggregateCandles(frames['15m'],96)){
    const source=days.get(day.ts);if(!source)continue;
    if(['open','high','low','close'].some(k=>Math.abs(source[k]-day[k])>1e-6))throw Error(`Daily/15m OHLC mismatch: ${new Date(day.ts).toISOString()}`);
    dailyComparisons++;
  }
  return {frames,manifest:archive.manifest,dailyComparisons};
}

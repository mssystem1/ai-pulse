import test from "node:test";
import assert from "node:assert/strict";
import {requestTelegramDownload,canShareReport,shareReport} from "./reportDownload";
test("Telegram downloads use the real HTTPS file with its filename; blob URLs use the fallback",()=>{
  let called=0;const app={downloadFile:(params:{url:string;file_name:string},callback?:((value:boolean)=>void))=>{called++;assert.equal(params.url,"https://pulse.test/file");assert.equal(params.file_name,"PULSE.png");callback?.(false);},isVersionAtLeast:()=>true};
  let accepted:boolean|undefined;assert.equal(requestTelegramDownload(app,"https://pulse.test/file","PULSE.png",v=>accepted=v),true);assert.equal(accepted,false);assert.equal(called,1);
  assert.equal(requestTelegramDownload(app,"blob:preview","PULSE.png",()=>{}),false);assert.equal(requestTelegramDownload({...app,isVersionAtLeast:()=>false},"https://pulse.test/file","PULSE.png",()=>{}),false);assert.equal(called,1);
});
test("native file share runs synchronously inside the final user click and retains the complete file",async()=>{
  const file=new File(["Full report\n全部报告"],"PULSE.txt",{type:"text/plain"});let invoked=false;
  const nav={canShare:()=>true,share:(data:ShareData)=>{invoked=true;assert.equal(data.files?.[0],file);return Promise.resolve();}};
  const pending=shareReport(file,nav);assert.equal(invoked,true);await pending;assert.match(await file.text(),/全部报告/);
  assert.equal(canShareReport(file,{canShare:()=>false,share:nav.share}),false);assert.throws(()=>shareReport(file,{canShare:()=>false,share:nav.share}));
});

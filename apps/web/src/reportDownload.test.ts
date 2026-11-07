import test from "node:test";
import assert from "node:assert/strict";
import {requestTelegramDownload,canShareReport,shouldShareReportOnSave,shareReport} from "./reportDownload";
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

test("Save on desktop downloads even when file sharing is supported or the PC has a touchscreen",()=>{
  const file=new File(["report"],"PULSE.txt",{type:"text/plain"}),sharing={canShare:()=>true,share:async()=>{}};
  for(const nav of [
    {userAgent:"Mozilla/5.0 (Windows NT 10.0; Win64; x64)",platform:"Win32",maxTouchPoints:0},
    {userAgent:"Mozilla/5.0 (Windows NT 10.0; Win64; x64)",platform:"Win32",maxTouchPoints:10},
    {userAgent:"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",platform:"MacIntel",maxTouchPoints:0},
    {userAgent:"Mozilla/5.0 (X11; Linux x86_64)",platform:"Linux x86_64",maxTouchPoints:0},
    {userAgent:"",userAgentData:{mobile:false},maxTouchPoints:10}
  ]){
    assert.equal(canShareReport(file,sharing),true);
    assert.equal(shouldShareReportOnSave(file,{...nav,...sharing}),false,JSON.stringify(nav));
  }
});

test("mobile Save retains the native file-saving fallback, including desktop-mode iPad",()=>{
  const file=new File(["report"],"PULSE.txt",{type:"text/plain"}),sharing={canShare:()=>true,share:async()=>{}};
  for(const nav of [
    {userAgent:"Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)",platform:"iPhone",maxTouchPoints:5},
    {userAgent:"Mozilla/5.0 (Linux; Android 15)",platform:"Linux armv8l",maxTouchPoints:5},
    {userAgent:"Mozilla/5.0 (Linux; Android 15; Tablet)",platform:"Linux armv8l",userAgentData:{mobile:false},maxTouchPoints:5},
    {userAgent:"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",platform:"MacIntel",maxTouchPoints:5},
    {userAgent:"",userAgentData:{mobile:true}}
  ]){
    assert.equal(shouldShareReportOnSave(file,{...nav,...sharing}),true,JSON.stringify(nav));
    assert.equal(shouldShareReportOnSave(file,{...nav,...sharing,canShare:()=>false}),false);
  }
});

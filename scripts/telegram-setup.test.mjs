import test from 'node:test';
import assert from 'node:assert/strict';
import { setupPlan,publicSetupPlan,applySetup,applyMenu,setupStatus,PULSE_COMMANDS } from './telegram-setup.mjs';
import { APPROVED_STARS } from './telegram-readiness.mjs';

const env={TELEGRAM_BOT_TOKEN:'private-fixture-token',TELEGRAM_BOT_USERNAME:'pulsemi_bot',TELEGRAM_WEBHOOK_SECRET:'private_fixture_secret',TELEGRAM_WEBHOOK_BASE_URL:'https://api.example',TELEGRAM_TON_MINI_APP_ENABLED:'1',TELEGRAM_TON_MINI_APP_URL:'https://pulse.example/ton-miniapp',TELEGRAM_SUPPORT_CONTACT:'@fixture_support',TELEGRAM_STARS_ENABLED:'0',TELEGRAM_STARS_GLOBAL_QUICK:'10',TELEGRAM_STARS_GLOBAL_PRO:'15',TELEGRAM_STARS_RISK_GUARD:'15',TELEGRAM_STARS_PREDICTION_QUICK:'10',TELEGRAM_STARS_PREDICTION_PRO:'15'};
function fixture({stage='paused',oldApi=false,html=false,wrongIdentity=false,iconUrl='https://pulse.example/tonconnect-icon.png',failMethod}={}){
  const calls=[];
  const fetcher=async(url,init)=>{
    const value=String(url);calls.push({url:value,method:init.method,payload:init.body?JSON.parse(init.body):undefined});
    if(value.includes('api.telegram.org')){const method=value.split('/').at(-1);if(method===failMethod)throw Error(value);return Response.json({ok:true,result:method==='getMe'?{username:wrongIdentity?'another_bot':'pulsemi_bot',has_main_web_app:true}:method==='getWebhookInfo'?{url:'https://api.example/v1/telegram/webhook',allowed_updates:['message','callback_query','pre_checkout_query'],pending_update_count:0}:method==='getChatMenuButton'?{type:'commands'}:true});}
    if(value.endsWith('/tonconnect-manifest.json'))return html?new Response('<html>fallback</html>',{headers:{'Content-Type':'text/html'}}):Response.json({name:'PULSE',url:env.TELEGRAM_TON_MINI_APP_URL,iconUrl});
    const ton=value.includes('/telegram/ton/');
    if(value.endsWith('/status'))return Response.json({enabled:true,configured:true,durableDelivery:true,mode:oldApi?'legacy_miniapp':ton?'ton_miniapp':'pulse',botUsername:'pulsemi_bot',webhookPath:'/v1/telegram/webhook',miniAppUrl:env.TELEGRAM_TON_MINI_APP_URL});
    return Response.json({currency:'XTR',checkoutReady:stage==='checkout',services:Object.entries(APPROVED_STARS).map(([id,stars])=>({id,stars:stage==='checkout'&&(!ton||['global-quick','global-pro'].includes(id))?stars:null,enabled:stage==='checkout'&&(!ton||['global-quick','global-pro'].includes(id))}))});
  };
  return {calls,fetcher};
}
const writes=calls=>calls.filter(call=>/\/set[A-Z]/.test(call.url));
test('paused configuration uses one PULSE identity and previews no credentials',()=>{
  const plan=setupPlan(env),preview=publicSetupPlan(plan);assert.equal(preview.name,'PULSE');assert.equal(preview.username,'pulsemi_bot');assert.equal(preview.webhookUrl,'https://api.example/v1/telegram/webhook');assert.ok(preview.description.includes('purchases are paused'));assert.ok(preview.description.length<=512);assert.ok(preview.shortDescription.length<=120);
  for(const secret of [env.TELEGRAM_BOT_TOKEN,env.TELEGRAM_WEBHOOK_SECRET])assert.ok(!JSON.stringify(preview).includes(secret));
  assert.equal(PULSE_COMMANDS.length,15);assert.ok(PULSE_COMMANDS.some(command=>command.command==='menu'));assert.ok(!PULSE_COMMANDS.some(command=>command.command==='miniapp'));
});
test('paused setup verifies both views before registering payment updates',async()=>{
  const plan=setupPlan(env),mock=fixture();const applied=await applySetup(plan,env,mock.fetcher);assert.equal(applied.length,6);assert.equal(writes(mock.calls).length,6);const webhook=writes(mock.calls).find(call=>call.url.endsWith('/setWebhook'));assert.equal(webhook.payload.drop_pending_updates,false);assert.ok(webhook.payload.allowed_updates.includes('pre_checkout_query'));assert.ok(mock.calls.findIndex(call=>call.url.endsWith('/tonconnect-manifest.json'))<mock.calls.findIndex(call=>/\/set[A-Z]/.test(call.url)));
});
test('old deployment, wrong token identity or missing manifest cause zero mutations',async()=>{
  for(const options of [{oldApi:true},{html:true},{wrongIdentity:true},{iconUrl:'https://pulse.example/logo.svg'},{iconUrl:'http://pulse.example/icon.png'}]){const mock=fixture(options);await assert.rejects(applySetup(setupPlan(env),env,mock.fetcher));assert.equal(writes(mock.calls).length,0);}
});
test('checkout stage verifies the approved active catalog and removes paused profile text',async()=>{
  const active={...env,TELEGRAM_STARS_ENABLED:'1'},plan=setupPlan(active,{stage:'checkout'}),mock=fixture({stage:'checkout'});await applySetup(plan,active,mock.fetcher);assert.ok(!plan.description.includes('purchases are paused'));assert.ok(!plan.about.includes('paused'));assert.ok(plan.description.length<=512);assert.ok(plan.about.length<=120);
});
test('partial failure reports completed steps without exposing the credential URL',async()=>{
  const mock=fixture({failMethod:'setWebhook'});await assert.rejects(applySetup(setupPlan(env),env,mock.fetcher),error=>error.message.includes('5 completed steps')&&!error.message.includes(env.TELEGRAM_BOT_TOKEN));
});
test('status only reads the existing bot and requires no second credentials',async()=>{
  const mock=fixture(),status=await setupStatus(setupPlan(env),mock.fetcher);assert.equal(status.identityMatches,true);assert.equal(status.mainMiniAppEnabled,true);assert.equal(status.webhookMatches,true);assert.equal(status.commandsMenuMatches,true);assert.equal(writes(mock.calls).length,0);
});

test('menu-only changes commands and menu without touching profile, webhook or sales stage',async()=>{
  const mock=fixture();assert.deepEqual(await applyMenu(setupPlan(env),mock.fetcher),['setMyCommands','setChatMenuButton']);
  assert.deepEqual(writes(mock.calls).map(call=>call.url.split('/').at(-1)),['setMyCommands','setChatMenuButton']);
  assert.deepEqual(writes(mock.calls)[1].payload,{menu_button:{type:'commands'}});
  assert.ok(!writes(mock.calls)[0].payload.commands.some(command=>command.command==='miniapp'));
});
test('menu-only identity or missing profile launcher blocks changes',async()=>{
  const wrong=fixture({wrongIdentity:true});await assert.rejects(applyMenu(setupPlan(env),wrong.fetcher));assert.equal(writes(wrong.calls).length,0);
  await assert.rejects(applyMenu(setupPlan(env),async()=>Response.json({ok:true,result:{username:'pulsemi_bot',has_main_web_app:false}})),/Main Mini App first/);
});

import { pathToFileURL } from 'node:url';
import { APPROVED_STARS, inspectCatalog, publicOrigin } from './telegram-readiness.mjs';

export const PULSE_NAME='PULSE';
export const PULSE_DESCRIPTION='PULSE brings market intelligence to Telegram. In chat: Global Quick and Prediction Quick (10 Stars); Risk Guard, Global Pro and Prediction Pro (15 Stars). Open the TON Mini App for TON-USDT research and optional TON Connect. Receive reports here and revisit My reports. Link your EVM wallet once for retained website history. Explore the full product: https://www.ai-pulse.tech.';
export const PULSE_ABOUT='PULSE · www.ai-pulse.tech · Research in chat, Stars payments, EVM history and a TON Mini App.';
export const PULSE_COMMANDS=[['start','Open the PULSE service menu'],['help','How to use PULSE'],['miniapp','Open the TON Mini App and TON Connect'],['website','Open the official www.ai-pulse.tech website'],['globalquick','Global Quick — 10 Stars'],['globalpro','Global Pro — 15 Stars'],['risk','Risk Guard — 15 Stars'],['predictionquick','Prediction Quick — 10 Stars'],['predictionpro','Prediction Pro — 15 Stars'],['reports','My chat and Mini App research reports'],['wallet','Link or change the EVM history wallet'],['settings','Manage the saved history wallet'],['paysupport','Stars payment help and refunds'],['terms','Research purchase terms'],['privacy','Account and report privacy']].map(([command,description])=>({command,description}));
const PRICE_KEYS={'global-quick':'TELEGRAM_STARS_GLOBAL_QUICK','global-pro':'TELEGRAM_STARS_GLOBAL_PRO','risk-guard':'TELEGRAM_STARS_RISK_GUARD','prediction-quick':'TELEGRAM_STARS_PREDICTION_QUICK','prediction-pro':'TELEGRAM_STARS_PREDICTION_PRO'};

export function setupPlan(env,{stage='paused'}={}){
  if(!['paused','checkout'].includes(stage))throw Error('Use --stage paused or checkout.');
  const token=env.TELEGRAM_BOT_TOKEN?.trim(),secret=env.TELEGRAM_WEBHOOK_SECRET?.trim(),username=env.TELEGRAM_BOT_USERNAME?.replace(/^@/,'').trim();
  if(!token||!username||!secret)throw Error('Configure the existing PULSE token, username and webhook secret.');
  if(!/^[A-Za-z0-9_-]{1,256}$/.test(secret)||secret===token)throw Error('Use a distinct webhook secret with the allowed format.');
  const origin=publicOrigin(env.TELEGRAM_WEBHOOK_BASE_URL||env.BASE_URL);
  let mini;try{mini=new URL(env.TELEGRAM_TON_MINI_APP_URL);publicOrigin(mini.origin);if(mini.pathname!=='/ton-miniapp'||mini.username||mini.password||mini.search||mini.hash)throw Error();}catch{throw Error('Set the exact public HTTPS /ton-miniapp URL.');}
  const description=PULSE_DESCRIPTION+(stage==='paused'?' Setup in progress: new Stars purchases are paused.':'');
  const about=stage==='paused'?'PULSE · www.ai-pulse.tech · Setup in progress. New Stars purchases paused; saved reports remain available.':PULSE_ABOUT;
  const webhookUrl=new URL('/v1/telegram/webhook',origin).href;
  const actions=[['setMyName',{name:PULSE_NAME}],['setMyCommands',{commands:PULSE_COMMANDS,scope:{type:'all_private_chats'}}],['setMyDescription',{description}],['setMyShortDescription',{short_description:about}],['setChatMenuButton',{menu_button:{type:'web_app',text:'Open PULSE',web_app:{url:mini.href}}}],['setWebhook',{url:webhookUrl,secret_token:secret,allowed_updates:['message','callback_query','pre_checkout_query'],drop_pending_updates:false}]];
  return {token,username,stage,origin,miniAppUrl:mini.href,webhookUrl,description,about,actions};
}
export function publicSetupPlan(plan){return {stage:plan.stage,name:PULSE_NAME,username:plan.username,miniAppUrl:plan.miniAppUrl,webhookUrl:plan.webhookUrl,description:plan.description,shortDescription:plan.about,commands:PULSE_COMMANDS,actions:plan.actions.map(([method])=>method),manualBotFather:'Enable Main Mini App on this same PULSE bot after frontend deployment. Set groups and inline mode disabled; keep privacy mode enabled.'};}
function botClient(plan,fetcher){return async(method,payload={})=>{
  try{const response=await fetcher(`https://api.telegram.org/bot${plan.token}/${method}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.timeout(15000),redirect:'error'});const data=await response.json();if(!response.ok||!data.ok)throw Error();return data.result;}catch{throw Error(`Telegram ${method} failed. No credential URL or raw response is printed.`);}
};}
export async function applySetup(plan,env,fetcher=fetch){
  if(env.TELEGRAM_TON_MINI_APP_ENABLED!=='1'||!env.TELEGRAM_SUPPORT_CONTACT?.trim())throw Error('Enable the PULSE TON Mini App and configure monitored payment support before setup.');
  if(env.TELEGRAM_STARS_ENABLED!==(plan.stage==='paused'?'0':'1')||Object.entries(APPROVED_STARS).some(([id,price])=>Number(env[PRICE_KEYS[id]])!==price))throw Error('Operator environment must match the selected sales stage and approved 10/15-Star prices.');
  const bot=botClient(plan,fetcher);const me=await bot('getMe');if(me?.username!==plan.username)throw Error('Token does not match the expected PULSE username. No configuration changed.');
  for(const [view,prefix,mode]of [['chat','/v1/telegram','pulse'],['ton','/v1/telegram/ton','ton_miniapp']]){
    const read=async path=>{try{const response=await fetcher(new URL(`${prefix}/${path}`,plan.origin),{method:'GET',redirect:'error',signal:AbortSignal.timeout(15000)});if(!response.ok)throw Error();return await response.json();}catch{throw Error(`Deployed ${view} ${path} inspection failed. No configuration changed.`);}};
    const state=await read('status');if(!state.enabled||!state.configured||!state.durableDelivery||state.mode!==mode||state.botUsername!==plan.username||state.webhookPath!=='/v1/telegram/webhook'||state.miniAppUrl!==plan.miniAppUrl)throw Error(`Deploy the single PULSE ${view} view and durable delivery first. No configuration changed.`);
    if(inspectCatalog(await read('services'),plan.stage,view).some(check=>check.status==='fail'))throw Error(`Deployed ${view} catalog does not match the selected stage. No configuration changed.`);
  }
  try{const response=await fetcher(new URL('/tonconnect-manifest.json',plan.miniAppUrl),{method:'GET',redirect:'error',signal:AbortSignal.timeout(15000)});if(!response.ok||!response.headers?.get('content-type')?.includes('application/json'))throw Error();const manifest=await response.json();const icon=new URL(manifest.iconUrl);if(manifest.name!==PULSE_NAME||manifest.url!==plan.miniAppUrl||icon.protocol!=='https:'||icon.username||icon.password||! /\.(png|ico)$/i.test(icon.pathname))throw Error();}catch{throw Error('Deploy the actual PULSE TON Connect JSON manifest with an HTTPS PNG/ICO icon before setup. No configuration changed.');}
  const applied=[];for(const [method,payload]of plan.actions){try{await bot(method,payload);applied.push(method);}catch{throw Error(`Telegram ${method} failed after ${applied.length} completed steps (${applied.join(', ')||'none'}). Configuration is sequential; inspect --status before resuming.`);}}
  return applied;
}
export async function setupStatus(plan,fetcher=fetch){const bot=botClient(plan,fetcher);const me=await bot('getMe'),info=await bot('getWebhookInfo'),menu=await bot('getChatMenuButton');return {name:PULSE_NAME,expectedUsername:plan.username,identityMatches:me?.username===plan.username,mainMiniAppEnabled:Boolean(me?.has_main_web_app),webhookMatches:info?.url===plan.webhookUrl,pendingUpdates:info?.pending_update_count,lastDeliveryError:Boolean(info?.last_error_message),allowedUpdates:info?.allowed_updates,miniAppMenuMatches:menu?.type==='web_app'&&menu?.text==='Open PULSE'&&menu?.web_app?.url===plan.miniAppUrl};}
async function main(){
  try{process.loadEnvFile();}catch{}
  const args=process.argv.slice(2);if(args.includes('--help')){console.log('One PULSE bot: node scripts/telegram-setup.mjs [--stage paused|checkout] [--status|--apply]\nDefault: dry-run with sales paused. --status reads identity/menu/webhook. --apply verifies both deployed views and JSON manifest before changing the one bot. BotFather Main Mini App setup remains manual.');return;}
  let stage='paused';for(let i=0;i<args.length;i++){if(args[i]==='--stage'&&args[i+1])stage=args[++i];else if(!['--status','--apply'].includes(args[i]))throw Error('Unknown option; use --help.');}if(args.includes('--status')&&args.includes('--apply'))throw Error('Choose either --status or --apply.');
  const plan=setupPlan(process.env,{stage});if(args.includes('--status'))console.log(JSON.stringify(await setupStatus(plan),null,2));else{console.log(JSON.stringify({mode:args.includes('--apply')?'apply':'dry-run',...publicSetupPlan(plan)},null,2));if(args.includes('--apply'))console.log(JSON.stringify({applied:await applySetup(plan,process.env)},null,2));}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(error=>{console.error(error instanceof Error?error.message:'Setup failed; inspect configuration.');process.exitCode=1;});

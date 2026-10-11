from pathlib import Path
import asyncio,json,re,subprocess,math
import truststore
truststore.inject_into_ssl()
import edge_tts,imageio_ffmpeg
ROOT=Path(__file__).resolve().parents[3];AUDIO=ROOT/'media/pulse-promo-production/audio'
FF=imageio_ffmpeg.get_ffmpeg_exe()
GROUPS={
'gateway':[(40.7,46,'Open Wallet and funding. Choose your Gateway deposit amount.'),(46.5,52,'Review the USDC approval in your wallet.'),(52.6,58,'Then review and confirm the Gateway deposit.'),(58.3,64,'Check the updated Gateway balance. Your trading capital remains separate.')],
'research':[(64.6,74,'In Global Market, choose a market and timeframe, then inspect live OKX reference data.'),(74.5,82,'Quick and Pro research add context, scenarios, targets, and invalidation.'),(82.7,95,'Compare what would support or challenge the idea. Pause on the chart and understand the scenarios.'),(95.4,104,'Open the research plan in Spot Trading. The report informs your decision; you still review the order.')],
'spot':[(104.6,112,'On Arc, Ether research maps to wrapped Ether and USDC.'),(112.3,122,'Review the amount, trigger, slippage, and take-profit and stop-loss protection. Manual Spot orders require your wallet approval.'),(122.5,130,'This limit order is pending, so it waits for its condition.'),(130.6,140,'Follow the order in the dashboard, or cancel it and reclaim the remaining funds.')],
'prediction':[(140.6,147,'In Prediction Market intelligence, choose a live question to investigate.'),(147.5,155,'Inspect its probabilities, liquidity, and resolution rules.'),(155.3,161,'Research adds evidence and alternative scenarios, alongside relevant market structure.'),(161.5,172,'Probability is a starting point for investigation. PULSE helps you understand the context before you decide.')],
'autopilot':[(172.7,182,'For autonomous execution, choose a market and strategy.'),(182.6,194,'Review your capital, exposure, and risk limits. Your wallet authorizes the policy.'),(194.3,204,'Your wallet funds the vault. Gateway funds the entry pass. Autopilot acts only when its required rules pass.'),(204.2,214,'Follow the vault, pause entries, and manage capital from its controls. Running does not mean a new trade.'),(214.3,224,'Open the journal for holds, checks, recovery events, and confirmed actions. A hold is a decision, too.')]
}
def duration(path):
 p=subprocess.run([FF,'-hide_banner','-i',str(path)],capture_output=True,text=True,encoding='utf-8',errors='replace')
 m=re.search(r'Duration: (\d+):(\d+):(\d+\.\d+)',p.stderr)
 if not m:raise RuntimeError('Cannot measure '+str(path))
 return int(m[1])*3600+int(m[2])*60+float(m[3])
async def main():
 original=json.loads((AUDIO/'voice-timing.json').read_text('utf-8'))
 result=[v for v in original if v['chapter'] not in GROUPS];sem=asyncio.Semaphore(2)
 async def render(chapter,index,g):
  async with sem:
   start,end,script=g;path=AUDIO/f'{chapter}-{index+1:02}-aligned-voice.mp3'
   text=script.replace('USDC','U S D C').replace('OKX','O K X');rate=0
   for attempt in range(3):
    try:
     if not path.exists():await edge_tts.Communicate(text,'en-US-AriaNeural',rate='+0%',receive_timeout=40).save(str(path))
     break
    except Exception:
     if attempt==2:raise
     if path.exists():path.unlink()
     await asyncio.sleep(1)
   seconds=duration(path);available=end-start-.25
   if seconds>available:
    rate=math.ceil((seconds/available-1)*100)+1
    await edge_tts.Communicate(text,'en-US-AriaNeural',rate=f'+{rate}%',receive_timeout=40).save(str(path))
    seconds=duration(path)
   if seconds>available+.1:raise RuntimeError('Voice does not fit '+chapter)
   print(chapter,index+1,seconds,'s',flush=True)
   return {'chapter':chapter,'voice':'en-US-AriaNeural','file':str(path),'seconds':seconds,'start':start,'available':available,'ratePercent':rate,'script':script}
 result+=await asyncio.gather(*(render(c,i,g) for c,groups in GROUPS.items() for i,g in enumerate(groups)))
 result.sort(key=lambda v:v['start'])
 (AUDIO/'voice-final-timing.json').write_text(json.dumps(result,indent=2),'utf-8')
 print('ALIGNED VOICE ready',len(result),flush=True)
asyncio.run(main())

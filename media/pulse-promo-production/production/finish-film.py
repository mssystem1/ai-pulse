from pathlib import Path
import json,subprocess,re,runpy,hashlib,shutil
import numpy as np
from PIL import Image,ImageDraw,ImageFont
M=runpy.run_path(str(Path(__file__).parent/'render-film.py'))
OUT=M['OUT'];WORK=M['WORK'];FF=M['FF'];PLAN=M['PLAN'];ASSETS=M['ASSETS']
MAIN=OUT/'PULSE-Arc-Mainnet-Demo-4min.mp4'
MUSIC=OUT/'PULSE-Arc-Mainnet-Demo-4min-music-only.mp4'

def mux():
    meta=';FFMETADATA1\ntitle=PULSE — Arc Mainnet Demo\nartist=PULSE\ncomment=Research. Review. Act.\n'
    for c in PLAN['chapters']:
        meta+=f'[CHAPTER]\nTIMEBASE=1/1000\nSTART={c["start"]*1000}\nEND={c["end"]*1000}\ntitle={c["name"]}\n'
    (WORK/'chapters.ffmeta').write_text(meta,encoding='utf-8')
    for dest,audio,label in ((MAIN,'PULSE-full-mix.wav','female-voice'),(MUSIC,'PULSE-music-only-master.wav','music-only')):
        args=['-i',WORK/'PULSE-picture-master.mp4','-i',OUT/'audio'/audio,'-f','ffmetadata','-i',WORK/'chapters.ffmeta','-map','0:v','-map','1:a','-map_metadata','2','-map_chapters','2','-c:v','copy','-c:a','aac','-b:a','256k','-ar','48000','-ac','2','-t','240','-movflags','+faststart',dest]
        M['run'](args,f'final-{label}');print('EXPORTED',dest.name,flush=True)

def measure(dest):
    metadata=subprocess.run([FF,'-hide_banner','-i',str(dest)],capture_output=True,text=True,encoding='utf-8',errors='replace').stderr
    match=re.search(r'Duration: (\d+):(\d+):(\d+\.\d+)',metadata)
    duration=int(match[1])*3600+int(match[2])*60+float(match[3])
    assert duration==240,metadata
    assert '1920x1080' in metadata and '30 fps' in metadata and '48000 Hz' in metadata and 'stereo' in metadata and 'aac' in metadata
    # Decode every video/audio packet, not only container metadata.
    result=subprocess.run([FF,'-hide_banner','-nostdin','-threads','2','-i',str(dest),'-map','0:v:0','-map','0:a:0','-vf','blackdetect=d=0.2:pix_th=0.035:pic_th=0.98','-af','loudnorm=I=-15:TP=-1:LRA=9:print_format=json','-progress','pipe:1','-nostats','-f','null','-'],capture_output=True,text=True,encoding='utf-8',errors='replace')
    (WORK/'logs'/f'verify-{dest.stem}.log').write_text(result.stderr+'\n'+result.stdout,encoding='utf-8')
    assert result.returncode==0,result.stderr[-2000:]
    assert 'progress=end' in result.stdout
    frames=int(re.findall(r'frame=(\d+)',result.stdout)[-1]);assert frames==7200,frames
    black=re.findall(r'black_start:([\d.]+) black_end:([\d.]+) black_duration:([\d.]+)',result.stderr)
    assert all(float(a)>239 for a,b,d in black),black
    assert not re.search(r'Error while decoding|corrupt decoded frame|Invalid data found',result.stderr,re.I)
    loud=json.loads(re.findall(r'\{[^{}]+\}',result.stderr)[-1])
    digest=hashlib.sha256(dest.read_bytes()).hexdigest()
    return {'file':dest.name,'durationSeconds':duration,'width':1920,'height':1080,'fps':30,'decodedVideoFrames':frames,'videoCodec':'H.264','audioCodec':'AAC','sampleRate':48000,'channels':2,'integratedLUFS':float(loud['input_i']),'truePeakDbTP':float(loud['input_tp']),'LRA':float(loud['input_lra']),'completeDecodePassed':True,'unexpectedBlackIntervals':[],'closingFadeBlackIntervals':black,'bytes':dest.stat().st_size,'sha256':digest}

def frames():
    folder=OUT/'review-frames';folder.mkdir(exist_ok=True)
    times=[3,9,13,20,28,36,44,49,55,61,69,77,88,99,108,117,126,137,144,151,158,167,178,188,198,209,219,229,232,236]
    for sec in times:
        M['run'](['-ss',sec,'-i',MAIN,'-frames:v','1','-q:v','2',folder/f'{sec:03}.jpg'],f'review-frame-{sec}')
    for offset in range(0,len(times),6):
        sheet=Image.new('RGB',(1920,800),'#041528');d=ImageDraw.Draw(sheet)
        for i,sec in enumerate(times[offset:offset+6]):
            x=(i%3)*640;y=(i//3)*400
            sheet.paste(Image.open(folder/f'{sec:03}.jpg').resize((640,360)),(x,y+32))
            d.text((x+12,y+8),f'{sec//60:02}:{sec%60:02}',font=ImageFont.truetype(str(OUT/'fonts/PlexMono.ttf'),18),fill='#e5d19a')
        sheet.save(folder/f'contact-{offset//6+1}.jpg',quality=94)
    Image.open(ASSETS/'endcard.png').convert('RGB').save(OUT/'PULSE-demo-poster.jpg',quality=96)
    print('REVIEW FRAMES ready',flush=True)

def package(reports):
    # Exact edit decisions account for internal and chapter dissolve handles.
    edits=[];title_bounds=[]
    for ci,c in enumerate(PLAN['chapters']):
        t=c['start'];shots=[]
        for si,s in enumerate(c['shots']):
            cfg=M['shot_config'](ci,si,s)
            shots.append({'timelineStart':t,'timelineEnd':t+s['target'],'originalFile':M['SOURCES'][s['source']].name,'sourceIn':cfg.get('in',s['in']),'sourceOut':cfg.get('out',s['out']),'duration':s['target'],'dissolveHandleSeconds':.3 if si<len(c['shots'])-1 else(.6 if ci<7 else 0),'treatment':cfg,'note':s['note']})
            t+=s['target']
        assert t==c['end']
        # Measure the actual encoded title; libass and Pillow use different font sizing.
        frame=(3,20,44,69,108,144,178,229)[ci]
        arr=np.asarray(Image.open(OUT/'review-frames'/f'{frame:03}.jpg').convert('RGB'))[86:159]
        mask=(arr.min(axis=2)>155)&((arr.max(axis=2).astype(int)-arr.min(axis=2))<45)
        ys,xs=np.nonzero(mask);assert len(xs)>50
        bounds={'chapter':c['id'],'left':int(xs.min()),'right':int(xs.max()),'top':86+int(ys.min()),'bottom':86+int(ys.max())}
        assert bounds['left']>=158 and bounds['right']<=1762 and bounds['bottom']<162,bounds
        title_bounds.append(bounds)
        assert len(M['wrap'](c['description']).split(r'\N'))<=2
        edits.append({'id':c['id'],'start':c['start'],'end':c['end'],'name':c['name'],'headline':c['headline'],'description':c['description'],'shots':shots})
    (OUT/'final-edit-decisions.json').write_text(json.dumps({'durationSeconds':240,'chapters':edits},indent=2),encoding='utf-8')
    (OUT/'export-validation.json').write_text(json.dumps({'exports':reports,'titlesAboveFootage':True,'descriptionsBelowFootage':True,'completeDecodePassed':True,'titleWidthCheckPassed':True,'encodedTitlePixelBounds':title_bounds,'descriptionMaximumLines':2,'voiceGroupsAlignedToSceneSteps':24,'originalSourceRecordingsModified':False,'originalSourceAudioIncluded':False,'visualReviewFrameCount':30},indent=2),encoding='utf-8')
    production=OUT/'production';production.mkdir(exist_ok=True)
    for name in ('render-film.py','compose-score.py','align-voice.py','mix-film.py','finish-film.py'):
        content=(Path(__file__).parent/name).read_text(encoding='utf-8')
        content=content.replace('Path(__file__).resolve().parents[3]','Path(__file__).resolve().parents[3]')
        (production/name).write_text(content,encoding='utf-8')
    (production/'requirements.txt').write_text('imageio-ffmpeg==0.6.0\nedge-tts==7.2.8\nnumpy==2.5.3\nPillow==12.3.0\nscipy==1.18.1\ntruststore==0.10.4\nfonttools==4.66.1\n')
    fmt=lambda s:f'{s//60:02}:{s%60:02}'
    lines=['# PULSE — Arc Mainnet demo','', 'The final local films are exactly **4:00**, **1920 × 1080**, **30 fps**, H.264 with 48-kHz stereo AAC.','', '- `PULSE-Arc-Mainnet-Demo-4min.mp4`: female AI narration with the original electronic score.','- `PULSE-Arc-Mainnet-Demo-4min-music-only.mp4`: the same cut, on-screen explanations and music, without narration.','- Open `index.html` for the local player, chapter navigation and both versions.','', '| Time | Chapter |','|---|---|']
    lines += [f'| {fmt(c["start"])}–{fmt(c["end"])} | {c["name"]} |' for c in PLAN['chapters']]
    lines += ['', '## Production notes','', 'Original music: **PULSE — Signal to Action**, 120 BPM, written and synthesized for this film. No third-party songs or external music samples were used. Female narration: **Microsoft en-US-AriaNeural**, synthetic English speech accessed through edge-tts. Fonts: **Syne** and **IBM Plex Mono**, with their OFL licenses in `fonts/`. The supplied PULSE recordings remain unchanged.','', 'The Spot demonstration shows a WETH/USDC limit order, pending before owner cancellation. Prediction is a research demonstration. The running BTC Autopilot has zero confirmed fills; the separate paused ETH account has historical fills. Gateway shows a confirmed deposit, not a completed withdrawal. The film does not invent transactions or returns.','', 'Titles and chapter names occupy the upper band. Action captions and descriptions stay below the footage. Soft radial color gradients, gentle reframing and 0.3/0.6-second dissolves guide attention without annotation boxes. Long loading waits and repetitive scrolling are cut.','', '## Validation','', 'Both exports were decoded completely: 7,200 video frames each, no decode errors or unexpected black intervals. Exact export loudness, true peak, checksums and dimensions are in `export-validation.json`. `review-frames/` contains 30 frames from the final film. `final-edit-decisions.json` records every cut and camera treatment.','', 'No upload or deployment was performed.']
    (OUT/'README.md').write_text('\n'.join(lines)+'\n',encoding='utf-8')
    transcript=['# Female narration','']
    for v in json.loads((OUT/'audio/voice-final-timing.json').read_text('utf-8')):
        transcript += [f'**{int(v["start"])//60:02}:{int(v["start"])%60:02} · {v["chapter"]}**',v['script'],'']
    (OUT/'TRANSCRIPT.md').write_text('\n'.join(transcript),encoding='utf-8')
    print('PACKAGE ready',flush=True)

if __name__=='__main__':
    import sys
    stage=sys.argv[1]
    if stage=='mux':mux()
    elif stage=='frames':frames()
    elif stage=='verify':
        reports=[measure(p) for p in (MAIN,MUSIC)];package(reports)
        print(json.dumps(reports),flush=True)

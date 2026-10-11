"""Local PULSE film assembly. Originals are only read; every edit is reproducible."""
from pathlib import Path
import argparse, json, math, re, subprocess, time
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter
import imageio_ffmpeg

ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT / 'media/pulse-promo-production'
WORK = ROOT / '.tmp/pulse-promo/render'
ASSETS = WORK / 'assets'
FF = imageio_ffmpeg.get_ffmpeg_exe()
PLAN = json.loads((ROOT/'media/pulse-promo-plan/storyboard.json').read_text(encoding='utf-8'))
SOURCES = {s['id']: Path('C:/Users/maksim.shishkov/Downloads') / s['name'] for s in PLAN['sources']}
for p in (OUT, WORK, ASSETS, WORK/'shots', WORK/'chapters', WORK/'logs'):
    p.mkdir(parents=True, exist_ok=True)

def run(args, label):
    log = WORK/'logs'/f'{label}.log'
    with log.open('w', encoding='utf-8') as f:
        r = subprocess.run([FF, '-hide_banner', '-nostdin', '-y', *map(str,args)], cwd=WORK, stdout=f, stderr=f)
    if r.returncode:
        raise RuntimeError(f'{label}: '+log.read_text(encoding='utf-8')[-5000:])

def encoder():
    return ['-c:v','libx264','-preset','fast','-crf','18','-threads','4','-pix_fmt','yuv420p','-r','30','-video_track_timescale','15360','-an','-movflags','+faststart']

def rgb(hexcolor):
    return tuple(int(hexcolor[i:i+2],16) for i in (1,3,5))

def glow(w,h, cx,cy, sx,sy, color, alpha):
    y,x=np.ogrid[:h,:w]
    a=(np.exp(-.5*((x-cx)/sx)**2-.5*((y-cy)/sy)**2)*alpha).astype(np.uint8)
    arr=np.zeros((h,w,4),np.uint8);arr[:,:,:3]=color;arr[:,:,3]=a
    return Image.fromarray(arr)

def font(size, weight=400):
    return ImageFont.truetype(str(OUT/'fonts'/f'Syne-{weight}.ttf'),size)

def assets():
    from fontTools.ttLib import TTFont
    from fontTools.varLib.instancer import instantiateVariableFont
    for weight in (400,600,700):
        dest=OUT/'fonts'/f'Syne-{weight}.ttf'
        if not dest.exists():
            ft=instantiateVariableFont(TTFont(OUT/'fonts/Syne.ttf'),{'wght':weight},inplace=False)
            # Stable family names for libass; separate bold face maps through weight.
            for n in ft['name'].names:
                if n.nameID in (1,16): n.string='Syne'.encode(n.getEncoding())
                if n.nameID in (2,17): n.string=('Bold' if weight==700 else 'Regular').encode(n.getEncoding())
            ft.save(dest)
    rng=np.random.default_rng(81240)
    base=np.empty((1080,1920,4),np.uint8);base[:,:,:3]=[4,17,29];base[:,:,3]=255
    bg=Image.fromarray(base)
    bg=Image.alpha_composite(bg,glow(1920,1080,350,40,580,370,(49,105,122),45))
    bg=Image.alpha_composite(bg,glow(1920,1080,1620,1000,480,420,(104,87,45),26))
    noise=rng.integers(-2,3,(1080,1920,1),dtype=np.int16)
    arr=np.array(bg);arr[:,:,:3]=np.clip(arr[:,:,:3].astype(np.int16)+noise,0,255).astype(np.uint8)
    bg=Image.fromarray(arr);d=ImageDraw.Draw(bg)
    # Native brand mark, not a screen annotation.
    d.line([(160,58),(171,58),(176,51),(182,69),(188,47),(194,58),(204,58)],fill='#e5d19a',width=2)
    d.text((220,40),'P U L S E',font=font(25,700),fill='#eef6f8')
    mono=ImageFont.truetype(str(OUT/'fonts/PlexMono.ttf'),14)
    d.text((160,1045),'ARC MAINNET  /  PRODUCT DEMO',font=mono,fill='#829fae')
    right='INTELLIGENCE. EXECUTION. YOUR CONTROL.'
    d.text((1760-d.textlength(right,font=mono),1045),right,font=mono,fill='#829fae')
    d.line([(160,1077),(1760,1077)],fill=(46,76,88),width=2)
    bg.convert('RGB').save(ASSETS/'background.png')
    # Edge-to-edge light stroke, a moving chapter cue outside the footage.
    streak=glow(220,5,110,2,55,3,(229,209,154),200)
    streak.save(ASSETS/'streak.png')
    # Full-height safe wallet detail end card designed in PULSE's palette.
    end=bg.copy()
    end=Image.alpha_composite(end,glow(1920,1080,960,510,480,340,(100,185,202),42))
    end=Image.alpha_composite(end,glow(1920,1080,880,510,360,270,(223,202,137),21))
    ed=ImageDraw.Draw(end)
    for rr in (155,220,292):
        ed.ellipse((960-rr,375-rr*.46,960+rr,375+rr*.46),outline=(75,106,112,80),width=2)
    ed.line([(855,375),(885,375),(910,340),(947,424),(980,316),(1016,375),(1065,375)],fill='#e5d19a',width=5)
    def center(text,y,size,weight=400,color='#edf4f6'):
        f=font(size,weight);ed.text((960-ed.textlength(text,font=f)/2,y),text,font=f,fill=color)
    center('PULSE',468,96,700)
    center('Find your PULSE.',592,44,600)
    center('Signal when you need it. Proof when it matters.',667,29,400,'#b8d0da')
    center('www.ai-pulse.tech',772,43,600,'#e5d19a')
    end.convert('RGB').save(ASSETS/'endcard.png')
    # Soft colored pools. The underlying UI stays legible; no rectangular callouts.
    for ci,c in enumerate(PLAN['chapters']):
        for si in range(len(c['shots'])):
            cfg=shot_config(ci,si,c['shots'][si])
            fx,fy=cfg.get('focus',(.55,.6))
            im=glow(1600,766,fx*1600,fy*766,250,160,rgb(c['color']),cfg.get('alpha',20))
            im.save(ASSETS/f'glow-{ci}-{si}.png')
    write_ass()
    print('ASSETS ready',flush=True)

def shot_config(ci,si,shot):
    cfg={'zoom':(1.015,1.045),'center':(.5,.5),'focus':(.55,.58),'alpha':32}
    # Wider shots establish location; detail shots preserve the identity of each field.
    edits={
      (0,0):{'in':0.6,'out':1.3,'zoom':(1.02,1.055),'center':(.50,.48),'focus':(.67,.57)},
      (0,1):{'zoom':(1.12,1.19),'center':(.52,.64),'focus':(.58,.66)},
      (0,2):{'zoom':(1.05,1.11),'center':(.5,.60),'focus':(.5,.63)},
      (1,0):{'zoom':(1.16,1.22),'center':(.5,.50),'focus':(.66,.54)},
      (1,1):{'zoom':(1.17,1.23),'center':(.5,.57),'focus':(.50,.61)},
      (1,2):{'in':45.2,'out':47.0,'zoom':(1.06,1.09),'center':(.79,.50),'focus':(.86,.42)},
      (2,0):{'in':23.7,'out':24.85,'zoom':(1.03,1.065),'center':(.82,.52),'focus':(.87,.7)},
      (2,1):{'in':31.65,'out':32.5,'zoom':(1.025,1.075),'center':(.84,.48),'focus':(.83,.48),'alpha':10},
      (2,2):{'in':37.7,'out':38.7,'zoom':(1.02,1.07),'center':(.84,.49),'focus':(.83,.44),'alpha':10},
      (2,3):{'in':44.5,'out':47.5,'zoom':(1.04,1.10),'center':(.83,.48),'focus':(.88,.43)},
      (3,0):{'zoom':(1.02,1.08),'center':(.5,.55),'focus':(.52,.49)},
      (3,1):{'in':45.9,'out':49.7,'zoom':(1.22,1.34),'center':(.62,.6),'focus':(.66,.60)},
      (3,2):{'in':54.8,'out':55.7,'zoom':(1.06,1.12),'center':(.49,.52),'focus':(.62,.59)},
      (3,3):{'zoom':(1.20,1.26),'center':(.58,.62),'focus':(.60,.68)},
      (4,0):{'zoom':(1.06,1.12),'center':(.53,.59),'focus':(.51,.62)},
      (4,1):{'in':89.3,'out':92.6,'zoom':(1.52,1.60),'center':(.51,.60),'focus':(.55,.61),'alpha':14},
      (4,2):{'in':122.9,'out':123.85,'zoom':(1.18,1.25),'center':(.52,.61),'focus':(.5,.62)},
      (4,3):{'in':131.7,'out':134.65,'zoom':(1.17,1.22),'center':(.52,.64),'focus':(.52,.65)},
      (5,0):{'in':4.7,'out':8.3,'zoom':(1.14,1.20),'center':(.5,.5),'focus':(.50,.52)},
      (5,1):{'in':0.45,'out':1.65,'zoom':(1.16,1.23),'center':(.50,.58),'focus':(.40,.58)},
      (5,2):{'zoom':(1.20,1.29),'center':(.60,.59),'focus':(.66,.58)},
      (5,3):{'in':33.2,'out':39.9,'zoom':(1.06,1.12),'center':(.5,.53),'focus':(.64,.60)},
      (6,0):{'in':38.3,'out':39.35,'zoom':(1.18,1.25),'center':(.51,.60),'focus':(.51,.59)},
      (6,1):{'in':45.65,'out':47.1,'zoom':(1.22,1.30),'center':(.55,.62),'focus':(.57,.61)},
      (6,2):{'in':0.8,'out':1.5,'zoom':(1.18,1.24),'center':(.55,.59),'focus':(.67,.62)},
      (6,3):{'zoom':(1.30,1.38),'center':(.53,.49),'focus':(.54,.49)},
      (6,4):{'zoom':(1.26,1.32),'center':(.56,.6),'focus':(.58,.66),'alpha':12},
      (7,0):{'zoom':(1.05,1.10),'center':(.5,.47),'focus':(.52,.54)},
      (7,1):{'zoom':(1.01,1.04),'center':(.5,.52),'focus':(.49,.57)},
      (7,2):{'endcard':True}
    }
    cfg.update(edits.get((ci,si),{}));return cfg

def render_shot(ci,si,c):
    s=c['shots'][si];cfg=shot_config(ci,si,s)
    version=4 if (ci,si) in {(3,2),(4,2),(5,1),(6,0),(6,1),(6,2)} else 3 if ci==4 else 2
    dest=WORK/'shots'/f'v{version}-{ci:02}-{si:02}.mp4'
    if dest.exists() and dest.stat().st_size>10000: return dest
    duration=s['target']+(.3 if si<len(c['shots'])-1 else (.6 if ci<7 else 0))
    count=round(duration*30)
    if cfg.get('endcard'):
        # Last six seconds are a native branded invitation rather than another demo state.
        args=['-loop','1','-framerate','30','-i',ASSETS/'endcard.png','-vf','crop=1600:766:160:162','-t',duration,*encoder(),dest]
        run(args,f'shot-{ci}-{si}');return dest
    begin=cfg.get('in',s['in']);end=cfg.get('out',s['out'])
    length=end-begin
    # Slow real actions slightly, then use a readable moving hold. Never fabricate values.
    speed=min(1.6,s['target']/length)
    z0,z1=cfg['zoom'];cx,cy=cfg['center']
    z=f'{z0}+({z1-z0})*(0.5-0.5*cos(PI*min(on/{count-1},1)))'
    x=f'max(0,min(iw-iw/zoom,iw*{cx}-iw/zoom/2))'
    y=f'max(0,min(ih-ih/zoom,ih*{cy}-ih/zoom/2))'
    filt=(f"[0:v]crop=iw-2:ih-2:1:1,setpts={speed}*(PTS-STARTPTS),fps=30,tpad=stop_mode=clone:stop_duration={duration},"
          f"trim=duration={duration},zoompan=z='{z}':x='{x}':y='{y}':d=1:s=1600x766:fps=30,"
          f"setsar=1,settb=AVTB[v];[1:v]format=rgba[g];[v][g]overlay=0:0:shortest=1,format=yuv420p[out]")
    args=['-threads','2','-ss',begin,'-t',length,'-i',SOURCES[s['source']],'-loop','1','-framerate','30','-i',ASSETS/f'glow-{ci}-{si}.png',
          '-filter_complex_threads','2','-filter_complex',filt,'-map','[out]','-frames:v',count,*encoder(),dest]
    run(args,f'shot-{ci}-{si}')
    return dest

def render_chapter(ci):
    c=PLAN['chapters'][ci];version=4 if ci in (3,4,5,6) else 2
    dest=WORK/'chapters'/f'v{version}-{ci:02}-{c["id"]}.mp4'
    if dest.exists() and dest.stat().st_size>10000: print('REUSE',c['id'],flush=True);return dest
    paths=[]
    for si in range(len(c['shots'])):
        print('SHOT',c['id'],si+1,flush=True);paths.append(render_shot(ci,si,c))
    args=[]
    for p in paths:args+=['-threads','1','-i',p]
    filters=[f'[{i}:v]format=yuv444p,setpts=PTS-STARTPTS,settb=1/30,fps=30[v{i}]' for i in range(len(paths))]
    current='v0';offset=0
    for i in range(1,len(paths)):
        offset+=c['shots'][i-1]['target'];n=f'x{i}'
        filters.append(f'[{current}][v{i}]xfade=transition=fade:duration=0.3:offset={offset}[{n}tmp]')
        filters.append(f'[{n}tmp]fps=30[{n}]');current=n
    filters.append(f'[{current}]format=yuv420p[out]')
    length=c['end']-c['start']+(.6 if ci<7 else 0)
    args+=['-filter_complex_threads','2','-filter_complex',';'.join(filters),'-map','[out]','-t',length,*encoder(),dest]
    run(args,f'chapter-{ci}');print('CHAPTER ready',c['id'],flush=True);return dest

def ass_time(t):
    centis=round(t*100);return f'{centis//360000}:{centis//6000%60:02}:{centis//100%60:02}.{centis%100:02}'
def ass_color(c):
    r,g,b=rgb(c);return f'&H{b:02X}{g:02X}{r:02X}&'
def esc(s):return s.replace('\\','\\\\').replace('{','(').replace('}',')').replace('\n',r'\N')
def wrap(text,size=30,limit=1580,weight=400):
    f=font(size,weight);lines=[];line=''
    for word in text.split():
        test=(line+' '+word).strip()
        if f.getlength(test)>limit:lines.append(line);line=word
        else:line=test
    lines.append(line);return r'\N'.join(lines)

def write_ass(selected=None, sample=False):
    chapters=PLAN['chapters'] if selected is None else [PLAN['chapters'][i] for i in selected]
    text='''[Script Info]
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Title,Syne,64,&H00F6F4EE,&H00FFFFFF,&HFF000000,&HFF000000,-1,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1
Style: Label,IBM Plex Mono,22,&H00DAC878,&H00FFFFFF,&HFF000000,&HFF000000,0,0,0,0,100,100,1,0,1,0,0,9,0,0,0,1
Style: Beat,Syne,36,&H00E9F4F4,&H00FFFFFF,&HFF000000,&HFF000000,-1,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1
Style: Body,Syne,30,&H00DAD0B8,&H00FFFFFF,&HFF000000,&HFF000000,0,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1
Style: Callout,Syne,30,&H38F6F4EE,&H00FFFFFF,&H99000000,&H99000000,-1,0,0,0,100,100,0,0,1,0,1,7,0,0,0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
'''
    base=0
    def event(start,end,style,content,layer=0):
        nonlocal text
        text+=f'Dialogue: {layer},{ass_time(start)},{ass_time(end)},{style},,0,0,0,,{content}\n'
    for c in chapters:
        i=PLAN['chapters'].index(c);start=base if sample else c['start'];end=start+c['end']-c['start']
        end_text=min(end-.18,start+10) if i==7 else end-.18
        color=ass_color(c['color'])
        event(start+.12,end_text,'Title',r'{\pos(160,86)\fad(250,180)}'+esc(c['headline']))
        event(start+.12,end_text,'Label',r'{\pos(1760,50)\fad(250,180)\c'+color+'}'+f'{i+1:02} / '+esc(c['name'].upper()))
        event(start+.15,end_text,'Body',r'{\pos(160,994)\fad(250,150)}'+wrap(c['description']))
        for timecode,body in c['beats']:
            a,b=timecode.split('\u2013');clock=lambda x:int(x.split(':')[0])*60+int(x.split(':')[1])
            a=clock(a)-c['start']+start;b=clock(b)-c['start']+start
            b=min(b-.15,end_text)
            if b>a+.1:event(a+.15,b,'Beat',r'{\pos(160,947)\fad(200,130)\c'+color+'}'+esc(body))
        if i==2:
            event(start+6.5,start+17.5,'Callout',r'{\pos(310,692)\fad(400,300)}Review in your wallet.')
        if i==6:
            event(start+1.0,start+8.0,'Callout',r'{\pos(1530,650)\fad(400,350)}Your strategy.\NYour boundaries.')
        base=end
    p=ASSETS/('sample.ass' if sample else 'film.ass');p.write_text(text,encoding='utf-8')
    return p

def canvas_filters(footage, assfile, bgidx, streakidx, endidx=None):
    filters=[f'[{bgidx}:v]format=yuv420p,setsar=1[bg]',f'[bg][{footage}]overlay=160:162:shortest=1[placed]',
             f'[placed]subtitles=assets/{assfile.name}:fontsdir=../../../media/pulse-promo-production/fonts[typed]',
             f'[typed][{streakidx}:v]overlay=x=\'160+1600*t/240-110\':y=1076:shortest=1[light]']
    if endidx is not None:
        filters += [f'[{endidx}:v]format=rgba,fade=t=in:st=234:d=0.5:alpha=1[card]',
                    '[light][card]overlay=0:0:enable=\'gte(t,234)\':shortest=1,format=yuv420p,tpad=stop_mode=clone:stop_duration=0.2,trim=end_frame=7200,fade=t=out:st=239:d=1[out]']
    else:filters+=['[light]format=yuv420p[out]']
    return filters

def render_sample():
    paths=[render_chapter(i) for i in (0,2)];args=[]
    for p in paths:args+=['-threads','1','-i',p]
    for name in ('background.png','streak.png'):
        args+=['-loop','1','-framerate','30','-i',ASSETS/name]
    filt=['[0:v]trim=duration=16,setpts=PTS-STARTPTS[a]','[1:v]trim=duration=24,setpts=PTS-STARTPTS[b]',
          '[a][b]concat=n=2:v=1:a=0[foot]']
    ass=write_ass((0,2),sample=True)
    filt+=canvas_filters('foot',ass,2,3)
    args+=['-filter_complex_threads','2','-filter_complex',';'.join(filt),'-map','[out]','-t','40',*encoder(),WORK/'sample-picture.mp4']
    run(args,'sample-picture')
    print('SAMPLE PICTURE ready',flush=True)

def render_picture():
    paths=[render_chapter(i) for i in range(8)];args=[]
    for p in paths:args+=['-threads','1','-i',p]
    for name in ('background.png','streak.png','endcard.png'):
        args+=['-loop','1','-framerate','30','-i',ASSETS/name]
    filters=[f'[{i}:v]format=yuv444p,setpts=PTS-STARTPTS,settb=1/30,fps=30[v{i}]' for i in range(8)]
    cur='v0'
    for i in range(1,8):
        n=f'x{i}';filters.append(f'[{cur}][v{i}]xfade=transition=fade:duration=0.6:offset={PLAN["chapters"][i]["start"]}[{n}tmp]')
        filters.append(f'[{n}tmp]fps=30[{n}]');cur=n
    filters += canvas_filters(cur,ASSETS/'film.ass',8,9,10)
    args+=['-filter_complex_threads','2','-filter_complex',';'.join(filters),'-map','[out]','-t','240',*encoder(),WORK/'PULSE-picture-master.mp4']
    run(args,'picture-master');print('PICTURE MASTER ready',flush=True)

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('stage',choices=['assets','sample','chapters','picture']);a=p.parse_args()
    if a.stage=='assets':assets()
    elif a.stage=='sample':render_sample()
    elif a.stage=='chapters':
        for i in range(8):render_chapter(i)
    else:render_picture()

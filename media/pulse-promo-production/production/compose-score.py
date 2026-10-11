"""Original 120-BPM electronic score; no sampled songs or third-party music."""
from pathlib import Path
import numpy as np
from scipy import signal
from scipy.io import wavfile
import json
ROOT=Path('C:/Users/maksim.shishkov/ai-pulse/media/pulse-promo-production/audio')
ROOT.mkdir(parents=True,exist_ok=True)
SR=48000; DURATION=240; rng=np.random.default_rng(240810)
mix=np.zeros((SR*DURATION,2),dtype=np.float32)
def add(audio,start,gain=1.0,pan=0.0):
    pos=max(0,int(start*SR)); count=min(len(audio),len(mix)-pos)
    if count<=0:return
    audio=audio[:count]*gain
    mix[pos:pos+count,0]+=audio*np.sqrt((1-pan)/2)
    mix[pos:pos+count,1]+=audio*np.sqrt((1+pan)/2)
def hz(midi):return 440*2**((midi-69)/12)
def envelope(t,attack,release,total):
    return np.minimum(1,t/max(attack,.001))*np.minimum(1,np.maximum(0,total-t)/max(release,.001))
def note(midi,duration,kind='pluck'):
    t=np.arange(int(duration*SR),dtype=np.float32)/SR; f=hz(midi)
    if kind=='pad':
        wave=sum(np.sin(2*np.pi*f*2**(detune/1200)*t+phase) for detune,phase in [(-5,.0),(5,.4),(0,.2)])/3
        wave+=.15*np.sin(2*np.pi*f*2*t)
        return (wave*envelope(t,1.1,1.5,duration)*.065).astype(np.float32)
    if kind=='bass':
        wave=np.sin(2*np.pi*f*t)+.18*np.sin(2*np.pi*f*2*t)+.06*np.sin(2*np.pi*f*3*t)
        return (wave*envelope(t,.006,.085,duration)*np.exp(-t*1.3)*.35).astype(np.float32)
    wave=np.sin(2*np.pi*f*t)+.27*np.sin(2*np.pi*f*2.002*t)+.085*np.sin(2*np.pi*f*3*t)
    return (wave*envelope(t,.004,.09,duration)*np.exp(-t*4.3)*.14).astype(np.float32)
def filtered_noise(length,lo,hi):
    audio=rng.standard_normal(int(length*SR)).astype(np.float32)
    sos=signal.butter(2,[lo,hi],btype='bandpass',fs=SR,output='sos')
    return signal.sosfilt(sos,audio).astype(np.float32)
t=np.arange(int(.42*SR),dtype=np.float32)/SR
phase=2*np.pi*(48*t+(150-48)*.022*(1-np.exp(-t/.022)))
kick=(np.sin(phase)*np.exp(-t*13)+.13*np.sin(phase*1.96)*np.exp(-t*22)).astype(np.float32)
kick+=filtered_noise(.42,2000,6500)*np.exp(-t*380)*.24
t=np.arange(int(.25*SR),dtype=np.float32)/SR
clap_noise=filtered_noise(.25,1500,7000)
clap=(clap_noise*(np.exp(-t*33)+.5*np.exp(-np.maximum(0,t-.013)*38)*(t>.013)+.32*np.exp(-np.maximum(0,t-.027)*38)*(t>.027))+.10*np.sin(2*np.pi*185*t)*np.exp(-t*35)).astype(np.float32)
t=np.arange(int(.13*SR),dtype=np.float32)/SR
hat=(filtered_noise(.13,5000,12000)*np.exp(-t*70)*.6).astype(np.float32)
t=np.arange(int(.34*SR),dtype=np.float32)/SR
open_hat=(filtered_noise(.34,4500,11000)*np.exp(-t*16)*.40).astype(np.float32)
chords=[[50,53,57,60,64],[46,50,53,57,60],[48,53,57,60,64],[48,55,58,62,65]]
roots=[38,34,41,36];motifs=[[74,69,77,76,74,81,77,69],[70,65,74,72,70,77,74,65],[77,72,81,79,77,84,81,72],[74,67,79,77,74,82,79,67]]
def energy(second):
    if second<8:return .30
    if second<16:return .52
    if second<40:return .70
    if second<64:return .76
    if second<104:return .88
    if second<140:return 1.0
    if second<172:return .50
    if second<208:return 1.0
    if second<224:return .85
    if second<236:return .75
    return .30
for pos in range(0,DURATION,8):
    ci=(pos//8)%4
    e=energy(pos)
    for i,midi in enumerate(chords[ci]):add(note(midi,9,'pad'),pos,gain=.75+e*.55,pan=(-.7+i*.35))
    if pos%32==0:print(json.dumps({'scoreSeconds':pos,'duration':DURATION}),flush=True)
for bar in range(120):
    start=bar*2;e=energy(start);ci=(bar//4)%4
    if start>=236:continue
    for beat in range(4):
        at=start+beat*.5
        if start>=8 and (e>.6 or beat in [0,2]):add(kick,at,gain=.44*e)
        if start>=16 and beat in [1,3]:add(clap,at,gain=.20*e,pan=.12)
        if start>=8:
            add(hat,at+.25,gain=.24*e,pan=(-.38 if beat%2==0 else .38))
            if e>.8:add(hat,at+.125,gain=.085*e,pan=-.5)
            if e>.8 and beat==3:add(open_hat,at+.25,gain=.14*e,pan=.4)
    for step in [0,3,4,6,7]:
        if start>=8:
            midi=roots[ci]+(12 if step==7 and bar%2 else 0)
            add(note(midi,.27,'bass'),start+step*.25,gain=.56*e)
    for step in range(8):
        if e<.6 and step%2:continue
        midi=motifs[ci][(step+bar%4)%8]
        if 172<=start<208 and step in [2,6]:midi+=12
        gain=(.52 if start<64 else .67)*e
        pluck=note(midi,.68)
        pan=.48*np.sin(step*1.5+bar)
        add(pluck,start+step*.25,gain=gain,pan=pan)
        add(pluck,start+step*.25+.375,gain=gain*.31,pan=-pan)
        add(pluck,start+step*.25+.75,gain=gain*.16,pan=pan)
# Airy chapter lifts: gentle stereo sweeps, not abrupt impact sounds.
for boundary in [16,40,64,104,140,172,224]:
    seconds=1.65;t=np.arange(int(seconds*SR),dtype=np.float32)/SR
    sweep=filtered_noise(seconds,1000,7500)*(t/seconds)**2*envelope(t,.1,.1,seconds)*.035
    add(sweep,boundary-seconds,gain=1,pan=-.4);add(sweep,boundary-seconds+.07,gain=.65,pan=.6)
for midi,at in [(62,0),(69,.5),(74,1)]:add(note(midi,1.4),at,gain=.72,pan=0)
# A soft musical resolution beneath the final URL.
for i,midi in enumerate([50,57,62,65,69]):add(note(midi,6,'pad'),234,gain=1.1,pan=-.6+i*.3)
fade_in=np.minimum(1,np.arange(len(mix),dtype=np.float32)/(SR*.45))
fade_out=np.minimum(1,np.maximum(0,(len(mix)-1-np.arange(len(mix),dtype=np.float32)))/(SR*2.6))
mix*=fade_in[:,None]*fade_out[:,None]
mix=np.tanh(mix*1.12).astype(np.float32)
peak=float(np.max(np.abs(mix)));mix*=.79/max(peak,.001)
wavfile.write(ROOT/'PULSE-Signal-to-Action-original-score.wav',SR,(mix*32767).astype(np.int16))
preview=mix[SR*64:SR*88]
wavfile.write(ROOT/'score-audition.wav',SR,(preview*32767).astype(np.int16))
(ROOT/'music-credits.json').write_text(json.dumps({'title':'PULSE — Signal to Action','type':'Original instrumental electronic composition synthesized specifically for this promo','tempo':120,'duration':240,'sampleRate':SR,'externalMusicSamples':0,'structure':'Sparse hook, steady groove, research build, Spot lift, Prediction breakdown, Autopilot lift, resolved outro','seed':240810},indent=2)+'\n','utf-8')
print(json.dumps({'originalScoreSeconds':DURATION,'peak':round(float(np.max(np.abs(mix))),3),'file':'PULSE-Signal-to-Action-original-score.wav'}),flush=True)

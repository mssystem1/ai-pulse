from pathlib import Path
import json,re,subprocess
import numpy as np
from scipy.io import wavfile
from scipy.ndimage import maximum_filter1d,gaussian_filter1d
import imageio_ffmpeg
ROOT=Path(__file__).resolve().parents[3]
OUT=ROOT/'media/pulse-promo-production';AUDIO=OUT/'audio';WORK=ROOT/'.tmp/pulse-promo/render'
FF=imageio_ffmpeg.get_ffmpeg_exe();SR=48000;N=240*SR
timing=json.loads((AUDIO/'voice-final-timing.json').read_text('utf-8'))

def normalize(src,dest,label):
    measure=subprocess.run([FF,'-hide_banner','-nostdin','-i',str(src),'-af','loudnorm=I=-15:TP=-1:LRA=9:print_format=json','-f','null','-'],capture_output=True,encoding='utf-8')
    if measure.returncode:raise RuntimeError(measure.stderr[-1000:])
    stats=json.loads(re.findall(r'\{[^{}]+\}',measure.stderr)[-1])
    filt=('loudnorm=I=-15:TP=-1:LRA=9:linear=true:print_format=json:'+f'measured_I={stats["input_i"]}:measured_TP={stats["input_tp"]}:'+f'measured_LRA={stats["input_lra"]}:measured_thresh={stats["input_thresh"]}:offset={stats["target_offset"]}')
    p=subprocess.run([FF,'-hide_banner','-nostdin','-y','-i',str(src),'-af',filt,'-ar','48000','-ac','2','-c:a','pcm_s24le',str(dest)],capture_output=True,encoding='utf-8')
    if p.returncode:raise RuntimeError(p.stderr[-1000:])
    report=json.loads(re.findall(r'\{[^{}]+\}',p.stderr)[-1]);report['targetIntegratedLUFS']=-15;report['targetTruePeakDbTP']=-1
    (AUDIO/f'{label}-loudness.json').write_text(json.dumps(report,indent=2),'utf-8')
    print('NORMALIZED',label,report['output_i'],report['output_tp'],flush=True)

def main():
    voice=np.zeros((N,2),np.float32);segments=[]
    for v in timing:
        data=subprocess.run([FF,'-v','error','-nostdin','-i',v['file'],'-af','loudnorm=I=-16:TP=-2:LRA=8','-ar','48000','-ac','1','-f','f32le','-'],capture_output=True)
        if data.returncode:raise RuntimeError(data.stderr.decode())
        a=np.frombuffer(data.stdout,np.float32).copy();start=round(v['start']*SR);end=min(N,start+len(a))
        a=a[:end-start]
        # Equal-power center voice; original capture audio is never mixed in.
        voice[start:end]+=a[:,None]*.82
        segments.append({'chapter':v['chapter'],'start':v['start'],'end':end/SR,'rms':float(np.sqrt(np.mean(a*a))),'peak':float(np.max(np.abs(a)))})
    rate,music=wavfile.read(AUDIO/'PULSE-Signal-to-Action-original-score.wav');assert rate==SR
    music=music.astype(np.float32)/32768
    # Ten-millisecond activity detection with anticipation and a gentle release.
    blocks=np.max(np.abs(voice).reshape(-1,480,2),axis=(1,2))
    activity=(blocks>.006).astype(np.float32)
    activity=maximum_filter1d(activity,size=65,mode='constant')
    activity=gaussian_filter1d(activity,sigma=12)
    env=np.interp(np.arange(N)/480,np.arange(len(activity)),activity).astype(np.float32)
    duck=.52-(.52-.13)*env
    master=voice+music*duck[:,None]
    # Designed fade, after the final URL/narration lands.
    fade=np.ones(N,np.float32);fade[-SR:]=np.linspace(1,0,SR,dtype=np.float32)
    master*=fade[:,None]
    wavfile.write(WORK/'mix-premaster.wav',SR,master)
    wavfile.write(AUDIO/'PULSE-female-narration-stem.wav',SR,voice)
    normalize(WORK/'mix-premaster.wav',AUDIO/'PULSE-full-mix.wav','full-mix')
    normalize(AUDIO/'PULSE-Signal-to-Action-original-score.wav',AUDIO/'PULSE-music-only-master.wav','music-only')
    (AUDIO/'mix-report.json').write_text(json.dumps({'durationSeconds':240,'sampleRate':SR,'channels':2,'voice':segments,'musicGainBetweenVoice':.52,'musicGainUnderVoice':.13,'musicDuckDb':20*np.log10(.13/.52),'unprocessedPeak':float(np.max(np.abs(master))),'originalCaptureAudioIncluded':False},indent=2),'utf-8')
    # Audition uses the same finished mix: 16 seconds opening and 24 Gateway.
    p=subprocess.run([FF,'-hide_banner','-nostdin','-y','-i',str(WORK/'sample-picture.mp4'),'-i',str(AUDIO/'PULSE-full-mix.wav'),'-filter_complex','[1:a]asplit[a][b];[a]atrim=start=0:end=16,asetpts=PTS-STARTPTS[c];[b]atrim=start=40:end=64,asetpts=PTS-STARTPTS[d];[c][d]concat=n=2:v=0:a=1[out]','-map','0:v','-map','[out]','-c:v','copy','-c:a','aac','-b:a','256k','-t','40','-movflags','+faststart',str(OUT/'PULSE-production-sample.mp4')],capture_output=True,encoding='utf-8')
    if p.returncode:raise RuntimeError(p.stderr[-1500:])
    print('AUDIO and SAMPLE ready',flush=True)

if __name__=='__main__':main()

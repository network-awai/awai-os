import {writeFileSync} from 'node:fs';
import {encode,sampleRate} from './acoustic-code.mjs';
export function wav(samples){const b=Buffer.alloc(44+samples.length*2);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(sampleRate,24);b.writeUInt32LE(sampleRate*2,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(samples.length*2,40);samples.forEach((v,i)=>b.writeInt16LE(Math.round(Math.max(-1,Math.min(1,v))*32767),44+i*2));return b;}
export function ambient(){const s=new Float32Array(sampleRate*24);const chords=[[220,277.18,329.63,415.3],[174.61,220,261.63,329.63],[196,246.94,293.66,369.99]];for(let i=0;i<s.length;i++){const t=i/sampleRate,j=Math.min(2,Math.floor(t/8)),phase=t-j*8,env=Math.sin(Math.PI*phase/8)**2;for(const f of chords[j])s[i]+=0.008*env*Math.sin(2*Math.PI*f*t)*(0.85+0.15*Math.sin(t*0.5));}return s;}
if(process.argv[2]==='ambient')writeFileSync(process.argv[3],wav(ambient()));
// Let the output device settle before the synchronization preamble.
export function codeAudio(code){const tone=encode(code),s=new Float32Array(sampleRate+tone.length);s.set(tone,sampleRate);return s;}
if(process.argv[2]==='code')writeFileSync(process.argv[4],wav(codeAudio(process.argv[3])),{mode:0o600});

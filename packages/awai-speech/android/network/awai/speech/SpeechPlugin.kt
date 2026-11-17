package network.awai.speech

import android.Manifest
import android.app.Activity
import android.app.AlertDialog
import android.media.*
import android.os.SystemClock
import androidx.appcompat.app.AppCompatActivity
import app.tauri.PermissionState
import app.tauri.annotation.*
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.util.UUID
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.math.sqrt

/** Foreground local microphone/playback adapter. No URLs, files, provider changes or remote grants. */
@TauriPlugin(permissions=[Permission(strings=[Manifest.permission.RECORD_AUDIO],alias="microphone")])
class SpeechPlugin(private val owner:Activity):Plugin(owner){
 private val worker=Executors.newSingleThreadExecutor()
 private val busy=AtomicBoolean(false)
 private val cancelled=AtomicBoolean(true)
 private val epoch=java.util.concurrent.atomic.AtomicInteger(0)
 @Volatile private var token=""
 @Volatile private var until=0L
 private var boundBot=""
 private var boundSession=""
 @Volatile private var recorder:AudioRecord?=null
 @Volatile private var player:AudioTrack?=null
 private var listens=0
 private var speaks=0
 private var engine:SpeechEngine?=null
 private fun result()=JSObject().put("schema","awai.local-speech-result.v1").put("botId",boundBot).put("sessionId",boundSession)
 private fun active(t:String){check(t.isNotEmpty()&&t==token&&!cancelled.get()&&SystemClock.elapsedRealtime()<until){"speech-session-ended"}}
 private fun stop(){epoch.incrementAndGet();cancelled.set(true);token="";until=0;try{recorder?.stop()}catch(_:Exception){};try{player?.pause();player?.flush()}catch(_:Exception){}}
 override fun onPause(activity:AppCompatActivity){stop()}
 override fun onDestroy(activity:AppCompatActivity){stop();worker.execute{engine?.close();engine=null};worker.shutdown()}
 @Command fun operation(invoke:Invoke){
  val a=invoke.getArgs();val action=a.optString("action")
  if(action=="stop"){stop();invoke.resolve(result().put("stopped",true));return}
  if(action=="status"){invoke.resolve(result().put("available",true).put("active",token.isNotEmpty()&&!cancelled.get()&&SystemClock.elapsedRealtime()<until).put("remoteAudio",false));return}
  if(action=="begin"){
   if(a.keys().asSequence().toSet()!=setOf("action","botId","sessionId")||!a.optString("botId").matches(Regex("profile:[A-Za-z0-9_.-]+"))||!a.optString("sessionId").matches(Regex("[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}"))){invoke.reject("invalid-speech-scope");return}
   if(busy.get()||token.isNotEmpty()){invoke.reject("speech-busy");return}
   if(getPermissionState("microphone")!=PermissionState.GRANTED){requestPermissionForAlias("microphone",invoke,"microphoneResult");return}
   begin(invoke);return
  }
  val keys=if(action=="speak")setOf("action","token","text","botId","sessionId")else setOf("action","token","botId","sessionId")
  if(action !in setOf("listen","speak","probe")||a.keys().asSequence().toSet()!=keys){invoke.reject("unsupported-speech-operation");return}
  val t=a.optString("token")
  try{active(t);require(a.optString("botId")==boundBot&&a.optString("sessionId")==boundSession);if(!owner.hasWindowFocus())throw IllegalStateException("speech-not-foreground");if(action=="speak")require(a.opt("text") is String&&a.getString("text").isNotBlank()&&a.getString("text").length<=512)}catch(_:Exception){invoke.reject("speech-session-or-input-invalid");return}
  if(!busy.compareAndSet(false,true)){invoke.reject("speech-busy");return}
  worker.execute{
   val started=SystemClock.elapsedRealtime()
   try{
    active(t);val e=engine?:throw IllegalStateException("speech-unavailable")
    val out=when(action){
     "listen"->{check(++listens<=12);val samples=record(t);active(t);val asrAt=SystemClock.elapsedRealtime();val text=if(samples.isEmpty())"" else e.recognize(samples,16000);result().put("text",text).put("audioSamples",samples.size).put("sampleRate",16000).put("recognitionMs",SystemClock.elapsedRealtime()-asrAt)}
     "speak"->{check(++speaks<=24);val audio=e.synthesize(a.getString("text"));active(t);val synthesisMs=SystemClock.elapsedRealtime()-started;play(t,audio.samples,audio.sampleRate);result().put("samples",audio.samples.size).put("sampleRate",audio.sampleRate).put("synthesisMs",synthesisMs)}
     else->{check(++speaks<=24&&++listens<=12);val text="こんにちは。音声の確認です。";val audio=e.synthesize(text);val ttsMs=SystemClock.elapsedRealtime()-started;active(t);val asrAt=SystemClock.elapsedRealtime();val recognized=e.recognize(SpeechEngine.resample16k(audio.samples,audio.sampleRate),16000);result().put("syntheticAudio",true).put("microphoneTested",false).put("text",recognized).put("samples",audio.samples.size).put("sampleRate",audio.sampleRate).put("synthesisMs",ttsMs).put("recognitionMs",SystemClock.elapsedRealtime()-asrAt)}
    }
    active(t);out.put("elapsedMs",SystemClock.elapsedRealtime()-started);owner.runOnUiThread{invoke.resolve(out)}
   }catch(_:Exception){owner.runOnUiThread{invoke.reject(if(cancelled.get())"speech-session-ended"else"local-speech-unavailable")}}
    catch(_:LinkageError){stop();owner.runOnUiThread{invoke.reject("local-speech-engine-unavailable")}}
   finally{busy.set(false)}
  }
 }
 @PermissionCallback fun microphoneResult(invoke:Invoke){if(getPermissionState("microphone")==PermissionState.GRANTED)begin(invoke)else invoke.reject("microphone-denied")}
 private fun begin(invoke:Invoke){
  AlertDialog.Builder(owner).setTitle("音声会話を始める")
   .setMessage("マイクと読み上げを最大3分間、この端末で使います。音声は保存・送信しません。文字をBotに送る操作は、そのつど画面で確認します。")
   .setNegativeButton("キャンセル"){_,_->invoke.reject("speech-denied")}.setOnCancelListener{invoke.reject("speech-denied")}
   .setPositiveButton("始める"){_,_->
    if(!busy.compareAndSet(false,true)){invoke.reject("speech-busy");return@setPositiveButton}
    val expectedEpoch=epoch.get()
    worker.execute{try{engine?.close();engine=SpeechEngine(owner);engine!!.verify();check(epoch.get()==expectedEpoch&&owner.hasWindowFocus());listens=0;speaks=0;boundBot=invoke.getArgs().getString("botId");boundSession=invoke.getArgs().getString("sessionId");token=UUID.randomUUID().toString();until=SystemClock.elapsedRealtime()+180000;cancelled.set(false);val out=result().put("token",token).put("durationMs",180000).put("remoteAudio",false).put("modelSet","sensevoice-20240717-supertonic3-20260511-ja");owner.runOnUiThread{invoke.resolve(out)}}catch(_:Exception){stop();owner.runOnUiThread{invoke.reject("speech-models-unavailable")}}finally{busy.set(false)}}
   }.show()
 }
 private fun record(t:String):FloatArray{
  val rate=16000;val minimum=AudioRecord.getMinBufferSize(rate,AudioFormat.CHANNEL_IN_MONO,AudioFormat.ENCODING_PCM_16BIT);check(minimum>0)
  val rec=AudioRecord(MediaRecorder.AudioSource.VOICE_RECOGNITION,rate,AudioFormat.CHANNEL_IN_MONO,AudioFormat.ENCODING_PCM_16BIT,maxOf(minimum,rate*2));recorder=rec
  try{check(rec.state==AudioRecord.STATE_INITIALIZED);rec.startRecording();val chunks=ArrayList<FloatArray>();val frame=ShortArray(320);var heard=0;var silent=0;var total=0;var noise=0.002
   while(total<rate*20){active(t);val n=rec.read(frame,0,frame.size);check(n>0);val block=FloatArray(n){frame[it]/32768f};total+=n;val rms=sqrt(block.sumOf{it.toDouble()*it}/n)
    if(total<=rate*0.3)noise=maxOf(noise,rms)
    if(rms>maxOf(0.008,noise*3)){heard++;silent=0}else if(heard>0)silent++
    chunks.add(block);if(heard>=3&&silent>=30)break;if(heard==0&&total>=rate*6)return FloatArray(0)
   }
   if(heard<3)return FloatArray(0)
   val out=FloatArray(total);var at=0;for(b in chunks){b.copyInto(out,at);at+=b.size};return out
  }finally{try{rec.stop()}catch(_:Exception){};rec.release();recorder=null}
 }
 private fun play(t:String,samples:FloatArray,rate:Int){
  val minimum=AudioTrack.getMinBufferSize(rate,AudioFormat.CHANNEL_OUT_MONO,AudioFormat.ENCODING_PCM_FLOAT);check(minimum>0)
  val track=AudioTrack.Builder().setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ASSISTANT).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build())
   .setAudioFormat(AudioFormat.Builder().setEncoding(AudioFormat.ENCODING_PCM_FLOAT).setSampleRate(rate).setChannelMask(AudioFormat.CHANNEL_OUT_MONO).build())
   .setBufferSizeInBytes(maxOf(minimum,rate/5*4)).setTransferMode(AudioTrack.MODE_STREAM).build();player=track
  try{check(track.state==AudioTrack.STATE_INITIALIZED);track.play();var at=0;while(at<samples.size){active(t);val n=minOf(2048,samples.size-at);val b=FloatArray(n){samples[at+it].coerceIn(-1f,1f)};val written=track.write(b,0,n,AudioTrack.WRITE_BLOCKING);check(written>0);at+=written};while(track.playbackHeadPosition.toLong()<samples.size){active(t);Thread.sleep(10)}}finally{try{track.stop()}catch(_:Exception){};track.release();player=null}
 }
}

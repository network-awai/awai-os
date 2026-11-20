package network.awai.speech

import android.content.Context
import com.k2fsa.sherpa.onnx.*
import org.json.JSONObject
import java.io.File
import java.security.MessageDigest

/** Fixed local audio engines only. Conversation, remote consent and history stay in the browser. */
internal class SpeechEngine(private val context:Context) {
 private var recognizer:OfflineRecognizer?=null
 private var synthesizer:OfflineTts?=null
 private val root=File(context.filesDir,"speech-models")
 private fun model(name:String)=File(root,name).absolutePath
 fun verify(){
  val pins=JSONObject(context.assets.open("speech-pins.json").bufferedReader().use{it.readText()})
  require(pins.getString("schema")=="awai.local-speech-pins.v1")
  val rows=pins.getJSONArray("models");require(rows.length()==9)
  for(i in 0 until rows.length()){
   val p=rows.getJSONObject(i);val f=File(root,p.getString("file"))
   require(f.canonicalPath.startsWith(root.canonicalPath+File.separator)&&f.isFile&&f.length()==p.getLong("bytes")){"speech-model-missing"}
   val digest=MessageDigest.getInstance("SHA-256")
   f.inputStream().use{input->val b=ByteArray(1024*1024);while(true){val n=input.read(b);if(n<0)break;digest.update(b,0,n)}}
   require(digest.digest().joinToString(""){"%02x".format(it.toInt() and 255)}==p.getString("sha256")){"speech-model-digest-mismatch"}
  }
 }
 private fun asr():OfflineRecognizer {
  if(recognizer==null)recognizer=OfflineRecognizer(config=OfflineRecognizerConfig(modelConfig=OfflineModelConfig(
   senseVoice=OfflineSenseVoiceModelConfig(model=model("asr/model.int8.onnx"),language="ja",useInverseTextNormalization=true),
   tokens=model("asr/tokens.txt"),numThreads=4,provider="cpu",debug=false)))
  return recognizer!!
 }
 private fun tts():OfflineTts {
  if(synthesizer==null)synthesizer=OfflineTts(config=OfflineTtsConfig(model=OfflineTtsModelConfig(
   supertonic=OfflineTtsSupertonicModelConfig(durationPredictor=model("tts/duration_predictor.int8.onnx"),
    textEncoder=model("tts/text_encoder.int8.onnx"),vectorEstimator=model("tts/vector_estimator.int8.onnx"),
    vocoder=model("tts/vocoder.int8.onnx"),ttsJson=model("tts/tts.json"),
    unicodeIndexer=model("tts/unicode_indexer.bin"),voiceStyle=model("tts/voice.bin")),
   numThreads=4,provider="cpu",debug=false)))
  return synthesizer!!
 }
 fun recognize(samples:FloatArray,sampleRate:Int):String {
  require(sampleRate==16000&&samples.size in 1600..(16000*20)&&samples.all{it.isFinite()&&it in -1f..1f}){"invalid-speech-audio"}
  val engine=asr();val stream=engine.createStream()
  try{stream.acceptWaveform(samples,sampleRate);engine.decode(stream);return engine.getResult(stream).text.trim().take(2048)}finally{stream.release()}
 }
 fun synthesize(text:String):GeneratedAudio {
  require(text.isNotBlank()&&text.length<=512&&!text.contains('\u0000')){"invalid-speech-text"}
  val out=tts().generateWithConfig(text,GenerationConfig(sid=0,numSteps=5,extra=mapOf("lang" to "ja","speed" to "1.0")))
  require(out.sampleRate==44100&&out.samples.size in 1..(44100*90)&&out.samples.all{it.isFinite()}){"invalid-speech-output"}
  return out
 }
 fun close(){recognizer?.release();recognizer=null;synthesizer?.release();synthesizer=null}
 companion object {
  fun resample16k(samples:FloatArray,rate:Int):FloatArray {
   require(rate in 8000..192000&&samples.isNotEmpty()&&samples.size<=rate*90)
   return FloatArray((samples.size.toLong()*16000/rate).toInt()){i->
    val position=i.toDouble()*rate/16000;val a=position.toInt().coerceAtMost(samples.lastIndex)
    val b=(a+1).coerceAtMost(samples.lastIndex);(samples[a]+(samples[b]-samples[a])*(position-a)).toFloat().coerceIn(-1f,1f)
   }
  }
 }
}

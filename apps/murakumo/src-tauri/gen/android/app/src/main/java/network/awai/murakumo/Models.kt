package network.awai.murakumo
import android.app.ActivityManager
import android.content.Context
import android.net.Uri
import android.os.Build
import android.os.Process
import android.os.StatFs
import android.os.SystemClock
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.security.MessageDigest
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Text models from the pinned catalog (assets/catalog.json, AWAI-3203). Each file is admitted only
 * when its size and SHA-256 equal the catalog entry, at import and again at load. One text model is
 * loaded at a time; loading another releases the current one. No network: this app has no INTERNET
 * permission. Files arrive through the Android document picker, or from Murakumo Net
 * (network.awai.murakumo.net), which downloads them with the canonical broker's consent and hands each
 * file over through InferenceStatusProvider "admit". Both paths copy the file and admit it again by
 * size and SHA-256 before it becomes the model file.
 */
internal object Models {
 const val CONTEXT=2048
 val worker=Executors.newSingleThreadExecutor()
 val busy=AtomicBoolean(false)
 /**
  * The one running provider request, process-local. Another app learns about it only through
  * InferenceStatusProvider "cancel", and only when its own requestId matches; status and usage never
  * carry it, since busy/idle timing would tell a peer holding INTERNET when a PHI caller runs inference.
  */
 val running=RunningJob()
 @Volatile var loadedId:String?=null
 @Volatile var loadedSinceMs=0L
 @Volatile var loading:String?=null
 val loaded get()=loadedId!=null
 private var cpuSample=Pair(0L,0L)

 private fun pins(c:Context)=JSONObject(c.assets.open("pins.json").bufferedReader().use{it.readText()}).getJSONObject("model")
 fun catalog(c:Context):JSONArray=JSONObject(c.assets.open("catalog.json").bufferedReader().use{it.readText()}).getJSONArray("models")
 fun entry(c:Context,id:String):JSONObject{val m=catalog(c);for(i in 0 until m.length())if(m.getJSONObject(i).getString("id")==id)return m.getJSONObject(i);throw IllegalArgumentException("unknown-model")}
 private fun dir(c:Context)=File(c.filesDir,"models").apply{mkdirs()}
 fun file(c:Context,id:String)=File(dir(c),"$id.gguf")

 /** The single-model build stored the pinned 0.6B as models/qwen3.gguf. Keep it under its catalog id. */
 private fun migrate(c:Context){val old=File(dir(c),"qwen3.gguf");val id=pins(c).getString("id").let{if(it=="qwen3-0.6b-q8_0")it else null}?:return
  val target=file(c,id);if(old.isFile&&!target.exists())old.renameTo(target)}

 /**
  * Readiness. [forOtherApp]: the copy another app reads through InferenceStatusProvider (karute,
  * Murakumo Net …). It carries no live job state, since busy/idle timing would tell an app with
  * network access when a PHI caller runs inference (Dev review #430): busy and image progress are null.
  */
 fun status(c:Context,forOtherApp:Boolean=false):JSONObject{migrate(c);val models=JSONArray();val cat=catalog(c)
  for(i in 0 until cat.length()){val e=cat.getJSONObject(i);val f=file(c,e.getString("id"))
   models.put(JSONObject().put("id",e.getString("id")).put("imported",f.isFile&&f.length()==e.getLong("bytes")))}
  val label=loadedId?.let{entry(c,it).getString("label")}?:pins(c).getString("label")
  return JSONObject().put("schema","awai.inference.local.v1").put("engine","llama.cpp").put("model",label)
   .put("imported",models.let{m->(0 until m.length()).any{m.getJSONObject(it).getBoolean("imported")}})
   .put("loaded",loaded).put("loadedModel",loadedId?:JSONObject.NULL).put("loading",loading?:JSONObject.NULL)
   .put("context",CONTEXT).put("busy",if(forOtherApp)JSONObject.NULL else busy.get()).put("models",models).put("downloading",JSONObject.NULL)
   .put("modalities",JSONArray().put("text")).put("remote",false).put("image",ImageModels.status(c).apply{if(forOtherApp)put("progress",JSONObject.NULL)})}

 private fun digest(f:File):String{val d=MessageDigest.getInstance("SHA-256");f.inputStream().use{val b=ByteArray(1 shl 20);while(true){val n=it.read(b);if(n<0)break;d.update(b,0,n)}};return d.digest().joinToString(""){"%02x".format(it.toInt() and 255)}}
 private fun admit(f:File,e:JSONObject){require(f.length()==e.getLong("bytes")&&digest(f)==e.getString("sha256")){"model-digest-mismatch"}}

 fun import(c:Context,uri:Uri,id:String){val e=entry(c,id);check(loadedId!=id){"release-required"};val dest=file(c,id);val temp=File(dir(c),"$id.part");try{
  c.contentResolver.openInputStream(uri)!!.use{input->temp.outputStream().use{output->val b=ByteArray(1 shl 20);var bytes=0L;while(true){val n=input.read(b);if(n<0)break;bytes+=n;require(bytes<=e.getLong("bytes")){"model-size-limit"};output.write(b,0,n)}}}
  admit(temp,e);check(temp.renameTo(dest)){"model-store-failed"}
 }finally{if(temp.exists())temp.delete()}}


 fun load(c:Context,id:String){val e=entry(c,id);val f=file(c,id);loading=id;try{
  if(loadedId!=null){Engine.release();loadedId=null}
  admit(f,e);check(Engine.load(f.absolutePath)){"model-load-failed"};loadedId=id;loadedSinceMs=System.currentTimeMillis()
 }finally{loading=null}}

 fun generate(prompt:String,tokens:Int):String{require(prompt.isNotBlank()&&prompt.toByteArray(Charsets.UTF_8).size<=8192&&tokens in 1..256){"invalid-request"};check(loaded){"model-not-loaded"};val result=String(Engine.generate(prompt.toByteArray(Charsets.UTF_8),tokens),Charsets.UTF_8);check(result.isNotBlank()){"empty-result"};return result}
 fun release(){Engine.release();loadedId=null}

 /** Only the originating caller (or Murakumo itself) can cancel the active request. */
 fun cancelJob(requestId:String,caller:String?=null):Boolean{
  if(!requestId.matches(Regex("[a-f0-9-]{36}")))return false
  return running.cancel(requestId,caller){imageJob->
   if(imageJob)ImageModels.cancel()else Engine.cancel()
  }
 }

 /**
  * awai.murakumo.device-usage.v1 for this device. Android does not let apps read device-wide CPU
  * (/proc/stat is closed since Android 8), so cpu-percent is null (unknown) and app-cpu-percent is
  * this app's share of all cores since the previous reading. The engine is CPU-only: gpu-percent null.
  */
 /**
  * [forOtherApp]: Murakumo Net's copy (it holds INTERNET). Fixed schema, numbers and fixed enums only;
  * the only strings are the schema, "this-device", "android", Build.MODEL, a catalog model id and the
  * state. Anything that moves with a running job is withheld: the job state ("unknown" instead of
  * busy/idle), this app's CPU share and used RAM (the per-request context) are null, and the load
  * time is rounded down to the minute. test/release_check_test.py checks this function's shape.
  */
 @Synchronized fun usage(c:Context,forOtherApp:Boolean=false):JSONObject{
  val am=c.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager;val mi=ActivityManager.MemoryInfo();am.getMemoryInfo(mi)
  val fs=StatFs(c.filesDir.absolutePath)
  val now=Pair(Process.getElapsedCpuTime(),SystemClock.elapsedRealtime());val prev=cpuSample;if(!forOtherApp)cpuSample=now
  val wall=(now.second-prev.second)*Runtime.getRuntime().availableProcessors()
  val appCpu=if(prev.second>0&&wall>0)((now.first-prev.first)*100/wall).coerceIn(0,100) else null
  val minute=60000L;val coarse={ms:Long->if(forOtherApp)ms/minute*minute else ms}
  val loadedJson=loadedId?.let{JSONObject().put("model",it).put("context",CONTEXT).put("state",if(forOtherApp)"unknown" else if(busy.get())"busy" else "idle").put("since-ms",coarse(loadedSinceMs))}
   ?:loading?.let{JSONObject().put("model",it).put("context",CONTEXT).put("state","loading").put("since-ms",coarse(System.currentTimeMillis()))}
  return JSONObject().put("schema","awai.murakumo.device-usage.v1").put("device","this-device").put("kind","android")
   .put("model-name",Build.MODEL).put("observed-at-ms",System.currentTimeMillis())
   .put("ram",JSONObject().put("total",mi.totalMem).put("used",if(forOtherApp)JSONObject.NULL else mi.totalMem-mi.availMem))
   .put("cpu-percent",JSONObject.NULL).put("app-cpu-percent",if(forOtherApp)JSONObject.NULL else appCpu?:JSONObject.NULL).put("gpu-percent",JSONObject.NULL)
   .put("disk",JSONObject().put("free",fs.availableBytes).put("total",fs.totalBytes))
   .put("loaded",loadedJson?:JSONObject.NULL)}

 /**
  * Callers whose prompts may be PHI (medical records). For them the confirmation shows only the length
  * and category, never the text, and the image modality is refused until its PNG/JSON files have a
  * deletion and retention rule (Murakumo privacy review §4 item 8).
  */
 val phiCallers=setOf("network.itonami.karute")
 /** Murakumo Net: downloads and device-usage reads live there, so this app needs no INTERNET. */
 const val NET_PACKAGE="network.awai.murakumo.net"
 fun netCaller(c:Context,caller:String?):Boolean=caller==NET_PACKAGE&&c.packageManager.checkSignatures(c.packageName,caller)==android.content.pm.PackageManager.SIGNATURE_MATCH
 fun trustedCaller(c:Context,caller:String?):Boolean {
  val allowed=setOf("network.itonami.app","network.itonami.gaka","network.awai.gaka","network.itonami.dougaka","network.itonami.dougaka.preview","network.itonami.mangaka","network.itonami.animeka","network.itonami.ongakuka","network.itonami.rodo","network.itonami.karute")
  return caller in allowed && c.packageManager.checkSignatures(c.packageName,caller!!)==android.content.pm.PackageManager.SIGNATURE_MATCH
 }
}

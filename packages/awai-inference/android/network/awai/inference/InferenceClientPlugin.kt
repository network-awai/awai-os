package network.awai.inference
import android.app.Activity
import android.content.Intent
import android.content.ComponentName
import android.net.Uri
import android.content.pm.PackageManager
import android.content.pm.PermissionInfo
import androidx.activity.result.ActivityResult
import app.tauri.annotation.Command
import app.tauri.annotation.ActivityCallback
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Plugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import java.util.concurrent.atomic.AtomicReference

@TauriPlugin
class InferenceClientPlugin(private val owner:Activity):Plugin(owner){
 private val provider="network.awai.murakumo"
 // The request this app opened a provider Activity for. Only this exact id may reach the provider's
 // cancel. Its presence also holds the busy slot until the Activity returns.
 private val running=AtomicReference<String?>(null)
 private fun available():Boolean=try{
  val pm=owner.packageManager;pm.getPackageInfo(provider,0)
  val p=pm.getPermissionInfo("network.awai.permission.LOCAL_INFERENCE",0)
  p.packageName==provider && (p.protectionLevel and PermissionInfo.PROTECTION_MASK_BASE)==PermissionInfo.PROTECTION_SIGNATURE && pm.checkSignatures(owner.packageName,provider)==PackageManager.SIGNATURE_MATCH
 }catch(e:Exception){false}
 @Command fun operation(invoke:Invoke){val a=invoke.getArgs();val action=a.optString("action")
  if(a.has("conversation")){try{require(a.optJSONObject("conversation")!=null);checkScope(a.getJSONObject("conversation"))}catch(e:Exception){invoke.reject("invalid-conversation-scope");return}}
  if(action=="readImage"){try{invoke.resolve(readImage(a.optString("imageId"),a.optJSONObject("conversation")))}catch(e:Exception){invoke.reject("image-unavailable-or-scope-mismatch")};return}
  if(action=="saveImage"){saveImage(invoke,a.optString("imageId"));return}
  if(action=="info"){
   val info=JSObject().put("schema","awai.inference.client.v1").put("installed",available()).put("provider",provider).put("modalities",org.json.JSONArray().put("text")).put("remote",false)
   if(available())try{val status=owner.contentResolver.call(Uri.parse("content://$provider.engine"),"status",null,null)?.getString("status");if(status!=null){val st=org.json.JSONObject(status);info.put("status",st);if(st.optJSONObject("image")?.optBoolean("imported")==true)info.put("modalities",org.json.JSONArray().put("text").put("image"))}}catch(e:Exception){info.put("statusUnavailable",true)}
   invoke.resolve(info);return
  }
  if(action=="cancel"){cancel(invoke,a.optString("requestId"));return}
  if(!available()){invoke.reject("local-inference-unavailable");return}
  if(action=="open"){owner.startActivity(Intent().setComponent(ComponentName(provider,"$provider.MainActivity")));invoke.resolve(JSObject().put("opened",true));return}
  if(action!="generate"||a.optString("schema")!="awai.inference.request.v1"||a.optString("modality") !in setOf("text","image")){invoke.reject("unsupported-request");return}
  val prompt=a.optString("prompt");val id=a.optString("requestId");val raw=a.opt("maxTokens")
  if(prompt.isBlank()||prompt.toByteArray(Charsets.UTF_8).size>8192||!id.matches(Regex("[a-f0-9-]{36}"))||raw !is Number||raw.toDouble()%1!=0.0||raw.toInt() !in 1..256){invoke.reject("invalid-request");return}
  if(!running.compareAndSet(null,id)){invoke.reject("busy");return}
  try{startActivityForResult(invoke,Intent().setComponent(ComponentName(provider,"$provider.InferenceRequestActivity")).putExtra("schema","awai.inference.request.v1").putExtra("modality",a.optString("modality")).putExtra("prompt",prompt).putExtra("maxTokens",raw.toInt()).putExtra("requestId",id),"generated")}catch(e:Exception){running.set(null);invoke.reject("provider-unavailable")}
 }
 /** Forward a cancel to the provider only for the request this app is running; otherwise no side effect. */
 private fun cancel(invoke:Invoke,id:String){
  if(!id.matches(Regex("[a-f0-9-]{36}"))){invoke.reject("invalid-request");return}
  if(running.get()!=id||!available()){invoke.resolve(JSObject().put("cancelled",false).put("reason","not-running"));return}
  val cancelled=try{owner.contentResolver.call(Uri.parse("content://$provider.engine"),"cancel",id,null)?.getBoolean("cancelled")==true}catch(e:Exception){false}
  if(cancelled)invoke.resolve(JSObject().put("cancelled",true))else invoke.resolve(JSObject().put("cancelled",false).put("reason","not-running"))
 }
 @ActivityCallback fun generated(invoke:Invoke,result:ActivityResult){running.set(null);val data=result.data
  if(result.resultCode!=Activity.RESULT_OK||data==null){invoke.reject(if(data?.getStringExtra("error")=="cancelled")"inference-cancelled" else "inference-denied-or-unavailable");return}
  if(invoke.getArgs().optString("modality")=="image"){try{receiveImage(invoke,data)}catch(e:Exception){invoke.reject("invalid-provider-image")};return}
  val text=data.getStringExtra("text")?:"";val id=invoke.getArgs().optString("requestId")
  if(data.getStringExtra("schema")!="awai.inference.result.v1"||data.getStringExtra("requestId")!=id||data.getStringExtra("modality")!="text"||data.getStringExtra("engine")!="llama.cpp"||text.toByteArray(Charsets.UTF_8).size>65536){invoke.reject("invalid-provider-result");return}
  val tokens=data.getIntExtra("outputTokens",-1)
  if(tokens !in 0..256){invoke.reject("invalid-provider-counter");return}
  invoke.resolve(JSObject().put("schema","awai.inference.result.v1").put("requestId",id).put("modality","text").put("engine","llama.cpp").put("text",text).put("outputTokens",tokens))
 }
 private fun imageFile(id:String):java.io.File {require(id.matches(Regex("[a-f0-9-]{36}")));return java.io.File(owner.filesDir,"generated-images/$id.png")}
 private fun digest(bytes:ByteArray)=java.security.MessageDigest.getInstance("SHA-256").digest(bytes).joinToString(""){"%02x".format(it.toInt()and 255)}
 private fun receiveImage(invoke:Invoke,data:Intent){
  val id=invoke.getArgs().getString("requestId");require(data.getStringExtra("schema")=="awai.inference.result.v1"&&data.getStringExtra("requestId")==id&&data.getStringExtra("modality")=="image"&&data.getStringExtra("engine")=="stable-diffusion.cpp")
  val uri=data.data!!;require(uri.scheme=="content"&&uri.authority==provider+".fileprovider")
  val meta=org.json.JSONObject(data.getStringExtra("image")!!);require(meta.getString("uri")==uri.toString()&&meta.getInt("width")==512&&meta.getInt("height")==512&&meta.getString("modelSet")=="qwen-image-2.1-turbo-uncensored-ad-q2-k")
  val bytes=owner.contentResolver.openInputStream(uri)!!.use{input->val b=input.readNBytes(4194305);require(b.size in 1..4194304);b}
  require(bytes.size.toLong()==meta.getLong("bytes")&&digest(bytes)==meta.getString("sha256"))
  val bounds=android.graphics.BitmapFactory.Options().apply{inJustDecodeBounds=true};android.graphics.BitmapFactory.decodeByteArray(bytes,0,bytes.size,bounds);require(bounds.outWidth==512&&bounds.outHeight==512&&bounds.outMimeType=="image/png")
  val f=imageFile(id);f.parentFile!!.mkdirs();check(f.createNewFile());f.outputStream().use{it.write(bytes)};require(digest(f.readBytes())==meta.getString("sha256"))
  val scope=invoke.getArgs().optJSONObject("conversation");checkScope(scope)
  val receipt=org.json.JSONObject().put("schema","awai.local-image-file.v1").put("imageId",id).put("sha256",meta.getString("sha256")).put("bytes",bytes.size).put("scope",scope?:org.json.JSONObject.NULL)
  val record=java.io.File(f.parentFile,"$id.json");check(record.createNewFile());record.writeText(receipt.toString())
  invoke.resolve(imageResponse(id,bytes,meta.getString("sha256")))
 }
 private fun checkScope(scope:org.json.JSONObject?){if(scope==null)return;require(scope.keys().asSequence().toSet()==setOf("botId","sessionId"));require(scope.getString("botId").matches(Regex("profile:[A-Za-z0-9_.-]+"))&&scope.getString("sessionId").matches(Regex("[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}")))}
 private fun imageResponse(id:String,bytes:ByteArray,hash:String)=JSObject().put("schema","awai.inference.result.v1").put("requestId",id).put("modality","image").put("engine","stable-diffusion.cpp").put("modelSet","qwen-image-2.1-turbo-uncensored-ad-q2-k").put("imageId",id).put("width",512).put("height",512).put("sha256",hash).put("bytes",bytes.size).put("dataUrl","data:image/png;base64,"+android.util.Base64.encodeToString(bytes,android.util.Base64.NO_WRAP))
 private fun readImage(id:String,wanted:org.json.JSONObject?):JSObject{
  checkScope(wanted);val f=imageFile(id);require(f.isFile&&f.length() in 1..4194304);val record=java.io.File(f.parentFile,"$id.json");require(record.isFile&&record.length() in 1..4096);val m=org.json.JSONObject(record.readText());require(m.getString("schema")=="awai.local-image-file.v1"&&m.getString("imageId")==id)
  val actual=m.optJSONObject("scope");require((wanted==null&&actual==null)||(wanted!=null&&actual!=null&&wanted.getString("botId")==actual.getString("botId")&&wanted.getString("sessionId")==actual.getString("sessionId")))
  val b=f.readBytes();val hash=digest(b);require(hash==m.getString("sha256")&&b.size==m.getInt("bytes"));return imageResponse(id,b,hash)
 }
 private fun saveImage(invoke:Invoke,id:String){
  // This dialog is the only approval point for saving on Android, so the destination, name, size and
  // digest are fixed before it opens. The bytes shown are the bytes written, and the readback below
  // checks them again; nothing is re-read or re-digested between approval and write.
  val bytes:ByteArray;val hash:String;val width:Int;val height:Int
  try{val f=imageFile(id).also{require(it.isFile&&it.length() in 1..4194304)};bytes=f.readBytes();hash=digest(bytes)
   val bounds=android.graphics.BitmapFactory.Options().apply{inJustDecodeBounds=true};android.graphics.BitmapFactory.decodeByteArray(bytes,0,bytes.size,bounds)
   require(bounds.outWidth==512&&bounds.outHeight==512&&bounds.outMimeType=="image/png");width=bounds.outWidth;height=bounds.outHeight
  }catch(e:Exception){invoke.reject("unknown-image");return}
  android.app.AlertDialog.Builder(owner).setTitle("画像を保存")
   .setMessage("保存先: Pictures/Awai（この端末。外部へ送信しません）\nファイル名: awai-$id.png\n画像: ${width}×${height} PNG\nサイズ: %,d バイト\nSHA-256: $hash".format(bytes.size))
   .setNegativeButton("キャンセル"){_,_->invoke.reject("denied")}.setOnCancelListener{invoke.reject("denied")}.setPositiveButton("保存する"){_,_->
    var uri:Uri?=null
    try{val values=android.content.ContentValues().apply{put(android.provider.MediaStore.Images.Media.DISPLAY_NAME,"awai-$id.png");put(android.provider.MediaStore.Images.Media.MIME_TYPE,"image/png");put(android.provider.MediaStore.Images.Media.RELATIVE_PATH,"Pictures/Awai");put(android.provider.MediaStore.Images.Media.IS_PENDING,1)}
     uri=owner.contentResolver.insert(android.provider.MediaStore.Images.Media.EXTERNAL_CONTENT_URI,values)!!;owner.contentResolver.openOutputStream(uri!!)!!.use{it.write(bytes)}
     val read=owner.contentResolver.openInputStream(uri!!)!!.use{it.readNBytes(4194305)};require(read.size==bytes.size&&digest(read)==hash){"save-readback-mismatch"}
     owner.contentResolver.update(uri!!,android.content.ContentValues().apply{put(android.provider.MediaStore.Images.Media.IS_PENDING,0)},null,null)
     invoke.resolve(JSObject().put("saved",true).put("uri",uri.toString()).put("sha256",hash).put("bytes",bytes.size).put("readbackVerified",true))
    }catch(e:Exception){invoke.reject("image-save-failed")}
   }.show()
 }

}

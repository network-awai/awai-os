package network.awai.murakumo
import android.app.Activity
import android.content.Intent
import android.webkit.WebView
import androidx.activity.result.ActivityResult
import app.tauri.annotation.Command
import app.tauri.annotation.ActivityCallback
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Plugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject

@TauriPlugin
class InferencePlugin(private val owner:Activity):Plugin(owner){
 @Volatile private var importing:String?=null
 @Command fun operation(invoke:Invoke){
  val args=invoke.getArgs();val action=args.optString("action")
  if(action=="status"){invoke.resolve(JSObject(Models.status(owner).toString()));return}
  // Read-only: the pinned catalog and this device's usage (AWAI-3203 stage 4a).
  if(action=="catalog"){invoke.resolve(JSObject(org.json.JSONObject(owner.assets.open("catalog.json").bufferedReader().use{it.readText()}).toString()));return}
  if(action=="usage"){invoke.resolve(JSObject(Models.usage(owner).toString()));return}
  // Host-stream downloads (AWAI-3307): called only by the Rust bridge's model_download_* commands.
  if(action in setOf("download-begin","download-finish","download-abort")){val id=args.optString("model")
   Models.worker.execute{try{val r=when(action){"download-begin"->Models.downloadBegin(owner,id);"download-finish"->{Models.downloadFinish(owner,id);Models.status(owner)};else->{Models.downloadAbort(owner,id);org.json.JSONObject().put("aborted",true)}}
    invoke.resolve(JSObject(r.toString()))}catch(e:Exception){invoke.reject(ErrorCodes.of(e,"model-download-rejected"))}};return}
  if(action=="cancel"){Engine.cancel();invoke.resolve(JSObject().put("cancelRequested",true));return}
  if(action !in setOf("import","load","generate","release")){invoke.reject("unknown-operation");return}
  if(!Models.busy.compareAndSet(false,true)){invoke.reject("busy");return}
  if(action=="import"){
   val id=args.optString("model");try{Models.entry(owner,id)}catch(e:Exception){Models.busy.set(false);invoke.reject("unknown-model");return}
   if(Models.loadedId==id){Models.busy.set(false);invoke.reject("release-required");return}
   importing=id
   try{startActivityForResult(invoke,Intent(Intent.ACTION_OPEN_DOCUMENT).setType("*/*").addCategory(Intent.CATEGORY_OPENABLE),"importResult")}catch(e:Exception){Models.busy.set(false);invoke.reject("file-picker-unavailable")};return
  }
  if(action=="generate")Engine.prepare()
  Models.worker.execute{try{
   val result=when(action){"load"->{Models.load(owner,args.optString("model"));JSObject(Models.status(owner).toString())};"release"->{Models.release();JSObject(Models.status(owner).toString())};else->{val prompt=args.optString("prompt");val count=args.optInt("maxTokens",128);require(args.optString("modality","text")=="text"){"unsupported-modality"};JSObject().put("text",Models.generate(prompt,count)).put("outputTokens",Engine.tokens()).put("engine","llama.cpp").put("modality","text")}}
   invoke.resolve(result)
  }catch(e:Exception){invoke.reject(ErrorCodes.of(e,"inference-failed"))}finally{Models.busy.set(false)}}
 }
 @ActivityCallback fun importResult(invoke:Invoke,result:ActivityResult){
  if(result.resultCode!=Activity.RESULT_OK||result.data?.data==null){Models.busy.set(false);invoke.reject("cancelled");return}
  val uri=result.data!!.data!!;val id=importing?:run{Models.busy.set(false);invoke.reject("unknown-model");return}
  Models.worker.execute{try{Models.import(owner,uri,id);invoke.resolve(JSObject(Models.status(owner).toString()))}catch(e:Exception){invoke.reject("model-import-rejected")}finally{Models.busy.set(false)}}
 }
}

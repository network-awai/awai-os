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
 @Command fun operation(invoke:Invoke){
  val args=invoke.getArgs();val action=args.optString("action")
  if(action=="status"){invoke.resolve(JSObject(Models.status(owner).toString()));return}
  if(action=="cancel"){Engine.cancel();invoke.resolve(JSObject().put("cancelRequested",true));return}
  if(action !in setOf("import","load","generate","release")){invoke.reject("unknown-operation");return}
  if(!Models.busy.compareAndSet(false,true)){invoke.reject("busy");return}
  if(action=="import"){
   if(Models.loaded){Models.busy.set(false);invoke.reject("release-required");return}
   try{startActivityForResult(invoke,Intent(Intent.ACTION_OPEN_DOCUMENT).setType("*/*").addCategory(Intent.CATEGORY_OPENABLE),"importResult")}catch(e:Exception){Models.busy.set(false);invoke.reject("file-picker-unavailable")};return
  }
  if(action=="generate")Engine.prepare()
  Models.worker.execute{try{
   val result=when(action){"load"->{Models.load(owner);JSObject(Models.status(owner).toString())};"release"->{Models.release();JSObject(Models.status(owner).toString())};else->{val prompt=args.optString("prompt");val count=args.optInt("maxTokens",128);require(args.optString("modality","text")=="text"){"unsupported-modality"};JSObject().put("text",Models.generate(prompt,count)).put("outputTokens",Engine.tokens()).put("engine","llama.cpp").put("modality","text")}}
   invoke.resolve(result)
  }catch(e:Exception){invoke.reject(e.message?.takeIf{it.matches(Regex("[a-z-]{1,60}"))}?:"inference-failed")}finally{Models.busy.set(false)}}
 }
 @ActivityCallback fun importResult(invoke:Invoke,result:ActivityResult){
  if(result.resultCode!=Activity.RESULT_OK||result.data?.data==null){Models.busy.set(false);invoke.reject("cancelled");return}
  val uri=result.data!!.data!!
  Models.worker.execute{try{Models.import(owner,uri);invoke.resolve(JSObject(Models.status(owner).toString()))}catch(e:Exception){invoke.reject("model-import-rejected")}finally{Models.busy.set(false)}}
 }
}

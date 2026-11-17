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
import java.util.concurrent.atomic.AtomicBoolean

@TauriPlugin
class InferenceClientPlugin(private val owner:Activity):Plugin(owner){
 private val provider="network.awai.murakumo"
 private val busy=AtomicBoolean(false)
 private fun available():Boolean=try{
  val pm=owner.packageManager;pm.getPackageInfo(provider,0)
  val p=pm.getPermissionInfo("network.awai.permission.LOCAL_INFERENCE",0)
  p.packageName==provider && (p.protectionLevel and PermissionInfo.PROTECTION_MASK_BASE)==PermissionInfo.PROTECTION_SIGNATURE && pm.checkSignatures(owner.packageName,provider)==PackageManager.SIGNATURE_MATCH
 }catch(e:Exception){false}
 @Command fun operation(invoke:Invoke){val a=invoke.getArgs();val action=a.optString("action")
  if(action=="info"){
   val info=JSObject().put("schema","awai.inference.client.v1").put("installed",available()).put("provider",provider).put("modalities",org.json.JSONArray().put("text")).put("remote",false)
   if(available())try{val status=owner.contentResolver.call(Uri.parse("content://$provider.engine"),"status",null,null)?.getString("status");if(status!=null)info.put("status",org.json.JSONObject(status))}catch(e:Exception){info.put("statusUnavailable",true)}
   invoke.resolve(info);return
  }
  if(!available()){invoke.reject("local-inference-unavailable");return}
  if(action=="open"){owner.startActivity(Intent().setComponent(ComponentName(provider,"$provider.MainActivity")));invoke.resolve(JSObject().put("opened",true));return}
  if(action!="generate"||a.optString("schema")!="awai.inference.request.v1"||a.optString("modality")!="text"){invoke.reject("unsupported-request");return}
  val prompt=a.optString("prompt");val id=a.optString("requestId");val raw=a.opt("maxTokens")
  if(prompt.isBlank()||prompt.toByteArray(Charsets.UTF_8).size>8192||!id.matches(Regex("[a-f0-9-]{36}"))||raw !is Number||raw.toDouble()%1!=0.0||raw.toInt() !in 1..256){invoke.reject("invalid-request");return}
  if(!busy.compareAndSet(false,true)){invoke.reject("busy");return}
  try{startActivityForResult(invoke,Intent().setComponent(ComponentName(provider,"$provider.InferenceRequestActivity")).putExtra("schema","awai.inference.request.v1").putExtra("modality","text").putExtra("prompt",prompt).putExtra("maxTokens",raw.toInt()).putExtra("requestId",id),"generated")}catch(e:Exception){busy.set(false);invoke.reject("provider-unavailable")}
 }
 @ActivityCallback fun generated(invoke:Invoke,result:ActivityResult){busy.set(false);val data=result.data
  if(result.resultCode!=Activity.RESULT_OK||data==null){invoke.reject("inference-denied-or-unavailable");return}
  val text=data.getStringExtra("text")?:"";val id=invoke.getArgs().optString("requestId")
  if(data.getStringExtra("schema")!="awai.inference.result.v1"||data.getStringExtra("requestId")!=id||data.getStringExtra("modality")!="text"||data.getStringExtra("engine")!="llama.cpp"||text.toByteArray(Charsets.UTF_8).size>65536){invoke.reject("invalid-provider-result");return}
  val tokens=data.getIntExtra("outputTokens",-1)
  if(tokens !in 0..256){invoke.reject("invalid-provider-counter");return}
  invoke.resolve(JSObject().put("schema","awai.inference.result.v1").put("requestId",id).put("modality","text").put("engine","llama.cpp").put("text",text).put("outputTokens",tokens))
 }
}

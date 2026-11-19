package network.awai.approval
import android.app.Activity
import android.content.ComponentName
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.PermissionInfo
import androidx.activity.result.ActivityResult
import app.tauri.annotation.ActivityCallback
import app.tauri.annotation.Command
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.util.concurrent.atomic.AtomicBoolean

/** ADR 0048 client: hands one typed request to the Awai app's ApprovalRequestActivity. Holds no key, stores no grant, never signs itself. */
@TauriPlugin
class ApprovalClientPlugin(private val owner:Activity):Plugin(owner){
 private val provider="network.awai.app"
 private val busy=AtomicBoolean(false)
 private fun available():Boolean=try{
  val pm=owner.packageManager;pm.getPackageInfo(provider,0)
  val p=pm.getPermissionInfo("network.awai.permission.KEY_APPROVAL",0)
  p.packageName==provider&&(p.protectionLevel and PermissionInfo.PROTECTION_MASK_BASE)==PermissionInfo.PROTECTION_SIGNATURE&&pm.checkSignatures(owner.packageName,provider)==PackageManager.SIGNATURE_MATCH
 }catch(e:Exception){false}
 @Command fun operation(invoke:Invoke){
  val a=invoke.getArgs();val kind=a.optString("kind");val id=a.optString("requestId");val wallet=a.optString("walletId")
  if(a.optString("schema")!="awai.approval.request.v1"||!id.matches(Regex("[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}"))){invoke.reject("invalid-request");return}
  // ADR 0048 stage 7: a local Bot's delegation (class A card) or its sealed presentation (class B, no card).
  if(kind=="itonami.bot-signer.delegate"||kind=="itonami.bot-signer.present"){
   val bot=a.optString("botId");if(!bot.matches(Regex("[a-z0-9][a-z0-9._-]{0,63}"))){invoke.reject("invalid-request");return}
   val target=if(kind=="itonami.bot-signer.present")"BotSignerActivity" else "ApprovalRequestActivity"
   val local=Intent().setComponent(ComponentName(provider,"$provider.$target")).putExtra("schema","awai.approval.request.v1").putExtra("requestId",id).putExtra("kind",kind).putExtra("botId",bot)
   if(!available()){invoke.reject("key-approval-unavailable");return}
   if(!busy.compareAndSet(false,true)){invoke.reject("busy");return}
   try{startActivityForResult(invoke,local,"answered")}catch(e:Exception){busy.set(false);invoke.reject("key-approval-unavailable")};return
  }
  if(!wallet.matches(Regex("[a-z0-9][a-z0-9-]{0,39}"))){invoke.reject("invalid-request");return}
  val intent=Intent().setComponent(ComponentName(provider,"$provider.ApprovalRequestActivity")).putExtra("schema","awai.approval.request.v1").putExtra("requestId",id).putExtra("kind",kind).putExtra("walletId",wallet)
  when(kind){
   "itonami.bot-wallet.address"->{}
   "itonami.bot-wallet.launch"->{val credit=a.opt("creditLimitMicros")
    if(credit !is Number||credit.toDouble()%1!=0.0){invoke.reject("invalid-request");return}
    intent.putExtra("assignmentId",a.optString("assignmentId")).putExtra("businessId",a.optString("businessId")).putExtra("creditLimitMicros",credit.toInt()).putExtra("walletAddress",a.optString("walletAddress"))}
   else->{invoke.reject("invalid-request");return}
  }
  if(!available()){invoke.reject("key-approval-unavailable");return}
  if(!busy.compareAndSet(false,true)){invoke.reject("busy");return}
  try{startActivityForResult(invoke,intent,"answered")}catch(e:Exception){busy.set(false);invoke.reject("key-approval-unavailable")}
 }
 @ActivityCallback fun answered(invoke:Invoke,result:ActivityResult){busy.set(false);val data=result.data;val id=invoke.getArgs().optString("requestId")
  if(result.resultCode!=Activity.RESULT_OK||data==null||data.getStringExtra("schema")!="awai.approval.result.v1"||data.getStringExtra("requestId")!=id){invoke.reject(data?.getStringExtra("error")?.takeIf{it.matches(Regex("[a-z-]{1,40}"))}?:"denied");return}
  val kind=invoke.getArgs().optString("kind")
  if(kind=="itonami.bot-signer.delegate"||kind=="itonami.bot-signer.present"){
   val out=JSObject().put("schema","awai.approval.result.v1").put("requestId",id)
   for(k in listOf("block","cid","holder","owner","signature","rootSignature","seal"))data.getStringExtra(k)?.let{v->if(v.length>8192||!v.matches(Regex("[0-9A-Za-z:x]+"))){invoke.reject("invalid-approval-result");return}else out.put(k,v)}
   out.put("before",data.getLongExtra("before",-1))
   invoke.resolve(out);return
  }
  val address=data.getStringExtra("walletAddress")?:"";val signature=data.getStringExtra("walletSignature")
  if(!address.matches(Regex("0x[0-9a-f]{40}"))||(signature!=null&&!signature.matches(Regex("0x[0-9a-f]{130}")))){invoke.reject("invalid-approval-result");return}
  val out=JSObject().put("schema","awai.approval.result.v1").put("requestId",id).put("walletAddress",address)
  if(signature!=null)out.put("walletSignature",signature)
  invoke.resolve(out)
 }
}

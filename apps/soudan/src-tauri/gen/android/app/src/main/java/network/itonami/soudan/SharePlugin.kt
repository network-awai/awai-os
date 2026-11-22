package network.itonami.soudan
import android.app.Activity
import android.content.Intent
import app.tauri.annotation.Command
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Plugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
// Soudan share sheet (AWAI-3236, scope ADR 0001 D9 / owner decision O1): hand the consultation memo
// the user approved to whatever app they pick in the OS chooser. No permission is needed and none
// is requested. The page reaches this only through the canonical broker (governor-approved operation
// plus the per-operation consent dialog); resolving means the chooser opened.
@TauriPlugin
class SharePlugin(private val owner:Activity):Plugin(owner){
 @Command fun share(invoke:Invoke){
  val text=invoke.getArgs().optString("text")
  if(text.isEmpty()||text.length>65536){invoke.reject("invalid-text");return}
  try{
   val send=Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT,text)
   owner.startActivity(Intent.createChooser(send,"相談メモを送る"))
   invoke.resolve(JSObject().put("shared",true))
  }catch(e:Exception){invoke.reject("share-unavailable")}
 }
}

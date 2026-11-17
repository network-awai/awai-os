package network.itonami.app
import android.app.Activity
import androidx.webkit.ProxyConfig
import androidx.webkit.ProxyController
import androidx.webkit.WebViewFeature
import app.tauri.annotation.Command
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Plugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import org.json.JSONObject
import java.io.File

object AgentTransport {
 const val origin="https://21mbp.tail110d8b.ts.net:8443"
 @Volatile var ready=true
 @Volatile var managed=false
 fun configure(owner:Activity){
  val file=File(owner.filesDir,"agent-transport.json");if(!file.exists())return
  managed=true;ready=false
  try{
   require(file.isFile&&file.length() in 1..4096);val c=JSONObject(file.readText())
   require(c.keys().asSequence().toSet()==setOf("schema","origin","proxy"))
   require(c.getString("schema")=="awai.agent-transport.v1"&&c.getString("origin")==origin&&c.getString("proxy")=="10.77.0.1:10844")
   require(WebViewFeature.isFeatureSupported(WebViewFeature.PROXY_OVERRIDE)&&WebViewFeature.isFeatureSupported(WebViewFeature.PROXY_OVERRIDE_REVERSE_BYPASS))
   val config=ProxyConfig.Builder().addProxyRule(c.getString("proxy")).addBypassRule("21mbp.tail110d8b.ts.net").setReverseBypassEnabled(true).build()
   ProxyController.getInstance().setProxyOverride(config,owner.mainExecutor){ready=true}
  }catch(_:Exception){ready=false}
 }
}
@TauriPlugin
class AgentTransportPlugin(owner:Activity):Plugin(owner){
 @Command fun status(invoke:Invoke){invoke.resolve(JSObject().put("schema","awai.agent-transport-status.v1").put("origin",AgentTransport.origin).put("mode",if(AgentTransport.managed)"managed-wired-tailnet"else"direct").put("ready",AgentTransport.ready))}
}

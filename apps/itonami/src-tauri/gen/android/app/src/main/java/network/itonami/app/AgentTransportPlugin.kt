package network.itonami.app
import android.app.Activity
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
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
   if(android.os.Build.VERSION.SDK_INT>=37 && owner.checkSelfPermission("android.permission.ACCESS_LOCAL_NETWORK")!=android.content.pm.PackageManager.PERMISSION_GRANTED){
    owner.requestPermissions(arrayOf("android.permission.ACCESS_LOCAL_NETWORK"),3104)
    return
   }
   require(WebViewFeature.isFeatureSupported(WebViewFeature.PROXY_OVERRIDE)&&WebViewFeature.isFeatureSupported(WebViewFeature.PROXY_OVERRIDE_REVERSE_BYPASS))
   // The wired maintenance LAN has no Internet/default route. Select only this
   // process's existing, exact Ethernet network; never change OS routing/DNS.
   val cm=owner.getSystemService(ConnectivityManager::class.java)
   val networks=cm.allNetworks.filter { n ->
    cm.getNetworkCapabilities(n)?.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET)==true &&
    cm.getLinkProperties(n)?.let { p -> p.interfaceName=="eth0" && p.linkAddresses.any { a -> a.address.hostAddress=="10.77.0.2" && a.prefixLength==24 } }==true
   }
   require(networks.size==1 && cm.bindProcessToNetwork(networks.single()))
   val config=ProxyConfig.Builder().addProxyRule(c.getString("proxy")).addBypassRule("21mbp.tail110d8b.ts.net").setReverseBypassEnabled(true).build()
   ProxyController.getInstance().setProxyOverride(config,owner.mainExecutor){ready=true}
  }catch(_:Exception){ready=false}
 }
}
@TauriPlugin
class AgentTransportPlugin(owner:Activity):Plugin(owner){
 @Command fun status(invoke:Invoke){invoke.resolve(JSObject().put("schema","awai.agent-transport-status.v1").put("origin",AgentTransport.origin).put("mode",if(AgentTransport.managed)"managed-wired-tailnet"else"direct").put("ready",AgentTransport.ready))}
}

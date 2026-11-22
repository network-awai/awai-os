package network.awai.murakumo.net
import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import androidx.core.content.FileProvider
import app.tauri.annotation.Command
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import org.json.JSONObject
import java.io.File
import java.security.MessageDigest
import java.util.concurrent.Executors

/**
 * Murakumo Net's native side. It holds the INTERNET permission that network.awai.murakumo gave up,
 * and does only two things: model downloads (the canonical broker streams a consented body; Rust
 * appends it to the file this plugin names) and the hand-off of a finished file to Murakumo.
 * It never runs inference and never receives a prompt or an output.
 *
 * Hand-off: the file must match the pinned catalog's size and SHA-256 here, then Murakumo gets a
 * one-file read grant on this app's FileProvider and admits it again itself (InferenceStatusProvider
 * "admit"). The local copy is deleted whether or not Murakumo accepts it.
 */
@TauriPlugin
class NetPlugin(private val owner:Activity):Plugin(owner){
 private val provider="network.awai.murakumo"
 private val engine=Uri.parse("content://network.awai.murakumo.engine")
 private val worker=Executors.newSingleThreadExecutor()
 @Volatile private var downloading:String?=null

 private fun catalog()=JSONObject(owner.assets.open("catalog.json").bufferedReader().use{it.readText()})
 private fun entry(id:String):JSONObject{val m=catalog().getJSONArray("models");for(i in 0 until m.length())if(m.getJSONObject(i).getString("id")==id)return m.getJSONObject(i);throw IllegalArgumentException("unknown-model")}
 private fun dir()=File(owner.filesDir,"downloads").apply{mkdirs()}
 private fun part(id:String)=File(dir(),"$id.download")
 private fun ready(id:String)=File(dir(),"$id.gguf")
 private fun call(method:String,arg:String?=null,extras:Bundle?=null):Bundle=owner.contentResolver.call(engine,method,arg,extras)?:throw IllegalStateException("murakumo-unavailable")
 private fun digest(f:File):String{val d=MessageDigest.getInstance("SHA-256");f.inputStream().use{val b=ByteArray(1 shl 20);while(true){val n=it.read(b);if(n<0)break;d.update(b,0,n)}};return d.digest().joinToString(""){"%02x".format(it.toInt() and 255)}}

 @Command fun operation(invoke:Invoke){
  val a=invoke.getArgs();val action=a.optString("action")
  when(action){
   "catalog"->{invoke.resolve(JSObject(catalog().toString()));return}
   "open-murakumo"->{try{owner.startActivity(Intent().setComponent(android.content.ComponentName(provider,"$provider.MainActivity")));invoke.resolve(JSObject().put("opened",true))}catch(e:Exception){invoke.reject("murakumo-unavailable")};return}
  }
  worker.execute{try{invoke.resolve(JSObject(when(action){
    "status"->call("status").getString("status")!!
    "usage"->call("usage").getString("usage")!!
    "download-begin"->begin(a.optString("model")).toString()
    "download-finish"->finish(a.optString("model"))
    "download-abort"->{abort(a.optString("model"));"{\"aborted\":true}"}
    else->throw IllegalArgumentException("unknown-operation")}))
  }catch(e:Exception){invoke.reject(NetCodes.of(e,if(action=="status"||action=="usage")"murakumo-unavailable" else if(action=="download-finish")"model-handoff-failed" else "model-download-rejected"))}}
 }

 @Synchronized private fun begin(id:String):JSONObject{val e=entry(id);check(downloading==null){"busy"};downloading=id;part(id).delete();ready(id).delete()
  return JSONObject().put("path",part(id).absolutePath).put("bytes",e.getLong("bytes"))}
 @Synchronized private fun abort(id:String){if(downloading==id){part(id).delete();downloading=null}}
 private fun finish(id:String):String{
  synchronized(this){check(downloading==id){"no-download"}}
  val e=entry(id);val p=part(id);val f=ready(id);var uri:Uri?=null
  try{
   require(p.length()==e.getLong("bytes")&&digest(p)==e.getString("sha256")){"model-digest-mismatch"};check(p.renameTo(f)){"model-store-failed"}
   uri=FileProvider.getUriForFile(owner,owner.packageName+".fileprovider",f)
   owner.grantUriPermission(provider,uri,Intent.FLAG_GRANT_READ_URI_PERMISSION)
   return call("admit",id,Bundle().apply{putString("uri",uri.toString())}).getString("status")!!
  }finally{if(uri!=null)owner.revokeUriPermission(uri,Intent.FLAG_GRANT_READ_URI_PERMISSION);p.delete();f.delete();synchronized(this){downloading=null}}
 }
}

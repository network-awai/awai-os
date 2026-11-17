package network.awai.murakumo
import android.content.Context
import android.net.Uri
import org.json.JSONObject
import java.io.File
import java.security.MessageDigest
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

internal object Models {
 val worker=Executors.newSingleThreadExecutor()
 val busy=AtomicBoolean(false)
 @Volatile var loaded=false
 private fun pins(c:Context)=JSONObject(c.assets.open("pins.json").bufferedReader().use{it.readText()}).getJSONObject("model")
 private fun file(c:Context)=File(c.filesDir,"models/qwen3.gguf")
 fun status(c:Context)=JSONObject().put("schema","awai.inference.local.v1").put("engine","llama.cpp").put("model",pins(c).getString("label")).put("imported",file(c).isFile).put("loaded",loaded).put("busy",busy.get()).put("modalities",org.json.JSONArray().put("text")).put("remote",false).put("image",ImageModels.status(c))
 private fun digest(f:File):String{val d=MessageDigest.getInstance("SHA-256");f.inputStream().use{val b=ByteArray(65536);while(true){val n=it.read(b);if(n<0)break;d.update(b,0,n)}};return d.digest().joinToString(""){"%02x".format(it.toInt() and 255)}}
 private fun admit(c:Context,f:File){val p=pins(c);require(f.length()==p.getLong("bytes")&&digest(f)==p.getString("sha256")){"model-digest-mismatch"}}
 fun import(c:Context,uri:Uri){check(!loaded){"release-required"};val dest=file(c);dest.parentFile!!.mkdirs();val temp=File(dest.parentFile,"import.part");try{
  c.contentResolver.openInputStream(uri)!!.use{input->temp.outputStream().use{output->val b=ByteArray(65536);var bytes=0L;while(true){val n=input.read(b);if(n<0)break;bytes+=n;require(bytes<=pins(c).getLong("bytes")){"model-size-limit"};output.write(b,0,n)}}}
  admit(c,temp);check(temp.renameTo(dest)){"model-store-failed"}
 }finally{if(temp.exists())temp.delete()}}
 fun load(c:Context){check(!loaded){"already-loaded"};val f=file(c);admit(c,f);check(Engine.load(f.absolutePath));loaded=true}
 fun generate(prompt:String,tokens:Int):String{require(prompt.isNotBlank()&&prompt.toByteArray(Charsets.UTF_8).size<=8192&&tokens in 1..256){"invalid-request"};check(loaded){"model-not-loaded"};val result=String(Engine.generate(prompt.toByteArray(Charsets.UTF_8),tokens),Charsets.UTF_8);check(result.isNotBlank()){"empty-result"};return result}
 fun release(){Engine.release();loaded=false}
 fun trustedCaller(c:Context,caller:String?):Boolean {
  val allowed=setOf("network.itonami.app","network.itonami.gaka","network.awai.gaka","network.itonami.dougaka","network.itonami.dougaka.preview","network.itonami.mangaka","network.itonami.animeka","network.itonami.ongakuka")
  return caller in allowed && c.packageManager.checkSignatures(c.packageName,caller!!)==android.content.pm.PackageManager.SIGNATURE_MATCH
 }
}

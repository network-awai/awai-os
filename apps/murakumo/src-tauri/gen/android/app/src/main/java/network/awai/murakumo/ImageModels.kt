package network.awai.murakumo
import android.content.Context
import android.graphics.Bitmap
import android.net.Uri
import androidx.core.content.FileProvider
import org.json.JSONObject
import java.io.File
import java.io.ByteArrayOutputStream
import java.security.MessageDigest

/** Fixed, separately pinned image model set. No arbitrary path, URL, model or executable. */
internal object ImageModels {
 private val cancelled=java.util.concurrent.atomic.AtomicBoolean(false)
 fun prepare(){cancelled.set(false)}
 fun cancel(){cancelled.set(true);try{ImageEngine.cancel()}catch(e:LinkageError){}}
 private fun pins(c:Context)=JSONObject(c.assets.open("image-pins.json").bufferedReader().use{it.readText()})
 private fun root(c:Context)=File(c.filesDir,"image-models")
 fun present(c:Context):Boolean=try {val a=pins(c).getJSONArray("models");(0 until a.length()).all{val p=a.getJSONObject(it);val f=File(root(c),p.getString("localFile"));f.isFile&&f.length()==p.getLong("bytes")}}catch(e:Exception){false}
 fun status(c:Context)=JSONObject().put("model",pins(c).getString("label")).put("imported",present(c)).put("loaded",false).put("backend","Vulkan0").put("progress",if(present(c)&&Models.busy.get())try{ImageEngine.progress()}catch(e:LinkageError){0}else 0)
 fun sha(f:File):String {val d=MessageDigest.getInstance("SHA-256");f.inputStream().use{val b=ByteArray(1024*1024);while(true){val n=it.read(b);if(n<0)break;d.update(b,0,n)}};return d.digest().joinToString(""){"%02x".format(it.toInt()and 255)}}
 fun generate(c:Context,id:String,prompt:String):JSONObject{
  require(id.matches(Regex("[a-f0-9-]{36}"))&&prompt.isNotBlank()&&prompt.toByteArray().size<=8192&&!prompt.contains('\u0000')){"invalid-request"}
  check(!Models.loaded){"release-text-model-required"};check(present(c)){"image-model-missing"};try{ImageEngine.prepare()}catch(e:LinkageError){throw IllegalStateException("image-engine-unavailable")}
  val a=pins(c).getJSONArray("models");for(i in 0 until a.length()){check(!cancelled.get()){"cancelled"};val p=a.getJSONObject(i);val f=File(root(c),p.getString("localFile"));require(f.isFile&&f.length()==p.getLong("bytes")&&sha(f)==p.getString("sha256")){"image-model-digest-mismatch"}}
  check(!cancelled.get()){"cancelled"};val rgb=ImageEngine.generate(root(c).absolutePath,prompt.toByteArray(Charsets.UTF_8));check(rgb.size==512*512*3){"invalid-image-output"}
  val pixels=IntArray(512*512){val k=it*3;0xff000000.toInt()or((rgb[k].toInt()and 255)shl 16)or((rgb[k+1].toInt()and 255)shl 8)or(rgb[k+2].toInt()and 255)}
  val bitmap=Bitmap.createBitmap(pixels,512,512,Bitmap.Config.ARGB_8888);val bytes=ByteArrayOutputStream();try{check(bitmap.compress(Bitmap.CompressFormat.PNG,100,bytes)){"image-encode-failed"}}finally{bitmap.recycle()}
  val png=bytes.toByteArray();require(png.size in 1..4194304){"image-size-limit"}
  val file=File(c.cacheDir,"generated/$id.png");file.parentFile!!.mkdirs();check(file.createNewFile()){"duplicate-image-id"};file.outputStream().use{it.write(png)}
  val uri=FileProvider.getUriForFile(c,c.packageName+".fileprovider",file)
  return JSONObject().put("uri",uri.toString()).put("sha256",sha(file)).put("bytes",file.length()).put("width",512).put("height",512).put("modelSet",pins(c).getString("id"))
 }
}

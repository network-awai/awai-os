package network.awai.murakumo
import android.content.ContentProvider
import android.content.ContentValues
import android.database.Cursor
import android.net.Uri
import android.os.Bundle
import android.os.Binder

/**
 * Signature-protected readiness, plus the model hand-off from Murakumo Net. No prompts, outputs or
 * other mutation surface.
 *
 * - status: readiness for this app, the allowed callers (karute …) and Murakumo Net.
 * - usage: this device's usage reading, for Murakumo Net's All devices view: fixed schema, and nothing
 *   that moves with a running job (Models.usage forOtherApp).
 * Every copy another app reads has no live job state (Models.status forOtherApp).
 * - cancel: stops the running request, and only when arg is that request's ID (Models.cancelJob); the
 *   answer is whether this call stopped it, so a stale or repeated cancel is a no-op.
 * - admit: Murakumo Net hands over a downloaded model file (a read grant on its own FileProvider URI).
 *   This app has no INTERNET permission. It copies the file into models/ and admits it again by size
 *   and SHA-256, exactly as for the document picker.
 */
class InferenceStatusProvider:ContentProvider(){
 override fun onCreate()=true
 override fun call(method:String,arg:String?,extras:Bundle?):Bundle {
  val c=context!!;val self=Binder.getCallingUid()==android.os.Process.myUid();val pkg=callingPackage
  val net=!self&&Models.netCaller(c,pkg)
  if(method=="status"){
   if(!self&&!net&&!Models.trustedCaller(c,pkg))throw SecurityException("caller-denied")
   if(arg!=null||extras!=null)throw IllegalArgumentException("unsupported-operation")
   return Bundle().apply{putString("status",Models.status(c,forOtherApp=!self).toString())}
  }
  if(method=="cancel"){
   if(!self&&!Models.trustedCaller(c,pkg))throw SecurityException("caller-denied")
   if(arg==null||extras!=null)throw IllegalArgumentException("unsupported-operation")
   val caller=if(self)null else requireNotNull(pkg)
   return Bundle().apply{putBoolean("cancelled",Models.cancelJob(arg,caller))}
  }
  if(!net)throw SecurityException("caller-denied")
  if(method=="usage"&&arg==null&&extras==null)return Bundle().apply{putString("usage",Models.usage(c,forOtherApp=true).toString())}
  if(method!="admit"||arg==null||extras==null||extras.keySet()!=setOf("uri"))throw IllegalArgumentException("unsupported-operation")
  val uri=Uri.parse(extras.getString("uri")?:"")
  if(uri.scheme!="content"||uri.authority!=Models.NET_PACKAGE+".fileprovider")throw IllegalArgumentException("unsupported-operation")
  if(!Models.busy.compareAndSet(false,true))throw IllegalStateException("busy")
  try{Models.entry(c,arg);Models.import(c,uri,arg)}catch(e:Exception){throw IllegalStateException(ErrorCodes.of(e,"model-import-rejected"))}finally{Models.busy.set(false)}
  return Bundle().apply{putString("status",Models.status(c,forOtherApp=!self).toString())}
 }
 override fun query(u:Uri,p:Array<out String>?,s:String?,a:Array<out String>?,o:String?):Cursor?=throw SecurityException("unsupported")
 override fun getType(u:Uri):String?=null
 override fun insert(u:Uri,v:ContentValues?):Uri?=throw SecurityException("unsupported")
 override fun update(u:Uri,v:ContentValues?,s:String?,a:Array<out String>?):Int=throw SecurityException("unsupported")
 override fun delete(u:Uri,s:String?,a:Array<out String>?):Int=throw SecurityException("unsupported")
}

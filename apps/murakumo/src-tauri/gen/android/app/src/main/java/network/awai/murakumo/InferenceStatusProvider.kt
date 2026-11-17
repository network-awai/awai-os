package network.awai.murakumo
import android.content.ContentProvider
import android.content.ContentValues
import android.database.Cursor
import android.net.Uri
import android.os.Bundle
import android.os.Binder

/** Signature-protected readiness only. No prompts, files, outputs or mutation surface. */
class InferenceStatusProvider:ContentProvider(){
 override fun onCreate()=true
 override fun call(method:String,arg:String?,extras:Bundle?):Bundle {
  val c=context!!
  if(Binder.getCallingUid()!=android.os.Process.myUid()&&!Models.trustedCaller(c,callingPackage))throw SecurityException("caller-denied")
  if(method!="status"||arg!=null||extras!=null)throw IllegalArgumentException("unsupported-operation")
  return Bundle().apply{putString("status",Models.status(c).toString())}
 }
 override fun query(u:Uri,p:Array<out String>?,s:String?,a:Array<out String>?,o:String?):Cursor?=throw SecurityException("unsupported")
 override fun getType(u:Uri):String?=null
 override fun insert(u:Uri,v:ContentValues?):Uri?=throw SecurityException("unsupported")
 override fun update(u:Uri,v:ContentValues?,s:String?,a:Array<out String>?):Int=throw SecurityException("unsupported")
 override fun delete(u:Uri,s:String?,a:Array<out String>?):Int=throw SecurityException("unsupported")
}

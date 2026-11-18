package network.itonami.app
import android.os.Bundle
import android.content.Intent
import androidx.activity.result.ActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import android.view.View
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import kotlin.math.max
class MainActivity : TauriActivity() {
 private var screenCaptureResult: ((ActivityResult) -> Unit)? = null
 private val screenCapture = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
  val callback = screenCaptureResult
  screenCaptureResult = null
  callback?.invoke(result)
 }

 internal fun requestScreenCapture(intent: Intent, onResult: (ActivityResult) -> Unit) {
  check(screenCaptureResult == null)
  screenCaptureResult = onResult
  try {
   screenCapture.launch(intent)
  } catch (error: Exception) {
   screenCaptureResult = null
   throw error
  }
 }

 override fun onDestroy() {
  val callback = screenCaptureResult
  screenCaptureResult = null
  callback?.invoke(ActivityResult(android.app.Activity.RESULT_CANCELED, null))
  super.onDestroy()
 }

 override fun onRequestPermissionsResult(requestCode:Int,permissions:Array<out String>,grantResults:IntArray){
  super.onRequestPermissionsResult(requestCode,permissions,grantResults)
  if(requestCode==3104 && grantResults.size==1 && grantResults[0]==android.content.pm.PackageManager.PERMISSION_GRANTED)AgentTransport.configure(this)
 }
 override fun onCreate(savedInstanceState:Bundle?) {
  enableEdgeToEdge();super.onCreate(savedInstanceState)
  AgentTransport.configure(this)
  val content=findViewById<View>(android.R.id.content)
  ViewCompat.setOnApplyWindowInsetsListener(content){view,insets->
   val bars=insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
   val ime=insets.getInsets(WindowInsetsCompat.Type.ime())
   view.setPadding(bars.left,bars.top,bars.right,max(bars.bottom,ime.bottom));insets
  }
  ViewCompat.requestApplyInsets(content)
 }
}

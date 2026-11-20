package network.awai.murakumo
import android.content.res.Configuration
import android.os.Bundle
import android.view.View
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import kotlin.math.max
class MainActivity : TauriActivity() {
 override fun onCreate(savedInstanceState:Bundle?) {
  enableEdgeToEdge();super.onCreate(savedInstanceState)
  val content=findViewById<View>(android.R.id.content)
  ViewCompat.setOnApplyWindowInsetsListener(content){view,insets->
   val bars=insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
   val ime=insets.getInsets(WindowInsetsCompat.Type.ime())
   view.setPadding(bars.left,bars.top,bars.right,max(bars.bottom,ime.bottom));insets
  }
  applySystemBarAppearance(resources.configuration)
  ViewCompat.requestApplyInsets(content)
 }
 // uiMode is in the manifest's configChanges, so a theme switch arrives here
 // instead of recreating the activity (AWAI-3434).
 override fun onConfigurationChanged(newConfig:Configuration) {
  super.onConfigurationChanged(newConfig)
  applySystemBarAppearance(newConfig)
 }
 // The bars are drawn over the decor view (edge-to-edge). Paint it with the page's
 // background, which follows the system theme through the shared awai-ui.css
 // (--awai-background #ffffff / #14110f), with dark icons in light mode and light
 // icons in dark mode; no navigation contrast scrim, which would not follow a switch.
 private fun applySystemBarAppearance(config:Configuration) {
  val light=(config.uiMode and Configuration.UI_MODE_NIGHT_MASK)!=Configuration.UI_MODE_NIGHT_YES
  window.decorView.setBackgroundColor(if(light)0xFFFFFFFF.toInt() else 0xFF14110F.toInt())
  if(android.os.Build.VERSION.SDK_INT>=29)window.isNavigationBarContrastEnforced=false
  WindowInsetsControllerCompat(window,findViewById(android.R.id.content)).apply{isAppearanceLightStatusBars=light;isAppearanceLightNavigationBars=light}
 }
}

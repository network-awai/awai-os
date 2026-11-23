package network.itonami.horei
import android.content.res.Configuration
import android.os.Bundle
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import kotlin.math.max
import network.awai.systembars.SystemBars
class MainActivity : TauriActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val content=findViewById<android.view.View>(android.R.id.content)
        ViewCompat.setOnApplyWindowInsetsListener(content){view,insets->
            val bars=insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
            val ime=insets.getInsets(WindowInsetsCompat.Type.ime())
            view.setPadding(bars.left,bars.top,bars.right,max(bars.bottom,ime.bottom));insets
        }
        SystemBars.applyForUiMode(this, resources.configuration)
        ViewCompat.requestApplyInsets(content)
    }
    // uiMode is in the manifest's configChanges, so a theme switch arrives here
    // instead of recreating the activity (AWAI-3422).
    override fun onConfigurationChanged(newConfig: Configuration) {
        super.onConfigurationChanged(newConfig)
        SystemBars.applyForUiMode(this, newConfig)
    }
}

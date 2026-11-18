package network.itonami.app

import android.accessibilityservice.AccessibilityService
import android.view.accessibility.AccessibilityEvent

/** Exposes the Android Recents action after explicit activation in system settings. */
class ScreenNavigationService : AccessibilityService() {
    override fun onServiceConnected() {
        connected = this
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) = Unit
    override fun onInterrupt() = Unit

    override fun onDestroy() {
        if (connected === this) connected = null
        super.onDestroy()
    }

    companion object {
        // Accessed only on the Android main thread.
        private var connected: ScreenNavigationService? = null

        fun showRecents(): Boolean =
            connected?.performGlobalAction(GLOBAL_ACTION_RECENTS) == true
    }
}

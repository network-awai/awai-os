package network.itonami.app

import android.app.Activity
import android.app.AlertDialog
import android.content.Intent
import android.media.projection.MediaProjectionManager
import android.provider.Settings
import android.os.Handler
import android.os.Looper
import androidx.activity.result.ActivityResult
import androidx.lifecycle.Lifecycle
import app.tauri.annotation.Command
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.Plugin
import app.tauri.plugin.PluginManager

@TauriPlugin
class ScreenToolsPlugin(activity: Activity) : Plugin(activity) {
    private val main = Handler(Looper.getMainLooper())
    private var approvalOwner: MainActivity? = null

    @Command
    fun operation(invoke: Invoke) {
        val args = invoke.getArgs()
        val action = args.opt("action") as? String
        if (args.length() != 1 || action == null) {
            invoke.reject("invalid-screen-operation")
            return
        }
        main.post { execute(action, invoke) }
    }

    private fun execute(action: String, invoke: Invoke) {
        if (action == "status") {
            invoke.resolve(ScreenRecordingService.result())
            return
        }
        val owner = PluginManager.activity as? MainActivity
        if (owner == null || !foreground(owner) || approvalOwner?.isDestroyed == false) {
            invoke.reject("screen-operation-unavailable")
            return
        }
        if (action == "record-stop") {
            if (ScreenRecordingService.requestStop()) invoke.resolve(ScreenRecordingService.result())
            else invoke.reject("screen-recording-inactive")
            return
        }
        if (action == "record-start") {
            if (ScreenRecordingService.isBusy()) {
                invoke.reject("screen-recording-busy")
                return
            }
            approvalOwner = owner
            try {
                val manager = owner.getSystemService(MediaProjectionManager::class.java)
                owner.requestScreenCapture(manager.createScreenCaptureIntent()) { result ->
                    projectionApproved(owner, invoke, result)
                }
            } catch (_: Exception) {
                clearApproval(owner)
                invoke.reject("screen-capture-unavailable")
            }
            return
        }
        val message = when (action) {
            "home" -> R.string.screen_home
            "recents" -> R.string.screen_recents
            "settings" -> R.string.screen_settings
            "accessibility-settings" -> R.string.screen_accessibility
            else -> {
                invoke.reject("unsupported-screen-operation")
                return
            }
        }
        approvalOwner = owner
        AlertDialog.Builder(owner)
            .setTitle(R.string.screen_confirm)
            .setMessage(message)
            .setNegativeButton(android.R.string.cancel) { _, _ ->
                invoke.reject("screen-operation-denied")
            }
            .setOnCancelListener { invoke.reject("screen-operation-denied") }
            .setPositiveButton(R.string.screen_allow) { _, _ ->
                if (!foreground(owner)) {
                    invoke.reject("screen-operation-unavailable")
                } else {
                    try {
                        when (action) {
                            "home" -> owner.startActivity(Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME))
                            "settings" -> owner.startActivity(Intent(Settings.ACTION_SETTINGS))
                            "accessibility-settings" -> owner.startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))
                            "recents" -> {
                                if (!ScreenNavigationService.showRecents()) {
                                    invoke.reject("screen-navigation-unavailable")
                                    return@setPositiveButton
                                }
                            }
                        }
                        invoke.resolve(ScreenRecordingService.result())
                    } catch (_: Exception) {
                        invoke.reject("screen-operation-unavailable")
                    }
                }
            }
            .setOnDismissListener { clearApproval(owner) }
            .show()
    }

    private fun projectionApproved(owner: MainActivity, invoke: Invoke, result: ActivityResult) {
        clearApproval(owner)
        val data = result.data
        if (result.resultCode != Activity.RESULT_OK || data == null || owner.isDestroyed ||
            PluginManager.activity !== owner) {
            invoke.reject("screen-operation-denied")
            return
        }
        if (!ScreenRecordingService.reserve()) {
            invoke.reject("screen-recording-busy")
            return
        }
        try {
            owner.startForegroundService(ScreenRecordingService.startIntent(owner, data))
            invoke.resolve(ScreenRecordingService.result())
        } catch (_: Exception) {
            ScreenRecordingService.failStart()
            invoke.reject("screen-capture-unavailable")
        }
    }

    private fun clearApproval(owner: MainActivity) {
        if (approvalOwner === owner) approvalOwner = null
    }

    private fun foreground(owner: MainActivity) =
        PluginManager.activity === owner && !owner.isFinishing &&
            owner.lifecycle.currentState == Lifecycle.State.RESUMED
}

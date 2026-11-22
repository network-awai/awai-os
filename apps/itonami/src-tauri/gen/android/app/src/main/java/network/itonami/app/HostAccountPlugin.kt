package network.itonami.app

import android.app.Activity
import android.app.KeyguardManager
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Process
import app.tauri.annotation.Command
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin

@TauriPlugin
class HostAccountPlugin(private val owner: Activity) : Plugin(owner) {
    @Command
    fun proof(invoke: Invoke) {
        val nonce = invoke.getArgs().optString("nonce")
        if (!nonce.matches(Regex("[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}"))) {
            invoke.reject("invalid-host-account-nonce")
            return
        }
        Thread({
            try {
                val keyguard = owner.getSystemService(KeyguardManager::class.java)
                check(keyguard != null && keyguard.isDeviceSecure && !keyguard.isDeviceLocked)
                val authority = "network.awai.home.account"
                val packages = owner.packageManager
                val provider = packages.resolveContentProvider(authority, 0)
                check(provider != null && provider.packageName == "network.awai.home" &&
                    provider.name == "network.awai.home.HostAccountProvider" &&
                    packages.checkSignatures(owner.packageName, provider.packageName) == PackageManager.SIGNATURE_MATCH &&
                    android.os.UserHandle.getUserHandleForUid(provider.applicationInfo.uid) == Process.myUserHandle())
                val result = owner.contentResolver.call(Uri.parse("content://$authority"),
                    "itonami-session-v1", nonce, null)?.getString("proof")
                check(!result.isNullOrEmpty() && result.length <= 2048 && !keyguard.isDeviceLocked)
                invoke.resolve(JSObject().put("uid", Process.myUid()).put("proof", result))
            } catch (_: Exception) {
                invoke.reject("host-account-unavailable")
            }
        }, "awai-host-account").start()
    }
}

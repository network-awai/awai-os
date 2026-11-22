package network.awai.shell

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import app.tauri.annotation.Command
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Plugin
import app.tauri.plugin.Invoke

object PeerRuntime {
    @JvmStatic external fun cancel(sessionId: String)
    @JvmStatic external fun active(sessionId: String): Boolean
}

@TauriPlugin
class AwaiPeerPlugin(private val owner: Activity): Plugin(owner) {
    @Command fun requestNotifications(invoke: Invoke) {
        owner.runOnUiThread {
            val missing=mutableListOf<String>()
            if(Build.VERSION.SDK_INT>=37 && owner.checkSelfPermission("android.permission.ACCESS_LOCAL_NETWORK")!=PackageManager.PERMISSION_GRANTED)missing.add("android.permission.ACCESS_LOCAL_NETWORK")
            if(Build.VERSION.SDK_INT>=33 && owner.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)!=PackageManager.PERMISSION_GRANTED)missing.add(Manifest.permission.POST_NOTIFICATIONS)
            if(missing.isNotEmpty())owner.requestPermissions(missing.toTypedArray(),7301)
            invoke.resolve()
        }
    }
    @Command fun beginReceive(invoke: Invoke) {
        try {
            val id=invoke.getArgs().getString("sessionId")
            val until=invoke.getArgs().getLong("until")
            require(id.matches(Regex("[1-9A-HJ-NP-Za-km-z]{32,128}")))
            require(until>System.currentTimeMillis()/1000 && until<=System.currentTimeMillis()/1000+21600)
            require(PeerRuntime.active(id))
            if(Build.VERSION.SDK_INT>=33 && owner.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)!=PackageManager.PERMISSION_GRANTED) {
                invoke.reject("notification-permission-required"); return
            }
            if(Build.VERSION.SDK_INT>=37 && owner.checkSelfPermission("android.permission.ACCESS_LOCAL_NETWORK")!=PackageManager.PERMISSION_GRANTED){invoke.reject("local-network-permission-required");return}
            val intent=Intent(owner,PeerReceiveService::class.java).putExtra("sessionId",id).putExtra("until",until)
            owner.runOnUiThread {
                try {
                    owner.startForegroundService(intent)
                    val handler=Handler(Looper.getMainLooper())
                    var checks=0
                    val check=object:Runnable {override fun run(){
                        if(PeerReceiveService.activeId==id){invoke.resolve();return}
                        if(++checks>=40 || !PeerRuntime.active(id)){invoke.reject("foreground-receive-not-running");return}
                        handler.postDelayed(this,100)
                    }}
                    handler.post(check)
                } catch(e:Exception){invoke.reject("foreground-receive-start-refused")}
            }
        } catch(e:Exception){invoke.reject("invalid-receive-session")}
    }
    @Command fun endReceive(invoke: Invoke) {
        val id=invoke.getArgs().getString("sessionId")
        if(PeerReceiveService.activeId==id) owner.stopService(Intent(owner,PeerReceiveService::class.java))
        invoke.resolve()
    }
}

package network.awai.shell

import android.app.*
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.*

/** Visible bounded receive carrier. Never restarts itself or acquires new grants. */
class PeerReceiveService: Service() {
    companion object { @Volatile var activeId:String?=null; const val STOP="network.awai.shell.STOP_RECEIVE" }
    private var sessionId:String?=null
    private val handler=Handler(Looper.getMainLooper())
    override fun onBind(intent:Intent?)=null
    private fun text(name:String):String=getString(resources.getIdentifier(name,"string",packageName))
    override fun onStartCommand(intent:Intent?,flags:Int,startId:Int):Int {
        val id=intent?.getStringExtra("sessionId")
        if(intent?.action==STOP) {if(id==sessionId)stopSelf();return START_NOT_STICKY}
        val until=intent?.getLongExtra("until",0)?:0
        if(id==null || !PeerRuntime.active(id) || until<=System.currentTimeMillis()/1000 || until>System.currentTimeMillis()/1000+21600){stopSelf();return START_NOT_STICKY}
        if(sessionId!=null && sessionId!=id){PeerRuntime.cancel(id);return START_NOT_STICKY}
        sessionId=id
        try {
            val manager=getSystemService(NotificationManager::class.java)
            manager.createNotificationChannel(NotificationChannel("awai-peer-receive",text("awai_peer_receive_channel"),NotificationManager.IMPORTANCE_LOW))
            val stop=PendingIntent.getService(this,1,Intent(this,PeerReceiveService::class.java).setAction(STOP).putExtra("sessionId",id),PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
            val launch=packageManager.getLaunchIntentForPackage(packageName)
            val builder=Notification.Builder(this,"awai-peer-receive")
                .setSmallIcon(android.R.drawable.stat_sys_upload_done)
                .setContentTitle(applicationInfo.loadLabel(packageManager).toString()+" · "+text("awai_peer_receiving"))
                .setContentText(text("awai_peer_receive_description"))
                .setOngoing(true).addAction(Notification.Action.Builder(null,text("awai_peer_stop"),stop).build())
            if(launch!=null)builder.setContentIntent(PendingIntent.getActivity(this,2,launch,PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE))
            if(Build.VERSION.SDK_INT>=29)startForeground(3001,builder.build(),ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC) else startForeground(3001,builder.build())
            activeId=id
            handler.removeCallbacksAndMessages(null)
            handler.postDelayed({stopSelf()},(until*1000-System.currentTimeMillis()).coerceAtLeast(1))
        } catch(e:Exception){PeerRuntime.cancel(id);stopSelf()}
        return START_NOT_STICKY
    }
    override fun onTimeout(startId:Int,fgsType:Int){sessionId?.let{PeerRuntime.cancel(it)};stopSelf()}
    override fun onDestroy(){handler.removeCallbacksAndMessages(null);sessionId?.let{PeerRuntime.cancel(it)};if(activeId==sessionId)activeId=null;stopForeground(STOP_FOREGROUND_REMOVE);super.onDestroy()}
}

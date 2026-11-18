package network.itonami.app

import android.app.Activity
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.media.MediaRecorder
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.provider.MediaStore
import android.view.WindowManager
import app.tauri.plugin.JSObject
import java.io.File
import java.util.UUID

class ScreenRecordingService : Service() {
    private val main = Handler(Looper.getMainLooper())
    private var recording: MediaRecorder? = null
    private var projection: MediaProjection? = null
    private var display: VirtualDisplay? = null
    private var temporary: File? = null
    private var recordingStarted = false
    private var finishing = false
    private val timeout = Runnable { finishRecording() }
    private val projectionCallback = object : MediaProjection.Callback() {
        override fun onStop() = finishRecording()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == STOP) {
            if (active === this && state == "recording") finishRecording()
            else if (active !== this) stopSelf()
            return START_NOT_STICKY
        }
        if (intent?.action != START || state != "starting") {
            if (!isBusy()) stopSelf()
            return START_NOT_STICKY
        }
        active = this
        try {
            startForeground(NOTIFICATION_ID, notification(), ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION)
            val grant = requireNotNull(intent.getParcelableExtra(GRANT, Intent::class.java))
            val manager = getSystemService(MediaProjectionManager::class.java)
            val source = requireNotNull(manager.getMediaProjection(Activity.RESULT_OK, grant))
            projection = source
            source.registerCallback(projectionCallback, main)

            val bounds = getSystemService(WindowManager::class.java).maximumWindowMetrics.bounds
            val scale = minOf(1.0, 1920.0 / maxOf(bounds.width(), bounds.height()))
            val width = ((bounds.width() * scale).toInt() / 2 * 2).coerceAtLeast(2)
            val height = ((bounds.height() * scale).toInt() / 2 * 2).coerceAtLeast(2)
            val density = resources.displayMetrics.densityDpi
            val output = File.createTempFile("screen-", ".mp4", cacheDir)
            temporary = output
            val encoder = MediaRecorder(this)
            recording = encoder
            encoder.setVideoSource(MediaRecorder.VideoSource.SURFACE)
            encoder.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
            encoder.setOutputFile(output.absolutePath)
            encoder.setVideoEncoder(MediaRecorder.VideoEncoder.H264)
            encoder.setVideoSize(width, height)
            encoder.setVideoFrameRate(30)
            encoder.setVideoEncodingBitRate(4_000_000)
            encoder.setMaxDuration(MAX_DURATION_MS)
            encoder.setMaxFileSize(MAX_BYTES)
            encoder.setOnInfoListener { _, code, _ ->
                if (code == MediaRecorder.MEDIA_RECORDER_INFO_MAX_DURATION_REACHED ||
                    code == MediaRecorder.MEDIA_RECORDER_INFO_MAX_FILESIZE_REACHED) finishRecording()
            }
            encoder.setOnErrorListener { _, _, _ -> finishRecording(save = false) }
            encoder.prepare()
            display = requireNotNull(source.createVirtualDisplay(
                "Itonami", width, height, density, DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
                encoder.surface, null, main
            ))
            encoder.start()
            recordingStarted = true
            state = "recording"
            main.postDelayed(timeout, MAX_DURATION_MS.toLong())
        } catch (_: Exception) {
            finishRecording(save = false)
        }
        return START_NOT_STICKY
    }

    private fun notification(): Notification {
        val manager = getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(NotificationChannel(
            CHANNEL, getString(R.string.screen_recording), NotificationManager.IMPORTANCE_LOW
        ))
        val stop = PendingIntent.getService(this, 0, Intent(this, javaClass).setAction(STOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        return Notification.Builder(this, CHANNEL)
            .setSmallIcon(android.R.drawable.ic_menu_camera)
            .setContentTitle(getString(R.string.screen_recording))
            .setContentText(getString(R.string.screen_recording_detail))
            .setOngoing(true)
            .setVisibility(Notification.VISIBILITY_PRIVATE)
            .addAction(Notification.Action.Builder(null, getString(R.string.screen_stop), stop).build())
            .build()
    }

    private fun finishRecording(save: Boolean = true) {
        if (finishing) return
        finishing = true
        main.removeCallbacks(timeout)
        var stopped = false
        if (recordingStarted) {
            stopped = runCatching { recording?.stop() }.isSuccess
        }
        runCatching { display?.release() }
        display = null
        runCatching { recording?.release() }
        recording = null
        projection?.let {
            runCatching { it.unregisterCallback(projectionCallback) }
            runCatching { it.stop() }
        }
        projection = null
        val file = temporary
        temporary = null
        if (save && stopped && file != null && file.length() in 1..MAX_BYTES) {
            state = "saving"
            Thread({
                val saved = runCatching { saveToMovies(file) }.getOrDefault(false)
                file.delete()
                main.post { complete(if (saved) "saved" else "failed") }
            }, "itonami-screen-save").start()
        } else {
            file?.delete()
            complete("failed")
        }
    }

    private fun saveToMovies(file: File): Boolean {
        val resolver = contentResolver
        val values = ContentValues().apply {
            put(MediaStore.Video.Media.DISPLAY_NAME, "Itonami-${UUID.randomUUID()}.mp4")
            put(MediaStore.Video.Media.MIME_TYPE, "video/mp4")
            put(MediaStore.Video.Media.RELATIVE_PATH, "Movies/Awai")
            put(MediaStore.Video.Media.IS_PENDING, 1)
        }
        val uri = resolver.insert(MediaStore.Video.Media.EXTERNAL_CONTENT_URI, values) ?: return false
        var published = false
        try {
            val copied = requireNotNull(resolver.openOutputStream(uri, "w")).use { out ->
                file.inputStream().use { it.copyTo(out) }
            }
            require(copied == file.length())
            values.clear()
            values.put(MediaStore.Video.Media.IS_PENDING, 0)
            published = resolver.update(uri, values, null, null) == 1
            return published
        } finally {
            if (!published) resolver.delete(uri, null, null)
        }
    }

    private fun complete(terminal: String) {
        state = terminal
        if (active === this) active = null
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    override fun onTaskRemoved(rootIntent: Intent?) {
        finishRecording()
        super.onTaskRemoved(rootIntent)
    }

    override fun onDestroy() {
        if (active === this) finishRecording(save = false)
        super.onDestroy()
    }

    companion object {
        private const val START = "network.itonami.app.screen.START"
        private const val STOP = "network.itonami.app.screen.STOP"
        private const val GRANT = "projection-grant"
        private const val CHANNEL = "itonami-screen-recording"
        private const val NOTIFICATION_ID = 3499
        private const val MAX_DURATION_MS = 300_000
        private const val MAX_BYTES = 180_000_000L

        // Plugin, lifecycle, notification and projection callbacks use the Android main thread.
        private var active: ScreenRecordingService? = null
        private var state = "idle"

        fun isBusy() = state in setOf("starting", "recording", "saving")

        fun reserve(): Boolean {
            if (isBusy()) return false
            state = "starting"
            return true
        }

        fun failStart() { state = "failed" }

        fun requestStop(): Boolean {
            val service = active ?: return false
            if (state != "recording") return false
            service.finishRecording()
            return true
        }

        fun result() = JSObject().put("schema", "awai.screen-tools.result.v1").put("state", state)

        fun startIntent(context: Context, grant: Intent) =
            Intent(context, ScreenRecordingService::class.java).setAction(START).putExtra(GRANT, grant)
    }
}

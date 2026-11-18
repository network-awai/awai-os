package network.awai.office

import android.app.Activity
import android.content.Intent
import android.provider.DocumentsContract
import androidx.activity.result.ActivityResult
import app.tauri.annotation.ActivityCallback
import app.tauri.annotation.Command
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.util.concurrent.Executors

@TauriPlugin
class OfficeBackupPlugin(private val activity: Activity) : Plugin(activity) {
    private val worker = Executors.newSingleThreadExecutor()
    private val localProviders = setOf(
        "com.android.externalstorage.documents",
        "com.android.providers.downloads.documents",
    )
    private val names = setOf(
        "bunsho-backup.bs1", "bunsho-backup.bs2", "bunsho-backup.bs3",
        "hyokeisan-backup.hs1", "hyokeisan-backup.hu1", "hyokeisan-backup.hx1",
        "zuhyo-backup.zs1", "zuhyo-backup.zs2",
    )

    @Command
    fun save(invoke: Invoke) {
        val args = invoke.getArgs()
        val name = args.optString("name")
        val snapshot = args.optString("snapshot")
        if (name !in names || snapshot.isEmpty() || snapshot.toByteArray(Charsets.UTF_8).size > 35000) {
            invoke.reject("invalid-backup")
            return
        }

        val picker = Intent(Intent.ACTION_CREATE_DOCUMENT)
            .addCategory(Intent.CATEGORY_OPENABLE)
            .setType("application/octet-stream")
            .putExtra(Intent.EXTRA_LOCAL_ONLY, true)
            .putExtra(Intent.EXTRA_TITLE, name)
        try {
            startActivityForResult(invoke, picker, "picked")
        } catch (_: Exception) {
            invoke.reject("backup-picker-unavailable")
        }
    }

    @ActivityCallback
    fun picked(invoke: Invoke, result: ActivityResult) {
        if (result.resultCode != Activity.RESULT_OK) {
            invoke.resolve(JSObject().put("status", "cancelled"))
            return
        }
        val uri = result.data?.data
        if (uri == null || uri.scheme != "content" || uri.authority !in localProviders ||
            !DocumentsContract.isDocumentUri(activity, uri)) {
            invoke.reject("local-provider-required")
            return
        }

        worker.execute {
            val bytes = invoke.getArgs().getString("snapshot").toByteArray(Charsets.UTF_8)
            val resolver = activity.contentResolver
            try {
                resolver.openOutputStream(uri, "wt")?.use { it.write(bytes) }
                    ?: error("backup-unwritable")
                val verified = resolver.openInputStream(uri)?.use { input ->
                    val readback = ByteArray(bytes.size)
                    java.io.DataInputStream(input).readFully(readback)
                    readback.contentEquals(bytes) && input.read() == -1
                } ?: false
                check(verified)
                invoke.resolve(JSObject().put("status", "saved"))
            } catch (_: Exception) {
                // ACTION_CREATE_DOCUMENT creates a new document rather than granting an old one.
                // Only clean up that returned document when the write or readback failed.
                runCatching { DocumentsContract.deleteDocument(resolver, uri) }
                invoke.reject("backup-write-failed")
            }
        }
    }
}

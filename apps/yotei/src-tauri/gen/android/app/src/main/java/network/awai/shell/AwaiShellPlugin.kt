package network.awai.shell
import android.app.Activity
import android.net.Uri
import app.tauri.annotation.Command
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Plugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import org.json.JSONArray

/** App-private legacy read and signature-protected HOME projection. No install, path or network API. */
@TauriPlugin
class AwaiShellPlugin(private val owner: Activity): Plugin(owner) {
    private fun validate(raw: String): JSONArray {
        require(raw.toByteArray(Charsets.UTF_8).size <= 131072)
        val events=JSONArray(raw);require(events.length()<=200)
        val ids=HashSet<String>()
        for(i in 0 until events.length()) {
            val e=events.getJSONObject(i)
            val id=e.getString("id");val title=e.getString("title");val at=e.getDouble("at")
            require(id.isNotBlank() && id.length<=80 && ids.add(id))
            require(title.isNotBlank() && title.length<=160)
            require(at.isFinite() && at>0 && at<=8640000000000000.0 && at==Math.floor(at))
        }
        return events
    }
    @Command fun legacyAgenda(invoke: Invoke) {
        try {
            // Never overwrite this snapshot: it belongs to the original host and is a rollback source.
            val raw=owner.getSharedPreferences("awai-legacy-agenda-v1",0).getString("events",null)
            invoke.resolve(JSObject().put("events",if(raw==null)null else validate(raw)))
        } catch(e:Exception){invoke.reject("unreadable-legacy-state")}
    }
    @Command fun projectAgenda(invoke: Invoke) {
        try {
            val events=validate(invoke.getArgs().getString("payload"))
            check(owner.getSharedPreferences("agenda",0).edit().putString("events",events.toString()).commit())
            owner.contentResolver.notifyChange(Uri.parse("content://network.itonami.yotei.agenda/events"),null)
            invoke.resolve()
        } catch(e:Exception){invoke.reject("agenda-projection-failed")}
    }
}

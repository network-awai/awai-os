package network.itonami.yotei
import android.os.Bundle
class MainActivity : TauriActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        val backup=getSharedPreferences("awai-legacy-agenda-v1",0)
        if(!backup.getBoolean("captured",false)) {
            val old=getSharedPreferences("agenda",0).getString("events",null)
            check(backup.edit().putString("events",old).putBoolean("captured",true).commit())
        }
        super.onCreate(savedInstanceState)
    }
}

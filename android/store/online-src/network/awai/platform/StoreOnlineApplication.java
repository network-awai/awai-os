package network.awai.platform;

import android.app.Application;

/** The online Store may be started by JobScheduler before any activity opens. */
public final class StoreOnlineApplication extends Application {
    @Override public void onCreate() {
        super.onCreate();
        AutoUpdater.configureTransport(new OkHttpUpdateTransport());
        InstallReceiver.resumeAutomaticResults(this);
    }
}

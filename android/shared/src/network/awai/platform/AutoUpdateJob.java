package network.awai.platform;

import android.app.job.JobParameters;
import android.app.job.JobService;
import java.net.HttpURLConnection;

/** The daily automatic-update check (AWAI-3668). Scheduled only while the approval is in force. */
public final class AutoUpdateJob extends JobService {
    private AutoUpdateRun running;

    @Override public boolean onStartJob(JobParameters params) {
        stopRunning();
        AutoUpdateRun run = new AutoUpdateRun();
        running = run;
        new Thread(() -> {
            try {
                AutoUpdater.run(getApplicationContext(), run);
            } finally {
                getMainExecutor().execute(() -> {
                    if (running != run) return;
                    running = null;
                    jobFinished(params, false);
                });
            }
        }, "awai-auto-update").start();
        return true;
    }

    @Override public boolean onStopJob(JobParameters params) {
        stopRunning();
        return true;
    }

    @Override public void onDestroy() {
        stopRunning();
        super.onDestroy();
    }

    private void stopRunning() {
        if (running == null) return;
        HttpURLConnection connection = running.stop();
        running = null;
        if (connection != null) {
            // Keep network cleanup off the JobService callback thread.
            new Thread(connection::disconnect, "awai-auto-update-disconnect").start();
        }
    }
}

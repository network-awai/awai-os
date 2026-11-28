package network.awai.platform;

import android.app.job.JobParameters;
import android.app.job.JobService;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** The daily automatic-update check (AWAI-3668). Scheduled only while the approval is in force. */
public final class AutoUpdateJob extends JobService {
    private static final ExecutorService WORKER =
            Executors.newSingleThreadExecutor(task -> new Thread(task, "awai-auto-update"));

    private AutoUpdateRun running;

    @Override public boolean onStartJob(JobParameters params) {
        stopRunning();
        AutoUpdateRun run = new AutoUpdateRun();
        running = run;
        WORKER.execute(() -> {
            try {
                AutoUpdater.run(getApplicationContext(), run);
            } finally {
                getMainExecutor().execute(() -> {
                    if (running != run) return;
                    running = null;
                    jobFinished(params, false);
                });
            }
        });
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
        running.stop();
        running = null;
    }
}

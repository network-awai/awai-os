package network.awai.platform;

import android.app.job.JobParameters;
import android.app.job.JobService;

/** The daily automatic-update check (AWAI-3668). Scheduled only while the approval is in force. */
public final class AutoUpdateJob extends JobService {
    @Override public boolean onStartJob(JobParameters params) {
        new Thread(() -> { try { AutoUpdater.run(getApplicationContext()); } finally { jobFinished(params, false); } }, "awai-auto-update").start();
        return true;
    }
    @Override public boolean onStopJob(JobParameters params) { return true; }
}

package network.awai.platform;

import java.net.HttpURLConnection;
import java.net.URL;

public final class AutoUpdateRunTest {
    public static void main(String[] args) throws Exception {
        AutoUpdateRun run = new AutoUpdateRun();
        HttpURLConnection first = connection();
        HttpURLConnection second = connection();
        run.attach(first);
        run.detach(first);
        run.attach(second);
        run.detach(first); // Cleanup for an older request must not clear the current one.
        if (run.stop() != second) throw new AssertionError("Missing active connection at stop");
        if (run.stop() != null) throw new AssertionError("Stop must hand off a connection only once");
        assertStopped(run::check);
        assertStopped(() -> run.attach(first));

        AutoUpdateRun finishedRequest = new AutoUpdateRun();
        finishedRequest.attach(first);
        finishedRequest.detach(first);
        if (finishedRequest.stop() != null) throw new AssertionError("Stopped a completed request");
        AutoUpdateRun nextRun = new AutoUpdateRun();
        nextRun.check();
        nextRun.attach(second);
        if (nextRun.stop() != second) throw new AssertionError("A later job can run independently");

        AutoUpdateRun superseded = new AutoUpdateRun();
        AutoUpdateRun.approvalChanged();
        AutoUpdateRun.approvalChanged(); // Reapproval must not wake a job with a superseded grant.
        assertStopped(superseded::check);
        assertStopped(() -> superseded.attach(first));
        new AutoUpdateRun().check();
        System.out.println("AutoUpdateRunTest: 9 passed");
    }

    private static HttpURLConnection connection() throws Exception {
        return (HttpURLConnection) new URL("https://raw.githubusercontent.com/").openConnection();
    }

    private static void assertStopped(Runnable action) {
        try {
            action.run();
            throw new AssertionError("Stopped update job accepted more work");
        } catch (AutoUpdateRun.Stopped expected) {
            if (!"job-stopped".equals(expected.getMessage())) throw new AssertionError(expected);
        }
    }
}

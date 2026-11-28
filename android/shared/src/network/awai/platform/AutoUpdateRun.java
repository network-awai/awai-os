package network.awai.platform;

import java.net.HttpURLConnection;

/** Cancellation shared between one JobService invocation and its request worker. */
final class AutoUpdateRun {
    // Orders approval changes, job stops and durable effects of a background update.
    static final Object EFFECTS = new Object();
    private static long approvalRevision;

    static final class Stopped extends SecurityException {
        Stopped(String reason) { super(reason); }
    }

    static final class Excluded extends SecurityException {
        Excluded() { super("app-excluded"); }
    }

    private boolean stopped;
    private final long revision;
    private HttpURLConnection connection;

    AutoUpdateRun() {
        synchronized (EFFECTS) {
            revision = approvalRevision;
        }
    }

    static void approvalChanged() {
        synchronized (EFFECTS) {
            approvalRevision++;
        }
    }

    void check() {
        synchronized (EFFECTS) {
            if (stopped || revision != approvalRevision) throw new Stopped("job-stopped");
        }
    }

    void attach(HttpURLConnection request) {
        synchronized (EFFECTS) {
            check();
            connection = request;
        }
    }

    void detach(HttpURLConnection request) {
        synchronized (EFFECTS) {
            if (connection == request) connection = null;
        }
    }

    HttpURLConnection stop() {
        synchronized (EFFECTS) {
            stopped = true;
            HttpURLConnection request = connection;
            connection = null;
            return request;
        }
    }
}

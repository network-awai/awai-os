package network.awai.platform;

import java.util.HashSet;
import java.util.Set;

/** Cancellation shared between one JobService invocation and its request worker. */
final class AutoUpdateRun {
    // Orders approval changes, job stops and durable effects of a background update.
    static final Object EFFECTS = new Object();
    private static final Set<AutoUpdateRun> REQUESTS = new HashSet<>();
    private static long approvalRevision;

    static final class Stopped extends SecurityException {
        Stopped(String reason) { super(reason); }
    }

    static final class Excluded extends SecurityException {
        Excluded() { super("app-excluded"); }
    }

    private boolean stopped;
    private final long revision;
    private UpdateHttpTransport.Request activeRequest;

    AutoUpdateRun() {
        synchronized (EFFECTS) {
            revision = approvalRevision;
        }
    }

    static void approvalChanged() {
        synchronized (EFFECTS) {
            approvalRevision++;
            for (AutoUpdateRun run : REQUESTS) run.activeRequest.cancel();
        }
    }

    void check() {
        synchronized (EFFECTS) {
            if (stopped || revision != approvalRevision) throw new Stopped("job-stopped");
        }
    }

    void start(UpdateHttpTransport.Request request) {
        synchronized (EFFECTS) {
            check();
            if (activeRequest != null) throw new IllegalStateException("update request already active");
            activeRequest = request;
            REQUESTS.add(this);
            request.start();
        }
    }

    void detach(UpdateHttpTransport.Request request) {
        synchronized (EFFECTS) {
            if (activeRequest != request) return;
            activeRequest = null;
            REQUESTS.remove(this);
        }
    }

    void stop() {
        synchronized (EFFECTS) {
            stopped = true;
            if (activeRequest != null) activeRequest.cancel();
            activeRequest = null;
            REQUESTS.remove(this);
        }
    }
}

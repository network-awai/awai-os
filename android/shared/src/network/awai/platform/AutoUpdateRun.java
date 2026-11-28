package network.awai.platform;

import java.util.HashSet;
import java.util.Set;
import java.util.concurrent.Executor;
import java.util.concurrent.Executors;

/** Cancellation shared between one JobService invocation and its request worker. */
final class AutoUpdateRun {
    // Serializes approval changes with admission of durable effects on the worker.
    static final Object EFFECTS = new Object();
    private static final Set<AutoUpdateRun> REQUESTS = new HashSet<>();
    private static final Executor CANCEL = Executors.newSingleThreadExecutor(task -> {
        Thread thread = new Thread(task, "awai-update-cancel");
        thread.setDaemon(true);
        return thread;
    });
    private static volatile long approvalRevision;

    static final class Stopped extends SecurityException {
        Stopped(String reason) { super(reason); }
    }

    static final class Excluded extends SecurityException {
        Excluded() { super("app-excluded"); }
    }

    private volatile boolean stopped;
    private final long revision = approvalRevision;
    private volatile UpdateHttpTransport.Request activeRequest;

    static void approvalChanged() {
        synchronized (EFFECTS) {
            approvalRevision++;
            for (AutoUpdateRun run : REQUESTS) cancel(run.activeRequest);
        }
    }

    void check() {
        if (isStopped()) throw new Stopped("job-stopped");
    }

    private boolean isStopped() {
        return stopped || revision != approvalRevision;
    }

    void start(UpdateHttpTransport.Request request) {
        synchronized (EFFECTS) {
            check();
            if (activeRequest != null) throw new IllegalStateException("update request already active");
            activeRequest = request;
            REQUESTS.add(this);
            try {
                check();
                request.start(this::isStopped);
            } catch (RuntimeException failure) {
                detach(request);
                throw failure;
            }
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
        if (stopped) return;
        stopped = true;
        // JobService callbacks run on Android's main thread. Publish the stop without
        // taking EFFECTS or calling into the transport, even during a disk or Binder wait.
        cancel(activeRequest);
    }

    private static void cancel(UpdateHttpTransport.Request request) {
        if (request != null) CANCEL.execute(request::cancel);
    }
}

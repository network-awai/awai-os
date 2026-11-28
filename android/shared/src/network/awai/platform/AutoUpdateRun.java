package network.awai.platform;

import java.util.HashSet;
import java.util.Set;
import java.util.concurrent.Executor;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicLong;

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

    private static final long STOPPED = -1;
    private final AtomicLong effects = new AtomicLong();
    private final long revision = approvalRevision;
    private volatile UpdateHttpTransport.Request activeRequest;

    static void approvalChanged() {
        synchronized (EFFECTS) {
            approvalRevision++;
            for (AutoUpdateRun run : REQUESTS) cancel(run.activeRequest);
        }
    }

    void check() {
        if (effects.get() == STOPPED || revision != approvalRevision) throw new Stopped("job-stopped");
    }

    // Admission and stop are ordered on the same atomic state. An already admitted
    // operation can finish; any subsequent operation needs its own admission.
    boolean beginEffect() {
        return revision == approvalRevision
                && effects.getAndUpdate(previous -> previous == STOPPED ? STOPPED : previous + 1) != STOPPED
                && revision == approvalRevision;
    }

    void requireEffect() {
        if (!beginEffect()) throw new Stopped("job-stopped");
    }

    void start(UpdateHttpTransport.Request request) {
        synchronized (EFFECTS) {
            check();
            if (activeRequest != null) throw new IllegalStateException("update request already active");
            activeRequest = request;
            REQUESTS.add(this);
            try {
                requireEffect();
                request.start(this::beginEffect);
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
        if (effects.getAndSet(STOPPED) == STOPPED) return;
        // JobService callbacks run on Android's main thread. Publish the stop without
        // taking EFFECTS or calling into the transport, even during a disk or Binder wait.
        cancel(activeRequest);
    }

    private static void cancel(UpdateHttpTransport.Request request) {
        if (request != null) CANCEL.execute(request::cancel);
    }
}

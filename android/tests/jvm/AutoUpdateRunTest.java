package network.awai.platform;

import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.function.BooleanSupplier;

public final class AutoUpdateRunTest {
    public static void main(String[] args) throws Exception {
        AutoUpdateRun run = new AutoUpdateRun();
        Request first = new Request();
        Request second = new Request();
        run.start(first);
        run.detach(first);
        run.start(second);
        run.detach(first); // Cleanup for an older request must not clear the current one.
        run.stop();
        run.stop();
        await(second.canceled, "active request cancellation");
        if (first.canceled.getCount() == 0) throw new AssertionError("Wrong request canceled");
        assertStopped(run::check);
        assertStopped(() -> run.start(first));
        if (first.starts != 1) throw new AssertionError("A stopped run started a request");

        AutoUpdateRun finishedRequest = new AutoUpdateRun();
        Request completed = new Request();
        finishedRequest.start(completed);
        finishedRequest.detach(completed);
        finishedRequest.stop();
        if (completed.canceled.getCount() == 0) throw new AssertionError("Stopped a completed request");

        AutoUpdateRun superseded = new AutoUpdateRun();
        Request active = new Request();
        superseded.start(active);
        AutoUpdateRun.approvalChanged();
        AutoUpdateRun.approvalChanged(); // Reapproval must not wake a job with a superseded grant.
        await(active.canceled, "superseded request cancellation");
        assertStopped(superseded::check);
        assertStopped(() -> superseded.start(first));
        superseded.detach(active);

        AutoUpdateRun nextRun = new AutoUpdateRun();
        Request fresh = new Request();
        nextRun.start(fresh);
        if (fresh.starts != 1 || fresh.canceled.getCount() == 0) throw new AssertionError("A later job cannot run independently");
        nextRun.stop();

        AutoUpdateRun blocked = new AutoUpdateRun();
        CountDownLatch cancelStarted = new CountDownLatch(1), releaseCancel = new CountDownLatch(1);
        blocked.start(new Request() {
            @Override public void cancel() {
                cancelStarted.countDown();
                await(releaseCancel, "release of slow transport cancellation");
            }
        });
        CountDownLatch lockHeld = new CountDownLatch(1), releaseLock = new CountDownLatch(1);
        Thread disk = new Thread(() -> {
            synchronized (AutoUpdateRun.EFFECTS) {
                lockHeld.countDown();
                await(releaseLock, "release of worker I/O");
            }
        });
        disk.start();
        await(lockHeld, "worker holding the effects lock");
        CountDownLatch returned = new CountDownLatch(1);
        Thread stop = new Thread(() -> { blocked.stop(); returned.countDown(); });
        stop.start();
        try {
            await(returned, "stop while disk and transport cancellation are blocked");
            await(cancelStarted, "asynchronous transport cancellation");
            assertStopped(blocked::check);
        } finally {
            releaseLock.countDown();
            releaseCancel.countDown();
            disk.join();
            stop.join();
        }
        System.out.println("AutoUpdateRunTest: 11 passed");
    }

    private static class Request implements UpdateHttpTransport.Request {
        int starts;
        final CountDownLatch canceled = new CountDownLatch(1);
        @Override public void start(BooleanSupplier stopped) { starts++; }
        @Override public byte[] receive() { throw new AssertionError("No network in fixture"); }
        @Override public void cancel() { canceled.countDown(); }
    }

    private static void await(CountDownLatch signal, String label) {
        try {
            if (!signal.await(3, TimeUnit.SECONDS)) throw new AssertionError("Timed out: " + label);
        } catch (InterruptedException failure) {
            Thread.currentThread().interrupt();
            throw new AssertionError(failure);
        }
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

package network.awai.platform;

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
        if (first.canceled || !second.canceled) throw new AssertionError("Wrong request canceled");
        assertStopped(run::check);
        assertStopped(() -> run.start(first));
        if (first.starts != 1) throw new AssertionError("A stopped run started a request");

        AutoUpdateRun finishedRequest = new AutoUpdateRun();
        Request completed = new Request();
        finishedRequest.start(completed);
        finishedRequest.detach(completed);
        finishedRequest.stop();
        if (completed.canceled) throw new AssertionError("Stopped a completed request");

        AutoUpdateRun superseded = new AutoUpdateRun();
        Request active = new Request();
        superseded.start(active);
        AutoUpdateRun.approvalChanged();
        AutoUpdateRun.approvalChanged(); // Reapproval must not wake a job with a superseded grant.
        if (!active.canceled) throw new AssertionError("Changed approval left a request pending");
        assertStopped(superseded::check);
        assertStopped(() -> superseded.start(first));
        superseded.detach(active);

        AutoUpdateRun nextRun = new AutoUpdateRun();
        Request fresh = new Request();
        nextRun.start(fresh);
        if (fresh.starts != 1 || fresh.canceled) throw new AssertionError("A later job cannot run independently");
        nextRun.stop();
        System.out.println("AutoUpdateRunTest: 10 passed");
    }

    private static final class Request implements UpdateHttpTransport.Request {
        int starts;
        boolean canceled;
        @Override public void start() { starts++; }
        @Override public byte[] receive() { throw new AssertionError("No network in fixture"); }
        @Override public void cancel() { canceled = true; }
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

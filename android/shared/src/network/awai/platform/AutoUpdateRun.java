package network.awai.platform;

import java.net.HttpURLConnection;

/** Cancellation shared between one JobService invocation and its request worker. */
final class AutoUpdateRun {
    static final class Stopped extends SecurityException {
        Stopped(String reason) { super(reason); }
    }

    private boolean stopped;
    private HttpURLConnection connection;

    synchronized void check() {
        if (stopped) throw new Stopped("job-stopped");
    }

    synchronized void attach(HttpURLConnection request) {
        check();
        connection = request;
    }

    synchronized void detach(HttpURLConnection request) {
        if (connection == request) connection = null;
    }

    synchronized HttpURLConnection stop() {
        stopped = true;
        HttpURLConnection request = connection;
        connection = null;
        return request;
    }
}

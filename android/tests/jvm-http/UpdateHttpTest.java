package network.awai.platform;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpsConfigurator;
import com.sun.net.httpserver.HttpsServer;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.net.Proxy;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.SocketTimeoutException;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.BooleanSupplier;
import javax.net.ssl.KeyManagerFactory;
import javax.net.ssl.SSLContext;
import javax.net.ssl.TrustManagerFactory;
import javax.net.ssl.X509TrustManager;
import okhttp3.Call;
import okhttp3.Connection;
import okhttp3.Dispatcher;
import okhttp3.EventListener;
import okhttp3.OkHttpClient;

public final class UpdateHttpTest {
    public static void main(String[] args) throws Exception {
        char[] password = "store-test-only".toCharArray();
        KeyStore keys = KeyStore.getInstance("PKCS12");
        keys.load(System.in, password);
        KeyManagerFactory keyManagers = KeyManagerFactory.getInstance(KeyManagerFactory.getDefaultAlgorithm());
        keyManagers.init(keys, password);
        TrustManagerFactory trustManagers = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm());
        trustManagers.init(keys);
        X509TrustManager trust = (X509TrustManager) trustManagers.getTrustManagers()[0];
        SSLContext tls = SSLContext.getInstance("TLS");
        tls.init(keyManagers.getKeyManagers(), trustManagers.getTrustManagers(), null);

        HttpsServer server = HttpsServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.setHttpsConfigurator(new HttpsConfigurator(tls));
        ExecutorService serverExecutor = Executors.newCachedThreadPool();
        server.setExecutor(serverExecutor);
        AtomicInteger deniedRequests = new AtomicInteger();
        AtomicInteger deniedConnections = new AtomicInteger();
        AtomicInteger deniedHttpRequests = new AtomicInteger();
        AtomicReference<AutoUpdateRun> stoppingPhase = new AtomicReference<>();
        CountDownLatch firstRequestArrived = new CountDownLatch(1);
        CountDownLatch releaseFirstRequest = new CountDownLatch(1);
        CountDownLatch slowBodyStarted = new CountDownLatch(1);
        CountDownLatch releaseSlowBody = new CountDownLatch(1);
        CountDownLatch cancelThreadOccupied = new CountDownLatch(1);
        CountDownLatch releaseCancelThread = new CountDownLatch(1);
        server.createContext("/hold", exchange -> {
            firstRequestArrived.countDown();
            await(releaseFirstRequest, "first request release");
            send(exchange, 200, "ok");
        });
        server.createContext("/denied", exchange -> {
            deniedRequests.incrementAndGet();
            send(exchange, 200, "must not be requested");
        });
        server.createContext("/redirect", exchange -> {
            exchange.getResponseHeaders().set("Location", "/denied");
            send(exchange, 302, "redirect");
        });
        server.createContext("/stop-http", exchange -> {
            deniedHttpRequests.incrementAndGet();
            send(exchange, 200, "must not be requested");
        });
        server.createContext("/slow", exchange -> {
            try (HttpExchange managed = exchange) {
                managed.sendResponseHeaders(200, 4);
                managed.getResponseBody().write('a');
                managed.getResponseBody().flush();
                slowBodyStarted.countDown();
                await(releaseSlowBody, "slow body release");
                managed.getResponseBody().write(new byte[] {'b', 'c', 'd'});
            } catch (IOException cancelled) {
                // Closing the client before the rest arrives is expected.
            }
        });
        server.createContext("/large", exchange -> send(exchange, 200, "0123456789"));
        server.start();

        String base = "https://127.0.0.1:" + server.getAddress().getPort();
        Dispatcher dispatcher = new Dispatcher();
        dispatcher.setMaxRequests(1);
        dispatcher.setMaxRequestsPerHost(1);
        OkHttpClient client = new OkHttpClient.Builder().dispatcher(dispatcher)
                .sslSocketFactory(tls.getSocketFactory(), trust)
                .eventListener(new EventListener() {
                    @Override public void connectStart(Call call, InetSocketAddress address, Proxy proxy) {
                        if ("/denied".equals(call.request().url().encodedPath())) deniedConnections.incrementAndGet();
                        if ("/stop-tcp".equals(call.request().url().encodedPath())) stoppingPhase.get().stop();
                    }
                    @Override public void secureConnectStart(Call call) {
                        if ("/stop-tls".equals(call.request().url().encodedPath())) stoppingPhase.get().stop();
                    }
                    @Override public void connectionAcquired(Call call, Connection connection) {
                        if ("/stop-http".equals(call.request().url().encodedPath())) stoppingPhase.get().stop();
                    }
                })
                .followRedirects(false).retryOnConnectionFailure(false).build();
        UpdateHttpTransport transport = new OkHttpUpdateTransport(client);
        try {
            AutoUpdateRun stopped = new AutoUpdateRun();
            stopped.stop();
            try {
                stopped.start(transport.prepare(base + "/denied", 32));
                throw new AssertionError("Stopped run enqueued a request");
            } catch (AutoUpdateRun.Stopped expected) {}
            if (dispatcher.queuedCallsCount() != 0 || dispatcher.runningCallsCount() != 0)
                throw new AssertionError("Stop before enqueue left a call");

            AutoUpdateRun blockingCancel = new AutoUpdateRun();
            UpdateHttpTransport.Request blockedRequest = new UpdateHttpTransport.Request() {
                @Override public void start(BooleanSupplier stopped) { }
                @Override public byte[] receive() { throw new AssertionError("Synthetic cancellation only"); }
                @Override public void cancel() {
                    cancelThreadOccupied.countDown();
                    await(releaseCancelThread, "unblock cancellation executor");
                }
            };
            blockingCancel.start(blockedRequest);
            blockingCancel.stop();
            await(cancelThreadOccupied, "cancellation executor to block");
            blockingCancel.detach(blockedRequest);

            UpdateHttpTransport.Request occupying = transport.prepare(base + "/hold", 32);
            occupying.start(() -> true);
            await(firstRequestArrived, "first request to occupy dispatcher");
            AutoUpdateRun revoked = new AutoUpdateRun();
            UpdateHttpTransport.Request pending = transport.prepare(base + "/denied", 32);
            revoked.start(pending);
            if (dispatcher.queuedCallsCount() != 1)
                throw new AssertionError("Cancellation fixture did not queue the call");
            AutoUpdateRun.approvalChanged();
            releaseFirstRequest.countDown();
            if (!"ok".equals(new String(occupying.receive(), StandardCharsets.US_ASCII)))
                throw new AssertionError("Wrong positive control body");
            // The queued call must refuse at the transport entry even if Call.cancel()
            // has not yet executed on the occupied cancellation thread.
            expectFailure(pending, IOException.class);
            revoked.detach(pending);
            awaitIdle(dispatcher);
            if (deniedRequests.get() != 0) throw new AssertionError("Canceled queued request reached the server");
            if (deniedConnections.get() != 0) throw new AssertionError("Canceled queued request attempted a connection");

            try (ServerSocket tcp = rawLoopback()) {
                AutoUpdateRun run = new AutoUpdateRun();
                stoppingPhase.set(run);
                UpdateHttpTransport.Request stoppedTcp = transport.prepare(loopbackUrl(tcp, "/stop-tcp"), 32);
                run.start(stoppedTcp);
                expectFailure(stoppedTcp, IOException.class);
                run.detach(stoppedTcp);
                try (Socket unexpected = tcp.accept()) {
                    throw new AssertionError("TCP reached the receiver after stop");
                } catch (SocketTimeoutException expected) { }
            }
            try (ServerSocket tlsSocket = rawLoopback()) {
                AutoUpdateRun run = new AutoUpdateRun();
                stoppingPhase.set(run);
                UpdateHttpTransport.Request stoppedTls = transport.prepare(loopbackUrl(tlsSocket, "/stop-tls"), 32);
                run.start(stoppedTls);
                expectFailure(stoppedTls, IOException.class);
                run.detach(stoppedTls);
                try (Socket established = tlsSocket.accept()) {
                    established.setSoTimeout(1000);
                    if (established.getInputStream().read() != -1) throw new AssertionError("TLS sent bytes after stop");
                }
            }
            AutoUpdateRun beforeHttp = new AutoUpdateRun();
            stoppingPhase.set(beforeHttp);
            UpdateHttpTransport.Request stoppedHttp = transport.prepare(base + "/stop-http", 32);
            beforeHttp.start(stoppedHttp);
            expectFailure(stoppedHttp, IOException.class);
            beforeHttp.detach(stoppedHttp);
            if (deniedHttpRequests.get() != 0) throw new AssertionError("Application request reached the receiver after stop");
            releaseCancelThread.countDown();

            AutoUpdateRun active = new AutoUpdateRun();
            UpdateHttpTransport.Request slow = transport.prepare(base + "/slow", 32);
            active.start(slow);
            await(slowBodyStarted, "partial response to reach the client");
            active.stop();
            expectFailure(slow, IOException.class);
            awaitIdle(dispatcher);
            releaseSlowBody.countDown();

            // The same redirect and size rules apply to the online transport itself.
            UpdateHttpTransport.Request redirect = transport.prepare(base + "/redirect", 32);
            redirect.start(() -> true);
            expectFailure(redirect, SecurityException.class);
            if (deniedRequests.get() != 0) throw new AssertionError("Redirect reached the wrong path");
            UpdateHttpTransport.Request oversized = transport.prepare(base + "/large", 4);
            oversized.start(() -> true);
            expectFailure(oversized, SecurityException.class);
            System.out.println("9 checks passed: stop before enqueue, queued cancellation, TCP/TLS/HTTP boundaries with cancellation thread blocked, normal fetch, stop during body, redirect, byte limit");
        } finally {
            releaseFirstRequest.countDown();
            releaseSlowBody.countDown();
            releaseCancelThread.countDown();
            dispatcher.cancelAll();
            dispatcher.executorService().shutdownNow();
            client.connectionPool().evictAll();
            server.stop(0);
            serverExecutor.shutdownNow();
        }
    }

    private static ServerSocket rawLoopback() throws IOException {
        ServerSocket server = new ServerSocket();
        server.bind(new InetSocketAddress("127.0.0.1", 0));
        server.setSoTimeout(500);
        return server;
    }

    private static String loopbackUrl(ServerSocket server, String path) {
        return "https://127.0.0.1:" + server.getLocalPort() + path;
    }

    private static void send(HttpExchange exchange, int status, String text) throws IOException {
        try (HttpExchange managed = exchange) {
            byte[] bytes = text.getBytes(StandardCharsets.US_ASCII);
            managed.sendResponseHeaders(status, bytes.length);
            managed.getResponseBody().write(bytes);
        }
    }

    private static void expectFailure(UpdateHttpTransport.Request request, Class<? extends Exception> kind) throws Exception {
        try {
            request.receive();
            throw new AssertionError("Expected " + kind.getSimpleName());
        } catch (Exception failure) {
            if (!kind.isInstance(failure)) throw failure;
        }
    }

    private static void await(CountDownLatch event, String what) {
        try {
            if (!event.await(5, TimeUnit.SECONDS)) throw new AssertionError(what);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new AssertionError(what, e);
        }
    }

    private static void awaitIdle(Dispatcher dispatcher) throws InterruptedException {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(5);
        while (dispatcher.runningCallsCount() != 0 || dispatcher.queuedCallsCount() != 0) {
            if (System.nanoTime() >= deadline) throw new AssertionError("HTTP dispatcher did not settle");
            Thread.sleep(5);
        }
    }
}

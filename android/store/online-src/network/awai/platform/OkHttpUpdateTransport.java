package network.awai.platform;

import java.io.IOException;
import java.net.InetAddress;
import java.net.Proxy;
import java.net.Socket;
import java.net.SocketAddress;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.TimeUnit;
import java.util.function.BooleanSupplier;
import javax.net.SocketFactory;
import javax.net.ssl.SSLSocketFactory;
import okhttp3.Call;
import okhttp3.Callback;
import okhttp3.OkHttpClient;
import okhttp3.Response;
import okhttp3.ResponseBody;

/** Background transport with a cancellation handle that exists before a request is enqueued. */
final class OkHttpUpdateTransport implements UpdateHttpTransport {
    private static final ThreadLocal<PendingRequest> NETWORK_CALL = new ThreadLocal<>();
    private final OkHttpClient client;

    OkHttpUpdateTransport() {
        this(new OkHttpClient.Builder()
                .followRedirects(false)
                .followSslRedirects(false)
                .retryOnConnectionFailure(false)
                .connectTimeout(15, TimeUnit.SECONDS)
                .readTimeout(30, TimeUnit.SECONDS)
                .callTimeout(60, TimeUnit.SECONDS)
                .build());
    }

    OkHttpUpdateTransport(OkHttpClient client) {
        this.client = client.newBuilder()
                // The fixed background origin uses direct HTTPS. A SOCKS socket would
                // bypass OkHttp's SocketFactory, and HTTP proxy CONNECT bypasses its
                // network interceptors.
                .proxy(Proxy.NO_PROXY)
                .socketFactory(new UpdateSockets())
                .sslSocketFactory(new UpdateTlsSockets(client.sslSocketFactory()), client.x509TrustManager())
                .addInterceptor(chain -> {
                    PendingRequest pending = chain.request().tag(PendingRequest.class);
                    pending.requireNetworkEffect();
                    NETWORK_CALL.set(pending);
                    try { return chain.proceed(chain.request()); }
                    finally { NETWORK_CALL.remove(); }
                })
                .addNetworkInterceptor(chain -> {
                    // All connections, including reused TLS connections, pass here
                    // before sending the application request.
                    currentRequest().requireNetworkEffect();
                    return chain.proceed(chain.request());
                }).build();
    }

    @Override public Request prepare(String url, int limit) {
        return new PendingRequest(client, url, limit);
    }

    private static PendingRequest currentRequest() throws IOException {
        PendingRequest pending = NETWORK_CALL.get();
        if (pending == null) throw new IOException("request-not-admitted");
        return pending;
    }

    private static final class UpdateSockets extends SocketFactory {
        @Override public Socket createSocket() throws IOException {
            PendingRequest pending = currentRequest();
            return new Socket() {
                @Override public void connect(SocketAddress endpoint, int timeout) throws IOException {
                    pending.requireNetworkEffect();
                    super.connect(endpoint, timeout);
                }
            };
        }

        // The pinned OkHttp client creates an unconnected socket and calls connect itself.
        @Override public Socket createSocket(String host, int port) throws IOException { throw unsupported(); }
        @Override public Socket createSocket(String host, int port, InetAddress local, int localPort) throws IOException { throw unsupported(); }
        @Override public Socket createSocket(InetAddress host, int port) throws IOException { throw unsupported(); }
        @Override public Socket createSocket(InetAddress host, int port, InetAddress local, int localPort) throws IOException { throw unsupported(); }
    }

    private static final class UpdateTlsSockets extends SSLSocketFactory {
        private final SSLSocketFactory delegate;
        UpdateTlsSockets(SSLSocketFactory delegate) { this.delegate = delegate; }

        @Override public String[] getDefaultCipherSuites() { return delegate.getDefaultCipherSuites(); }
        @Override public String[] getSupportedCipherSuites() { return delegate.getSupportedCipherSuites(); }

        @Override public Socket createSocket(Socket socket, String host, int port, boolean close) throws IOException {
            currentRequest().requireNetworkEffect();
            return delegate.createSocket(socket, host, port, close);
        }

        @Override public Socket createSocket(String host, int port) throws IOException { throw unsupported(); }
        @Override public Socket createSocket(String host, int port, InetAddress local, int localPort) throws IOException { throw unsupported(); }
        @Override public Socket createSocket(InetAddress host, int port) throws IOException { throw unsupported(); }
        @Override public Socket createSocket(InetAddress host, int port, InetAddress local, int localPort) throws IOException { throw unsupported(); }
    }

    private static IOException unsupported() { return new IOException("unguarded-socket"); }

    private static final class PendingRequest implements Request, Callback {
        private final Call call;
        private final int limit;
        private final CompletableFuture<byte[]> result = new CompletableFuture<>();
        private volatile BooleanSupplier beginEffect = () -> false;

        PendingRequest(OkHttpClient client, String url, int limit) {
            this.call = client.newCall(new okhttp3.Request.Builder().url(url)
                    .header("Accept-Encoding", "identity").tag(PendingRequest.class, this).build());
            this.limit = limit;
        }

        @Override public void start(BooleanSupplier beginEffect) {
            this.beginEffect = beginEffect;
            call.enqueue(this);
        }

        void requireNetworkEffect() throws IOException {
            if (!beginEffect.getAsBoolean()) throw new IOException("request-canceled");
        }

        @Override public byte[] receive() throws Exception {
            try {
                return result.get();
            } catch (ExecutionException failure) {
                Throwable cause = failure.getCause();
                if (cause instanceof Exception) throw (Exception) cause;
                throw failure;
            }
        }

        @Override public void cancel() {
            call.cancel();
            result.completeExceptionally(new IOException("request-canceled"));
        }

        @Override public void onFailure(Call call, IOException failure) {
            result.completeExceptionally(failure);
        }

        @Override public void onResponse(Call call, Response response) {
            try (Response managed = response) {
                if (managed.code() != 200) throw new SecurityException("fetch-status");
                ResponseBody body = managed.body();
                if (body == null || body.contentLength() > limit) throw new SecurityException("fetch-size");
                result.complete(Integrity.read(body.byteStream(), limit));
            } catch (Exception failure) {
                result.completeExceptionally(failure);
            }
        }
    }
}

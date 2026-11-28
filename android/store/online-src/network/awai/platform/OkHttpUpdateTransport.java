package network.awai.platform;

import java.io.IOException;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.TimeUnit;
import java.util.function.BooleanSupplier;
import okhttp3.Call;
import okhttp3.Callback;
import okhttp3.OkHttpClient;
import okhttp3.Response;
import okhttp3.ResponseBody;

/** Background transport with a cancellation handle that exists before a request is enqueued. */
final class OkHttpUpdateTransport implements UpdateHttpTransport {
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
        this.client = client.newBuilder().addInterceptor(chain -> {
            PendingRequest pending = chain.request().tag(PendingRequest.class);
            if (pending.stopped.getAsBoolean()) throw new IOException("request-canceled");
            return chain.proceed(chain.request());
        }).build();
    }

    @Override public Request prepare(String url, int limit) {
        return new PendingRequest(client, url, limit);
    }

    private static final class PendingRequest implements Request, Callback {
        private final Call call;
        private final int limit;
        private final CompletableFuture<byte[]> result = new CompletableFuture<>();
        private volatile BooleanSupplier stopped = () -> false;

        PendingRequest(OkHttpClient client, String url, int limit) {
            this.call = client.newCall(new okhttp3.Request.Builder().url(url)
                    .header("Accept-Encoding", "identity").tag(PendingRequest.class, this).build());
            this.limit = limit;
        }

        @Override public void start(BooleanSupplier stopped) {
            this.stopped = stopped;
            call.enqueue(this);
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

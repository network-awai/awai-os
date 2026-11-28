package network.awai.platform;

import java.util.function.BooleanSupplier;

interface UpdateHttpTransport {
    interface Request {
        void start(BooleanSupplier beginEffect);
        byte[] receive() throws Exception;
        void cancel();
    }

    Request prepare(String url, int limit);
}

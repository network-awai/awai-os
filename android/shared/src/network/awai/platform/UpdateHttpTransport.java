package network.awai.platform;

interface UpdateHttpTransport {
    interface Request {
        void start();
        byte[] receive() throws Exception;
        void cancel();
    }

    Request prepare(String url, int limit);
}

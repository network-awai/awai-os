package network.awai.murakumo;
final class Engine {
 static {System.loadLibrary("awai_llama");}
 static native boolean load(String path);
 static native boolean loaded();
 static native byte[] generate(byte[] prompt,int maxTokens);
 static native void release();
 static native void cancel();
 static native void prepare();
 static native int tokens();
}

package network.awai.murakumo;
final class ImageEngine {
 static {System.loadLibrary("awai_diffusion");}
 static native byte[] generate(String directory,byte[] prompt);
 static native int progress();
 static native void cancel();
 static native void prepare();
}

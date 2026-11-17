import network.awai.drive.DriveFiles;import java.io.*;import java.nio.file.*;import java.util.*;import java.util.concurrent.*;import java.security.*;
public class DriveFilesTest{
 static int checks=0;static void yes(boolean b){checks++;if(!b)throw new AssertionError("check "+checks);}static void reject(Callable<?> f)throws Exception{checks++;try{f.call();throw new AssertionError("accepted forbidden input");}catch(IOException expected){}}
 public static void main(String[] args)throws Exception{Path base=Path.of(args[0]);Files.createDirectories(base);DriveFiles d=new DriveFiles(base.resolve("store").toFile());
 for(String n:new String[]{"..","a/b","a\\b","bad\nname","bad\0name",".pending-test"})reject(()->DriveFiles.name(n));
 reject(()->d.resolve("../escape"));reject(()->d.resolve("/absolute"));d.mkdir("","資料");
 byte[] bytes=new byte[1024*1024+13];new Random(7).nextBytes(bytes);InputStream bounded=new ByteArrayInputStream(bytes){public synchronized int read(byte[] b,int o,int n){if(n>65536)throw new AssertionError("unbounded copy");return super.read(b,o,n);}};
 String h=d.copy("資料","test.bin",bounded,bytes.length);yes(h.equals(HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes))));yes(Arrays.equals(Files.readAllBytes(d.resolve("資料/test.bin").toPath()),bytes));
 DriveFiles reopened=new DriveFiles(base.resolve("store").toFile());yes(reopened.list("資料").length==1);reject(()->reopened.copy("資料","test.bin",new ByteArrayInputStream(new byte[]{9}),1));yes(Files.size(reopened.resolve("資料/test.bin").toPath())==bytes.length);
 reject(()->d.copy("","short",new ByteArrayInputStream(new byte[2]),3));yes(!d.resolve("short").exists());
 reject(()->d.copy("","fault",new InputStream(){int n=0;public int read()throws IOException{if(n++>7)throw new IOException("injected");return 1;}},-1));yes(!d.resolve("fault").exists());
 reject(()->d.copy("","too-large",new ByteArrayInputStream(new byte[0]),DriveFiles.MAX_BYTES+1));yes(!d.resolve("too-large").exists());
 ExecutorService pool=Executors.newFixedThreadPool(2);CountDownLatch start=new CountDownLatch(1);List<Future<Boolean>> out=new ArrayList<>();for(byte value:new byte[]{21,42})out.add(pool.submit(()->{start.await();try{new DriveFiles(base.resolve("store").toFile()).copy("","race",new ByteArrayInputStream(new byte[]{value}),1);return true;}catch(IOException e){return false;}}));start.countDown();yes(out.get(0).get()!=out.get(1).get());pool.shutdown();yes(Files.size(d.resolve("race").toPath())==1);
 Files.createSymbolicLink(base.resolve("store/link"),base.resolve("store/race"));reject(()->d.resolve("link"));reject(()->d.list(""));Files.delete(base.resolve("store/link"));yes(Arrays.stream(base.resolve("store").toFile().list()).noneMatch(n->n.startsWith(".pending-")&&!n.equals(".pending-writer.lock")));
 System.out.println("DriveFiles: "+checks+" checks passed: byte/SHA/reopen, no-clobber concurrent writers, failed/short copy, traversal/control/symlink, size bound.");}
}

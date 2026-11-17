package network.awai.drive;
import java.io.*;
import java.nio.file.*;
import java.nio.channels.*;
import java.security.*;
import java.text.Normalizer;
import java.util.*;
/** Bounded Android app-private transport adapter. Not an AwaiFS codec/CID/crypto implementation. */
public final class DriveFiles {
 public static final long MAX_BYTES=1073741824L, RESERVE=64L*1024*1024;
 public static final int BUFFER=65536, MAX_ENTRIES=1000;
 private final File root;
 public DriveFiles(File base)throws IOException{Files.createDirectories(base.toPath());root=base.getCanonicalFile();}
 public static String name(String n)throws IOException{
  if(n==null||n.trim().isEmpty()||n.length()>160||n.equals(".")||n.equals("..")||n.startsWith(".pending-")||n.matches(".*[/\\\\\\x00-\\x1f\\x7f].*"))throw new IOException("invalid-name");
  return Normalizer.normalize(n,Normalizer.Form.NFC);
 }
 public File resolve(String rel)throws IOException{
  if(rel==null||rel.length()>2048)throw new IOException("invalid-path");if(rel.isEmpty())return root;
  String[] parts=rel.split("/",-1);if(parts.length>16)throw new IOException("invalid-path");File f=root;
  for(String p:parts){f=new File(f,name(p));if(Files.isSymbolicLink(f.toPath()))throw new IOException("invalid-path");}
  if(!f.getCanonicalPath().startsWith(root.getPath()+File.separator))throw new IOException("invalid-path");return f;
 }
 public String path(File f)throws IOException{return root.toPath().relativize(f.getCanonicalFile().toPath()).toString().replace(File.separatorChar,'/');}
 private File directory(String p)throws IOException{File f=resolve(p);if(!f.isDirectory())throw new IOException("invalid-path");return f;}
 public synchronized File[] list(String p)throws IOException{
  File[] files=directory(p).listFiles(f->!f.getName().startsWith(".pending-"));if(files==null)throw new IOException("storage-unavailable");if(files.length>MAX_ENTRIES)throw new IOException("entry-limit");
  for(File f:files){if(Files.isSymbolicLink(f.toPath()))throw new IOException("invalid-path");resolve(path(f));}Arrays.sort(files,Comparator.comparing(File::isFile).thenComparing(File::getName));return files;
 }
 public synchronized void mkdir(String parent,String n)throws IOException{if(list(parent).length>=MAX_ENTRIES)throw new IOException("entry-limit");Files.createDirectory(new File(directory(parent),name(n)).toPath());}
 public synchronized String copy(String parent,String n,InputStream in,long expected)throws IOException{
  if(expected>MAX_BYTES)throw new IOException("file-too-large");if(expected< -1)throw new IOException("invalid-size");
  if(list(parent).length>=MAX_ENTRIES)throw new IOException("entry-limit");File dir=directory(parent),dest=new File(dir,name(n));if(Files.exists(dest.toPath(),LinkOption.NOFOLLOW_LINKS))throw new FileAlreadyExistsException("file-exists");
  if(dir.getUsableSpace()<RESERVE+Math.max(0,expected))throw new IOException("storage-full");
  Path tmp=Files.createTempFile(dir.toPath(),".pending-", ".part");boolean published=false;
  try{
   MessageDigest digest;try{digest=MessageDigest.getInstance("SHA-256");}catch(NoSuchAlgorithmException e){throw new IOException("sha-unavailable");}
   long total=0;byte[] buffer=new byte[BUFFER];
   try(FileOutputStream out=new FileOutputStream(tmp.toFile())){int count;while((count=in.read(buffer))!=-1){if(count==0)continue;total+=count;if(total>MAX_BYTES)throw new IOException("file-too-large");if(dir.getUsableSpace()<RESERVE+count)throw new IOException("storage-full");out.write(buffer,0,count);digest.update(buffer,0,count);}if(expected>=0&&total!=expected)throw new IOException("source-size-changed");out.getFD().sync();}
   // Android denies hard links in app storage. Serialize this private adapter's
   // writers with an OS lock, recheck no-clobber while holding it, then publish
   // with one atomic rename. Both exported document providers are read-only.
   try(RandomAccessFile guard=new RandomAccessFile(new File(dir,".pending-writer.lock"),"rw")){
    FileLock lock;try{lock=guard.getChannel().tryLock();}catch(OverlappingFileLockException e){throw new IOException("file-busy");}
    if(lock==null)throw new IOException("file-busy");
    try{if(Files.exists(dest.toPath(),LinkOption.NOFOLLOW_LINKS))throw new FileAlreadyExistsException("file-exists");Files.move(tmp,dest.toPath(),StandardCopyOption.ATOMIC_MOVE);published=true;}finally{lock.release();}
   }
   StringBuilder h=new StringBuilder();for(byte b:digest.digest())h.append(String.format(Locale.ROOT,"%02x",b&255));return h.toString();
  }finally{Files.deleteIfExists(tmp);}
 }
}

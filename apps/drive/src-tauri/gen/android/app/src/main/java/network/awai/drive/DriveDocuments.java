package network.awai.drive;
import android.provider.*;import android.database.*;import android.os.*;import java.io.*;import java.net.URLConnection;
/** Android SAF read projection. Writes remain in the app's atomic import path. */
public final class DriveDocuments extends DocumentsProvider{
 private DriveFiles files;
 public boolean onCreate(){try{files=new DriveFiles(new File(getContext().getFilesDir(),"drive-local-v1"));return true;}catch(IOException e){return false;}}
 public static String mime(File f){if(f.isDirectory())return DocumentsContract.Document.MIME_TYPE_DIR;String s=URLConnection.guessContentTypeFromName(f.getName());return s==null?"application/octet-stream":s;}
 private String rel(String id)throws FileNotFoundException{if(id.equals("root"))return "";if(!id.startsWith("entry:"))throw new FileNotFoundException();return id.substring(6);}
 private File file(String id)throws FileNotFoundException{try{File f=files.resolve(rel(id));if(!f.exists())throw new FileNotFoundException();return f;}catch(IOException e){throw new FileNotFoundException("invalid-document");}}
 public Cursor queryRoots(String[] projection){String[] cols=projection==null?new String[]{"root_id","document_id","title","flags","mime_types"}:projection;MatrixCursor c=new MatrixCursor(cols);MatrixCursor.RowBuilder row=c.newRow();for(String col:cols)row.add(col,col.equals("root_id")?"local":col.equals("document_id")?"root":col.equals("title")?"Awai Drive · この端末":col.equals("flags")?0:col.equals("mime_types")?"*/*":null);return c;}
 private static final String[] COLS={"document_id","_display_name","mime_type","flags","_size","last_modified"};
 private void row(MatrixCursor c,File f)throws IOException{String id=files.path(f).isEmpty()?"root":"entry:"+files.path(f);MatrixCursor.RowBuilder row=c.newRow();for(String col:c.getColumnNames())row.add(col,col.equals("document_id")?id:col.equals("_display_name")?(id.equals("root")?"Awai Drive":f.getName()):col.equals("mime_type")?mime(f):col.equals("flags")?0:col.equals("_size")?f.length():col.equals("last_modified")?f.lastModified():null);}
 public Cursor queryDocument(String id,String[] projection)throws FileNotFoundException{MatrixCursor c=new MatrixCursor(projection==null?COLS:projection);try{row(c,file(id));return c;}catch(IOException e){throw new FileNotFoundException();}}
 public Cursor queryChildDocuments(String id,String[] projection,String sort)throws FileNotFoundException{MatrixCursor c=new MatrixCursor(projection==null?COLS:projection);try{for(File f:files.list(rel(id)))row(c,f);return c;}catch(IOException e){throw new FileNotFoundException();}}
 public ParcelFileDescriptor openDocument(String id,String mode,CancellationSignal signal)throws FileNotFoundException{if(!"r".equals(mode))throw new FileNotFoundException("read-only-projection");if(signal!=null)signal.throwIfCanceled();return ParcelFileDescriptor.open(file(id),ParcelFileDescriptor.MODE_READ_ONLY);}
}

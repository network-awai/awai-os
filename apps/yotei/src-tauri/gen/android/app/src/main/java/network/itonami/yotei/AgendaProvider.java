package network.itonami.yotei;
import android.content.*;
import android.database.*;
import android.net.Uri;

/** Read-only, Android-signature-permission protected local projection for the HOME widget. */
public final class AgendaProvider extends ContentProvider {
    @Override public boolean onCreate(){return true;}
    @Override public Cursor query(Uri uri,String[] projection,String selection,String[] args,String sort){
        if(!"/events".equals(uri.getPath())||uri.getQuery()!=null)throw new IllegalArgumentException("unsupported-uri");
        MatrixCursor result=new MatrixCursor(new String[]{"events"});
        result.addRow(new Object[]{getContext().getSharedPreferences("agenda",0).getString("events","[]")});return result;
    }
    @Override public String getType(Uri uri){return "vnd.android.cursor.item/vnd.network.itonami.agenda";}
    @Override public Uri insert(Uri uri,ContentValues values){throw new UnsupportedOperationException();}
    @Override public int delete(Uri uri,String where,String[] args){throw new UnsupportedOperationException();}
    @Override public int update(Uri uri,ContentValues values,String where,String[] args){throw new UnsupportedOperationException();}
}

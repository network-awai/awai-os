package network.awai.home;

import android.app.Activity;
import android.app.WallpaperManager;
import android.content.Intent;
import android.graphics.BitmapFactory;
import android.os.Bundle;
import android.provider.Settings;
import android.view.View;
import android.widget.*;
import java.io.InputStream;

/** Local appearance settings. Android SystemUI exclusively owns credentials and unlock. */
public final class AppearanceActivity extends Activity {
    private int dp(int value){return Math.round(value*getResources().getDisplayMetrics().density);}
    private void text(LinearLayout page,String value,int size){TextView t=new TextView(this);t.setText(value);t.setTextSize(size);t.setPadding(0,dp(8),0,dp(8));page.addView(t);}
    private void action(LinearLayout page,String title,View.OnClickListener click){Button b=new Button(this);b.setText(title);b.setAllCaps(false);b.setMinHeight(dp(56));b.setOnClickListener(click);page.addView(b,new LinearLayout.LayoutParams(-1,-2));}
    private void settings(Intent intent){try{startActivity(intent);}catch(Exception unavailable){Toast.makeText(this,"この端末では設定画面を開けません。Android の設定から確認してください。",Toast.LENGTH_LONG).show();}}
    @Override public void onCreate(Bundle state){
        super.onCreate(state);
        ScrollView scroll=new ScrollView(this);LinearLayout page=new LinearLayout(this);page.setOrientation(LinearLayout.VERTICAL);page.setPadding(dp(24),dp(32),dp(24),dp(32));scroll.addView(page);setContentView(scroll);
        action(page,"‹ ホームに戻る",v->finish());
        text(page,"Awai の外観",28);text(page,"暮らしの、そのあいだに。",16);
        ImageView image=new ImageView(this);image.setAdjustViewBounds(true);image.setScaleType(ImageView.ScaleType.CENTER_CROP);
        try(InputStream in=getAssets().open("assets/awai-original-source-wallpaper.png")){image.setImageBitmap(BitmapFactory.decodeStream(in));}catch(Exception ignored){}
        page.addView(image,new LinearLayout.LayoutParams(-1,dp(200)));
        text(page,"ロック画面",22);text(page,"Awai の原画をロック画面に設定します。ホームの壁紙設定は変更しません。",16);
        TextView status=new TextView(this);status.setAccessibilityLiveRegion(View.ACCESSIBILITY_LIVE_REGION_POLITE);
        action(page,"ロック画面に Awai を反映",v->{
            v.setEnabled(false);
            new Thread(()->{
                String result;
                WallpaperManager manager=WallpaperManager.getInstance(this);
                try(InputStream in=getAssets().open("assets/awai-original-source-wallpaper.png")){
                    if(!manager.isWallpaperSupported()||!manager.isSetWallpaperAllowed())throw new IllegalStateException();
                    manager.setStream(in,null,false,WallpaperManager.FLAG_LOCK);
                    result="ロック画面に反映しました。";
                }catch(Exception error){result="反映できませんでした。Android の壁紙設定から確認してください。";}
                final String message=result;runOnUiThread(()->{status.setText(message);v.setEnabled(true);});
            },"awai-lock-wallpaper").start();
        });page.addView(status);
        text(page,"時計・配色・PIN",22);text(page,"時計や色は Android の壁紙・スタイル設定で調整できます。PIN と指紋による認証は Android が管理します。",16);
        action(page,"壁紙・時計・配色を調整",v->settings(new Intent(Intent.ACTION_SET_WALLPAPER)));
        action(page,"画面ロックの設定",v->settings(new Intent(Settings.ACTION_SECURITY_SETTINGS)));
        action(page,"Android の設定を開く",v->settings(new Intent(Settings.ACTION_SETTINGS)));
    }
}

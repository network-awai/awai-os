package network.awai.pinprobe;
import android.app.Instrumentation;
import android.content.*;
import android.content.res.*;
import android.content.res.loader.*;
import android.graphics.*;
import android.graphics.drawable.Drawable;
import android.os.*;
import android.view.accessibility.AccessibilityNodeInfo;
import org.json.*;
import org.xmlpull.v1.XmlPullParser;
import java.io.*;
import java.util.*;

/** Read-only resource/geometry probe. Never reads node text, credential input or security data. */
public class ResourceProbe extends Instrumentation {
 private Bundle arguments;
 @Override public void onCreate(Bundle b){super.onCreate(b);arguments=b;start();}
 @Override public void onStart(){Bundle result=new Bundle();try{
  Context own=getTargetContext().createDeviceProtectedStorageContext();JSONObject report=new JSONObject();
  if("bounds".equals(arguments.getString("mode"))){
   android.app.UiAutomation automation=getUiAutomation(1);android.accessibilityservice.AccessibilityServiceInfo info=automation.getServiceInfo();info.flags|=android.accessibilityservice.AccessibilityServiceInfo.FLAG_REPORT_VIEW_IDS|android.accessibilityservice.AccessibilityServiceInfo.FLAG_INCLUDE_NOT_IMPORTANT_VIEWS;automation.setServiceInfo(info);
   ArrayDeque<AccessibilityNodeInfo> queue=new ArrayDeque<>();AccessibilityNodeInfo root=automation.getRootInActiveWindow();if(root!=null)queue.add(root);
   JSONArray keys=new JSONArray();
   while(!queue.isEmpty()){
    AccessibilityNodeInfo n=queue.remove();String id=n.getViewIdResourceName();
    if(id!=null&&(id.endsWith("/pinEntry")||id.toLowerCase().contains("password"))){n.recycle();continue;}
    if(id!=null&&id.matches("com.android.systemui:id/(key[0-9]|delete_button|key_enter|emergency_call_button|keyguard_pin_view|pin_container|flow1)")){
     Rect r=new Rect();n.getBoundsInScreen(r);JSONObject o=new JSONObject();o.put("id",id);o.put("class",n.getClassName());o.put("bounds",new JSONArray(new int[]{r.left,r.top,r.right,r.bottom}));o.put("enabled",n.isEnabled());keys.put(o);
    }
    for(int i=0;i<n.getChildCount();i++){AccessibilityNodeInfo child=n.getChild(i);if(child!=null)queue.add(child);}n.recycle();
   }report.put("geometryOnly",keys);report.put("textRead",false);
  }else{
   File apk=new File(own.getCacheDir(),"overlay.apk");try(InputStream in=own.getAssets().open("AwaiPinOverlay.apk");OutputStream out=new FileOutputStream(apk)){byte[] buffer=new byte[8192];int count;while((count=in.read(buffer))!=-1)out.write(buffer,0,count);}
   Context target=own.createPackageContext("com.android.systemui",0);Resources resources=target.getResources();
   ResourcesLoader loader=new ResourcesLoader();ParcelFileDescriptor fd=ParcelFileDescriptor.open(apk,ParcelFileDescriptor.MODE_READ_ONLY);ResourcesProvider provider=ResourcesProvider.loadFromApk(fd);loader.addProvider(provider);resources.addLoaders(loader);
   int nativeRoot=resources.getIdentifier("keyguard_pin_view","id","com.android.systemui"),nativeInput=resources.getIdentifier("pinEntry","id","com.android.systemui");
   int ownBackground=resources.getIdentifier("awai_pin_background","drawable","network.awai.systemui.pin");
   if(nativeRoot!=0x7f0a0450||nativeInput!=0x7f0a067a||ownBackground==0)throw new IllegalStateException("resource namespaces do not match target");
   JSONObject layouts=new JSONObject();for(String name:new String[]{"awai_pin_view","awai_pin_motion_layout"}){
    int id=resources.getIdentifier(name,"layout","network.awai.systemui.pin");XmlResourceParser xml=resources.getLayout(id);Set<Integer> found=new HashSet<>();int background=0;
    while(xml.next()!=XmlPullParser.END_DOCUMENT)if(xml.getEventType()==XmlPullParser.START_TAG){
     int viewId=xml.getAttributeResourceValue("http://schemas.android.com/apk/res/android","id",0);if(viewId!=0)found.add(viewId);
     if(viewId==nativeRoot)background=xml.getAttributeResourceValue("http://schemas.android.com/apk/res/android","background",0);
    }xml.close();if(!found.contains(nativeRoot)||!found.contains(nativeInput)||background!=ownBackground)throw new IllegalStateException("native/overlay resource ID collision");layouts.put(name,found.size());
   }
   Drawable background=resources.getDrawable(ownBackground,null);Bitmap image=Bitmap.createBitmap(720,1604,Bitmap.Config.ARGB_8888);background.setBounds(0,0,720,1604);background.draw(new Canvas(image));try(OutputStream out=new FileOutputStream(new File(own.getCacheDir(),"background.png"))){image.compress(Bitmap.CompressFormat.PNG,100,out);}report.put("layoutsChecked",layouts);report.put("nativeRoot",nativeRoot);report.put("nativeInput",nativeInput);report.put("overlayBackground",ownBackground);report.put("resourceNamespaceCheck","passed");
   resources.removeLoaders(loader);loader.removeProvider(provider);provider.close();fd.close();
  }
  try(Writer out=new FileWriter(new File(own.getCacheDir(),"report.json"))){out.write(report.toString(2));}result.putString("report",report.toString());finish(-1,result);
 }catch(Throwable error){result.putString("error",error.toString());finish(0,result);}}
}

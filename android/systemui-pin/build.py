#!/usr/bin/env python3
"""Build a target-pinned, code-free SystemUI PIN RRO. Never deploys or touches credentials."""
import argparse,hashlib,json,pathlib,re,shutil,subprocess,xml.etree.ElementTree as E,zipfile
ROOT=pathlib.Path(__file__).resolve().parents[2];HERE=pathlib.Path(__file__).resolve().parent
ANDROID='http://schemas.android.com/apk/res/android';AUTO='http://schemas.android.com/apk/res-auto';SYS='http://schemas.android.com/apk/prv/res/com.android.systemui'
E.register_namespace('android',ANDROID);E.register_namespace('sysui',SYS)
def run(args,**kw):return subprocess.run([str(a) for a in args],check=True,text=True,**kw)
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def native(v):return re.sub(r'@\+?(?=(?:id|layout|dimen|style|string|integer|drawable|xml|color)/)','@*com.android.systemui:',v)
def identities(root):return {v.rsplit('/',1)[-1]:n.tag for n in root.iter() for k,v in n.attrib.items() if k=='{'+ANDROID+'}id'}
def layout(source,portrait,settings):
 original=E.parse(source).getroot();doc=E.parse(source).getroot()
 for n in doc.iter():
  for k,v in list(n.attrib.items()):
   del n.attrib[k];n.set(k.replace(AUTO,SYS),native(v))
 if portrait:
  doc.set('{'+ANDROID+'}background','@drawable/awai_pin_background')
  for side,value in [('Left',settings['sideDp']),('Right',settings['sideDp']),('Top',settings['topDp']),('Bottom',settings['bottomDp'])]:doc.set('{'+ANDROID+'}padding'+side,str(value)+'dp')
  for n in doc.iter():
   name=n.get('{'+ANDROID+'}id','').rsplit('/',1)[-1]
   if name in [*(f'key{i}' for i in range(10)),'delete_button','key_enter']:
    for dim in ['width','height']:n.set('{'+ANDROID+'}layout_'+dim,str(settings['keyDp'])+'dp')
    n.set('{'+SYS+'}layout_constraintWidth_max',str(settings['keyDp'])+'dp');n.set('{'+ANDROID+'}background','@drawable/awai_pin_key')
   if name=='pinEntry':
    n.set('{'+ANDROID+'}layout_width','match_parent');n.set('{'+ANDROID+'}layout_height','52dp');n.attrib.pop('{'+ANDROID+'}layout_marginRight',None)
   if name=='row0':
    n.set('{'+ANDROID+'}paddingBottom','16dp');n.attrib.pop('{'+SYS+'}layout_constraintBottom_toTopOf',None)
   if name=='flow1':
    n.set('{'+ANDROID+'}layout_height','wrap_content');n.set('{'+ANDROID+'}layout_marginTop','20dp');n.set('{'+SYS+'}flow_verticalBias','0.0');n.set('{'+SYS+'}flow_horizontalGap',str(settings['columnGapDp'])+'dp');n.set('{'+SYS+'}flow_verticalGap',str(settings['rowGapDp'])+'dp');n.set('{'+SYS+'}layout_constraintTop_toBottomOf','@*com.android.systemui:id/row0')
   if name=='keyguard_selector_fade_container':n.set('{'+SYS+'}layout_constraintVertical_bias','1.0')
 assert identities(original)==identities(doc),'native IDs/types changed'
 for a,b in zip(original.iter(),doc.iter()):
  for k,v in a.attrib.items():
   if k.endswith('}digit') or k.endswith('}textView') or k.endswith('}contentDescription') or k.endswith('}accessibilityTraversalBefore'):
    assert b.get(k.replace(AUTO,SYS))==native(v),'native input/accessibility binding changed'
 return E.tostring(doc,encoding='unicode')
def main():
 p=argparse.ArgumentParser();p.add_argument('--systemui',type=pathlib.Path,required=True);p.add_argument('--framework',type=pathlib.Path,required=True);p.add_argument('--out',type=pathlib.Path,default=ROOT/'.agent-output/pin-overlay');a=p.parse_args();pins=json.loads((HERE/'target.json').read_text());assert sha(a.systemui)==pins['systemUiSha256'],'unknown SystemUI build'
 
 for name,expected in pins['upstreamSha256'].items():assert sha(HERE/'upstream'/name)==expected,'upstream layout drift'
 sdk=pathlib.Path.home()/'Library/Android/sdk';tools=sdk/'build-tools/36.1.0';out=a.out.resolve();out.mkdir(parents=True,exist_ok=True);res=out/'res';shutil.copytree(HERE/'res',res,dirs_exist_ok=True)
 for portrait in [False,True]:
  dest=res/('layout-port' if portrait else 'layout');dest.mkdir(exist_ok=True)
  for name in ['keyguard_pin_view','keyguard_pin_motion_layout']:
   xml=layout(HERE/'upstream'/(name+'.xml'),portrait,pins['portrait']);(dest/(name.replace('keyguard_','awai_')+'.xml')).write_text(xml)
 artwork=ROOT/'android/client/assets/awai-original-source-wallpaper.png';assert sha(artwork)==pins['wallpaperSha256'];(res/'drawable-nodpi').mkdir(exist_ok=True);shutil.copyfile(artwork,res/'drawable-nodpi/awai_wallpaper.png')
 for variant,scrim,container in [('values','#DEFFFFFF','#e1eaff'),('values-night','#DE14110F','#26354e')]:
  folder=res/variant;folder.mkdir(exist_ok=True);(folder/'colors.xml').write_text('<resources><color name="awai_pin_scrim">'+scrim+'</color><color name="awai_pin_container">'+container+'</color></resources>')
 run([tools/'aapt2','compile','--dir',res,'-o',out/'resources.zip'])
 run([tools/'aapt2','link','--shared-lib','--no-resource-deduping','--no-resource-removal','-o',out/'unsigned.apk','--manifest',HERE/'AndroidManifest.xml','-I',a.framework,'-I',a.systemui,out/'resources.zip'])
 run([tools/'zipalign','-f','4',out/'unsigned.apk',out/'aligned.apk']);apk=out/'AwaiPinOverlay.apk';run([tools/'apksigner','sign','--ks',pathlib.Path.home()/'.android/debug.keystore','--ks-key-alias','androiddebugkey','--ks-pass','pass:android','--out',apk,out/'aligned.apk']);run([tools/'apksigner','verify',apk])
 with zipfile.ZipFile(apk) as z:assert not any(n.endswith('.dex') for n in z.namelist())
 report={'target':pins,'apkSha256':sha(apk),'bytes':apk.stat().st_size,'noDex':True,'nativeIdentityAndInputBindingCheck':'passed','deployment':'not performed'};(out/'build.json').write_text(json.dumps(report,indent=2));print(json.dumps(report,indent=2))
if __name__=='__main__':main()

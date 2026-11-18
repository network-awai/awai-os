#!/usr/bin/env python3
"""Build reversible Android Otehon hosts from installed SDK tools; no Gradle/plugin download.
Shared UI/domain and a development-signed, bundled catalog are also staged for NixOS.
Never installs on a device. Outputs stay in the task's .agent-output directory by default.
"""
import argparse, base64, hashlib, json, os, pathlib, shutil, subprocess, time, zipfile, re

ROOT = pathlib.Path(__file__).resolve().parent.parent
def run(args, **kw):
    return subprocess.run([str(x) for x in args], check=True, text=True, **kw)
def digest(path): return hashlib.sha256(path.read_bytes()).hexdigest()
def manifest(pkg, activity, version, kind, online=False):
    perms = ''
    extra = ''
    home = ''
    if kind == 'home':
        perms = '<uses-permission android:name="network.awai.permission.READ_AGENDA"/><uses-permission android:name="android.permission.SET_WALLPAPER"/><uses-permission android:name="android.permission.ACCESS_NETWORK_STATE"/><uses-permission android:name="android.permission.INTERNET"/>'
        extra = '<activity android:name="network.awai.home.AppearanceActivity" android:exported="false" android:label="Awai の外観"/>'
        home = '<intent-filter><action android:name="android.intent.action.MAIN"/><category android:name="android.intent.category.HOME"/><category android:name="android.intent.category.DEFAULT"/></intent-filter>'
    if kind == 'store':
        perms = '<uses-permission android:name="android.permission.REQUEST_INSTALL_PACKAGES"/>' + ('<uses-permission android:name="android.permission.INTERNET"/><uses-permission android:name="android.permission.ACCESS_NETWORK_STATE"/>' if online else '')
        extra = '<receiver android:name="network.awai.platform.InstallReceiver" android:exported="false"/>'
    if kind == 'yotei':
        perms = '<permission android:name="network.awai.permission.READ_AGENDA" android:protectionLevel="signature"/>'
        extra = '<provider android:name="network.itonami.yotei.AgendaProvider" android:authorities="network.itonami.yotei.agenda" android:exported="true" android:readPermission="network.awai.permission.READ_AGENDA" android:writePermission="network.awai.permission.READ_AGENDA"/>'
    if kind == 'torihiki':
        perms = '<uses-permission android:name="android.permission.INTERNET"/>'
    theme='AwaiHomeTheme' if kind=='home' else 'AwaiTheme'
    appicon='@drawable/awai_mark' if kind=='home' else '@android:drawable/ic_menu_today'
    title={'home':'Awai Home','store':'itonami Store','yotei':'Yotei','torihiki':'Torihiki'}[kind]
    return f'''<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="{pkg}" android:versionCode="{version}" android:versionName="0.1.{version-1}">
      <uses-sdk android:minSdkVersion="35" android:targetSdkVersion="37"/>{perms}
      <queries><intent><action android:name="android.intent.action.MAIN"/><category android:name="android.intent.category.LAUNCHER"/></intent>
      <intent><action android:name="android.intent.action.MAIN"/><category android:name="android.intent.category.APP_BROWSER"/></intent>
      <intent><action android:name="android.intent.action.DIAL"/></intent><intent><action android:name="android.media.action.STILL_IMAGE_CAMERA"/></intent>
      <package android:name="network.itonami.yotei"/><package android:name="network.itonami.torihiki"/><package android:name="network.awai.store"/><provider android:authorities="network.itonami.yotei.agenda"/></queries>
      <application android:theme="@style/{theme}" android:label="{title}" android:icon="{appicon}" android:allowBackup="false" android:usesCleartextTraffic="false" android:debuggable="true" android:enableOnBackInvokedCallback="true">
      <activity android:name="{activity}" android:exported="true" android:launchMode="singleTask" android:windowSoftInputMode="adjustResize">
      <intent-filter><action android:name="android.intent.action.MAIN"/><category android:name="android.intent.category.LAUNCHER"/></intent-filter>{home}</activity>{extra}</application></manifest>'''

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--version',type=int,default=1);ap.add_argument('--sdk',type=pathlib.Path,default=pathlib.Path.home()/'Library/Android/sdk');ap.add_argument('--java',type=pathlib.Path,default=pathlib.Path('/opt/homebrew/opt/openjdk/bin'));ap.add_argument('--out',type=pathlib.Path,default=ROOT/'.agent-output/android');ap.add_argument('--skip-cljs',action='store_true');ap.add_argument('--online-pins',type=pathlib.Path);ap.add_argument('--catalog-revision',type=int,default=None);ap.add_argument('--itonami-apk',type=pathlib.Path,default=None);ap.add_argument('--torihiki-bot-apk',type=pathlib.Path,default=None);ap.add_argument('--tabi-mikake-apk',type=pathlib.Path,default=None);ap.add_argument('--deai-apk',type=pathlib.Path,default=None);ap.add_argument('--hiring-apk',type=pathlib.Path,default=None);ap.add_argument('--home-only',action='store_true');args=ap.parse_args()
    if args.catalog_revision is not None and args.catalog_revision<1:raise SystemExit('positive catalog revision required')
    if args.version<1:raise SystemExit('positive version required')
    out=args.out.resolve();out.mkdir(parents=True,exist_ok=True);tools=args.sdk/'build-tools/36.1.0';jar=args.sdk/'platforms/android-37.0/android.jar'
    key=pathlib.Path.home()/'.android/debug.keystore'
    for f in [jar,tools/'aapt2',tools/'d8',tools/'apksigner',key,args.java/'javac']:
        if not f.is_file():raise SystemExit(f'missing build prerequisite: {f}')
    if not args.skip_cljs:run(['clojure','-M:build'],cwd=ROOT/'android/client')
    run(['node',ROOT/'android/build-identity.mjs'],cwd=ROOT)
    if not (ROOT/'android/client/generated/domain.js').is_file():raise SystemExit('shared CLJS domain is not built')
    run(['bb','-cp','android/contracts/src','android/contracts/export.clj',out/'shared.json'],cwd=ROOT)
    common=json.loads((out/'shared.json').read_text());assets=out/'web';assets.mkdir(exist_ok=True)
    for name in ['index.html','client.css','client.js','online.js','setup.js','setup.css','torihiki.js']:shutil.copyfile(ROOT/'android/client'/name,assets/name)
    shutil.copytree(ROOT/'android/client/assets',assets/'assets',dirs_exist_ok=True)
    shutil.copyfile(ROOT/'android/client/generated/domain.js',assets/'domain.js')
    shutil.copyfile(ROOT/'android/client/generated/identity.js',assets/'identity.js')
    pins=json.loads((ROOT/'otehon/shell/vendor/PINS.json').read_text());runtime=ROOT/'otehon/shell/vendor/kotoba-client-runtime.js'
    if digest(runtime)!=pins['files']['kotoba-client-runtime.js']:raise SystemExit('canonical runtime pin drift')
    shutil.copyfile(runtime,assets/'runtime.js')
    consent=ROOT/'otehon/shell/vendor/kotoba-client-consent.css'
    if digest(consent)!=pins['files']['kotoba-client-consent.css']:raise SystemExit('canonical consent CSS pin drift')
    shutil.copyfile(consent,assets/'runtime-consent.css')
    pins_online=json.loads(args.online_pins.read_text()) if args.online_pins else None
    (assets/'online-pins.json').write_text(json.dumps(pins_online,separators=(',',':')))
    (assets/'online-data.js').write_text('window.ItonamiOnlinePins='+json.dumps(pins_online,separators=(',',':'))+';\n')
    if pins_online:
        connect=run(['node',ROOT/'android/online-csp.mjs'],input=json.dumps({'assets':str(assets),'pins':pins_online,'descriptor':common['descriptor']}),capture_output=True).stdout.strip()
        html=(assets/'index.html').read_text().replace("connect-src 'none'",connect)
        (assets/'index.html').write_text(html)
    (assets/'catalog-data.js').write_text('window.ItonamiCatalog={apps:[]};\n')
    css='@layer tokens { :root { color-scheme: light dark; '+''.join(f'--{k}:{v};'for k,v in common['palette']['light'].items())+' } @media (prefers-color-scheme:dark) { :root {'+''.join(f'--{k}:{v};'for k,v in common['palette']['dark'].items())+' } } }\n'
    (assets/'tokens.css').write_text(css)
    resources=out/'res'
    for mode,parent in [('light','android:style/Theme.Material.Light.NoActionBar'),('dark','android:style/Theme.Material.NoActionBar')]:
        folder=resources/('values'if mode=='light'else'values-night');folder.mkdir(parents=True,exist_ok=True)
        (folder/'styles.xml').write_text(f'<resources><style name="AwaiTheme" parent="{parent}"><item name="android:fontFamily">sans</item><item name="android:windowActionModeOverlay">true</item><item name="android:colorAccent">{common["palette"][mode]["primary"]}</item></style><color name="awai_background">{common["palette"][mode]["background"]}</color></resources>')
    drawable=resources/'drawable-nodpi';drawable.mkdir(parents=True,exist_ok=True)
    shutil.copyfile(ROOT/'otehon/branding/awai-desktop-logo.png',drawable/'awai_mark.png')
    for folder in [resources/'values',resources/'values-night']:
        path=folder/'styles.xml'
        path.write_text(path.read_text().replace('</resources>','<style name="AwaiHomeTheme" parent="AwaiTheme"><item name="android:windowSplashScreenBackground">@color/awai_background</item><item name="android:windowSplashScreenAnimatedIcon">@drawable/awai_mark</item><item name="android:windowSplashScreenBehavior">icon_preferred</item></style></resources>'))
    run([args.java/'javac','-d',out,ROOT/'android/SignCatalog.java'])
    # SignCatalog emits only a public certificate fingerprint; private key/password never enter output artifacts.
    probe=out/'probe';probe.write_bytes(b'fingerprint')
    fp=run([args.java/'java','-cp',out,'SignCatalog',key,probe,out/'catalog-key.der',out/'probe.sig'],capture_output=True).stdout.strip()
    def build(kind,pkg,activity):
        stage=out/f'{kind}-v{args.version}';stage.mkdir(exist_ok=True);classes=stage/'classes';classes.mkdir(exist_ok=True);gen=stage/'gen';gen.mkdir(exist_ok=True);dex=stage/'dex';dex.mkdir(exist_ok=True)
        # Explicitly rebuild only this task's generated outputs; unrelated workspace data is untouched.
        xml=stage/'AndroidManifest.xml';xml.write_text(manifest(pkg,activity,args.version,kind,bool(pins_online)))
        staged_assets=stage/'assets'
        shutil.copytree(assets,staged_assets,dirs_exist_ok=True,
                        ignore=shutil.ignore_patterns('packages','catalog.json','catalog.sig','catalog-key.der') if kind!='store' else None)
        if kind!='store':
            (staged_assets/'catalog-data.js').write_text('window.ItonamiCatalog={apps:[]};\n')
            (staged_assets/'online-data.js').write_text('window.ItonamiOnlinePins=null;\n')
            (staged_assets/'online-pins.json').write_text('null')
            (staged_assets/'index.html').write_text((ROOT/'android/client/index.html').read_text())
        if kind=='torihiki':
            # Exactly the origin declared by torihiki.js; HostActivity.torihikiRead/torihikiTx narrow it to the declared routes.
            html=(staged_assets/'index.html').read_text().replace("connect-src 'none'","connect-src https://torihiki-node.04-feasts-minded.workers.dev")
            (staged_assets/'index.html').write_text(html)
        if kind=='home':
            html=(staged_assets/'index.html').read_text().replace("connect-src 'none'","connect-src https://relay.awai.network")
            (staged_assets/'index.html').write_text(html)
        files=sorted(str(p.relative_to(staged_assets)).replace(os.sep,'/')for p in staged_assets.rglob('*')if p.is_file()and p.name not in ['assets.list','catalog.json','catalog.sig','catalog-key.der']and not str(p.relative_to(staged_assets)).startswith('packages/'))
        (staged_assets/'assets.list').write_text('\n'.join(files)+'\n')
        run([tools/'aapt2','compile','--dir',resources,'-o',stage/'resources.zip'])
        run([tools/'aapt2','link','-o',stage/'resources.apk','--manifest',xml,'-I',jar,'--java',gen,'-R',stage/'resources.zip','-A',staged_assets,'--auto-add-overlay'])
        sources=list((ROOT/'android/shared/src').rglob('*.java'))+list((ROOT/'android'/kind/'src').rglob('*.java'))+list(gen.rglob('*.java'))
        run([args.java/'javac','--release','8','-encoding','UTF-8','-cp',jar,'-d',classes,*sources])
        run([tools/'d8','--min-api','35','--lib',jar,'--output',dex,*classes.rglob('*.class')])
        unsigned=stage/'unsigned.apk';shutil.copyfile(stage/'resources.apk',unsigned)
        with zipfile.ZipFile(unsigned,'a',compression=zipfile.ZIP_DEFLATED)as z:
            for f in dex.glob('*.dex'):z.write(f,f.name)
        run([tools/'zipalign','-f','4',unsigned,stage/'aligned.apk'])
        apk=out/f'{kind}-v{args.version}.apk'
        run([tools/'apksigner','sign','--ks',key,'--ks-key-alias','androiddebugkey','--ks-pass','pass:android','--key-pass','pass:android','--out',apk,stage/'aligned.apk'])
        run([tools/'apksigner','verify','--verbose',apk],stdout=subprocess.DEVNULL)
        return apk
    if args.home_only:
        home=build('home','network.awai.home','network.awai.home.HomeActivity')
        report={'schema':'awai.android.home-build.v1','version':args.version,'publicSignerSha256':fp,'runtime':pins,'artifacts':{home.name:{'sha256':digest(home),'bytes':home.stat().st_size}},'identitySourceSha256':digest(ROOT/'android/client/identity-entry.js'),'identityVerifierSha256':digest(ROOT/'otehon/shell/src/identity/link.js'),'deviceSourceSha256':digest(ROOT/'otehon/shell/src/identity/device.js')}
        (out/f'home-build-v{args.version}.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2));return
    yotei=build('yotei','network.itonami.yotei','network.itonami.yotei.YoteiActivity')
    torihiki=build('torihiki','network.itonami.torihiki','network.itonami.torihiki.TorihikiActivity')
    packages=assets/'packages';packages.mkdir(exist_ok=True);shutil.copyfile(yotei,packages/'yotei.apk');shutil.copyfile(torihiki,packages/'torihiki.apk')
    revision=args.catalog_revision if args.catalog_revision is not None else args.version
    listed=[{'id':'network.itonami.yotei','name':'Yotei','description':'予定をこの端末に保存します。外部への送信や同期、通知配信は行いません。','publisher':'Awai Otehon 開発版','versionCode':args.version,'versionName':f'0.1.{args.version-1}','artifacts':[{'platform':'android','runtime':'android','kind':'apk','asset':'packages/yotei.apk','bytes':yotei.stat().st_size,'sha256':digest(yotei),'signerSha256':fp},{'platform':'nixos','runtime':'browser','kind':'bundled-web','asset':'bundled:yotei','bytes':(assets/'client.js').stat().st_size,'sha256':digest(assets/'client.js')}]},
            {'id':'network.itonami.torihiki','name':'Torihiki','description':'取引所 devnet の価格・板・ノード状態を表示し、端末の鍵で署名して devnet に発注できます。devnet・デモ専用で、実際の資産は扱いません。通信は毎回確認します。','publisher':'Awai Otehon 開発版','versionCode':args.version,'versionName':f'0.1.{args.version-1}','artifacts':[{'platform':'android','runtime':'android','kind':'apk','asset':'packages/torihiki.apk','bytes':torihiki.stat().st_size,'sha256':digest(torihiki),'signerSha256':fp}]}]
    if args.itonami_apk is not None:
        staged=packages/'itonami.apk';shutil.copyfile(args.itonami_apk,staged)
        signer=run([tools/'apksigner','verify','--print-certs',staged],capture_output=True).stdout
        if fp not in signer:raise SystemExit('itonami APK signer does not match the development identity')
        listed.append({'id':'network.itonami.app','name':'Itonami','description':'NixOS 版 Itonami UI を一つの Tauri v3 アプリにまとめた開発版。既存 Home・Store・Yotei は保持し別アプリ ID で追加。Nix 専用サービスは未移植で機能表示しない。Android development debug 署名（本番鍵ではない）。','publisher':'Awai Otehon 開発版','versionCode':1000,'versionName':'0.1.0','artifacts':[{'platform':'android','runtime':'android','kind':'apk','asset':'packages/itonami.apk','bytes':staged.stat().st_size,'sha256':digest(staged),'signerSha256':fp}]})
    if args.torihiki_bot_apk is not None:
        # Tauri v3 APK built from network-awai/app-itonami-torihiki app/. The listed id, version and signer are read from
        # the APK itself and refused unless they are exactly the admitted package and the development identity.
        staged=packages/'torihiki-bot.apk';shutil.copyfile(args.torihiki_bot_apk,staged)
        signer=run([tools/'apksigner','verify','--print-certs',staged],capture_output=True).stdout
        if [l.rsplit(' ',1)[-1] for l in signer.splitlines() if 'certificate SHA-256 digest:' in l]!=[fp]:raise SystemExit('torihiki bot APK signer does not match the development identity')
        badging=run([tools/'aapt2','dump','badging',staged],capture_output=True).stdout.splitlines()[0]
        m=re.fullmatch(r"package: name='([^']+)' versionCode='([0-9]+)' versionName='([^']+)'.*",badging)
        if not m or m.group(1)!='network.itonami.torihiki.bot':raise SystemExit('torihiki bot APK package is not network.itonami.torihiki.bot')
        listed.append({'id':'network.itonami.torihiki.bot','name':'Torihiki Bot','description':'市場運営 bot（ISIC 6611）の profile と稼働状況、取引所 devnet の価格・板を読み取り専用で表示します。発注・鍵・入出金はありません。devnet・デモ専用で、通信は毎回確認します。Android development debug 署名（本番鍵ではない）。','publisher':'Awai Otehon 開発版','versionCode':int(m.group(2)),'versionName':m.group(3),'artifacts':[{'platform':'android','runtime':'android','kind':'apk','asset':'packages/torihiki-bot.apk','bytes':staged.stat().st_size,'sha256':digest(staged),'signerSha256':fp}]})
    if args.tabi_mikake_apk is not None:
        # Tauri v3 APK built from network-awai/app-tabi-mikake (AWAI-3301/3302). The listed id, version and signer are read
        # from the APK itself and refused unless they are exactly the admitted package and the development identity.
        staged=packages/'tabi-mikake.apk';shutil.copyfile(args.tabi_mikake_apk,staged)
        signer=run([tools/'apksigner','verify','--print-certs',staged],capture_output=True).stdout
        if [l.rsplit(' ',1)[-1] for l in signer.splitlines() if 'certificate SHA-256 digest:' in l]!=[fp]:raise SystemExit('tabi mikake APK signer does not match the development identity')
        badging=run([tools/'aapt2','dump','badging',staged],capture_output=True).stdout
        m=re.fullmatch(r"package: name='([^']+)' versionCode='([0-9]+)' versionName='([^']+)'.*",badging.splitlines()[0])
        if not m or m.group(1)!='network.itonami.tabimikake':raise SystemExit('tabi mikake APK package is not network.itonami.tabimikake')
        # ADR 0046 D6: the app declares no external operation, so its APK must not ask for network access.
        if "uses-permission: name='android.permission.INTERNET'" in badging:raise SystemExit('tabi mikake APK requests INTERNET')
        listed.append({'id':'network.itonami.tabimikake','name':'Tabi Mikake','description':'航空券と宿の価格を、この端末で比べます。予約・支払いは予約先のサイトで行い、このアプリは予約しません。この版は架空のデータだけを使い、外部へは何も送信しません。Android development debug 署名（本番鍵ではない）。','publisher':'Awai Otehon 開発版','versionCode':int(m.group(2)),'versionName':m.group(3),'artifacts':[{'platform':'android','runtime':'android','kind':'apk','asset':'packages/tabi-mikake.apk','bytes':staged.stat().st_size,'sha256':digest(staged),'signerSha256':fp}]})
    if args.deai_apk is not None:
        # Tauri v3 APK built from network-awai/app-deai (AWAI-3373/3374). The listed id, version and signer are read
        # from the APK itself and refused unless they are exactly the admitted package and the development identity.
        staged=packages/'deai.apk';shutil.copyfile(args.deai_apk,staged)
        signer=run([tools/'apksigner','verify','--print-certs',staged],capture_output=True).stdout
        if [l.rsplit(' ',1)[-1] for l in signer.splitlines() if 'certificate SHA-256 digest:' in l]!=[fp]:raise SystemExit('deai APK signer does not match the development identity')
        badging=run([tools/'aapt2','dump','badging',staged],capture_output=True).stdout
        m=re.fullmatch(r"package: name='([^']+)' versionCode='([0-9]+)' versionName='([^']+)'.*",badging.splitlines()[0])
        if not m or m.group(1)!='network.itonami.deai':raise SystemExit('deai APK package is not network.itonami.deai')
        # The app declares no external operation (operations: []), so its APK must not ask for network access.
        if "uses-permission: name='android.permission.INTERNET'" in badging:raise SystemExit('deai APK requests INTERNET')
        listed.append({'id':'network.itonami.deai','name':'Deai','description':'出会いの準備をこの端末だけで進めます。プロフィールの下書きと、自分で入力した候補の並び順と理由を表示します。外部への送信、遠隔推論、利用者どうしの連絡はありません。Android development debug 署名（本番鍵ではない）。','publisher':'Awai Otehon 開発版','versionCode':int(m.group(2)),'versionName':m.group(3),'artifacts':[{'platform':'android','runtime':'android','kind':'apk','asset':'packages/deai.apk','bytes':staged.stat().st_size,'sha256':digest(staged),'signerSha256':fp}]})
    if args.hiring_apk is not None:
        # Tauri v3 APK built from network-awai/app-itonami-hiring (AWAI-3175/3176, ADR 0043 S1). The listed id, version and
        # signer are read from the APK itself and refused unless they are exactly the admitted package and the development identity.
        staged=packages/'hiring.apk';shutil.copyfile(args.hiring_apk,staged)
        signer=run([tools/'apksigner','verify','--print-certs',staged],capture_output=True).stdout
        if [l.rsplit(' ',1)[-1] for l in signer.splitlines() if 'certificate SHA-256 digest:' in l]!=[fp]:raise SystemExit('hiring APK signer does not match the development identity')
        badging=run([tools/'aapt2','dump','badging',staged],capture_output=True).stdout
        m=re.fullmatch(r"package: name='([^']+)' versionCode='([0-9]+)' versionName='([^']+)'.*",badging.splitlines()[0])
        if not m or m.group(1)!='network.itonami.hiring':raise SystemExit('hiring APK package is not network.itonami.hiring')
        # The app declares no external operation (AWAI-3175), so its APK must not ask for network access.
        if "uses-permission: name='android.permission.INTERNET'" in badging:raise SystemExit('hiring APK requests INTERNET')
        listed.append({'id':'network.itonami.hiring','name':'Hiring','description':'求職・求人の bot が作った下書き（応募文・求人告知）を、この端末で確かめて承認・差し戻しします。応募・投稿・送信はしません。記録は端末の中だけに残します。Android development debug 署名（本番鍵ではない）。','publisher':'Awai Otehon 開発版','versionCode':int(m.group(2)),'versionName':m.group(3),'artifacts':[{'platform':'android','runtime':'android','kind':'apk','asset':'packages/hiring.apk','bytes':staged.stat().st_size,'sha256':digest(staged),'signerSha256':fp}]})
    catalog={'schema':'itonami.store.bundled.v1','revision':revision,'expiresAt':int(time.time())+30*86400,'apps':listed}
    raw=json.dumps(catalog,ensure_ascii=False,separators=(',',':'));(assets/'catalog.json').write_text(raw)
    run([args.java/'java','-cp',out,'SignCatalog',key,assets/'catalog.json',assets/'catalog-key.der',assets/'catalog.sig'],stdout=subprocess.DEVNULL)
    (assets/'catalog-data.js').write_text('window.ItonamiCatalogRaw='+json.dumps(raw,ensure_ascii=False)+';window.ItonamiCatalog=JSON.parse(window.ItonamiCatalogRaw);window.ItonamiCatalogSignature='+json.dumps(base64.b64encode((assets/'catalog.sig').read_bytes()).decode())+';window.ItonamiPublicKey='+json.dumps(base64.b64encode((assets/'catalog-key.der').read_bytes()).decode())+';\n')
    store=build('store','network.awai.store','network.awai.store.StoreActivity')
    home=build('home','network.awai.home','network.awai.home.HomeActivity')
    report={'schema':'awai.android.build.v1','version':args.version,'sdk':37,'buildTools':'36.1.0','signing':'local-android-debug-only','publicSignerSha256':fp,'runtime':pins,'artifacts':{p.name:{'sha256':digest(p),'bytes':p.stat().st_size}for p in [home,store,yotei,torihiki]},'sharedDomainSha256':digest(ROOT/'android/contracts/src/itonami/store/domain.cljc'),'sharedClientSha256':digest(assets/'client.js')}
    (out/f'build-v{args.version}.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2))
if __name__=='__main__':main()

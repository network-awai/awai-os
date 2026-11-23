#!/usr/bin/env python3
"""Build reversible Android Otehon hosts from installed SDK tools; no Gradle/plugin download.
Shared UI/domain and a development-signed, bundled catalog are also staged for NixOS.
Never installs on a device. Outputs stay in the task's .agent-output directory by default.
"""
import argparse, base64, hashlib, json, os, pathlib, shutil, subprocess, time, zipfile, re

ROOT = pathlib.Path(__file__).resolve().parent.parent
# AWAI-3882: the publisher is defined once in store/catalog-source/series-apps.json and
# referenced here; never copy the literal per app entry.
PUBLISHER = json.loads((ROOT / 'store/catalog-source/series-apps.json').read_text())['publisher']
def run(args, **kw):
    return subprocess.run([str(x) for x in args], check=True, text=True, **kw)
def digest(path): return hashlib.sha256(path.read_bytes()).hexdigest()
DEBUG_KEYSTORE=pathlib.Path.home()/'.android/debug.keystore'
# AWAI-3775: development root and role keys, outside any repository (see store/keys/README.md).
DEV_KEY_DIR=pathlib.Path.home()/'.android/awai-store-dev'
DEV_CATALOG_KEYSTORE=DEV_KEY_DIR/'catalog.p12'
DEV_KEY_PASSWORD=DEV_KEY_DIR/'password'
def store_query_packages(pins=None):
    """Every package the Store may list, named in <queries> so the Store sees it whether or not it has a launcher
    activity (AWAI-3771): the ids written in Catalog.java, the local apps, the series table, and any online pins.
    Without this, a package with no MAIN/LAUNCHER activity looked not installed, and the Store's own downgrade and
    signer checks were skipped. QUERY_ALL_PACKAGES is not used."""
    ids = set(re.findall(r'"((?:network|app)\.[a-z][a-z0-9]*(?:\.[a-z][a-z0-9]*)+)"',
                         (ROOT/'android/shared/src/network/awai/platform/Catalog.java').read_text()))
    ids.update('network.itonami.'+a['suffix'] for a in json.loads((ROOT/'android/local-apps.json').read_text())['apps'])
    ids.update(a['id'] for a in json.loads((ROOT/'store/catalog-source/series-apps.json').read_text())['apps'])
    if pins: ids.update(pins['apks'])
    for i in ids:
        if not re.fullmatch(r'[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)+', i): raise SystemExit(f'not a package id for <queries>: {i}')
    return sorted(ids)
def manifest(pkg, activity, version, kind, online=False, debuggable=True, query_packages=()):
    perms = ''
    extra = ''
    home = ''
    if kind == 'home':
        perms = '<uses-permission android:name="network.awai.permission.READ_AGENDA"/><uses-permission android:name="android.permission.SET_WALLPAPER"/><uses-permission android:name="android.permission.ACCESS_NETWORK_STATE"/><uses-permission android:name="android.permission.INTERNET"/>'
        perms += ('<uses-permission android:name="android.permission.HIDE_OVERLAY_WINDOWS"/>'
                  '<permission android:name="network.awai.permission.HOST_ACCOUNT" android:protectionLevel="signature"/>')
        extra = ('<activity android:name="network.awai.home.AppearanceActivity" android:exported="false" android:label="Awai の外観"/>'
                 '<activity android:name="network.awai.home.AccountBrokerActivity" android:exported="true" android:excludeFromRecents="true" android:label="Awai アカウント"/>'
                 '<provider android:name="network.awai.home.HostAccountProvider" android:authorities="network.awai.home.account" android:exported="true" android:permission="network.awai.permission.HOST_ACCOUNT"/>')
        home = '<intent-filter><action android:name="android.intent.action.MAIN"/><category android:name="android.intent.category.HOME"/><category android:name="android.intent.category.DEFAULT"/></intent-filter>'
    if kind == 'store':
        perms = '<uses-permission android:name="android.permission.REQUEST_INSTALL_PACKAGES"/><uses-permission android:name="android.permission.UPDATE_PACKAGES_WITHOUT_USER_ACTION"/>' + ('<uses-permission android:name="android.permission.INTERNET"/><uses-permission android:name="android.permission.ACCESS_NETWORK_STATE"/><uses-permission android:name="android.permission.RECEIVE_BOOT_COMPLETED"/><uses-permission android:name="android.permission.POST_NOTIFICATIONS"/>' if online else '')
        extra = '<receiver android:name="network.awai.platform.InstallReceiver" android:exported="false"/>' + ('<service android:name="network.awai.platform.AutoUpdateJob" android:permission="android.permission.BIND_JOB_SERVICE" android:exported="false"/>' if online else '')
    if kind == 'yotei':
        perms = '<permission android:name="network.awai.permission.READ_AGENDA" android:protectionLevel="signature"/>'
        extra = '<provider android:name="network.itonami.yotei.AgendaProvider" android:authorities="network.itonami.yotei.agenda" android:exported="true" android:readPermission="network.awai.permission.READ_AGENDA" android:writePermission="network.awai.permission.READ_AGENDA"/>'
    if kind == 'torihiki':
        perms = '<uses-permission android:name="android.permission.INTERNET"/>'
    theme='AwaiHomeTheme' if kind=='home' else 'AwaiTheme'
    appicon = {'home': '@drawable/awai_mark', 'yotei': '@drawable/yotei_crest'}.get(
        kind, '@android:drawable/ic_menu_today')
    round_icon = ' android:roundIcon="@drawable/yotei_crest_round"' if kind == 'yotei' else ''
    title={'home':'Awai Home','store':'itonami Store','yotei':'Yotei','torihiki':'Torihiki'}[kind]
    known={'network.awai.drive','network.awai.yataverse','network.itonami.yotei','network.itonami.torihiki','network.awai.store'}
    listed=''.join(f'<package android:name="{p}"/>' for p in query_packages if p not in known)
    return f'''<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="{pkg}" android:versionCode="{version}" android:versionName="0.1.{version-1}">
      <uses-sdk android:minSdkVersion="33" android:targetSdkVersion="37"/>{perms}
      <queries><intent><action android:name="android.intent.action.MAIN"/><category android:name="android.intent.category.LAUNCHER"/></intent>
      <intent><action android:name="android.intent.action.MAIN"/><category android:name="android.intent.category.APP_BROWSER"/></intent>
      <intent><action android:name="android.intent.action.DIAL"/></intent><intent><action android:name="android.media.action.STILL_IMAGE_CAMERA"/></intent>
      <package android:name="network.awai.drive"/><package android:name="network.awai.yataverse"/><package android:name="network.itonami.yotei"/><package android:name="network.itonami.torihiki"/><package android:name="network.awai.store"/>{listed}<provider android:authorities="network.itonami.yotei.agenda"/></queries>
      <application android:theme="@style/{theme}" android:label="{title}" android:icon="{appicon}"{round_icon} android:allowBackup="false" android:usesCleartextTraffic="false" android:debuggable="{str(debuggable).lower()}" android:enableOnBackInvokedCallback="true">
      <activity android:name="{activity}" android:exported="true" android:launchMode="singleTask" android:windowSoftInputMode="adjustResize">
      <intent-filter><action android:name="android.intent.action.MAIN"/><category android:name="android.intent.category.LAUNCHER"/></intent-filter>{home}</activity>{extra}</application></manifest>'''

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--version',type=int,default=1);ap.add_argument('--sdk',type=pathlib.Path,default=pathlib.Path.home()/'Library/Android/sdk');ap.add_argument('--java',type=pathlib.Path,default=pathlib.Path('/opt/homebrew/opt/openjdk/bin'));ap.add_argument('--out',type=pathlib.Path,default=ROOT/'.agent-output/android');ap.add_argument('--skip-cljs',action='store_true');ap.add_argument('--online-pins',type=pathlib.Path);ap.add_argument('--catalog-revision',type=int,default=None);ap.add_argument('--itonami-apk',type=pathlib.Path,default=None);ap.add_argument('--torihiki-bot-apk',type=pathlib.Path,default=None);ap.add_argument('--tabi-mikake-apk',type=pathlib.Path,default=None);ap.add_argument('--deai-apk',type=pathlib.Path,default=None);ap.add_argument('--hiring-apk',type=pathlib.Path,default=None);ap.add_argument('--kumade-apk',type=pathlib.Path,default=None);ap.add_argument('--payment-drafts-apk',type=pathlib.Path,default=None, help='Development-signed Tauri APK from apps/payment-drafts (AWAI-3157/3159)');ap.add_argument('--securities-drafts-apk',type=pathlib.Path,default=None, help='Development-signed Tauri APK from apps/securities-drafts (AWAI-3158/3159)');ap.add_argument('--local-apps-dir',type=pathlib.Path,default=None);ap.add_argument('--home-only',action='store_true')
    ap.add_argument('--agent-trace-apk', type=pathlib.Path, help='Development-signed APK from app-itonami-agent-trace')
    ap.add_argument('--agent-trace-online', action='store_true', help='Admit the feed-enabled agent trace APK with INTERNET')
    ap.add_argument('--agent-trace-sha256', help='Expected SHA-256 from the source app build receipt')
    ap.add_argument('--bundle-registry-assoc', action='store_true', help='Bundle the pinned release-signed Registry Assoc APK')
    ap.add_argument('--unsigned-home', action='store_true', help='Build a non-debuggable Home APK for a separate APK signing service')
    ap.add_argument('--dapp-distribution', type=pathlib.Path)
    ap.add_argument('--store-package', choices=['network.awai.store','network.awai.store.p2p.preview'], default='network.awai.store')
    ap.add_argument('--store-only', action='store_true')
    # AWAI-3761: the signing identity. The defaults are the local Android debug identity, as before.
    ap.add_argument('--keystore', type=pathlib.Path, default=DEBUG_KEYSTORE, help='JKS or PKCS12 keystore that signs the APKs and the catalog')
    ap.add_argument('--key-alias', default='androiddebugkey')
    ap.add_argument('--keystore-pass-env', help='name of the environment variable that holds the keystore and key password; the value is never put on a command line or in a report')
    ap.add_argument('--release', action='store_true', help='non-debuggable APKs signed by --keystore; refuses the Android debug identity')
    # AWAI-3775: the Store trusts a root and a root-signed key list; the catalog is signed by a listed catalog key,
    # not by the APK key. Without --key-list the Store pins the APK key for both, as before.
    ap.add_argument('--key-list', type=pathlib.Path, help='directory with store-root.der, keys.txt and keys.sig (android/key-list.py sign)')
    ap.add_argument('--catalog-keystore', type=pathlib.Path, help='keystore of a catalog key listed in --key-list')
    ap.add_argument('--catalog-key-alias')
    ap.add_argument('--catalog-pass-env', help='name of the environment variable that holds the catalog keystore password')
    args=ap.parse_args()
    if args.dapp_distribution and (args.online_pins or args.store_package != 'network.awai.store.p2p.preview'):
        ap.error('dapp bundle requires the isolated offline preview Store')
    if args.store_only and (args.home_only or args.unsigned_home):
        ap.error('--store-only cannot build Home')
    if args.unsigned_home:
        args.home_only = True
        if args.out.exists() and any(args.out.iterdir()):
            ap.error('--unsigned-home requires an empty output directory')
    if bool(args.agent_trace_apk) != bool(args.agent_trace_sha256):
        ap.error('--agent-trace-apk and --agent-trace-sha256 must be supplied together')
    if args.agent_trace_online and not args.agent_trace_apk:
        ap.error('--agent-trace-online requires an agent trace APK')
    if args.agent_trace_sha256 and not re.fullmatch(r'[a-f0-9]{64}', args.agent_trace_sha256):
        ap.error('--agent-trace-sha256 requires a lowercase SHA-256 digest')
    if args.catalog_revision is not None and args.catalog_revision<1:raise SystemExit('positive catalog revision required')
    if args.version<1:raise SystemExit('positive version required')
    out=args.out.resolve();out.mkdir(parents=True,exist_ok=True);tools=args.sdk/'build-tools/36.1.0';jar=args.sdk/'platforms/android-37.0/android.jar'
    key=args.keystore
    if args.keystore_pass_env is not None and not re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]*', args.keystore_pass_env):
        ap.error('--keystore-pass-env takes the name of an environment variable')
    if args.keystore_pass_env and not os.environ.get(args.keystore_pass_env):
        ap.error(f'environment variable {args.keystore_pass_env} is not set')
    if args.release:
        if args.unsigned_home: ap.error('--release signs the APKs; --unsigned-home leaves Home unsigned')
        if not args.keystore_pass_env or key.resolve()==DEBUG_KEYSTORE.resolve() or args.key_alias=='androiddebugkey':
            ap.error('--release requires --keystore, --key-alias and --keystore-pass-env for a key other than the Android debug identity')
    # apksigner and SignCatalog read the password from the environment themselves.
    ks_pass=['env:'+args.keystore_pass_env] if args.keystore_pass_env else ['pass:android']
    sign_catalog_key=[key,args.key_alias]+([args.keystore_pass_env] if args.keystore_pass_env else [])
    def apk_key_sign(data,key_out,sig_out,**kw):
        return run([args.java/'java','-cp',out,'SignCatalog',key,data,key_out,sig_out,*sign_catalog_key[1:]],**kw)
    # AWAI-3775: the Store trusts a root and a root-signed key list, and the bundled catalog is signed by a listed
    # catalog key, never by the APK key. Defaults: the published development list (store/keys/store-root.der and
    # store/latest/keys-envelope.json) and the development catalog key in ~/.android/awai-store-dev.
    if not args.key_list:
        args.key_list=out/'key-list';args.key_list.mkdir(exist_ok=True)
        shutil.copyfile(ROOT/'store/keys/store-root.der',args.key_list/'store-root.der')
        published=json.loads((ROOT/'store/latest/keys-envelope.json').read_text())
        (args.key_list/'keys.txt').write_bytes(published['raw'].encode('ascii'))
        (args.key_list/'keys.sig').write_bytes(base64.b64decode(published['signature']))
    if not args.catalog_keystore:
        if args.catalog_key_alias or args.catalog_pass_env:ap.error('--catalog-key-alias and --catalog-pass-env need --catalog-keystore')
        if not DEV_CATALOG_KEYSTORE.is_file() or not DEV_KEY_PASSWORD.is_file():
            raise SystemExit(f'missing the development catalog key {DEV_CATALOG_KEYSTORE}: see store/keys/README.md, or give --key-list and --catalog-keystore')
        # Read into this process's environment only; SignCatalog reads it from there, never from the command line.
        os.environ['AWAI_STORE_DEV_PASS']=DEV_KEY_PASSWORD.read_text().strip()
        args.catalog_keystore,args.catalog_key_alias,args.catalog_pass_env=DEV_CATALOG_KEYSTORE,'catalog','AWAI_STORE_DEV_PASS'
    if not (args.catalog_key_alias and args.catalog_pass_env):
        ap.error('--catalog-keystore needs --catalog-key-alias and --catalog-pass-env')
    if not re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]*', args.catalog_pass_env) or not os.environ.get(args.catalog_pass_env):
        ap.error('--catalog-pass-env takes the name of a set environment variable')
    if args.catalog_keystore.resolve()==key.resolve() and args.catalog_key_alias==args.key_alias:
        ap.error('the catalog key must not be the APK signing key')
    key_list=json.loads(run(['python3',ROOT/'android/key-list.py','verify','--dir',args.key_list],capture_output=True).stdout)
    def catalog_sign(data,key_out,sig_out,**kw):
        return run([args.java/'java','-cp',out,'SignCatalog',args.catalog_keystore,data,key_out,sig_out,args.catalog_key_alias,args.catalog_pass_env],**kw)
    required=[jar,tools/'aapt2',tools/'d8',tools/'zipalign',args.java/'javac']
    if not args.unsigned_home:
        required.extend([tools/'apksigner',key])
    for f in required:
        if not f.is_file():raise SystemExit(f'missing build prerequisite: {f}')
    if not args.skip_cljs:run(['clojure','-M:build'],cwd=ROOT/'android/client')
    if not (ROOT/'otehon/shell/node_modules/esbuild').is_dir():raise SystemExit('missing build prerequisite: run `npm ci` in otehon/shell (esbuild for the identity bundle)')
    generated=out/'generated';generated.mkdir(exist_ok=True)
    run(['node',ROOT/'android/build-identity.mjs',generated],cwd=ROOT)
    if not (ROOT/'android/client/generated/domain.js').is_file():raise SystemExit('shared CLJS domain is not built')
    run(['bb','-cp','android/contracts/src','android/contracts/export.clj',out/'shared.json'],cwd=ROOT)
    common=json.loads((out/'shared.json').read_text());assets=out/'web';assets.mkdir(exist_ok=True)
    for name in ['index.html','client.css','client.js','online.js','key-list.js','setup.js','setup.css','torihiki.js']:shutil.copyfile(ROOT/'android/client'/name,assets/name)
    shutil.copytree(ROOT/'android/client/assets',assets/'assets',dirs_exist_ok=True)
    shutil.copyfile(ROOT/'android/client/generated/domain.js',assets/'domain.js')
    shutil.copyfile(generated/'identity.js',assets/'identity.js')
    shutil.copyfile(generated/'handover.js',assets/'handover.js')
    shutil.copyfile(ROOT/'android/client/account-broker.html',assets/'account-broker.html')
    shutil.copyfile(generated/'account-broker.js',assets/'account-broker.js')
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
    for icon in ('yotei_crest.png', 'yotei_crest_round.png'):
        shutil.copyfile(ROOT/'android/yotei/res/drawable-nodpi'/icon, drawable/icon)
    for folder in [resources/'values',resources/'values-night']:
        path=folder/'styles.xml'
        path.write_text(path.read_text().replace('</resources>','<style name="AwaiHomeTheme" parent="AwaiTheme"><item name="android:windowSplashScreenBackground">@color/awai_background</item><item name="android:windowSplashScreenAnimatedIcon">@drawable/awai_mark</item><item name="android:windowSplashScreenBehavior">icon_preferred</item></style></resources>'))
    fp=None
    if not args.unsigned_home:
        run([args.java/'javac','-d',out,ROOT/'android/SignCatalog.java'])
        # SignCatalog emits only a public certificate fingerprint.
        probe=out/'probe';probe.write_bytes(b'fingerprint')
        fp=apk_key_sign(probe,out/'apk-key.der',out/'probe.sig',capture_output=True).stdout.strip()
        if not re.fullmatch(r'[a-f0-9]{64}',fp):raise SystemExit('signing key could not be read')
    def build(kind,pkg,activity):
        stage=out/f'{kind}-v{args.version}';stage.mkdir(exist_ok=True);classes=stage/'classes';classes.mkdir(exist_ok=True);gen=stage/'gen';gen.mkdir(exist_ok=True);dex=stage/'dex';dex.mkdir(exist_ok=True)
        # Explicitly rebuild only this task's generated outputs; unrelated workspace data is untouched.
        xml=stage/'AndroidManifest.xml';xml.write_text(manifest(pkg,activity,args.version,kind,bool(pins_online),debuggable=not (args.unsigned_home or args.release),
                                                                query_packages=store_query_packages(pins_online) if kind=='store' else ()))
        staged_assets=stage/'assets'
        shutil.copytree(assets,staged_assets,dirs_exist_ok=True,
                        ignore=shutil.ignore_patterns('packages','catalog.json','catalog.sig','catalog-key.der','store-root.der','keys.txt','keys.sig') if kind!='store' else None)
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
        files=sorted(str(p.relative_to(staged_assets)).replace(os.sep,'/')for p in staged_assets.rglob('*')if p.is_file()and p.name not in ['assets.list','catalog.json','catalog.sig','catalog-key.der','store-root.der','keys.txt','keys.sig']and not str(p.relative_to(staged_assets)).startswith('packages/'))
        (staged_assets/'assets.list').write_text('\n'.join(files)+'\n')
        run([tools/'aapt2','compile','--dir',resources,'-o',stage/'resources.zip'])
        run([tools/'aapt2','link','-o',stage/'resources.apk','--manifest',xml,'-I',jar,'--java',gen,'-R',stage/'resources.zip','-A',staged_assets,'--auto-add-overlay'])
        sources=list((ROOT/'android/shared/src').rglob('*.java'))+list((ROOT/'android'/kind/'src').rglob('*.java'))+list((ROOT/'packages/awai-system-bars/android').rglob('*.java'))+list(gen.rglob('*.java'))
        run([args.java/'javac','--release','8','-encoding','UTF-8','-cp',jar,'-d',classes,*sources])
        run([tools/'d8','--min-api','33','--lib',jar,'--output',dex,*classes.rglob('*.class')])
        unsigned=stage/'unsigned.apk';shutil.copyfile(stage/'resources.apk',unsigned)
        with zipfile.ZipFile(unsigned,'a',compression=zipfile.ZIP_DEFLATED)as z:
            for f in dex.glob('*.dex'):z.write(f,f.name)
        run([tools/'zipalign','-f','4',unsigned,stage/'aligned.apk'])
        if args.unsigned_home:
            apk=out/f'{kind}-v{args.version}-unsigned.apk'
            shutil.copyfile(stage/'aligned.apk',apk)
            return apk
        apk=out/f'{kind}-v{args.version}.apk'
        run([tools/'apksigner','sign','--ks',key,'--ks-key-alias',args.key_alias,'--ks-pass',*ks_pass,'--key-pass',*ks_pass,'--out',apk,stage/'aligned.apk'])
        run([tools/'apksigner','verify','--verbose',apk],stdout=subprocess.DEVNULL)
        if args.release:
            # A release build must carry exactly the given key, must not be the debug identity and must not be debuggable.
            certs=run([tools/'apksigner','verify','--print-certs',apk],capture_output=True).stdout
            if re.findall(r'certificate SHA-256 digest: ([a-f0-9]{64})',certs)!=[fp]:raise SystemExit(f'{kind} APK signer is not the given key')
            if 'CN=Android Debug' in certs:raise SystemExit('--release refuses the Android debug identity')
            if 'application-debuggable' in run([tools/'aapt2','dump','badging',apk],capture_output=True).stdout:raise SystemExit(f'{kind} APK is debuggable')
        return apk
    if args.home_only:
        home=build('home','network.awai.home','network.awai.home.HomeActivity')
        report={'schema':'awai.android.home-build.v1','version':args.version,'publicSignerSha256':fp,'runtime':pins,'artifacts':{home.name:{'sha256':digest(home),'bytes':home.stat().st_size}},'identitySourceSha256':digest(ROOT/'android/client/identity-entry.js'),'identityVerifierSha256':digest(ROOT/'otehon/shell/src/identity/link.js'),'deviceSourceSha256':digest(ROOT/'otehon/shell/src/identity/device.js')}
        (out/f'home-build-v{args.version}.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2));return
    # --store-only reuses the Yotei APK of an earlier full build in the same output directory, and builds it when there is none.
    previous_yotei=out/f'yotei-v{args.version}.apk'
    yotei=previous_yotei if args.store_only and previous_yotei.is_file() else build('yotei','network.itonami.yotei','network.itonami.yotei.YoteiActivity')
    run([tools/'apksigner','verify',yotei],stdout=subprocess.DEVNULL)
    torihiki=build('torihiki','network.itonami.torihiki','network.itonami.torihiki.TorihikiActivity')
    packages=assets/'packages';packages.mkdir(exist_ok=True);shutil.copyfile(yotei,packages/'yotei.apk');shutil.copyfile(torihiki,packages/'torihiki.apk')
    revision=args.catalog_revision if args.catalog_revision is not None else args.version
    listed=[{'id':'network.itonami.yotei','name':'Yotei','description':'予定をこの端末に保存します。外部への送信や同期、通知配信は行いません。','publisher':PUBLISHER,'versionCode':args.version,'versionName':f'0.1.{args.version-1}','artifacts':[{'platform':'android','runtime':'android','kind':'apk','asset':'packages/yotei.apk','bytes':yotei.stat().st_size,'sha256':digest(yotei),'signerSha256':fp},{'platform':'nixos','runtime':'browser','kind':'bundled-web','asset':'bundled:yotei','bytes':(assets/'client.js').stat().st_size,'sha256':digest(assets/'client.js')}]},
            {'id':'network.itonami.torihiki','name':'Torihiki','description':'取引所 devnet の価格・板・ノード状態を表示し、端末の鍵で署名して devnet に発注できます。devnet・デモ専用で、実際の資産は扱いません。通信は毎回確認します。','publisher':PUBLISHER,'versionCode':args.version,'versionName':f'0.1.{args.version-1}','artifacts':[{'platform':'android','runtime':'android','kind':'apk','asset':'packages/torihiki.apk','bytes':torihiki.stat().st_size,'sha256':digest(torihiki),'signerSha256':fp}]}]
    if args.itonami_apk is not None:
        staged=packages/'itonami.apk';shutil.copyfile(args.itonami_apk,staged)
        signer=run([tools/'apksigner','verify','--print-certs',staged],capture_output=True).stdout
        if re.findall(r'certificate SHA-256 digest: ([a-f0-9]{64})', signer) != [fp]:
            raise SystemExit('itonami APK signer does not match the development identity')
        badging = run([tools/'aapt2','dump','badging',staged], capture_output=True).stdout
        info = re.search(r"^package: name='network\.itonami\.app' versionCode='([0-9]+)' versionName='([^']+)'",badging,re.M)
        if not info or int(info[1]) < 1:
            raise SystemExit('itonami APK package/version mismatch')
        listed.append({'id':'network.itonami.app','name':'Itonami','description':'NixOS 版 Itonami UI を一つの Tauri v3 アプリにまとめた開発版。既存 Home・Store・Yotei は保持し別アプリ ID で追加。Nix 専用サービスは未移植で機能表示しない。Android development debug 署名（本番鍵ではない）。','publisher':PUBLISHER,'versionCode':int(info[1]),'versionName':info[2],'artifacts':[{'platform':'android','runtime':'android','kind':'apk','asset':'packages/itonami.apk','bytes':staged.stat().st_size,'sha256':digest(staged),'signerSha256':fp}]})
    if args.torihiki_bot_apk is not None:
        # Tauri v3 APK built from network-awai/app-itonami-torihiki app/. The listed id, version and signer are read from
        # the APK itself and refused unless they are exactly the admitted package and the development identity.
        staged=packages/'torihiki-bot.apk';shutil.copyfile(args.torihiki_bot_apk,staged)
        signer=run([tools/'apksigner','verify','--print-certs',staged],capture_output=True).stdout
        if [l.rsplit(' ',1)[-1] for l in signer.splitlines() if 'certificate SHA-256 digest:' in l]!=[fp]:raise SystemExit('torihiki bot APK signer does not match the development identity')
        badging=run([tools/'aapt2','dump','badging',staged],capture_output=True).stdout.splitlines()[0]
        m=re.fullmatch(r"package: name='([^']+)' versionCode='([0-9]+)' versionName='([^']+)'.*",badging)
        if not m or m.group(1)!='network.itonami.torihiki.bot':raise SystemExit('torihiki bot APK package is not network.itonami.torihiki.bot')
        listed.append({'id':'network.itonami.torihiki.bot','name':'Torihiki Bot','description':'市場運営 bot（ISIC 6611）の profile と稼働状況、取引所 devnet の価格・板を読み取り専用で表示します。発注・鍵・入出金はありません。devnet・デモ専用で、通信は毎回確認します。Android development debug 署名（本番鍵ではない）。','publisher':PUBLISHER,'versionCode':int(m.group(2)),'versionName':m.group(3),'artifacts':[{'platform':'android','runtime':'android','kind':'apk','asset':'packages/torihiki-bot.apk','bytes':staged.stat().st_size,'sha256':digest(staged),'signerSha256':fp}]})
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
        listed.append({'id':'network.itonami.tabimikake','name':'Tabi Mikake','description':'航空券と宿の価格を、この端末で比べます。予約・支払いは予約先のサイトで行い、このアプリは予約しません。この版は架空のデータだけを使い、外部へは何も送信しません。Android development debug 署名（本番鍵ではない）。','publisher':PUBLISHER,'versionCode':int(m.group(2)),'versionName':m.group(3),'artifacts':[{'platform':'android','runtime':'android','kind':'apk','asset':'packages/tabi-mikake.apk','bytes':staged.stat().st_size,'sha256':digest(staged),'signerSha256':fp}]})
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
        listed.append({'id':'network.itonami.deai','name':'Deai','description':'出会いの準備をこの端末だけで進めます。プロフィールの下書きと、自分で入力した候補の並び順と理由を表示します。外部への送信、遠隔推論、利用者どうしの連絡はありません。Android development debug 署名（本番鍵ではない）。','publisher':PUBLISHER,'versionCode':int(m.group(2)),'versionName':m.group(3),'artifacts':[{'platform':'android','runtime':'android','kind':'apk','asset':'packages/deai.apk','bytes':staged.stat().st_size,'sha256':digest(staged),'signerSha256':fp}]})
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
        listed.append({'id':'network.itonami.hiring','name':'Hiring','description':'求職・求人の bot が作った下書き（応募文・求人告知）を、この端末で確かめて承認・差し戻しします。応募・投稿・送信はしません。記録は端末の中だけに残します。Android development debug 署名（本番鍵ではない）。','publisher':PUBLISHER,'versionCode':int(m.group(2)),'versionName':m.group(3),'artifacts':[{'platform':'android','runtime':'android','kind':'apk','asset':'packages/hiring.apk','bytes':staged.stat().st_size,'sha256':digest(staged),'signerSha256':fp}]})
    if args.kumade_apk is not None:
        # Tauri v3 APK built from network-awai/app-itonami-kumade (AWAI-3165/3166/3167, network-awai-apex ADR 0043). The listed
        # id, version and signer are read from the APK itself and refused unless they are exactly the admitted package and the
        # development identity. Kumade needs INTERNET for its declared Common Crawl reads (each with each-operation consent),
        # so INTERNET is allowed; any other permission (besides AndroidX's own non-exported receiver permission) is refused.
        staged=packages/'kumade.apk';shutil.copyfile(args.kumade_apk,staged)
        signer=run([tools/'apksigner','verify','--print-certs',staged],capture_output=True).stdout
        if [l.rsplit(' ',1)[-1] for l in signer.splitlines() if 'certificate SHA-256 digest:' in l]!=[fp]:raise SystemExit('kumade APK signer does not match the development identity')
        badging=run([tools/'aapt2','dump','badging',staged],capture_output=True).stdout
        m=re.fullmatch(r"package: name='([^']+)' versionCode='([0-9]+)' versionName='([^']+)'.*",badging.splitlines()[0])
        if not m or m.group(1)!='network.itonami.kumade':raise SystemExit('kumade APK package is not network.itonami.kumade')
        perms=sorted(set(re.findall(r"uses-permission: name='([^']+)'",badging)))
        if perms!=sorted({'android.permission.INTERNET','network.itonami.kumade.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION'}):raise SystemExit(f'kumade APK permissions are not exactly INTERNET: {perms}')
        listed.append({'id':'network.itonami.kumade','name':'Kumade','description':'公開 Web のページを、この端末で読み解きます。貼り付けた HTML の抽出、Common Crawl の過去のアーカイブの検索と取得（通信は毎回確認）、端末内の索引での検索ができます。任意の URL の取得とクロールは、取得用サービスが止まっているため使えません。Android development debug 署名（本番鍵ではない）。','publisher':PUBLISHER,'versionCode':int(m.group(2)),'versionName':m.group(3),'artifacts':[{'platform':'android','runtime':'android','kind':'apk','asset':'packages/kumade.apk','bytes':staged.stat().st_size,'sha256':digest(staged),'signerSha256':fp}]})
    # Payment Drafts / Securities Drafts (AWAI-3157/3158/3159, ADR 0042). Both are Tauri v3 APKs built from
    # apps/payment-drafts and apps/securities-drafts in this repository. They declare no external operation and
    # no INTERNET permission, so they are the same local-only class as android/local-apps.json entries:
    # package network.itonami.<suffix>, asset packages/<suffix>.apk, 40 MiB budget, permissions exactly the
    # AndroidX non-exported receiver permission (or none). The listed id, version and signer are read from the
    # APK itself. Text comes from android/local-apps.json so --payment-drafts-apk/--securities-drafts-apk and
    # --local-apps-dir produce the same catalog row for the same APK.
    _draft_table = {a['suffix']: a for a in json.loads((ROOT/'android/local-apps.json').read_text())['apps']}
    def _stage_draft(apk_path, suffix, package, staged_name):
        meta = _draft_table.get(suffix)
        if meta is None:
            raise SystemExit(f'{package} is not listed in android/local-apps.json')
        if apk_path.stat().st_size > 40 * 1024 * 1024:
            raise SystemExit(f'{package} APK exceeds its 40 MiB Store budget')
        staged = packages / staged_name
        shutil.copyfile(apk_path, staged)
        signer = run([tools/'apksigner', 'verify', '--print-certs', staged], capture_output=True).stdout
        if [l.rsplit(' ', 1)[-1] for l in signer.splitlines() if 'certificate SHA-256 digest:' in l] != [fp]:
            raise SystemExit(f'{package} APK signer does not match the development identity')
        badging = run([tools/'aapt2', 'dump', 'badging', staged], capture_output=True).stdout
        m = re.fullmatch(r"package: name='([^']+)' versionCode='([0-9]+)' versionName='([^']+)'.*", badging.splitlines()[0])
        if not m or m.group(1) != package:
            raise SystemExit(f'{staged_name} package is not {package}')
        perms = sorted(set(re.findall(r"uses-permission: name='([^']+)'", badging)))
        if perms not in ([], [package + '.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION']):
            raise SystemExit(f'{package} APK requests permissions: {perms}')
        if 'uses-permission: name=\'android.permission.INTERNET\'' in badging:
            raise SystemExit(f'{package} APK requests INTERNET')
        listed.append({'id': package, 'name': meta['name'], 'description': meta['description'] + 'Android development debug 署名（本番鍵ではない）。', 'publisher': PUBLISHER, 'versionCode': int(m.group(2)), 'versionName': m.group(3), 'artifacts': [{'platform': 'android', 'runtime': 'android', 'kind': 'apk', 'asset': f'packages/{staged_name}', 'bytes': staged.stat().st_size, 'sha256': digest(staged), 'signerSha256': fp}]})
    if args.payment_drafts_apk is not None:
        _stage_draft(args.payment_drafts_apk, 'paymentdrafts', 'network.itonami.paymentdrafts', 'paymentdrafts.apk')
    if args.securities_drafts_apk is not None:
        _stage_draft(args.securities_drafts_apk, 'securitiesdrafts', 'network.itonami.securitiesdrafts', 'securitiesdrafts.apk')
    if args.agent_trace_apk is not None:
        staged = packages / 'agent-trace.apk'
        if args.agent_trace_apk.stat().st_size > 2 * 1024 * 1024:
            raise SystemExit('agent trace APK exceeds its Store byte budget')
        shutil.copyfile(args.agent_trace_apk, staged)
        actual_digest = digest(staged)
        if actual_digest != args.agent_trace_sha256:
            raise SystemExit('agent trace APK digest does not match the supplied build receipt')
        signer = run([tools/'apksigner', 'verify', '--print-certs', staged], capture_output=True).stdout
        if [line.rsplit(' ', 1)[-1] for line in signer.splitlines()
                if 'certificate SHA-256 digest:' in line] != [fp]:
            raise SystemExit('agent trace APK signer does not match the development identity')
        badging = run([tools/'aapt2', 'dump', 'badging', staged], capture_output=True).stdout
        package = re.fullmatch(r"package: name='network\.itonami\.agenttrace' versionCode='([0-9]+)' versionName='([^']+)'.*",
                               badging.splitlines()[0])
        permissions = run([tools/'aapt2', 'dump', 'permissions', staged], capture_output=True).stdout.splitlines()
        requested = [line.split('name=', 1)[-1].strip("'") for line in permissions if line.startswith('uses-permission')]
        expected = ['android.permission.INTERNET'] if args.agent_trace_online else []
        if not package or requested != expected:
            raise SystemExit('agent trace APK package or permissions do not match the selected Store profile')
        listed.append({
            'id': 'network.itonami.agenttrace', 'name': '営トレース',
            'description': 'OTLP のエージェント実行履歴を端末内で確認し、OpenTelemetry または Langfuse 用に書き出します。',
            'publisher': PUBLISHER,
            'versionCode': int(package.group(1)), 'versionName': package.group(2),
            'artifacts': [{'platform': 'android', 'runtime': 'android', 'kind': 'apk',
                           'asset': 'packages/agent-trace.apk', 'bytes': staged.stat().st_size,
                           'sha256': actual_digest, 'signerSha256': fp}],
        })
    if args.local_apps_dir is not None:
        # Local Itonami apps that keep everything on the device. android/local-apps.json fixes the admitted
        # suffixes and their Store text; the directory holds <suffix>.apk files. Each APK is refused unless its package is
        # exactly network.itonami.<suffix>, its single signer is the development identity, it requests no permission other
        # than AndroidX's own non-exported receiver permission (so no INTERNET), and it fits the 40 MiB budget. Version,
        # size and digest come from the APK itself. An APK in the directory that the table does not list is refused.
        table=json.loads((ROOT/'android/local-apps.json').read_text())
        known={a['suffix']:a for a in table['apps']}
        for apk_path in sorted(args.local_apps_dir.glob('*.apk')):
            suffix=apk_path.stem
            if suffix not in known:raise SystemExit(f'local app APK {apk_path.name} is not listed in android/local-apps.json')
            meta=known[suffix];pkg='network.itonami.'+suffix
            if apk_path.stat().st_size>40*1024*1024:raise SystemExit(f'{pkg} APK exceeds its 40 MiB Store budget')
            staged=packages/f'{suffix}.apk';shutil.copyfile(apk_path,staged)
            signer=run([tools/'apksigner','verify','--print-certs',staged],capture_output=True).stdout
            if [l.rsplit(' ',1)[-1] for l in signer.splitlines() if 'certificate SHA-256 digest:' in l]!=[fp]:raise SystemExit(f'{pkg} APK signer does not match the development identity')
            badging=run([tools/'aapt2','dump','badging',staged],capture_output=True).stdout
            m=re.fullmatch(r"package: name='([^']+)' versionCode='([0-9]+)' versionName='([^']+)'.*",badging.splitlines()[0])
            if not m or m.group(1)!=pkg:raise SystemExit(f'{apk_path.name} package is not {pkg}')
            perms=sorted(set(re.findall(r"uses-permission: name='([^']+)'",badging)))
            if perms not in ([],[pkg+'.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION']):raise SystemExit(f'{pkg} APK requests permissions: {perms}')
            listed.append({'id':pkg,'name':meta['name'],'description':meta['description']+'Android development debug 署名（本番鍵ではない）。','publisher':PUBLISHER,'versionCode':int(m.group(2)),'versionName':m.group(3),'artifacts':[{'platform':'android','runtime':'android','kind':'apk','asset':f'packages/{suffix}.apk','bytes':staged.stat().st_size,'sha256':digest(staged),'signerSha256':fp}]})
    if args.bundle_registry_assoc:
        distribution = ROOT / 'store/distribution/dev-20261119-r105'
        published = json.loads((distribution / 'catalog-rev105-raw.json').read_bytes())
        entry = next(app for app in published['apps'] if app['id'] == 'network.itonami.registry.assoc')
        artifact, = entry['artifacts']
        apk = distribution / 'registry-assoc.apk'
        if apk.stat().st_size != artifact['bytes'] or digest(apk) != artifact['sha256']:
            raise SystemExit('Registry Assoc APK does not match the published catalog')
        signer = run([tools/'apksigner', 'verify', '--print-certs', apk], capture_output=True).stdout
        digests = re.findall(r'certificate SHA-256 digest: ([a-f0-9]{64})', signer)
        if digests != [artifact['signerSha256']] or digests == [fp]:
            raise SystemExit('Registry Assoc APK does not have its dedicated release signer')
        shutil.copyfile(apk, packages / 'registry-assoc.apk')
        listed.append(entry)
    if args.dapp_distribution:
        if pins_online:raise SystemExit('dapp bundle is offline-only; do not widen online Yotei transport')
        distribution=args.dapp_distribution.resolve();release=json.loads((distribution/'distribution.json').read_text())
        profiles=json.loads((ROOT/'apps/dapp-carrier/profiles/apps.json').read_text())
        allowed={p['key']:p for p in profiles['apps']};seen=set()
        if release.get('schema')!='awai.dapp.distribution.v1' or len(release.get('artifacts',[]))!=len(allowed):raise SystemExit('invalid dapp distribution')
        descriptions={'aozora':'言葉と、選んだ Peer との同期。','dougaka':'動画づくりと、選んだ Peer との同期。','ongakuka':'P2P 接続プレビュー。音楽制作の画面はまだ含まれていません。','itonami':'P2P 接続プレビュー。エージェントの画面はまだ含まれていません。','yataverse':'選んだ相手からスナップショットを受信し、保持を確認します。'}
        for a in release['artifacts']:
            name=a.get('key');profile=allowed.get(name)
            if not profile or name in seen or a.get('id')!=profile['id'] or a.get('asset')!=f'packages/{name}.apk':raise SystemExit('unapproved dapp identity')
            seen.add(name);source=distribution/a['asset']
            if source.is_symlink() or not source.is_file() or not 1<=source.stat().st_size<=256*1024*1024 or source.stat().st_size!=a['bytes'] or digest(source)!=a['sha256']:raise SystemExit('dapp APK digest/size mismatch')
            printed=run([tools/'apksigner','verify','--print-certs',source],capture_output=True).stdout
            signer=re.search(r'Signer #1 certificate SHA-256 digest: ([0-9a-f]+)',printed,re.I)
            badging=run([tools/'aapt2','dump','badging',source],capture_output=True).stdout
            info=re.search(r"package: name='([^']+)' versionCode='(\d+)' versionName='([^']+)'",badging)
            if not signer or signer[1].lower()!=fp or a['signerSha256']!=fp or not info or info[1]!=profile['id'] or int(info[2])!=a['versionCode'] or info[3]!=a['versionName']:raise SystemExit('dapp APK signer/package/version mismatch')
            target_asset = 'packages/itonami-preview.apk' if name == 'itonami' else a['asset']
            shutil.copyfile(source, assets / target_asset)
            listed.append({'id':profile['id'],'name':profile['name'],'description':descriptions[name],'publisher':PUBLISHER,'versionCode':a['versionCode'],'versionName':a['versionName'],'artifacts':[{k:a[k] for k in ['bytes','sha256','signerSha256']}|{'asset':target_asset,'platform':'android','runtime':'android','kind':'apk'}]})
    catalog={'schema':'itonami.store.bundled.v1','revision':revision,'expiresAt':int(time.time())+30*86400,'apps':listed}
    raw=json.dumps(catalog,ensure_ascii=False,separators=(',',':'));(assets/'catalog.json').write_text(raw)
    if key_list:
        catalog_sign(assets/'catalog.json',out/'catalog-role-key.der',assets/'catalog.sig',stdout=subprocess.DEVNULL)
        catalog_key_id=digest(out/'catalog-role-key.der')
        if catalog_key_id not in key_list['catalogKeys']:raise SystemExit('the catalog key is not listed for the catalog role in --key-list')
        for name in ('store-root.der','keys.txt','keys.sig'):shutil.copyfile(args.key_list/name,assets/name)
        (assets/'catalog-key.der').unlink(missing_ok=True)
        trust={'mode':'key-list','sequence':key_list['sequence'],'expiresAt':key_list['expiresAt'],'root':key_list['root'],'catalogKey':catalog_key_id,'pointerKeys':key_list['pointerKeys']}
        b64=lambda name:base64.b64encode((assets/name).read_bytes()).decode()
        trust_js='window.ItonamiKeyList='+json.dumps({'root':b64('store-root.der'),'raw':b64('keys.txt'),'signature':b64('keys.sig')})+';'
    (assets/'catalog-data.js').write_text('window.ItonamiCatalogRaw='+json.dumps(raw,ensure_ascii=False)+';window.ItonamiCatalog=JSON.parse(window.ItonamiCatalogRaw);window.ItonamiCatalogSignature='+json.dumps(base64.b64encode((assets/'catalog.sig').read_bytes()).decode())+';'+trust_js+'\n')
    store=build('store',args.store_package,'network.awai.store.StoreActivity')
    built=[store]
    if not args.store_only:
        built.extend((build('home','network.awai.home','network.awai.home.HomeActivity'), yotei, torihiki))
    signing='release-key' if args.release else 'local-android-debug-only' if key.resolve()==DEBUG_KEYSTORE.resolve() and args.key_alias=='androiddebugkey' else 'custom-key-debuggable'
    report={'schema':'awai.android.build.v1','version':args.version,'sdk':37,'buildTools':'36.1.0','signing':signing,'publicSignerSha256':fp,'trust':trust,'runtime':pins,'artifacts':{p.name:{'sha256':digest(p),'bytes':p.stat().st_size}for p in built},'storePackage':args.store_package,'sharedDomainSha256':digest(ROOT/'android/contracts/src/itonami/store/domain.cljc'),'sharedClientSha256':digest(assets/'client.js')}
    if args.release:report['debuggable']=False
    (out/f'build-v{args.version}.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2))
if __name__=='__main__':main()

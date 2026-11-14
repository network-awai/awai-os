import fcntl, importlib.util, unittest, tempfile, subprocess, ssl, http.server, threading, json, time, urllib.request, signal, sys
from pathlib import Path
spec=importlib.util.spec_from_file_location('update_network',Path(__file__).parents[1]/'nixos/otehon/update-network.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class Admission(unittest.TestCase):
    def setUp(self):
        self.c={'architecture':'x86_64','stateContract':'chromium-1-profile-v1','channel':'stable','cohort':'stable','maintenanceHours':list(range(24)),'maxValiditySeconds':86400}
        self.m={'schema':'awai.otehon.release.v1','version':2,'system':'/nix/store/'+'0'*32+'-system','architecture':'x86_64','stateContract':self.c['stateContract'],'channel':'stable','cohorts':['canary','stable'],'issuedAt':100,'expiresAt':1000}
    def test_valid(self): m.admit(self.m,self.c,200)
    def test_canary_before_stable_promotion(self):
        self.m['cohorts']=['canary']
        with self.assertRaises(m.Hold):m.admit(self.m,self.c,200)
        self.c['cohort']='canary';m.admit(self.m,self.c,200)
        self.c['cohort']='stable';self.m['cohorts'].append('stable');m.admit(self.m,self.c,200)
    def test_contract_refusals(self):
        for key,val in [('version',True),('system','/tmp/system'),('architecture','aarch64'),('stateContract','new-schema'),('channel','canary'),('issuedAt',300),('expiresAt',150),('cohorts',['stable','stable']),('cohorts',['../bad'])]:
            a={**self.m,key:val}
            with self.subTest(key=key,val=val),self.assertRaises(m.Refused):m.admit(a,self.c,200)
    def test_unknown_fields(self):
        with self.assertRaises(m.Refused):m.admit({**self.m,'command':'evil'},self.c,200)
    def test_window(self):
        self.c['maintenanceHours']=[]
        with self.assertRaises(m.Hold):m.admit(self.m,self.c,200)
    def test_invalid_origins(self):
        for url in ['http://host/feed','https://u:p@host/feed','https://host/../feed','https://host/feed?q=x','https://host/feed#x']:
            with self.subTest(url=url),self.assertRaises(m.Refused):m.origin_url(url)
class TLS(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp=tempfile.TemporaryDirectory();cls.base=Path(cls.tmp.name)
        subprocess.run(['openssl','req','-x509','-newkey','rsa:2048','-nodes','-keyout',str(cls.base/'key.pem'),'-out',str(cls.base/'cert.pem'),'-days','1','-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost'],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        cls.requests=[];cls.bodies={};cls.blocked={};cls.release={}
        class Handler(http.server.BaseHTTPRequestHandler):
            def do_GET(self):
                cls.requests.append(self.path)
                if self.path in cls.blocked:
                    self.send_response(200);self.send_header('Content-Length','100');self.end_headers()
                    self.wfile.write(b'{');self.wfile.flush();cls.blocked[self.path].set()
                    cls.release[self.path].wait(20)
                    return
                if self.path=='/redirect':self.send_response(302);self.send_header('Location','https://example.invalid/escape');self.end_headers();return
                self.send_response(200);self.end_headers();self.wfile.write(cls.bodies.get(self.path,b'x'*100))
            def log_message(self,*a):pass
        cls.server=http.server.ThreadingHTTPServer(('localhost',0),Handler);ctx=ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER);ctx.load_cert_chain(cls.base/'cert.pem',cls.base/'key.pem');cls.server.socket=ctx.wrap_socket(cls.server.socket,server_side=True);cls.thread=threading.Thread(target=cls.server.serve_forever,daemon=True);cls.thread.start()
    @classmethod
    def tearDownClass(cls):cls.server.shutdown();cls.server.server_close();cls.tmp.cleanup()
    def delivery(self):return m.Delivery({'feedUrl':f'https://localhost:{self.server.server_port}','maxDownloadBytes':500,'maxStorePaths':10,'caBundle':str(self.base/'cert.pem')})
    def test_tls_and_bound(self):
        with tempfile.TemporaryDirectory() as d:
            self.assertEqual(self.delivery().fetch('ok',Path(d)/'ok',100),100)
            with self.assertRaises(m.Refused):self.delivery().fetch('big',Path(d)/'big',10)
    def test_redirect_not_followed(self):
        with tempfile.TemporaryDirectory() as d:
            with self.assertRaises(m.Refused):self.delivery().fetch('redirect',Path(d)/'out',100)
    def test_untrusted_tls_refused(self):
        d=self.delivery();d.opener=urllib.request.build_opener(urllib.request.ProxyHandler({}),m.NoRedirect(),urllib.request.HTTPSHandler(context=ssl.create_default_context()))
        with tempfile.TemporaryDirectory() as p, self.assertRaises(Exception):d.fetch('ok',Path(p)/'no',100)
    def test_aggregate_download_bound(self):
        d=self.delivery();d.left=50
        with tempfile.TemporaryDirectory() as p,self.assertRaises(m.Refused):d.fetch('ok',Path(p)/'small',100)
    def test_narinfo_cannot_escape_origin(self):
        key='0'*32;self.bodies['/cache/'+key+'.narinfo']=('StorePath: /nix/store/'+key+'-system\nURL: https://example.invalid/nar\nReferences: \nNarSize: 1\n').encode()
        with tempfile.TemporaryDirectory() as p,self.assertRaisesRegex(m.Refused,'narinfo-origin'):self.delivery().cache('/nix/store/'+key+'-system',Path(p)/'cache')
    def test_narinfo_invalid_reference(self):
        key='1'*32;self.bodies['/cache/'+key+'.narinfo']=('StorePath: /nix/store/'+key+'-system\nURL: nar/good.nar\nReferences: ../escape\nNarSize: 1\n').encode()
        with tempfile.TemporaryDirectory() as p,self.assertRaisesRegex(m.Refused,'narinfo-reference'):self.delivery().cache('/nix/store/'+key+'-system',Path(p)/'cache')
    def test_missing_ca_refused(self):
        with self.assertRaises(Exception):m.Delivery({'feedUrl':'https://localhost','maxDownloadBytes':1,'maxStorePaths':1,'caBundle':str(self.base/'absent')})
    def test_sigterm_and_sigkill_next_poll_recovers_staging(self):
        for sig in (signal.SIGTERM,signal.SIGKILL):
            with self.subTest(signal=sig),tempfile.TemporaryDirectory() as directory:
                state=Path(directory)/'state';state.mkdir(mode=0o700)
                sentinel=state/'operator-notes';sentinel.write_bytes(b'preserve')
                endpoint=f'/stall-{int(sig)}/manifest.json'
                self.blocked[endpoint]=threading.Event();self.release[endpoint]=threading.Event()
                config={'stateDirectory':str(state),'feedUrl':f'https://localhost:{self.server.server_port}/stall-{int(sig)}','caBundle':str(self.base/'cert.pem'),'maxDownloadBytes':500,'maxStorePaths':10}
                config_path=Path(directory)/'config.json';config_path.write_text(json.dumps(config))
                args=[sys.executable,str(Path(m.__file__)),str(config_path)]
                process=subprocess.Popen(args,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
                try:
                    self.assertTrue(self.blocked[endpoint].wait(10),'real TLS download did not begin')
                    deadline=time.monotonic()+5
                    while not list(state.glob('network-*/manifest.json')) and time.monotonic()<deadline: time.sleep(0.01)
                    stages=list(state.glob('network-*'));self.assertEqual(len(stages),1)
                    self.assertTrue((stages[0]/'manifest.json').exists())
                    concurrent=subprocess.run(args,capture_output=True,text=True,timeout=10)
                    self.assertEqual(json.loads(concurrent.stdout)['reason'],'update-operation-in-progress')
                    self.assertTrue(stages[0].exists(),'active download was swept')
                    process.send_signal(sig);process.communicate(timeout=10)
                    self.assertEqual(process.returncode,-int(sig))
                    self.assertTrue(stages[0].exists(),'fixture did not leave interrupted staging')
                    # Cleanup must also run when the next poll holds for a pending trial.
                    pending=state/'pending.json';pending.write_bytes(b'{"version":2}')
                    recovered=subprocess.run(args,capture_output=True,text=True,timeout=10)
                    self.assertEqual(recovered.returncode,0,recovered.stderr)
                    self.assertEqual(json.loads(recovered.stdout)['reason'],'trial-in-progress')
                    self.assertFalse(stages[0].exists())
                    self.assertEqual(pending.read_bytes(),b'{"version":2}')
                    self.assertEqual(sentinel.read_bytes(),b'preserve')
                finally:
                    self.release[endpoint].set()
                    if process.poll() is None: process.kill();process.communicate(timeout=10)

class StagingSafety(unittest.TestCase):
    def test_active_apply_preserves_staging(self):
        with tempfile.TemporaryDirectory() as directory:
            state=Path(directory);stage=state/'network-abcdefgh';stage.mkdir(mode=0o700)
            with (state/'operation.lock').open('a') as lock:
                fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
                with self.assertRaises(m.Hold):m.poll({'stateDirectory':str(state)})
                self.assertTrue(stage.exists())
    def test_symlink_never_followed(self):
        with tempfile.TemporaryDirectory() as directory:
            base=Path(directory);state=base/'state';state.mkdir(mode=0o700)
            outside=base/'outside';outside.mkdir();sentinel=outside/'keep';sentinel.write_bytes(b'owner')
            (state/'network-abcdefgh').symlink_to(outside,target_is_directory=True)
            with self.assertRaisesRegex(m.Refused,'unsafe-staging-entry'):m.poll({'stateDirectory':str(state)})
            self.assertEqual(sentinel.read_bytes(),b'owner')
if __name__=='__main__':unittest.main()

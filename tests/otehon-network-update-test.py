import importlib.util, unittest, tempfile, subprocess, ssl, http.server, threading, json, time
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
        cls.requests=[]
        class Handler(http.server.BaseHTTPRequestHandler):
            def do_GET(self):
                cls.requests.append(self.path)
                if self.path=='/redirect':self.send_response(302);self.send_header('Location','https://example.invalid/escape');self.end_headers();return
                self.send_response(200);self.end_headers();self.wfile.write(b'x'*100)
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
    def test_missing_ca_refused(self):
        with self.assertRaises(Exception):m.Delivery({'feedUrl':'https://localhost','maxDownloadBytes':1,'maxStorePaths':1,'caBundle':str(self.base/'absent')})
if __name__=='__main__':unittest.main()

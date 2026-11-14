"""AWAI-183: privileged Otehon OS administration, never an app-origin API."""
import fcntl, json, os, re, ssl, stat, time, shutil, subprocess, tempfile, urllib.parse, urllib.request
from pathlib import Path

class Refused(Exception): pass
class Hold(Exception): pass
HASH = re.compile(r"[0-9abcdfghijklmnpqrsvwxyz]{32}")
STORE = re.compile(r"/nix/store/([0-9abcdfghijklmnpqrsvwxyz]{32})-[A-Za-z0-9._+-]+")
NAME = re.compile(r"[a-z0-9][a-z0-9-]{0,63}")
class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs): raise Refused("redirect")

def origin_url(url):
    p = urllib.parse.urlsplit(url)
    if p.scheme != "https" or not p.hostname or p.username or p.password or p.query or p.fragment or re.search(r"[\s\\]", url): raise Refused("feed-origin")
    if any(x in (".", "..") for x in p.path.split("/")): raise Refused("feed-path")
    return url.rstrip("/")

class Delivery:
    def __init__(self, config):
        self.base = origin_url(config["feedUrl"])
        self.left = config["maxDownloadBytes"]
        self.limit = config["maxStorePaths"]
        self.config = config
        self.opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect(), urllib.request.HTTPSHandler(context=ssl.create_default_context(cafile=config["caBundle"])))
    def fetch(self, name, target, bound):
        if not re.fullmatch(r"[A-Za-z0-9._+/-]+", name) or ".." in name.split("/") or name.startswith("/"): raise Refused("fetch-path")
        count = 0; deadline = time.monotonic() + 60
        with self.opener.open(self.base + "/" + name, timeout=10) as response, open(target, "xb") as out:
            if response.status != 200: raise Refused("http-status")
            while True:
                if time.monotonic() > deadline: raise Refused("download-timeout")
                chunk = response.read(min(65536, bound - count + 1, self.left + 1))
                if not chunk: break
                count += len(chunk); self.left -= len(chunk)
                if count > bound or self.left < 0: raise Refused("download-bound")
                if shutil.disk_usage(Path(target).parent).free < self.config.get("minimumFreeBytes",0) + len(chunk): raise Hold("space")
                out.write(chunk)
            out.flush(); os.fsync(out.fileno())
        return count
    def cache(self, system, destination):
        destination.mkdir()
        (destination / "nix-cache-info").write_text("StoreDir: /nix/store\nWantMassQuery: 0\nPriority: 40\n")
        queue = [STORE.fullmatch(system).group(1)]; seen = set(); nars = {}; import_bytes = 0
        while queue:
            key = queue.pop()
            if key in seen: continue
            if not HASH.fullmatch(key) or len(seen) >= self.limit: raise Refused("closure-bound")
            seen.add(key); info = destination / (key + ".narinfo")
            self.fetch("cache/" + info.name, info, 1048576)
            fields = {}
            for line in info.read_text().splitlines():
                k, sep, v = line.partition(": ")
                if not sep: raise Refused("narinfo-field")
                if k in fields and k != "Sig": raise Refused("narinfo-duplicate")
                fields[k] = v
            match = STORE.fullmatch(fields.get("StorePath", ""))
            if not match or match.group(1) != key: raise Refused("narinfo-store")
            nar = fields.get("URL", "")
            if not re.fullmatch(r"nar/[A-Za-z0-9._+-]+", nar) or "/.." in nar: raise Refused("narinfo-origin")
            for ref in fields.get("References", "").split():
                m = STORE.fullmatch("/nix/store/" + ref)
                if not m: raise Refused("narinfo-reference")
                queue.append(m.group(1))
                if len(queue) > self.limit * 16: raise Refused("closure-bound")
            try: size = int(fields['NarSize'])
            except (KeyError,ValueError): raise Refused('nar-size')
            if size < 0 or size > self.config['maxImportBytes'] - import_bytes: raise Refused('import-bound')
            exists = subprocess.run(['nix-store','--check-validity',fields['StorePath']],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL).returncode == 0
            if not exists: import_bytes += size
            nars[nar] = (fields['StorePath'], exists)
        # Verify signatures on ALL metadata before downloading/importing any NAR.
        subprocess.run(['nix','--extra-experimental-features','nix-command','store','verify','--store','file://'+str(destination),'--recursive','--no-contents','--sigs-needed','1','--option','trusted-public-keys',Path(self.config['cacheKey']).read_text().strip(),system],check=True)
        for nar, (store_path, exists) in nars.items():
            # Reuse already admitted store paths instead of downloading the entire OS again.
            if exists: continue
            (destination / 'nar').mkdir(exist_ok=True)
            self.fetch('cache/'+nar,destination/nar,self.left)
        if shutil.disk_usage('/nix/store').free < self.config['minimumFreeBytes'] + import_bytes: raise Hold('import-space')
        return len(seen)

def admit(manifest, config, now):
    required = {"version", "system", "schema", "channel", "cohorts", "architecture", "stateContract", "issuedAt", "expiresAt"}
    if set(manifest) != required or manifest["schema"] != "awai.otehon.release.v1": raise Refused("release-schema")
    if type(manifest["version"]) is not int or not 0 < manifest["version"] < 2**53 or not STORE.fullmatch(manifest["system"]): raise Refused("release-shape")
    if manifest["architecture"] != config["architecture"] or manifest["stateContract"] != config["stateContract"]: raise Refused("state-contract")
    if manifest["channel"] != config["channel"]: raise Refused("channel")
    cohorts = manifest["cohorts"]
    if not isinstance(cohorts, list) or not cohorts or len(cohorts)>64 or not all(isinstance(x,str) and NAME.fullmatch(x) for x in cohorts) or len(set(cohorts)) != len(cohorts): raise Refused("cohorts")
    issued, expiry = manifest["issuedAt"], manifest["expiresAt"]
    if type(issued) is not int or type(expiry) is not int or not issued <= now < expiry or not 0 < expiry-issued <= config["maxValiditySeconds"]: raise Refused("release-time")
    if config["cohort"] not in cohorts: raise Hold("cohort")
    if time.localtime(now).tm_hour not in config["maintenanceHours"]: raise Hold("maintenance-window")

def lock_file(path):
    handle = path.open("a")
    try:
        fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        handle.close()
        raise Hold("update-operation-in-progress")
    return handle

def clean_abandoned_stages(state):
    # Both network polling and foundation apply/settle must be idle. In particular,
    # a killed poller may have left an apply subprocess importing this cache.
    with lock_file(state / "operation.lock"):
        for child in state.iterdir():
            if not re.fullmatch(r"network-[a-z0-9_]{8}", child.name): continue
            info = child.lstat()
            if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.geteuid() or info.st_mode & 0o077:
                raise Refused("unsafe-staging-entry")
            shutil.rmtree(child)

def poll(config, command="otehon-update"):
    state = Path(config["stateDirectory"])
    state.mkdir(mode=0o700, parents=True, exist_ok=True)
    # Own this lock in Python as well as the service lifetime: direct invocations
    # must not sweep another active download. It is released by SIGTERM/SIGKILL.
    with lock_file(state / "network.lock"):
        clean_abandoned_stages(state)
        return poll_locked(config, command, state)

def poll_locked(config, command, state):
    if (state / "pending.json").exists(): raise Hold("trial-in-progress")
    stage = Path(tempfile.mkdtemp(prefix="network-", dir=state))
    try:
        delivery = Delivery(config)
        delivery.fetch("manifest.json", stage/"manifest.json", 1048576)
        delivery.fetch("manifest.json.minisig", stage/"manifest.json.minisig", 16384)
        # Reuse the foundation's pinned minisign, version, failed-version and pending admission.
        result = subprocess.run([command, "check", str(stage)], capture_output=True, text=True)
        if result.returncode:
            if "old-version" in result.stdout: raise Hold("no-new-version")
            raise Refused("manifest-admission")
        manifest = json.loads((stage/"manifest.json").read_bytes())
        admit(manifest, config, int(time.time()))
        if shutil.disk_usage(state).free < config["minimumFreeBytes"] + 1048576: raise Hold("space")
        paths = delivery.cache(manifest["system"], stage/"cache")
        subprocess.run([command, "apply", str(stage)], check=True)
        print(json.dumps({"phase":"staged","version":manifest["version"],"storePaths":paths}), flush=True)
        if config["automaticReboot"]: subprocess.run(["systemctl","reboot","--no-block"],check=True)
    finally:
        shutil.rmtree(stage)

if __name__ == "__main__":
    import sys
    try:
        config = json.loads(Path(sys.argv[1]).read_text())
        poll(config)
    except Hold as e: print(json.dumps({"phase":"held","reason":str(e)}))
    except Exception as e:
        print(json.dumps({"phase":"refused","reason":str(e) if isinstance(e,Refused) else type(e).__name__}))
        sys.exit(2)

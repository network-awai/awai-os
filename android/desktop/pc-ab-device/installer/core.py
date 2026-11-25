#!/usr/bin/env python3
"""Awai OS PC installer: the guards and the install sequence, shared by the screen and the text front ends.

Nothing in the front ends decides whether a disk may be written. They call `disk_problems`,
`confirm_target` and `run_install`; every refusal is produced here, in the backend.

  core.py worker --work-dir DIR --media-dir DIR     run the install described by DIR/request.json (detached by server.py)

`run_install` order (each step may only add refusals, none may be skipped):
  explicit confirmation -> target checks + identity == confirmed -> archive.sha256 -> raw image sha256 == pinned value
  -> plan (existing == [], expected new partition count) -> target checks + identity again, immediately
  before writing -> `awai-pc-install.py apply --record` -> record checks -> `sgdisk -v` -> sync.
"""
import contextlib
import errno
import fcntl
import hashlib
import importlib.util
import io
import json
import os
import re
import shutil
import stat
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_WORK = "/run/awai-pc-installer"
DEFAULT_MEDIA = "/run/archiso/bootmnt/awai"
ARCHIVE_NAME = "awai-pc-install.img.zst"
IMAGE_NAME = "awai-pc-install.img"
USERDATA_GIB = 16
SECTOR = 512
SKIPPED_DISKS = re.compile(r"^(loop|ram|zram|sr|fd|nbd)\d*$")

# code -> (Japanese shown on screen, English shown by the text installer)
MESSAGES = {
    "not-nvme": ("NVMe SSD 全体ではないため選べません。", "Choose the whole NVMe device, such as /dev/nvme0n1."),
    "not-block": ("ディスクとして認識できないため選べません。", "The target is not a block device."),
    "not-disk": ("ディスク全体ではないため選べません。", "The target is not a whole disk."),
    "read-only": ("読み取り専用のため選べません。", "The target is read-only."),
    "has-partitions": ("既存の区画があるため選べません。", "The target already has partitions. Use an approved blank NVMe."),
    "sector-size": ("512 バイトセクターの SSD のみ対応しています。", "This pilot installer requires 512-byte logical sectors."),
    "mounted": ("使用中（マウント済み）のため選べません。", "The target has a mounted filesystem."),
    "signatures": ("既存のデータがあるため選べません。", "The target contains existing data signatures."),
    "boot-medium": ("この PC を起動した USB のため選べません。", "This is the boot medium."),
    "boot-unknown": ("起動した USB を特定できないため選べません。", "The boot medium could not be identified."),
    "inspect-failed": ("ディスクの情報を取得できないため選べません。", "The disk could not be inspected."),
    "not-confirmed": ("インストールの確認が完了していません。もう一度やり直してください。", "The install was not explicitly confirmed."),
    "no-ticket": ("確認の手順が完了していません。もう一度やり直してください。", "The target was not confirmed."),
    "identity-changed": ("確認した後に SSD の情報が変わったため、書き込まずに中止しました。", "The target identity changed after it was confirmed."),
    "record-exists": ("このセッションではすでに書き込みが行われています。再起動してからやり直してください。", "An install record exists. Reboot before another installation."),
    "busy": ("別のインストールが実行中です。", "Another installation is running."),
    "pins-invalid": ("USB のハッシュ記録が正しくありません。", "The pinned hash files are missing or malformed."),
    "archive-sha": ("インストールイメージの確認に失敗しました。USB の内容が正しくありません。", "archive.sha256 check failed."),
    "image-sha": ("展開したイメージが期待する内容と一致しません。", "The raw image SHA-256 does not match the pinned value."),
    "no-space": ("メモリが足りません。インストールイメージを展開できませんでした。", "Not enough memory (the work directory is a RAM disk) to unpack the image."),
    "image-failed": ("インストールイメージを展開できませんでした。", "The image could not be decompressed."),
    "plan-refused": ("書き込み計画を作れなかったため中止しました。", "The plan was refused."),
    "plan-name-in-use": ("SSD にすでに Awai OS の区画があるため中止しました。", "A partition name is already in use."),
    "plan-no-space": ("SSD の空き容量が足りないため中止しました。", "Not enough free space."),
    "plan-not-empty": ("SSD に既存の区画があるため中止しました。", "The plan found existing partitions."),
    "plan-count": ("作成する区画の数が想定と異なるため中止しました。", "The plan does not have the expected partitions."),
    "apply-refused": ("書き込み前の検証で中止しました。", "apply refused before writing."),
    "readback": ("書き込んだ内容が読み戻しの結果と一致しませんでした。", "Written data differs on readback."),
    "existing-changed": ("既存の区画の内容が変わったことを検出しました。", "An existing partition changed."),
    "apply-failed": ("書き込みまたは読み戻しの検証に失敗しました。", "apply failed."),
    "record-invalid": ("インストール記録が期待する内容と一致しません。", "The install record does not match the expected result."),
    "sgdisk-verify": ("区画表の検証で問題が見つかりました。", "sgdisk -v reported a problem."),
    "sync-failed": ("書き込みの同期に失敗しました。", "sync failed."),
    "interrupted": ("インストールが途中で止まりました。", "The installer stopped before it finished."),
    "internal": ("予期しないエラーで中止しました。", "Unexpected error."),
}
STEPS_JA = {1: "イメージの確認", 2: "SSD への書き込み", 3: "書き込んだ内容の読み戻し"}


class Refusal(Exception):
    def __init__(self, code, detail=""):
        super().__init__(f"{code}: {detail}" if detail else code)
        self.code, self.detail = code, detail


class Busy(Exception):
    """Another installer holds the lock. Raised before anything is read or written."""


class Blocked(Exception):
    """An install already wrote or recorded in this session. State is left untouched."""


# --------------------------------------------------------------------------- host

class Host:
    """The only door to the system. Tests give a subclass; production uses this one."""
    dev_dir = "/dev"

    def run(self, cmd):
        return subprocess.run(cmd, capture_output=True, text=True, env={**os.environ, "LC_ALL": "C"})

    def is_block(self, path):
        try:
            return stat.S_ISBLK(os.stat(path).st_mode)
        except OSError:
            return False

    def dev_path(self, name):
        return f"{self.dev_dir}/{name}"

    def target_re(self):
        return re.compile(re.escape(self.dev_dir) + r"/nvme[0-9]+n[0-9]+")


def _out(host, cmd):
    r = host.run(cmd)
    if r.returncode != 0:
        raise Refusal("inspect-failed", " ".join(cmd))
    return r.stdout


def parse_pairs(line):
    return dict(re.findall(r'([A-Z][A-Z0-9:_-]*)="((?:[^"\\]|\\.)*)"', line))


LSBLK_COLS = "NAME,SIZE,VENDOR,MODEL,SERIAL,WWN,TRAN,RO,TYPE,MAJ:MIN"


def _facts(row):
    return {"name": row["NAME"], "size": int(row["SIZE"]), "vendor": row.get("VENDOR", "").strip(), "model": row.get("MODEL", "").strip(),
            "serial": row.get("SERIAL", "").strip() or None, "wwn": row.get("WWN", "").strip() or None,
            "tran": row.get("TRAN", "").strip(), "ro": row.get("RO"), "type": row.get("TYPE"),
            "majmin": row.get("MAJ:MIN")}


def list_block_disks(host):
    rows = [parse_pairs(l) for l in _out(host, ["lsblk", "-dn", "-P", "-b", "-o", LSBLK_COLS]).splitlines() if l.strip()]
    return [_facts(r) for r in rows if r.get("TYPE") == "disk" and not SKIPPED_DISKS.match(r["NAME"])]


def boot_chain(host, media):
    """Names of every block device the media directory is served from (partition, disk, dm parents)."""
    r = host.run(["findmnt", "-n", "-o", "SOURCE", "--target", media])
    source = r.stdout.strip() if r.returncode == 0 else ""
    if not source.startswith("/"):
        return None
    r = host.run(["lsblk", "-nr", "-s", "-o", "NAME", source])
    names = {l.strip() for l in r.stdout.splitlines() if l.strip()} if r.returncode == 0 else set()
    names.add(os.path.basename(source))
    return names


def disk_problems(host, name, boot):
    """Every reason `name` may not be written, in the order of the text installer's checks. [] = eligible."""
    path = host.dev_path(name)
    problems = []
    if not host.target_re().fullmatch(path):
        problems.append("not-nvme")
    if not host.is_block(path):
        problems.append("not-block")
    try:
        kind = _out(host, ["lsblk", "-dn", "--raw", "-o", "TYPE,RO", path]).split()
        if kind != ["disk", "0"]:
            problems.append("read-only" if kind == ["disk", "1"] else "not-disk")
        if len([l for l in _out(host, ["lsblk", "-nr", "-o", "TYPE", path]).splitlines() if l.strip()]) != 1:
            problems.append("has-partitions")
        if _out(host, ["blockdev", "--getss", path]).strip() != str(SECTOR):
            problems.append("sector-size")
        if any(l.strip() for l in _out(host, ["lsblk", "-nr", "-o", "MOUNTPOINTS", path]).splitlines()):
            problems.append("mounted")
        signatures = [l.strip() for l in _out(host, ["wipefs", "--no-act", "--noheadings", "--output", "TYPE", path]).splitlines() if l.strip()]
        if any(s not in ("gpt", "PMBR") for s in signatures):
            problems.append("signatures")
    except Refusal:
        problems.append("inspect-failed")
    if boot is None:
        problems.append("boot-unknown")
    elif name in boot:
        problems.append("boot-medium")
    return problems


def require_target(host, name, boot):
    problems = disk_problems(host, name, boot)
    if problems:
        raise Refusal(problems[0])


def identity(host, name):
    """What the person confirmed. Compared field by field, so a serial or WWN appearing or vanishing is a change."""
    path = host.dev_path(name)
    rows = [parse_pairs(l) for l in _out(host, ["lsblk", "-dn", "-P", "-b", "-o", LSBLK_COLS, path]).splitlines() if l.strip()]
    if len(rows) != 1 or rows[0].get("NAME") != name:
        raise Refusal("inspect-failed", name)
    f = _facts(rows[0])
    return {k: f[k] for k in ("name", "majmin", "size", "model", "serial", "wwn")}


def list_disks(host, media):
    boot = boot_chain(host, media)
    out = []
    for d in list_block_disks(host):
        problems = disk_problems(host, d["name"], boot)
        out.append(dict(d, path=host.dev_path(d["name"]), eligible=not problems, problems=problems))
    return out


def confirm_target(host, media, name):
    """Step 1 -> 2: the checks plus the identity the later write is compared with."""
    require_target(host, name, boot_chain(host, media))
    return identity(host, name)


# --------------------------------------------------------------------------- pins, image

def _read_pin(path, expected_name):
    try:
        with open(path) as f:
            text = f.read()
    except OSError:
        raise Refusal("pins-invalid", os.path.basename(path))
    m = re.fullmatch(r"([0-9a-f]{64})  (\S+)\n?", text)
    if not m or m[2] != expected_name:
        raise Refusal("pins-invalid", os.path.basename(path))
    return m[1]


def load_pins(media):
    """One source of truth for both digests: the two files on the media."""
    return (_read_pin(os.path.join(media, "archive.sha256"), ARCHIVE_NAME),
            _read_pin(os.path.join(media, "install-image.sha256"), IMAGE_NAME))


def _hash_file(path, progress):
    digest, done = hashlib.sha256(), 0
    total = max(os.path.getsize(path), 1)
    with open(path, "rb") as f:
        while chunk := f.read(8 << 20):
            digest.update(chunk)
            done += len(chunk)
            progress(done / total)
    return digest.hexdigest()


def prepare_image(host, media, work, archive_sha, image_sha, progress):
    """archive.sha256 first, then the raw image, whose sha256 must equal the pinned value. progress(0..1)."""
    archive = os.path.join(media, ARCHIVE_NAME)
    raw = os.path.join(work, IMAGE_NAME)
    if not os.path.isfile(archive):
        raise Refusal("archive-sha", "missing archive")
    if _hash_file(archive, lambda f: progress(0.15 * f)) != archive_sha:
        raise Refusal("archive-sha")
    if not os.path.exists(raw):
        # /run is a tmpfs (half of RAM) and holds the unpacked image. The unpacked size is only an upper bound (the file is
        # sparse), but it can never be smaller than the archive's incompressible content: refuse early below that, and map
        # a full disk during unpacking to the same clear message.
        if shutil.disk_usage(work).free < os.path.getsize(archive):
            raise Refusal("no-space", "free space below the archive size")
        _decompress(host, archive, raw + ".part", image_sha, lambda f: progress(0.15 + 0.45 * f))
        os.replace(raw + ".part", raw)
    else:
        progress(0.6)
    if _hash_file(raw, lambda f: progress(0.6 + 0.4 * f)) != image_sha:
        raise Refusal("image-sha")
    progress(1.0)
    return raw


def _decompress(host, archive, part, image_sha, progress):
    """zstd -> sparse raw file. Progress is the share of the compressed archive already fed to zstd."""
    import threading
    proc = subprocess.Popen(["zstd", "--quiet", "-dc"], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                            env={**os.environ, "LC_ALL": "C"})
    total, fed = max(os.path.getsize(archive), 1), [0]

    def feed():
        try:
            with open(archive, "rb") as f:
                while chunk := f.read(1 << 20):
                    proc.stdin.write(chunk)
                    fed[0] += len(chunk)
        except OSError:
            pass
        finally:
            with contextlib.suppress(OSError):
                proc.stdin.close()

    feeder = threading.Thread(target=feed, daemon=True)
    feeder.start()
    digest, zero, size = hashlib.sha256(), bytes(1 << 20), 0
    try:
        with open(part, "wb") as out:
            while chunk := proc.stdout.read(1 << 20):
                digest.update(chunk)
                size += len(chunk)
                if chunk == zero[:len(chunk)]:
                    out.seek(len(chunk), os.SEEK_CUR)
                else:
                    out.write(chunk)
                progress(min(0.99, fed[0] / total))
            out.truncate(size)
            out.flush()
            os.fsync(out.fileno())
        feeder.join()
        proc.stdout.close()
        if proc.wait() != 0 or fed[0] != os.path.getsize(archive):
            raise Refusal("image-failed", f"zstd exit {proc.returncode}")
    except OSError as e:
        with contextlib.suppress(OSError):
            os.unlink(part)
        raise Refusal("no-space" if e.errno == errno.ENOSPC else "image-failed", str(e))
    finally:
        if proc.poll() is None:
            proc.kill()
            proc.wait()
        proc.stdout.close()
    if digest.hexdigest() != image_sha:
        with contextlib.suppress(OSError):
            os.unlink(part)
        raise Refusal("image-sha")
    progress(1.0)


def load_installer(installer_py=None):
    path = installer_py or next(p for p in (os.path.join(HERE, "awai-pc-install.py"),
                                            os.path.join(HERE, "..", "awai-pc-install.py")) if os.path.exists(p))
    spec = importlib.util.spec_from_file_location("awai_pc_install", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


_PLAN_MESSAGES = (("name-in-use", "plan-name-in-use"), ("not-enough-free-space", "plan-no-space"))


def make_checked_plan(mod, path, raw):
    try:
        plan = mod.make_plan(path, raw, USERDATA_GIB)
        sparts = mod.table(raw)[0]
        expected = len(mod.LAYOUT) + len(mod.vbmeta_layout(sparts))
    except SystemExit as e:
        msg = str(e.code)
        code = next((c for k, c in _PLAN_MESSAGES if k in msg), "plan-refused")
        raise Refusal(code, msg)
    except subprocess.CalledProcessError as e:
        raise Refusal("plan-refused", f"{e.cmd[0]} failed")
    if plan["existing"] != []:
        raise Refusal("plan-not-empty")
    if len(plan["new"]) != expected:
        raise Refusal("plan-count", f"{len(plan['new'])} != {expected}")
    return plan, expected


# --------------------------------------------------------------------------- state and lock

def _path(work, name):
    return os.path.join(work, name)


def ensure_work(work):
    os.makedirs(work, mode=0o700, exist_ok=True)
    os.chmod(work, 0o700)


def read_state(work):
    """Writers replace the file atomically, so a partial read means another writer is not ours: retry before giving up."""
    for attempt in range(4):
        try:
            with open(_path(work, "state.json")) as f:
                return json.load(f)
        except FileNotFoundError:
            break
        except (OSError, ValueError):
            time.sleep(0.05 * (attempt + 1))
    return {"state": "idle"}


def lock_held(work):
    ensure_work(work)
    fd = os.open(_path(work, "lock"), os.O_RDWR | os.O_CREAT, 0o600)
    try:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        return False
    except BlockingIOError:
        return True
    finally:
        os.close(fd)


def write_started(work):
    return os.path.exists(_path(work, "write-started")) or os.path.lexists(_path(work, "install-record.json"))


def status(work, starting=False):
    """The true state: a `running` file without a live lock holder is an interrupted install, never a running one."""
    st = read_state(work)
    if st.get("state") == "running" and not starting and not lock_held(work):
        st = dict(st, state="failed", error={"code": "interrupted", "step": st.get("step", 1)},
                  written="started" if write_started(work) else "none")
    if st.get("state") == "failed" and st.get("error"):
        code = st["error"].get("code", "internal")
        st["error"] = dict(st["error"], ja=MESSAGES.get(code, MESSAGES["internal"])[0],
                           stepJa=STEPS_JA.get(st["error"].get("step", 1), ""))
    return st


class Reporter:
    def __init__(self, work, device, on_update=None):
        self.work, self.on_update, self.last = work, on_update, 0.0
        self.state = {"schema": 1, "state": "running", "device": device, "step": 1, "fraction": 0.0,
                      "written": "none", "partitions": None, "updatedAt": time.time()}

    def push(self, force=True, **kw):
        self.state.update(kw)
        now = time.monotonic()
        if not force and now - self.last < 0.2:
            return
        self.last = now
        self.state["updatedAt"] = time.time()
        tmp = _path(self.work, "state.json.tmp")
        fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w") as f:
            json.dump(self.state, f)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, _path(self.work, "state.json"))
        if self.on_update:
            self.on_update(dict(self.state))

    def fail(self, refusal):
        self.push(state="failed", error={"code": refusal.code, "detail": refusal.detail[:300], "step": self.state["step"]})


# --------------------------------------------------------------------------- the install

def run_install(host, work, media, request, on_update=None, installer_py=None):
    """request = {"device": "nvme0n1", "confirmed": True, "identity": {...}}. Returns the final state.
    Raises Busy / Blocked without touching state when it must not start at all."""
    ensure_work(work)
    lock_fd = os.open(_path(work, "lock"), os.O_RDWR | os.O_CREAT, 0o600)
    try:
        try:
            fcntl.flock(lock_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise Busy()
        if write_started(work):
            raise Blocked()
        rep = Reporter(work, request.get("device"), on_update)
        rep.push()
        try:
            _install(host, work, media, request, rep, installer_py)
        except Refusal as e:
            rep.fail(e)
        except SystemExit as e:
            rep.fail(Refusal("internal", str(e.code)))
        except OSError as e:
            rep.fail(Refusal("no-space" if e.errno == errno.ENOSPC else "internal", f"{type(e).__name__}: {e}"))
        except Exception as e:  # never let an unexpected error look like success
            rep.fail(Refusal("internal", f"{type(e).__name__}: {e}"))
        return rep.state
    finally:
        os.close(lock_fd)


_APPLY_MESSAGES = (("written data differs on readback", "readback"), ("data changed", "existing-changed"),
                   ("GPT entry changed", "existing-changed"), ("digest does not match", "image-sha"),
                   ("install record already exists", "record-exists"))


def _install(host, work, media, request, rep, installer_py):
    name = request.get("device") or ""
    if request.get("confirmed") is not True:
        raise Refusal("not-confirmed")
    confirmed = request.get("identity")
    if not isinstance(confirmed, dict):
        raise Refusal("no-ticket")
    path = host.dev_path(name)
    record = _path(work, "install-record.json")

    boot = boot_chain(host, media)
    require_target(host, name, boot)
    if identity(host, name) != confirmed:
        raise Refusal("identity-changed")

    archive_sha, image_sha = load_pins(media)
    raw = prepare_image(host, media, work, archive_sha, image_sha, lambda f: rep.push(False, step=1, fraction=round(f, 4)))
    mod = load_installer(installer_py)
    make_checked_plan(mod, path, raw)

    # Immediately before writing: every target check again, then the identity again, then a fresh plan.
    boot = boot_chain(host, media)
    require_target(host, name, boot)
    if identity(host, name) != confirmed:
        raise Refusal("identity-changed")
    plan, expected = make_checked_plan(mod, path, raw)
    if os.path.lexists(record):
        raise Refusal("record-exists")

    rep.push(step=2, fraction=0.0, partitions=expected)

    def progress(event, done, total):
        if event == "write-start":
            fd = os.open(_path(work, "write-started"), os.O_WRONLY | os.O_CREAT, 0o600)
            os.fsync(fd)
            os.close(fd)
            rep.push(written="started")
        elif event == "write":
            rep.push(False, step=2, fraction=round(done / max(total, 1), 4))
        elif event == "write-done":
            rep.push(step=3, fraction=0.0)
        elif event == "verify":
            rep.push(False, step=3, fraction=round(done / max(total, 1), 4))

    sink = io.StringIO()
    try:
        with contextlib.redirect_stdout(sink):
            mod.apply(path, raw, plan, record, image_sha, progress=progress)
    except SystemExit as e:
        msg = str(e.code)
        code = next((c for k, c in _APPLY_MESSAGES if k in msg), "apply-refused" if msg.startswith("REFUSED") else "apply-failed")
        raise Refusal(code, msg)
    except subprocess.CalledProcessError as e:
        raise Refusal("apply-failed", f"{e.cmd[0]} failed")

    rep.push(step=3, fraction=1.0)
    try:
        with open(record) as f:
            rec = json.load(f)
    except (OSError, ValueError):
        raise Refusal("record-invalid", "unreadable")
    readback = rec.get("newPartitionReadback")
    if (rec.get("sourceSha256") != image_sha or rec.get("existingUnchanged") is not True
            or not isinstance(readback, dict) or len(readback) != expected
            or not all(isinstance(v, dict) and re.fullmatch(r"[0-9a-f]{64}", str(v.get("sha256"))) for v in readback.values())):
        raise Refusal("record-invalid")
    r = host.run(["sgdisk", "-v", path])
    if r.returncode != 0 or "No problems found" not in r.stdout:
        raise Refusal("sgdisk-verify", r.stdout.strip()[:200])
    if host.run(["sync"]).returncode != 0:
        raise Refusal("sync-failed")
    rep.push(state="done", step=3, fraction=1.0, partitions=len(readback), record=record)


# --------------------------------------------------------------------------- worker entry

def worker_main(argv, host=None):
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("--work-dir", default=DEFAULT_WORK)
    ap.add_argument("--media-dir", default=DEFAULT_MEDIA)
    a = ap.parse_args(argv)
    try:
        with open(_path(a.work_dir, "request.json")) as f:
            request = json.load(f)
        os.unlink(_path(a.work_dir, "request.json"))
    except (OSError, ValueError):
        return 2
    try:
        state = run_install(host or Host(), a.work_dir, a.media_dir, request)
    except Busy:
        return 3
    except Blocked:
        return 4
    return 0 if state["state"] == "done" else 1


if __name__ == "__main__":
    if sys.argv[1:2] == ["worker"]:
        sys.exit(worker_main(sys.argv[2:]))
    sys.exit("usage: core.py worker --work-dir DIR --media-dir DIR")

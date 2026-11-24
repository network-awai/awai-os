"""Test world: fake system tools on PATH, regular files standing in for disks, a media directory.
No root, no real block devices."""
import hashlib
import json
import os
import shutil
import stat
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
INSTALLER = HERE.parent
sys.path.insert(0, str(INSTALLER))
import core  # noqa: E402

TARGET_BYTES = 20 << 30  # sparse: userdata (16 GiB) must fit
SECTOR = 512
SOURCE_PARTS = ["EFI", "super", "persist", "firmware", "vendor_boot_a", "vendor_boot_b", "boot_a", "boot_b"]


class FakeHost(core.Host):
    """Production Host with the device directory moved to a temp dir of regular files."""
    def __init__(self, dev_dir):
        self.dev_dir = str(dev_dir)

    def is_block(self, path):
        return os.path.isfile(path)


def disk(size=TARGET_BYTES, model="KXG80ZNV256G", serial="SN-A", wwn="eui.0025385", tran="nvme", **extra):
    d = {"size": size, "model": model, "serial": serial, "wwn": wwn, "tran": tran, "ro": "0", "type": "disk",
         "majmin": "259:0", "logsec": 512, "children": [], "mounts": [""], "signatures": ["gpt", "PMBR"]}
    d.update(extra)
    return d


class World:
    def __init__(self, vbmeta=False):
        self.tmp = Path(tempfile.mkdtemp(prefix="awai-inst-"))
        self.dev, self.media, self.work, self.bin = (self.tmp / n for n in ("dev", "media", "work", "bin"))
        for p in (self.dev, self.media, self.bin):
            p.mkdir()
        self.world_file = self.tmp / "world.json"
        self.world = {"disks": {"nvme0n1": disk(), "sda": disk(size=62 << 30, model="TransMemory", serial="USB1", wwn=None, tran="usb", majmin="8:0",
                                                               signatures=["iso9660"], children=[{}])},
                      "boot": {"source": "/dev/sda1", "chain": ["sda1", "sda"]}}
        for name in self.world["disks"]:
            (self.dev / name).write_bytes(b"")
        with open(self.dev / "nvme0n1", "wb") as f:
            f.truncate(TARGET_BYTES)
        for tool in ("lsblk", "blockdev", "wipefs", "findmnt", "sgdisk", "zstd", "sync", "systemctl"):
            w = self.bin / tool
            w.write_text(f'#!/bin/sh\nexec "{sys.executable}" "{HERE / "fake_tool.py"}" {tool} "$@"\n')
            w.chmod(0o755)
        self.make_media(vbmeta)
        self.save()
        self._env = {k: os.environ.get(k) for k in ("PATH", "FAKE_WORLD")}
        os.environ["PATH"] = f"{self.bin}{os.pathsep}{os.environ['PATH']}"
        os.environ["FAKE_WORLD"] = str(self.world_file)
        self.host = FakeHost(self.dev)

    def make_media(self, vbmeta=False):
        names = SOURCE_PARTS + (["vbmeta_a", "vbmeta_b"] if vbmeta else [])
        parts, cur = [], 2048
        for i, n in enumerate(names, 1):
            parts.append({"number": i, "start": cur, "end": cur + 7, "type": "8300", "name": n})
            cur += 2048
        raw = bytearray(os.urandom(cur * SECTOR))
        head = b"FAKEGPT" + json.dumps({"parts": parts, "guids": {}}).encode()
        raw[:1 << 16] = head.ljust(1 << 16, b"\0")
        self.raw_sha = hashlib.sha256(raw).hexdigest()
        # the fake zstd copies its input, so the "archive" is the raw bytes
        (self.media / core.ARCHIVE_NAME).write_bytes(bytes(raw))
        self.archive_sha = hashlib.sha256(raw).hexdigest()
        (self.media / "archive.sha256").write_text(f"{self.archive_sha}  {core.ARCHIVE_NAME}\n")
        (self.media / "install-image.sha256").write_text(f"{self.raw_sha}  {core.IMAGE_NAME}\n")
        self.expected_parts = 11 + (2 if vbmeta else 0)

    def save(self):
        self.world_file.write_text(json.dumps(self.world))

    def update(self, **top):
        self.world.update(top)
        self.save()

    def edit_disk(self, name, **fields):
        self.world["disks"][name].update(fields)
        self.save()

    def request(self, device="nvme0n1", typed=None):
        ident = core.confirm_target(self.host, str(self.media), device)
        return {"device": device, "typed": typed if typed is not None else device, "identity": ident}

    def run(self, request, **kw):
        return core.run_install(self.host, str(self.work), str(self.media), request, **kw)

    def cleanup(self):
        for k, v in self._env.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v
        shutil.rmtree(self.tmp, ignore_errors=True)

    def target_untouched(self):
        return not (self.dev / "nvme0n1.gpt.json").exists() and not (self.work / "write-started").exists()


WORKER_ENTRY = HERE / "worker_entry.py"


def worker_cmd(world):
    return [sys.executable, str(WORKER_ENTRY), str(world.dev), "--work-dir", str(world.work), "--media-dir", str(world.media)]

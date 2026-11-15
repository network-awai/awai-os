"""Local OS provisioning only. Never migrate or overwrite an existing store/home."""
import json
import os
from pathlib import Path
import pwd
import secrets
import stat
import subprocess
import sys


def directory(path, uid, gid):
    if path.is_symlink():
        raise RuntimeError('symlink directory refused')
    path.mkdir(mode=0o700, parents=True, exist_ok=True)
    info = path.stat()
    if not stat.S_ISDIR(info.st_mode):
        raise RuntimeError('directory required')
    os.chown(path, uid, gid)
    os.chmod(path, 0o700)


def create_private(path, data, uid, gid):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'w') as out:
        os.fchown(out.fileno(), uid, gid)
        out.write(data)
        out.flush()
        os.fsync(out.fileno())


def prepare(config):
    state, mount = Path(config['state']), Path(config['mount'])
    user = pwd.getpwnam(config['user'])
    source = subprocess.check_output(
        ['findmnt', '-n', '-o', 'MAJ:MIN', '--target', user.pw_dir], text=True).strip()
    encrypted = subprocess.check_output(
        ['lsblk', '-ndo', 'MAJ:MIN', '/dev/mapper/otehon-state'], text=True).strip()
    if not encrypted or source != encrypted:
        raise RuntimeError('Drive requires the unlocked Otehon encrypted state')
    # The encrypted volume's root stays root-only. Access through its existing
    # per-user home bind, rather than relaxing /var/lib/otehon permissions.
    for parent in reversed(list(state.parents)):
        if parent != Path(user.pw_dir) and Path(user.pw_dir) in parent.parents:
            directory(parent, user.pw_uid, user.pw_gid)
    directory(state, user.pw_uid, user.pw_gid)
    directory(state / 'cache', user.pw_uid, user.pw_gid)
    if mount.is_symlink() or (mount.exists() and any(mount.iterdir())):
        raise RuntimeError('Drive mount must be empty; existing files are preserved')
    directory(mount, user.pw_uid, user.pw_gid)
    credentials = state / 'credentials'
    if not credentials.exists() and not credentials.is_symlink():
        token = secrets.token_hex(32)
        create_private(credentials, 'AWAI_VOL_TOKEN=' + token + '\nRCLONE_WEBDAV_BEARER_TOKEN=' + token + '\n', user.pw_uid, user.pw_gid)
    info = credentials.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_uid != user.pw_uid or info.st_mode & 0o077:
        raise RuntimeError('unsafe Drive credential file')
    # Only fresh homes receive the default; never rewrite existing preferences.
    config_dir = Path(user.pw_dir) / '.config'
    if config['defaultSave']:
        directory(config_dir, user.pw_uid, user.pw_gid)
        dirs = config_dir / 'user-dirs.dirs'
        if not dirs.exists() and not dirs.is_symlink():
            create_private(dirs, 'XDG_DOCUMENTS_DIR=' + json.dumps(str(mount)) + '\n', user.pw_uid, user.pw_gid)
        gtk = config_dir / 'gtk-3.0'
        directory(gtk, user.pw_uid, user.pw_gid)
        bookmarks = gtk / 'bookmarks'
        if not bookmarks.exists() and not bookmarks.is_symlink():
            create_private(bookmarks, mount.as_uri() + ' Awai Drive\n', user.pw_uid, user.pw_gid)


if __name__ == '__main__':
    prepare(json.loads(Path(sys.argv[1]).read_text()))

"""Publish only a mounted Drive; never remove or replace user files."""
import os
from pathlib import Path
import sys


def manage(action, target, public, mounted=os.path.ismount):
    target, public = Path(target), Path(public)
    if action == 'publish':
        if not mounted(target):
            raise RuntimeError('Drive is not mounted')
        # symlink(2) fails atomically if any user path already exists.
        public.symlink_to(target)
    elif action == 'withdraw':
        if public.is_symlink() and os.readlink(public) == str(target) and public.lstat().st_uid == os.getuid():
            public.unlink()
    else:
        raise RuntimeError('unknown Drive alias action')


if __name__ == '__main__':
    manage(*sys.argv[1:4])

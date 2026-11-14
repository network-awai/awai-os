"""Fixed UEFI registration after verified image installation; root OS administration."""
import json
import os
from pathlib import Path
import re
import stat
import struct
import subprocess
import sys
import uuid

EFI = Path('/sys/firmware/efi/efivars')
LABEL = 'Awai Otehon'
LOADER = r'\EFI\BOOT\BOOTX64.EFI'

class Refused(Exception): pass

def check_uefi():
    if not EFI.is_dir(): raise Refused('boot-usb-in-uefi-mode')
    result = subprocess.run(['findmnt','-n','-o','FSTYPE,OPTIONS','--target',str(EFI)], capture_output=True,text=True,check=True,timeout=10)
    fields = result.stdout.split()
    if len(fields)!=2 or fields[0]!='efivarfs' or 'rw' not in fields[1].split(','):
        raise Refused('uefi-variables-not-writable')

def esp_guid(fd):
    # The admitted image has a 512-byte-sector GPT, with ESP as entry one.
    header = os.pread(fd,512,512)
    if len(header)!=512 or header[:8]!=b'EFI PART': raise Refused('installed-gpt')
    table,count,size = struct.unpack_from('<QII',header,72)
    if table!=2 or not 1<=count<=128 or size!=128: raise Refused('installed-gpt-layout')
    entry = os.pread(fd,size,table*512)
    if len(entry)!=size or uuid.UUID(bytes_le=entry[:16])!=uuid.UUID('c12a7328-f81f-11d2-ba4b-00a0c93ec93b'):
        raise Refused('installed-esp')
    return str(uuid.UUID(bytes_le=entry[16:32]))

def verified_entry(listing,guid):
    order = re.search(r'^BootOrder:\s*([0-9a-f]{4})(?:,|\s*$)',listing,re.I|re.M)
    if not order: raise Refused('uefi-boot-order-readback')
    number = order.group(1)
    line = re.search(r'^Boot'+number+r'\*\s+Awai Otehon\s+(.+)$',listing,re.I|re.M)
    if not line or not re.search(r'HD\(1,GPT,'+re.escape(guid)+r',',line.group(1),re.I) or ('File('+LOADER+')').casefold() not in line.group(1).casefold():
        raise Refused('uefi-entry-readback')
    return number.upper()

def register(fd):
    check_uefi()
    if not stat.S_ISBLK(os.fstat(fd).st_mode): raise Refused('boot-target-not-block-device')
    guid = esp_guid(fd)
    # libefivar identifies the device through fstat/sysfs. Keep the admitted FD,
    # rather than resolving a potentially replaced /dev/nvmeX path again.
    subprocess.run(['efibootmgr','--create','--disk',f'/proc/self/fd/{fd}','--part','1','--label',LABEL,'--loader',LOADER],pass_fds=(fd,),check=True,capture_output=True,text=True,timeout=30)
    result = subprocess.run(['efibootmgr','--verbose'],check=True,capture_output=True,text=True,timeout=10)
    number = verified_entry(result.stdout,guid)
    return {'bootEntry':LABEL,'bootNumber':number,'espPartUuid':guid}

if __name__=='__main__':
    try:
        if os.geteuid()!=0: raise Refused('root-administration-required')
        if sys.argv[1:]==['check']:
            check_uefi();result={'uefiWritable':True}
        elif len(sys.argv)==3 and sys.argv[1]=='register' and re.fullmatch(r'[0-9]{1,4}',sys.argv[2]):
            result=register(int(sys.argv[2]))
        else: raise Refused('fixed-boot-operation-required')
        print(json.dumps(result))
    except Exception as error:
        print('BOOT_FAILED '+(str(error) if isinstance(error,Refused) else type(error).__name__),file=sys.stderr)
        sys.exit(2)

#!/bin/bash
# AWAI-3586: make a disk image whose A/B partitions hold exactly the images of a target-files package.
# An incremental OTA checks the source partitions against the target-files it was generated from; the stock
# disk-vda.img is built from PRODUCT_OUT, where boot.img differs from IMAGES/boot.img.
#   make-tf-disk.sh <target_files.zip> <stock disk-vda.img> <out disk image>
set -euo pipefail
TF=$1; STOCK=$2; OUT=$3
cd /root/build/src; export PATH=$PWD/out/host/linux-x86/bin:$PWD/prebuilts/jdk/jdk21/linux-x86/bin:$PATH
T=$(mktemp -d /root/build/tf-disk.XXXX); trap 'rm -rf $T' EXIT
unzip -q -o $TF "IMAGES/boot.img" "IMAGES/vendor_boot.img" -d $T
build_super_image $TF $T/super.img > $T/super.log 2>&1 || { tail -5 $T/super.log; exit 1; }
file $T/super.img | cut -c1-120
if file $T/super.img | grep -q sparse; then simg2img $T/super.img $T/super.raw; else mv $T/super.img $T/super.raw; fi
cp --sparse=always -f $STOCK $OUT
python3 - $OUT $T <<'PY'
import sys,subprocess,re,os,hashlib
out,t=sys.argv[1],sys.argv[2]
tab=subprocess.run(['/usr/sbin/sgdisk','-p',out],capture_output=True,text=True).stdout
parts={m[4]:(int(m[2]),int(m[3])) for m in re.finditer(r'^\s*(\d+)\s+(\d+)\s+(\d+)\s+\S+\s+\S+\s+\S+\s+(\S+)\s*$',tab,re.M)}
def put(name,img):
    s,e=parts[name]; n=os.path.getsize(img); assert n<=(e-s+1)*512,(name,n)
    h=hashlib.sha256()
    with open(out,'r+b') as o, open(img,'rb') as i:
        o.seek(s*512)
        while True:
            b=i.read(8<<20)
            if not b: break
            o.write(b); h.update(b)
    print(name,n,h.hexdigest())
for name,img in (('boot_a','IMAGES/boot.img'),('boot_b','IMAGES/boot.img'),('vendor_boot_a','IMAGES/vendor_boot.img'),('vendor_boot_b','IMAGES/vendor_boot.img'),('super','super.raw')):
    put(name,os.path.join(t,img))
PY
sha256sum $OUT

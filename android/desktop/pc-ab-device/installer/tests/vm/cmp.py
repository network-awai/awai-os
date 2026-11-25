import sys,struct,hashlib,subprocess,os,uuid
raw,iso=sys.argv[1:3]
def parts(h):
    n,sz=struct.unpack('<II',h[592:600]); st=struct.unpack('<Q',h[584:592])[0]; P={}
    for i in range(n):
        e=h[st*512+i*sz:st*512+i*sz+sz]
        if len(e)>=128 and any(e[:16]): P[e[56:128].decode('utf-16le').rstrip('\0')]=struct.unpack('<QQ',e[32:48])
    return P
f=open(raw,'rb'); T=parts(f.read(2<<20)); print('target',len(T),sorted(T))
m={'EFI':'awai_esp','super':'super','persist':'persist','firmware':'firmware','vendor_boot_a':'vendor_boot_a','vendor_boot_b':'vendor_boot_b','boot_a':'boot_a','boot_b':'boot_b'}
b=subprocess.Popen(['bsdtar','-xOf',iso,'awai/awai-pc-install.img.zst'],stdout=subprocess.PIPE)
s=subprocess.Popen(['zstd','-q','-dc'],stdin=b.stdout,stdout=subprocess.PIPE).stdout
h=b''
while len(h)<2<<20: h+=s.read((2<<20)-len(h))
SP=parts(h); pos=len(h); buf=h; ok=0
todo=sorted((SP[k][0]*512,(SP[k][1]+1)*512,k) for k in m if k in SP)
for a,e,k in todo:
    while pos<a:
        c=s.read(min(8<<20,a-pos)); pos+=len(c)
    d=hashlib.sha256(); t=hashlib.sha256()
    if pos>a and a<len(h) and pos!=len(h): raise SystemExit('overlap '+k)
    n=0
    if pos>a: c=h[a:pos]; d.update(c); n=len(c)
    L=e-a
    while n<L:
        c=s.read(min(8<<20,L-n)); 
        if not c: break
        d.update(c); n+=len(c); pos+=len(c)
    ta,te=T[m[k]]; f.seek(ta*512); r=(te-ta+1)*512; assert r==L,(k,r,L)
    while r:
        c=f.read(min(8<<20,r)); t.update(c); r-=len(c)
    same=d.hexdigest()==t.hexdigest(); ok+=same; print(k,'SAME' if same else 'DIFF',d.hexdigest()[:12],flush=True)
print('OK',ok,'of',len(todo))

import Foundation
import CryptoKit
import Darwin

let owner: uid_t = 501
let serial = "0022CFF6B899CA205987CBC4"
let capacity: UInt64 = 61949214720
let inbox = "/Users/junkawasaki/github/workspaces/codex/awai-usb-writer/usb-write-request.json"
let imageRoot = "/Users/junkawasaki/github/workspaces/codex/awai-usb-writer/"
struct Failure: Error, CustomStringConvertible { let description: String }
func require(_ ok: Bool, _ message: String) throws { if !ok { throw Failure(description:message) } }
func event(_ fields:[String:Any]) { if let data=try? JSONSerialization.data(withJSONObject:fields,options:[.sortedKeys]), let s=String(data:data,encoding:.utf8) { print(s);fflush(stdout) } }
func command(_ path:String,_ args:[String]) throws -> Data {
    let p=Process();p.executableURL=URL(fileURLWithPath:path);p.arguments=args
    p.environment=["PATH":"/usr/bin:/bin:/usr/sbin:/sbin","LC_ALL":"C"]
    let pipe=Pipe();p.standardOutput=pipe;p.standardError=FileHandle.standardError
    try p.run();let data=pipe.fileHandleForReading.readDataToEndOfFile();p.waitUntilExit()
    try require(p.terminationStatus==0,"Command failed: \(path)");return data
}
func dictionary(_ data:Data) throws -> [String:Any] { guard let d=try PropertyListSerialization.propertyList(from:data,format:nil) as? [String:Any] else {throw Failure(description:"Invalid disk metadata")};return d }
func candidates(_ tree:Any, matched:Bool=false) -> [String] {
    if let a=tree as? [Any] {return a.flatMap{candidates($0,matched:matched)}}
    guard let d=tree as? [String:Any] else{return []}
    let yes=matched || (d["USB Serial Number"] as? String==serial && d["USB Vendor Name"] as? String=="KIOXIA")
    var names:[String]=[]
    if yes && d["Whole"] as? Bool==true && (d["Size"] as? NSNumber)?.uint64Value==capacity && d["IORegistryEntryName"] as? String=="KIOXIA TransMemory Media",let name=d["BSD Name"] as? String {names.append(name)}
    return names + candidates(d["IORegistryEntryChildren"] ?? [],matched:yes)
}
func selected(_ names:[String]) throws -> String {
    try require(names.count==1,"Exactly one matching KIOXIA must be attached")
    let name=names[0];try require(name.range(of:"^disk[0-9]+$",options:.regularExpression) != nil,"Invalid whole-disk identifier");return name
}
func target() throws -> String {
    let tree=try PropertyListSerialization.propertyList(from:command("/usr/sbin/ioreg",["-a","-l","-r","-c","IOUSBHostDevice"]),format:nil)
    let disk=try selected(candidates(tree))
    let d=try dictionary(command("/usr/sbin/diskutil",["info","-plist","/dev/"+disk]))
    try require(d["WholeDisk"] as? Bool==true && d["Internal"] as? Bool==false && d["BusProtocol"] as? String=="USB" && d["VirtualOrPhysical"] as? String=="Physical" && d["IORegistryEntryName"] as? String=="KIOXIA TransMemory Media" && (d["TotalSize"] as? NSNumber)?.uint64Value==capacity,"Refusing unexpected disk")
    return disk
}
func asOwner<T>(_ body:() throws -> T) throws -> T {
    var group:gid_t=20
    try require(setgroups(1,&group)==0 && setegid(group)==0 && seteuid(owner)==0,"Cannot drop privileges")
    defer{if seteuid(0) != 0 || setegid(0) != 0 {fatalError("Cannot restore privileges")}}
    return try body()
}
func userFile(_ path:String) throws -> FileHandle {
    let fd=open(path,O_RDONLY|O_NOFOLLOW|O_CLOEXEC);try require(fd>=0,"Cannot open user file")
    var st=stat();if fstat(fd,&st) != 0 || st.st_mode & S_IFMT != S_IFREG || st.st_uid != owner {close(fd);throw Failure(description:"Source must be a regular file owned by the configured user")}
    return FileHandle(fileDescriptor:fd,closeOnDealloc:true)
}
struct Request:Decodable {let action:String;let iso:String;let sha256:String;let bytes:UInt64}
func request() throws -> (Request,FileHandle) {
    try asOwner {
        let manifest=try userFile(inbox);defer{try? manifest.close()}
        let data=try manifest.read(upToCount:4097) ?? Data();try require(data.count<=4096,"Request too large")
        let r=try JSONDecoder().decode(Request.self,from:data)
        try require(["check","write"].contains(r.action),"Unknown action")
        let resolved=URL(fileURLWithPath:r.iso).resolvingSymlinksInPath().path
        try require(resolved.hasPrefix(imageRoot) && resolved.hasSuffix(".iso"),"ISO must be inside the configured QA folder")
        try require(r.bytes>=1048576 && r.bytes<=8589934592 && r.bytes%512==0,"Invalid ISO length")
        try require(r.sha256.range(of:"^[0-9a-f]{64}$",options:.regularExpression) != nil,"Invalid SHA256")
        let f=try userFile(resolved);var st=stat();try require(fstat(f.fileDescriptor,&st)==0 && UInt64(st.st_size)==r.bytes,"ISO length mismatch")
        try f.seek(toOffset:32769);try require(try f.read(upToCount:5)==Data("CD001".utf8),"Not an ISO9660 image");try f.seek(toOffset:0)
        return (r,f)
    }
}
func digest(_ handle:FileHandle,_ bytes:UInt64,copy:FileHandle?=nil,phase:String) throws -> String {
    var hash=SHA256();var done:UInt64=0,last:UInt64=0
    while done<bytes {
        let data=try handle.read(upToCount:Int(min(4*1024*1024,bytes-done))) ?? Data()
        try require(!data.isEmpty,"Short read");hash.update(data:data);try copy?.write(contentsOf:data);done+=UInt64(data.count)
        if done-last>=128*1024*1024 || done==bytes {event(["phase":phase,"bytes":done,"total":bytes]);last=done}
    }
    return hash.finalize().map{String(format:"%02x",$0)}.joined()
}
func main() throws {
    try require(CommandLine.arguments.count==1,"Arguments are not allowed")
    try require(geteuid()==0,"Run the installed helper with sudo")
    let lock=open("/var/run/murakumo-usb-writer.lock",O_CREAT|O_RDWR|O_NOFOLLOW|O_CLOEXEC,0o600)
    try require(lock>=0 && flock(lock,LOCK_EX|LOCK_NB)==0,"Another USB writer is running");defer{close(lock)}
    let (r,input)=try request();defer{try? input.close()}
    let disk=try target()
    if r.action=="check" {
        let hash=try digest(input,r.bytes,phase:"checking")
        try require(hash==r.sha256,"ISO SHA256 mismatch")
        event(["status":"preflight-passed","disk":disk,"serial":serial,"sha256":hash]);return
    }
    // A root-private snapshot prevents image changes between validation and write.
    var template=Array("/var/run/murakumo-usb.XXXXXX".utf8CString)
    guard let raw=mkdtemp(&template) else{throw Failure(description:"Cannot create private snapshot")}
    let dir=String(cString:raw);defer{try? FileManager.default.removeItem(atPath:dir)}
    let fd=open(dir+"/image",O_CREAT|O_EXCL|O_RDWR|O_NOFOLLOW|O_CLOEXEC,0o600)
    try require(fd>=0,"Cannot stage ISO");let staged=FileHandle(fileDescriptor:fd,closeOnDealloc:true);defer{try? staged.close()}
    let hash=try digest(input,r.bytes,copy:staged,phase:"staging");try require(hash==r.sha256,"ISO SHA256 mismatch; USB unchanged")
    try staged.synchronize();try staged.seek(toOffset:0)
    _=try command("/usr/sbin/diskutil",["unmountDisk","/dev/"+disk])
    try require(try target()==disk,"USB changed before writing")
    let rawFD=open("/dev/r"+disk,O_RDWR|O_NOFOLLOW|O_CLOEXEC|O_EXCL)
    try require(rawFD>=0,"USB write access denied: \(String(cString:strerror(errno)))")
    var st=stat();try require(fstat(rawFD,&st)==0 && st.st_mode & S_IFMT==S_IFCHR,"Unexpected device type")
    let device=FileHandle(fileDescriptor:rawFD,closeOnDealloc:true);defer{try? device.close()}
    try require(try target()==disk,"USB changed after opening")
    let written=try digest(staged,r.bytes,copy:device,phase:"writing");try require(written==r.sha256,"Snapshot mismatch")
    try device.synchronize();try device.seek(toOffset:0)
    let readback=try digest(device,r.bytes,phase:"readback");try require(readback==r.sha256,"USB readback mismatch; not ejected")
    try device.close()
    try require(try target()==disk,"USB changed before ejection")
    _=try command("/usr/sbin/diskutil",["eject","/dev/"+disk])
    event(["status":"verified-and-ejected","disk":disk,"serial":serial,"bytes":r.bytes,"iso_sha256":r.sha256,"usb_sha256":readback])
}
#if USB_WRITER_TEST
func tests() throws {
    let media:[String:Any]=["Whole":true,"Size":capacity,"IORegistryEntryName":"KIOXIA TransMemory Media","BSD Name":"disk27"]
    let usb:[String:Any]=["USB Serial Number":serial,"USB Vendor Name":"KIOXIA","IORegistryEntryChildren":[media]]
    try require(try selected(candidates([usb]))=="disk27","Dynamic disk lookup failed")
    try require(candidates([media]).isEmpty,"Unbound media accepted")
    var wrong=usb;wrong["USB Serial Number"]="other";try require(candidates([wrong]).isEmpty,"Wrong serial accepted")
    for names in [[],["disk1","disk2"],["disk1s1"],["../../disk0"]] {
        do{_=try selected(names);throw Failure(description:"Unsafe selection accepted")}catch let e as Failure{try require(e.description != "Unsafe selection accepted","Unsafe selection accepted")}
    }
    print("PASS serial binding, dynamic whole-disk lookup, missing/duplicate/partition/path refusal")
}
do {try tests()}catch{fputs("\(error)\n",stderr);exit(1)}
#else
do {try main()}catch{event(["status":"failed","error":String(describing:error)]);exit(1)}
#endif

import Foundation
import CryptoKit
import Security

let service = "cloud.murakumo.aiueos.release-signing"
struct Failure: Error { let text: String }
func query(_ id: String) -> [String: Any] { [kSecClass as String:kSecClassGenericPassword,kSecAttrService as String:service,kSecAttrAccount as String:id] }
func load(_ id: String) throws -> Curve25519.Signing.PrivateKey {
 var q=query(id);q[kSecReturnData as String]=true;q[kSecMatchLimit as String]=kSecMatchLimitOne
 var result:CFTypeRef?;let status=SecItemCopyMatching(q as CFDictionary,&result)
 guard status==errSecSuccess,let data=result as? Data else { throw Failure(text:"Keychain read failed: \(status)") }
 return try Curve25519.Signing.PrivateKey(rawRepresentation:data)
}
func main() throws {
 let args=CommandLine.arguments;guard args.count==3, ["init","public","sign"].contains(args[1]),args[2].range(of:"^[a-z0-9][a-z0-9-]{0,63}$",options:.regularExpression) != nil else {throw Failure(text:"Usage: signer init|public|sign KEY_ID")}
 let id=args[2];var key:Curve25519.Signing.PrivateKey
 if args[1]=="init" {
  key=Curve25519.Signing.PrivateKey();var q=query(id)
  q[kSecValueData as String]=key.rawRepresentation
  q[kSecAttrAccessible as String]=kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
  q[kSecAttrLabel as String]="AiueOS release signing \(id)"
  let status=SecItemAdd(q as CFDictionary,nil);guard status==errSecSuccess else {throw Failure(text:"Keychain create refused: \(status)")}
 } else {key=try load(id)}
 if args[1]=="sign" {
  var data=Data()
  while let chunk=try FileHandle.standardInput.read(upToCount:4096), !chunk.isEmpty {
   data.append(chunk)
   guard data.count<=131072 else {throw Failure(text:"Payload bound exceeded")}
  }
  print(try key.signature(for:data).base64EncodedString())
 } else {print(key.publicKey.rawRepresentation.base64EncodedString())}
}
do {try main()} catch {fputs("Release signer failed: \(error)\n",stderr);exit(1)}

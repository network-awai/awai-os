// Awai OS release signing key in macOS Keychain (AWAI-3067).
// Ed25519 key for signing Awai release manifests. Android's own platform/OTA/AVB keys are a
// separate set produced by the source build. The private key never leaves this Mac's Keychain:
// it is stored this-device-only, is not synchronised, and no command prints it.
//
//   create <id>        create the key; refuses if it already exists; prints the public key
//   public <id>        print the base64 raw public key
//   sign <id> <file>   print the base64 signature over the file's bytes
import CryptoKit
import Foundation
import Security

let service = "network.awai.os.release-signing.v1"
struct Failure: Error { let text: String }

func query(_ id: String) -> [String: Any] {
    [kSecClass as String: kSecClassGenericPassword,
     kSecAttrService as String: service,
     kSecAttrAccount as String: id,
     kSecAttrSynchronizable as String: false]
}

func load(_ id: String) throws -> Curve25519.Signing.PrivateKey {
    var q = query(id)
    q[kSecReturnData as String] = true
    q[kSecMatchLimit as String] = kSecMatchLimitOne
    var result: CFTypeRef?
    let status = SecItemCopyMatching(q as CFDictionary, &result)
    guard status == errSecSuccess, let data = result as? Data else { throw Failure(text: "Keychain read failed: \(status)") }
    return try Curve25519.Signing.PrivateKey(rawRepresentation: data)
}

do {
    let args = CommandLine.arguments
    guard args.count >= 3, ["create", "public", "sign"].contains(args[1]),
          args[2].range(of: "^[a-z0-9][a-z0-9.-]{0,63}$", options: .regularExpression) != nil
    else { throw Failure(text: "usage: create|public <id> | sign <id> <file>") }
    let id = args[2]
    switch args[1] {
    case "create":
        let key = Curve25519.Signing.PrivateKey()
        var q = query(id)
        q[kSecValueData as String] = key.rawRepresentation
        q[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        q[kSecAttrLabel as String] = "Awai OS release signing \(id)"
        let status = SecItemAdd(q as CFDictionary, nil)
        guard status == errSecSuccess else { throw Failure(text: "Keychain create refused (exists or denied): \(status)") }
        print(key.publicKey.rawRepresentation.base64EncodedString())
    case "public":
        print(try load(id).publicKey.rawRepresentation.base64EncodedString())
    default:
        guard args.count == 4 else { throw Failure(text: "usage: sign <id> <file>") }
        let data = try Data(contentsOf: URL(fileURLWithPath: args[3]))
        print(try load(id).signature(for: data).base64EncodedString())
    }
} catch let error as Failure {
    FileHandle.standardError.write((error.text + "\n").data(using: .utf8)!)
    exit(1)
} catch {
    FileHandle.standardError.write("\(error)\n".data(using: .utf8)!)
    exit(1)
}

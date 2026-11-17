// Operator-side checkpoint custody; never part of the Android application runtime.
// age owns the archive cryptography. Identity bytes stay in Keychain/process pipes.
import Foundation
import Security

enum Failure: Error { case refused(String) }
let age = "/opt/homebrew/bin/age"
let keygen = "/opt/homebrew/bin/age-keygen"
let service = "network.awai.android.checkpoint.v1"
let account = "AWAI-2992-20261117"

func process(_ path: String, _ arguments: [String]) -> Process {
    let p = Process(); p.executableURL = URL(fileURLWithPath: path); p.arguments = arguments
    p.standardError = FileHandle.nullDevice
    return p
}
func capture(_ path: String, _ arguments: [String], input: Data? = nil) throws -> Data {
    let p = process(path, arguments), output = Pipe(), source = Pipe()
    p.standardOutput = output
    if input != nil { p.standardInput = source } else { p.standardInput = FileHandle.nullDevice }
    try p.run()
    if let input { try source.fileHandleForWriting.write(contentsOf: input); try source.fileHandleForWriting.close() }
    let bytes = output.fileHandleForReading.readDataToEndOfFile(); p.waitUntilExit()
    guard p.terminationStatus == 0 else { throw Failure.refused("Subprocess refused") }
    return bytes
}
func identity(create: Bool) throws -> Data {
    let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
        kSecAttrService as String: service, kSecAttrAccount as String: account,
        kSecReturnData as String: true, kSecMatchLimit as String: kSecMatchLimitOne]
    var result: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &result)
    if status == errSecSuccess, let data = result as? Data { return data }
    guard status == errSecItemNotFound, create else { throw Failure.refused("Checkpoint identity unavailable (Keychain status \(status))") }
    let data = try capture(keygen, [])
    guard String(data: data, encoding: .utf8)?.contains("AGE-SECRET-KEY-1") == true else { throw Failure.refused("Identity generation refused") }
    let item: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
        kSecAttrService as String: service, kSecAttrAccount as String: account,
        kSecAttrLabel as String: "Awai Android checkpoint AWAI-2992",
        kSecAttrSynchronizable as String: false, kSecValueData as String: data]
    guard SecItemAdd(item as CFDictionary, nil) == errSecSuccess else { throw Failure.refused("Checkpoint identity custody failed") }
    return data
}
func archive(_ path: String) throws {
    let url = URL(fileURLWithPath: path), values = try url.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey, .fileSizeKey])
    guard values.isRegularFile == true, values.isSymbolicLink != true, (values.fileSize ?? 0) > 0 else { throw Failure.refused("Require an existing regular encrypted archive") }
}
func decryptInto(_ archivePath: String, consumer: Process) throws {
    try archive(archivePath)
    let secret = try identity(create: false), input = Pipe(), plaintext = Pipe()
    let decrypt = process(age, ["--decrypt", "--identity", "/dev/stdin", archivePath])
    decrypt.standardInput = input; decrypt.standardOutput = plaintext
    consumer.standardInput = plaintext
    try consumer.run(); try decrypt.run()
    try input.fileHandleForWriting.write(contentsOf: secret); try input.fileHandleForWriting.close()
    try plaintext.fileHandleForWriting.close(); try plaintext.fileHandleForReading.close()
    decrypt.waitUntilExit(); consumer.waitUntilExit()
    guard decrypt.terminationStatus == 0, consumer.terminationStatus == 0 else { throw Failure.refused("Archive authentication or consumer verification failed") }
}

do {
    let args = Array(CommandLine.arguments.dropFirst())
    switch args.first {
    case "recipient":
        guard args.count == 1 else { throw Failure.refused("recipient takes no arguments") }
        let publicKey = try capture(keygen, ["-y"], input: identity(create: true))
        guard let value = String(data: publicKey, encoding: .utf8), value.trimmingCharacters(in: .whitespacesAndNewlines).hasPrefix("age1") else { throw Failure.refused("Public recipient unavailable") }
        FileHandle.standardOutput.write(publicKey)
    case "verify":
        guard args.count == 2 else { throw Failure.refused("verify <encrypted-tar.age>") }
        let tar = process("/usr/bin/tar", ["-tf", "-"]); tar.standardOutput = FileHandle.nullDevice
        try decryptInto(args[1], consumer: tar)
        print("Authenticated encrypted archive and tar structure verified")
    default: throw Failure.refused("Use recipient or verify; private identities are never exported")
    }
} catch {
    // No child stderr, secret identity, filename listing or decrypted output is logged.
    FileHandle.standardError.write(Data("Checkpoint refused: \(error)\n".utf8)); exit(1)
}

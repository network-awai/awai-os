import AppKit
import CryptoKit
import Darwin
import Foundation
import Virtualization

// This is an independently built development image, not a signed release.
private let previewImageSHA256 = "e0d0c89ceb27e079a30444170c16645d711b8aece6e1261465f844de5e025374"

private enum PreviewError: LocalizedError {
    case message(String)
    var errorDescription: String? {
        switch self { case .message(let text): return text }
    }
}

private func isRegularFile(_ url: URL) throws -> Bool {
    let values = try url.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey])
    return values.isRegularFile == true && values.isSymbolicLink != true
}

private func prepareDisk(source: URL, directory: URL) throws -> URL {
    let fm = FileManager.default
    let disk = directory.appendingPathComponent("disk.raw")
    let marker = directory.appendingPathComponent("image-origin.txt")
    if fm.fileExists(atPath: disk.path) {
        guard try isRegularFile(disk), try isRegularFile(marker),
              try String(contentsOf: marker, encoding: .utf8).trimmingCharacters(in: .whitespacesAndNewlines) == previewImageSHA256
        else { throw PreviewError.message("The existing disk has no matching origin record. It was not changed.") }
        return disk
    }
    guard try isRegularFile(source) else { throw PreviewError.message("Choose a regular raw disk image.") }
    let partial = directory.appendingPathComponent("disk.raw.partial")
    let fd = open(partial.path, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW, 0o600)
    guard fd >= 0 else { throw PreviewError.message("A partial disk already exists or cannot be created. It was not changed.") }
    let output = FileHandle(fileDescriptor: fd, closeOnDealloc: true)
    var complete = false
    defer {
        try? output.close()
        if !complete { try? fm.removeItem(at: partial) }
    }
    let input = try FileHandle(forReadingFrom: source)
    defer { try? input.close() }
    var sha = SHA256()
    while let bytes = try input.read(upToCount: 1 << 20), !bytes.isEmpty {
        sha.update(data: bytes)
        try output.write(contentsOf: bytes)
    }
    try output.synchronize()
    let digest = sha.finalize().map { String(format: "%02x", $0) }.joined()
    guard digest == previewImageSHA256 else {
        throw PreviewError.message("Image digest does not match the pinned development image.")
    }
    try output.close()
    try fm.moveItem(at: partial, to: disk)
    try (previewImageSHA256 + "\n").write(to: marker, atomically: true, encoding: .utf8)
    complete = true
    return disk
}

@main
final class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate, VZVirtualMachineDelegate {
    private var window: NSWindow!
    private var message: NSTextField!
    private var vm: VZVirtualMachine?
    private var lockFD: Int32 = -1
    private var terminating = false

    static func main() {
        let application = NSApplication.shared
        let delegate = AppDelegate()
        application.delegate = delegate
        application.setActivationPolicy(.regular)
        application.run()
        withExtendedLifetime(delegate) {}
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1100, height: 720),
                          styleMask: [.titled, .closable, .miniaturizable, .resizable],
                          backing: .buffered, defer: false)
        window.title = "Awai OS Preview"
        window.center()
        window.delegate = self
        message = NSTextField(wrappingLabelWithString: "Preparing the development preview…")
        message.alignment = .center
        message.frame = NSRect(x: 60, y: 300, width: 980, height: 100)
        message.autoresizingMask = [.width, .minYMargin, .maxYMargin]
        window.contentView = NSView(frame: window.frame)
        window.contentView?.addSubview(message)
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)

        do {
            let args = CommandLine.arguments
            func argument(_ flag: String) -> String? {
                guard let i = args.firstIndex(of: flag), i + 1 < args.count else { return nil }
                return args[i + 1]
            }
            let base = argument("--state-dir").map { URL(fileURLWithPath: $0, isDirectory: true) }
                ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
                    .appendingPathComponent("Awai OS Preview", isDirectory: true)
            try FileManager.default.createDirectory(at: base, withIntermediateDirectories: true,
                                                    attributes: [.posixPermissions: 0o700])
            lockFD = open(base.appendingPathComponent(".lock").path, O_CREAT | O_RDWR | O_NOFOLLOW, 0o600)
            guard lockFD >= 0, flock(lockFD, LOCK_EX | LOCK_NB) == 0 else {
                throw PreviewError.message("This preview disk is already in use.")
            }
            let disk = base.appendingPathComponent("disk.raw")
            var source: URL
            if FileManager.default.fileExists(atPath: disk.path) {
                source = disk
            } else if let image = argument("--image") {
                source = URL(fileURLWithPath: image)
            } else {
                let panel = NSOpenPanel()
                panel.title = "Choose the Awai OS development raw image"
                panel.message = "Only the pinned 0.6.0 development image is accepted. Your original file is not changed."
                panel.allowsMultipleSelection = false
                guard panel.runModal() == .OK, let selected = panel.url else { NSApp.terminate(nil); return }
                source = selected
            }
            message.stringValue = "Checking and preparing the preview disk. This can take several minutes."
            DispatchQueue.global(qos: .userInitiated).async {
                do {
                    let diskURL = try prepareDisk(source: source, directory: base)
                    NSLog("AWAI_PREVIEW_IMAGE_READY")
                    DispatchQueue.main.async { self.startVM(disk: diskURL, directory: base) }
                } catch {
                    DispatchQueue.main.async { self.showError(error) }
                }
            }
        } catch { showError(error) }
    }

    private func startVM(disk: URL, directory: URL) {
        do {
            let config = VZVirtualMachineConfiguration()
            config.cpuCount = min(4, VZVirtualMachineConfiguration.maximumAllowedCPUCount)
            config.memorySize = 4 * 1024 * 1024 * 1024
            let boot = VZEFIBootLoader()
            let varsURL = directory.appendingPathComponent("efi-variables")
            if FileManager.default.fileExists(atPath: varsURL.path) {
                boot.variableStore = VZEFIVariableStore(url: varsURL)
            } else {
                boot.variableStore = try VZEFIVariableStore(creatingVariableStoreAt: varsURL, options: [])
            }
            config.bootLoader = boot
            let diskAttachment = try VZDiskImageStorageDeviceAttachment(url: disk, readOnly: false)
            config.storageDevices = [VZVirtioBlockDeviceConfiguration(attachment: diskAttachment)]
            let network = VZVirtioNetworkDeviceConfiguration()
            network.attachment = VZNATNetworkDeviceAttachment()
            config.networkDevices = [network]
            let graphics = VZVirtioGraphicsDeviceConfiguration()
            graphics.scanouts = [VZVirtioGraphicsScanoutConfiguration(widthInPixels: 1440, heightInPixels: 900)]
            config.graphicsDevices = [graphics]
            config.keyboards = [VZUSBKeyboardConfiguration()]
            config.pointingDevices = [VZUSBScreenCoordinatePointingDeviceConfiguration()]
            config.entropyDevices = [VZVirtioEntropyDeviceConfiguration()]
            config.memoryBalloonDevices = [VZVirtioTraditionalMemoryBalloonDeviceConfiguration()]
            try config.validate()
            NSLog("AWAI_PREVIEW_CONFIGURATION_VALID")
            let machine = VZVirtualMachine(configuration: config)
            machine.delegate = self
            vm = machine
            let view = VZVirtualMachineView(frame: window.contentView!.bounds)
            view.autoresizingMask = [.width, .height]
            view.virtualMachine = machine
            window.contentView = view
            machine.start { result in
                switch result {
                case .success: NSLog("AWAI_PREVIEW_VM_STARTED")
                case .failure(let error): DispatchQueue.main.async { self.showError(error) }
                }
            }
        } catch { showError(error) }
    }

    private func showError(_ error: Error) {
        NSLog("AWAI_PREVIEW_ERROR: %@", error.localizedDescription)
        let alert = NSAlert(error: error)
        alert.runModal()
        NSApp.terminate(nil)
    }

    func windowShouldClose(_ sender: NSWindow) -> Bool {
        NSApp.terminate(nil)
        return false
    }

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        guard let machine = vm, machine.canRequestStop else { return .terminateNow }
        guard !terminating else { return .terminateLater }
        do {
            try machine.requestStop()
            terminating = true
            return .terminateLater
        } catch {
            NSAlert(error: error).runModal()
            return .terminateCancel
        }
    }

    func guestDidStop(_ virtualMachine: VZVirtualMachine) {
        if terminating { NSApp.reply(toApplicationShouldTerminate: true) }
        else { NSApp.terminate(nil) }
    }

    func virtualMachine(_ virtualMachine: VZVirtualMachine, didStopWithError error: Error) {
        if terminating { NSApp.reply(toApplicationShouldTerminate: true) }
        else { showError(error) }
    }
}

import Foundation
import Virtualization
import Darwin

// DEV_UNTRUSTED research adapter. Fixed devices; no user-supplied commands.
func emit(_ value: [String: Any]) {
    let data = try! JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])
    FileHandle.standardOutput.write(data + Data([10]))
}
func fail(_ message: String, _ code: Int32 = 1) -> Never {
    emit(["witness": "HOST_OBSERVED", "event": "error", "message": message])
    exit(code)
}
guard CommandLine.arguments.count == 2 else { fail("expected one staged run directory") }
let root = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true).standardizedFileURL
let resolved = root.resolvingSymlinksInPath()
guard root == resolved, root.path.contains("/coding/tmp/"), root.path.contains("/.cache/proof-guest/") else {
    fail("run directory must be an unaliased proof-guest staging directory")
}
func regular(_ name: String) throws -> URL {
    let url = root.appendingPathComponent(name)
    let attrs = try FileManager.default.attributesOfItem(atPath: url.path)
    guard attrs[.type] as? FileAttributeType == .typeRegular else { fail("non-regular staged input: " + name) }
    return url
}
final class Observer: NSObject, VZVirtualMachineDelegate {
    func guestDidStop(_ virtualMachine: VZVirtualMachine) {
        emit(["witness": "HOST_OBSERVED", "event": "guest_stopped"])
        // Allow the last serial-pipe read to drain before leaving.
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) { exit(0) }
    }
    func virtualMachine(_ virtualMachine: VZVirtualMachine, didStopWithError error: Error) {
        fail("VM stopped with error: \(error)")
    }
}
let observer = Observer()
let machine: VZVirtualMachine
let pipe = Pipe()
var serialBytes = 0
let serialLock = NSLock()
let serialLimit = 262144
let config = VZVirtualMachineConfiguration()
do {
    let kernel = try regular("kernel")
    let initrd = try regular("initrd")
    let input = try regular("input.raw")
    let state = try regular("state.raw")
    let stateSize = try FileManager.default.attributesOfItem(atPath: state.path)[.size] as! UInt64
    guard stateSize == 8388608 else { fail("state disk must be exactly 8 MiB") }
    let boot = VZLinuxBootLoader(kernelURL: kernel)
    boot.initialRamdiskURL = initrd
    boot.commandLine = "console=hvc0 rdinit=/proof-init panic=1 quiet"
    config.bootLoader = boot
    config.cpuCount = 1
    config.memorySize = 256 * 1024 * 1024
    config.platform = VZGenericPlatformConfiguration()
    config.networkDevices = []
    config.directorySharingDevices = []
    config.socketDevices = []
    config.graphicsDevices = []
    config.audioDevices = []
    config.keyboards = []
    config.pointingDevices = []
    config.entropyDevices = [VZVirtioEntropyDeviceConfiguration()]
    config.memoryBalloonDevices = []
    config.storageDevices = [
        VZVirtioBlockDeviceConfiguration(attachment: try VZDiskImageStorageDeviceAttachment(url: input, readOnly: true)),
        VZVirtioBlockDeviceConfiguration(attachment: try VZDiskImageStorageDeviceAttachment(url: state, readOnly: false))
    ]
    let serial = VZVirtioConsoleDeviceSerialPortConfiguration()
    serial.attachment = VZFileHandleSerialPortAttachment(fileHandleForReading: nil, fileHandleForWriting: pipe.fileHandleForWriting)
    config.serialPorts = [serial]
    try config.validate()
    emit(["witness": "HOST_OBSERVED", "event": "configuration", "profile": "proof-offline-v1",
          "pid": getpid(), "vcpus": config.cpuCount, "memory_bytes": config.memorySize,
          "network_devices": config.networkDevices.count, "directory_sharing_devices": config.directorySharingDevices.count,
          "socket_devices": config.socketDevices.count, "graphics_devices": config.graphicsDevices.count,
          "audio_devices": config.audioDevices.count, "serial_ports": config.serialPorts.count,
          "entropy_devices": config.entropyDevices.count, "serial_byte_limit": serialLimit, "deadline_seconds": 60,
          "storage": [["path": input.path, "read_only": true], ["path": state.path, "read_only": false, "bytes": stateSize]]])
    machine = VZVirtualMachine(configuration: config)
} catch { fail("configuration failed: \(error)") }
machine.delegate = observer
pipe.fileHandleForReading.readabilityHandler = { handle in
    var bytes = [UInt8](repeating: 0, count: 8192)
    let count = Darwin.read(handle.fileDescriptor, &bytes, bytes.count)
    guard count > 0 else { return }
    let data = Data(bytes.prefix(count))
    serialLock.lock()
    serialBytes += data.count
    let withinLimit = serialBytes <= serialLimit
    serialLock.unlock()
    guard withinLimit else { fail("serial output limit exceeded", 74) }
    DispatchQueue.main.async {
        emit(["witness": "GUEST_ASSERTED", "event": "serial", "base64": data.base64EncodedString()])
    }
}
DispatchQueue.main.asyncAfter(deadline: .now() + 60) { fail("host wall deadline exceeded", 124) }
machine.start { result in
    switch result {
    case .success:
        emit(["witness": "HOST_OBSERVED", "event": "started", "runtime_network_devices": machine.networkDevices.count,
              "runtime_directory_sharing_devices": machine.directorySharingDevices.count,
              "runtime_socket_devices": machine.socketDevices.count])
    case .failure(let error): fail("VM start failed: \(error)")
    }
}
RunLoop.main.run()

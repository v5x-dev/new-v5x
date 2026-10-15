import { PacketEncoder } from "./packets/encoder"

export * from "./packets/base"
export * from "./packets/device-to-host"
export * from "./packets/encoder"
export * from "./packets/host-to-device"

// Packet constructors are part of the public module, so initialize the shared
// encoder even when a caller imports this file without the connection module.
PacketEncoder.getInstance()

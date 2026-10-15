import { type MatchMode, type ISmartDeviceInfo } from "../vex"
import { VexFirmwareVersion } from "../vex-firmware-version"
import type { V5SerialDevice } from "../vex-device"

export class V5SerialDeviceState {
  _instance: V5SerialDevice
  private refreshPauseDepth = 0

  get _isFileTransferring(): boolean {
    return this.refreshPauseDepth > 0
  }

  set _isFileTransferring(value: boolean) {
    this.refreshPauseDepth = value ? Math.max(1, this.refreshPauseDepth) : 0
  }

  get isRefreshPaused(): boolean {
    return this.refreshPauseDepth > 0
  }

  beginRefreshPause(): () => void {
    this.refreshPauseDepth++
    let released = false

    return () => {
      if (released) return
      released = true
      this.refreshPauseDepth = Math.max(0, this.refreshPauseDepth - 1)
    }
  }

  async withRefreshPaused<T>(operation: () => Promise<T> | T): Promise<T> {
    const release = this.beginRefreshPause()

    try {
      return await operation()
    } finally {
      release()
    }
  }

  brain = {
    activeProgram: 0,
    battery: {
      batteryPercent: 0,
      isCharging: false,
    },
    button: {
      isPressed: false,
      isDoublePressed: false,
    },
    cpu0Version: VexFirmwareVersion.allZero(),
    cpu1Version: VexFirmwareVersion.allZero(),
    isAvailable: false,
    settings: {
      isScreenReversed: false,
      isWhiteTheme: false,
      usingLanguage: 0,
    },
    systemVersion: VexFirmwareVersion.allZero(),
    uniqueId: 0,
  }

  controllers = [
    {
      battery: 0,
      isAvailable: false,
      isCharging: false,
    },
    {
      battery: 0,
      isAvailable: false,
    },
  ]

  devices: Array<ISmartDeviceInfo | undefined> = []
  isFieldControllerConnected = false
  matchMode: MatchMode = "disabled"

  radio = {
    channel: 0,
    isAvailable: false,
    isConnected: false,
    isVexNet: false,
    isRadioData: false,
    latency: 0,
    signalQuality: 0,
    signalStrength: 0,
  }

  constructor(instance: V5SerialDevice) {
    this._instance = instance
  }
}

export interface V5SerialDeviceOptions {
  autoRefresh?: boolean
  refreshIntervalMs?: number
  maxFileDownloadBytes?: number
}

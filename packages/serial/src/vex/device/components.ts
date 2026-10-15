import {
  type ISmartDeviceInfo,
  SmartDeviceType,
  RadioChannelType,
} from "../vex"
import { FileControlH2DPacket, FileControlReplyD2HPacket } from "../vex-packet"
import { V5SerialDeviceState } from "./state"

export class V5Battery {
  private readonly state: V5SerialDeviceState

  constructor(state: V5SerialDeviceState) {
    this.state = state
  }

  get batteryPercent(): number {
    return this.state.brain.battery.batteryPercent
  }

  get isCharging(): boolean {
    return this.state.brain.battery.isCharging
  }
}

export class V5BrainButton {
  private readonly state: V5SerialDeviceState

  constructor(state: V5SerialDeviceState) {
    this.state = state
  }

  get isPressed(): boolean {
    return this.state.brain.button.isPressed
  }

  get isDoublePressed(): boolean {
    return this.state.brain.button.isDoublePressed
  }
}

export class V5BrainSettings {
  private readonly state: V5SerialDeviceState

  constructor(state: V5SerialDeviceState) {
    this.state = state
  }

  get isScreenReversed(): boolean {
    return this.state.brain.settings.isScreenReversed
  }

  get isWhiteTheme(): boolean {
    return this.state.brain.settings.isWhiteTheme
  }

  get usingLanguage(): number {
    return this.state.brain.settings.usingLanguage
  }
}

export class V5Controller {
  private readonly state: V5SerialDeviceState
  private readonly controllerIndex: number

  constructor(state: V5SerialDeviceState, controllerIndex: number) {
    this.state = state
    this.controllerIndex = controllerIndex
  }

  get batteryPercent(): number {
    return this.state.controllers[this.controllerIndex].battery
  }

  get isMasterController(): boolean {
    return this.controllerIndex === 0
  }

  get isAvailable(): boolean {
    return this.state.controllers[this.controllerIndex].isAvailable
  }

  get isCharging(): boolean | undefined {
    return this.state.controllers[this.controllerIndex].isCharging
  }
}

export class V5SmartDevice {
  private readonly state: V5SerialDeviceState
  private readonly deviceIndex: number

  constructor(state: V5SerialDeviceState, index: number) {
    this.state = state
    this.deviceIndex = index
  }

  protected getDeviceInfo(): ISmartDeviceInfo | undefined {
    return this.state.devices[this.deviceIndex]
  }

  get isAvailable(): boolean {
    return this.getDeviceInfo() !== undefined
  }

  get port(): number {
    return this.deviceIndex
  }

  get type(): SmartDeviceType {
    return this.getDeviceInfo()?.type ?? SmartDeviceType.EMPTY
  }

  get version(): number {
    return this.getDeviceInfo()?.version ?? 0
  }
}

export class V5Radio {
  private readonly state: V5SerialDeviceState

  constructor(state: V5SerialDeviceState) {
    this.state = state
  }

  get channel(): number {
    return this.state.radio.channel
  }

  get isAvailable(): boolean {
    return this.state.radio.isAvailable
  }

  get isConnected(): boolean {
    return this.state.radio.isConnected
  }

  get isVexNet(): boolean {
    return this.state.radio.isVexNet
  }

  get isRadioData(): boolean {
    return this.state.radio.isRadioData
  }

  get latency(): number {
    return this.state.radio.latency
  }

  async changeChannel(channel: RadioChannelType): Promise<boolean> {
    const result = await this.state._instance.connection?.writeDataAsync(
      new FileControlH2DPacket(1, channel)
    )

    return result instanceof FileControlReplyD2HPacket
  }
}

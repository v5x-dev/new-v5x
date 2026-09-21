import {
  AckType,
  FileDownloadTarget,
  FileExitAction,
  FileInitAction,
  FileInitOption,
  FileLoadAction,
  FileVendor,
  type IFileBasicInfo,
  type IFileWriteRequest,
  type IPacketCallback,
  type MatchMode,
  SerialDeviceType,
  type SlotNumber,
  USER_FIFO_MAX_WRITE_SIZE,
  USER_FLASH_USR_CODE_START,
  USER_PROG_CHUNK_SIZE,
  UserFifoChannel,
  type SelectDashScreen,
} from "./vex";
import { VexEventTarget } from "./vex-event";
import { generateProsColdLibraryName } from "./pros-cold-hash";
import { type ProgramIniConfig } from "./vex-ini-config";
import { PendingRequestDispatcher } from "./pending-request-dispatcher";
import { ReceiveBuffer } from "./receive-buffer";
import { runPacketReader } from "./packet-reader";
import { TailQueue } from "./tail-queue";
import {
  MatchStatusReplyD2HPacket,
  DeviceBoundPacket,
  GetMatchStatusH2DPacket,
  UpdateMatchModeH2DPacket,
  MatchModeReplyD2HPacket,
  GetSystemStatusReplyD2HPacket,
  GetSystemStatusH2DPacket,
  type HostBoundPacket,
  InitFileTransferH2DPacket,
  InitFileTransferReplyD2HPacket,
  LinkFileH2DPacket,
  ExitFileTransferH2DPacket,
  ExitFileTransferReplyD2HPacket,
  WriteFileReplyD2HPacket,
  WriteFileH2DPacket,
  LinkFileReplyD2HPacket,
  ReadFileH2DPacket,
  ReadFileReplyD2HPacket,
  SystemVersionH2DPacket,
  SystemVersionReplyD2HPacket,
  Query1H2DPacket,
  Query1ReplyD2HPacket,
  LoadFileActionH2DPacket,
  LoadFileActionReplyD2HPacket,
  GetSystemFlagsH2DPacket,
  GetSystemFlagsReplyD2HPacket,
  GetRadioStatusH2DPacket,
  GetRadioStatusReplyD2HPacket,
  GetDeviceStatusH2DPacket,
  GetDeviceStatusReplyD2HPacket,
  EraseFileH2DPacket,
  EraseFileReplyD2HPacket,
  FileClearUpH2DPacket,
  FileClearUpReplyD2HPacket,
  SendDashTouchH2DPacket,
  SendDashTouchReplyD2HPacket,
  SelectDashH2DPacket,
  SelectDashReplyD2HPacket,
  ScreenCaptureH2DPacket,
  ScreenCaptureReplyD2HPacket,
  UserFifoH2DPacket,
  UserFifoReplyD2HPacket,
} from "./vex-packet";
import { VexFirmwareVersion } from "./vex-firmware-version";
import type {
  AdapterSerialPort,
  SerialAdapter,
  SerialPortFilter,
} from "../adapters/serial-adapter";
import { portMatchesFilters } from "../adapters/serial-adapter";
import { convertScreenCapture } from "../screen-capture";

export const DEFAULT_MAX_FILE_DOWNLOAD_BYTES = 64 * 1024 * 1024;
export const DEFAULT_TRANSFER_WINDOW_SIZE = 4;
export const DEFAULT_USER_FIFO_TIMEOUT = 500;

export interface VexSerialConnectionOptions {
  maxFileDownloadBytes?: number;
  /**
   * Retained for compatibility with the previous transport implementation.
   * CDC2 write replies have no sequence number, so file uploads stay
   * stop-and-wait and do not send multiple writes at once.
   */
  transferWindowSize?: number;
}

export interface VexSerialConnectionEvents {
  connected: undefined;
  disconnected: undefined;
  warning: { message: string; details?: unknown };
}

type HostBoundPacketConstructor<T extends HostBoundPacket> = {
  new (data: Uint8Array | ArrayBuffer): T;
};

/**
 * A connection to a V5 device.
 * Emit events: connected, disconnected
 */
export class VexSerialConnection extends VexEventTarget<VexSerialConnectionEvents> {
  filters: SerialPortFilter[] = [{ usbVendorId: 10376 }];

  writer: WritableStreamDefaultWriter<Uint8Array> | undefined;
  reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  port: AdapterSerialPort | undefined;
  serial: SerialAdapter;
  #closing = false;
  #closePromise: Promise<void> | undefined;
  #openPromise: Promise<boolean | undefined> | undefined;
  #portDisconnectListener: (() => void) | undefined;
  #wasConnected = false;
  readonly maxFileDownloadBytes: number;
  readonly transferWindowSize: number;

  private readonly pendingRequests = new PendingRequestDispatcher();
  protected readonly fileTransfers = new TailQueue();

  /** A snapshot of outstanding requests, retained for compatibility. */
  get callbacksQueue(): IPacketCallback[] {
    return this.pendingRequests.callbacks;
  }

  get isConnected(): boolean {
    return (
      this.port !== undefined &&
      this.reader !== undefined &&
      this.writer !== undefined
    );
  }

  get isClosing(): boolean {
    return this.#closing;
  }

  constructor(
    serial: SerialAdapter,
    options: VexSerialConnectionOptions = {},
  ) {
    super();
    this.serial = serial;
    const maxFileDownloadBytes =
      options.maxFileDownloadBytes ?? DEFAULT_MAX_FILE_DOWNLOAD_BYTES;
    if (
      !Number.isSafeInteger(maxFileDownloadBytes) ||
      maxFileDownloadBytes <= 0
    ) {
      throw new RangeError("maxFileDownloadBytes must be a positive safe integer");
    }
    this.maxFileDownloadBytes = maxFileDownloadBytes;

    const transferWindowSize =
      options.transferWindowSize ?? DEFAULT_TRANSFER_WINDOW_SIZE;
    if (!Number.isSafeInteger(transferWindowSize) || transferWindowSize <= 0) {
      throw new RangeError("transferWindowSize must be a positive safe integer");
    }
    this.transferWindowSize = transferWindowSize;
  }

  async close(): Promise<void> {
    if (this.#closePromise !== undefined) return this.#closePromise;
    this.#closing = true;

    const closing = this.closeResources();
    this.#closePromise = closing;
    try {
      await closing;
    } finally {
      if (this.#closePromise === closing) this.#closePromise = undefined;
      this.#closing = false;
    }
  }

  private async closeResources(): Promise<void> {
    for (const callback of this.pendingRequests.drain()) {
      callback.callback(AckType.NOT_CONNECTED);
    }

    const disconnectListener = this.#portDisconnectListener;
    this.#portDisconnectListener = undefined;
    if (disconnectListener !== undefined) {
      try {
        this.port?.removeEventListener?.("disconnect", disconnectListener);
      } catch {}
    }

    const writer = this.writer;
    this.writer = undefined;
    if (writer !== undefined) {
      try {
        await writer.close();
      } catch {}
      try {
        writer.releaseLock();
      } catch {}
    }

    const reader = this.reader;
    this.reader = undefined;
    if (reader !== undefined) {
      try {
        await reader.cancel();
      } catch {}
      try {
        reader.releaseLock();
      } catch {}
    }

    const port = this.port;
    this.port = undefined;
    if (port !== undefined) {
      try {
        await port.close();
      } catch (error) {
        this.emitWarning("failed to close the serial port", error);
      }
    }

    if (this.#wasConnected) {
      this.#wasConnected = false;
      this.emitSafely("disconnected", undefined);
    }
  }

  async open(
    use: number | undefined = 0,
    askUser: boolean = true,
  ): Promise<boolean | undefined> {
    if (this.#openPromise !== undefined) return this.#openPromise;

    const opening = this.openPort(use, askUser);
    this.#openPromise = opening;
    void opening.then(
      () => {
        if (this.#openPromise === opening) this.#openPromise = undefined;
      },
      () => {
        if (this.#openPromise === opening) this.#openPromise = undefined;
      },
    );
    return opening;
  }

  private async openPort(
    use: number | undefined,
    askUser: boolean,
  ): Promise<boolean | undefined> {
    if (this.#closePromise !== undefined) await this.#closePromise;
    if (this.port !== undefined) throw new Error("Already connected.");

    let port: AdapterSerialPort | undefined;

    if (use !== undefined) {
      let matchingPorts: AdapterSerialPort[];
      try {
        matchingPorts = (await this.serial.getPorts()).filter((candidate) =>
          portMatchesFilters(candidate.getInfo(), this.filters),
        );
      } catch {
        return false;
      }

      const ports = matchingPorts.filter((candidate) => candidate.readable === null);

      port = ports[use];
      if (port == null && matchingPorts[use] != null) return false;
    }

    // A missing indexed port means the caller has already tried every granted
    // port. Do not open the chooser again for each retry.
    if (port == null && askUser && (use === undefined || use === 0)) {
      try {
        port = await this.serial.requestPort({ filters: this.filters });
      } catch {}
    }

    if (port == null) return undefined;

    if (port.readable != null) return false;

    try {
      await port.open({ baudRate: 115200 });

      this.port = port;

      this.#portDisconnectListener = () => {
        void this.close();
      };
      port.addEventListener("disconnect", this.#portDisconnectListener);

      const writable = port.writable as WritableStream<Uint8Array> | null;
      const readable = port.readable as ReadableStream<Uint8Array> | null;
      if (writable == null || readable == null) {
        await this.close();
        return false;
      }
      this.writer = writable.getWriter();
      this.reader = readable.getReader();
      this.#wasConnected = true;
      void this.startReader();
      this.emitSafely("connected", undefined);

      return true;
    } catch {
      await this.close();
      return false;
    }
  }

  writeData(
    rawData: DeviceBoundPacket | Uint8Array,
    resolve: (
      data: HostBoundPacket | ArrayBuffer | Uint8Array | AckType,
    ) => void,
    timeout: number = 1000,
  ): void {
    void this.writeDataAsync(rawData, timeout).then(resolve);
  }

  async writeDataAsync(
    rawData: DeviceBoundPacket | Uint8Array,
    timeout: number = 1000,
    pipelined = false,
  ): Promise<HostBoundPacket | ArrayBuffer | Uint8Array | AckType> {
    if (!Number.isFinite(timeout) || timeout < 0 || timeout > 0x7fffffff) {
      throw new RangeError("timeout must be between 0 and 2147483647 ms");
    }

    if (rawData instanceof DeviceBoundPacket && !pipelined) {
      return this.pendingRequests.serialize(
        rawData.commandId,
        rawData.commandExtendedId,
        () => this.writeDataAsyncUnserialized(rawData, timeout),
      );
    }
    return this.writeDataAsyncUnserialized(rawData, timeout);
  }

  private async writeDataAsyncUnserialized(
    rawData: DeviceBoundPacket | Uint8Array,
    timeout: number,
  ): Promise<HostBoundPacket | ArrayBuffer | Uint8Array | AckType> {
    return new Promise((resolve) => {
      const writer = this.writer;
      if (writer === undefined || this.#closing) {
        resolve(AckType.NOT_CONNECTED);
        return;
      }

      const data = rawData instanceof DeviceBoundPacket ? rawData.data : rawData;
      let removePending = (): boolean => false;
      const callback: IPacketCallback = {
        callback: resolve,
        timeout: setTimeout(() => {
          if (!removePending()) return;
          resolve(AckType.TIMEOUT);
        }, timeout),
        wantedCommandId:
          rawData instanceof DeviceBoundPacket ? rawData.commandId : undefined,
        wantedCommandExId:
          rawData instanceof DeviceBoundPacket
            ? rawData.commandExtendedId
            : undefined,
      };
      removePending = this.pendingRequests.add(callback);

      try {
        void writer.write(data).catch(() => {
          if (!removePending()) return;
          clearTimeout(callback.timeout);
          resolve(AckType.WRITE_ERROR);
        });
      } catch {
        if (removePending()) {
          clearTimeout(callback.timeout);
          resolve(AckType.WRITE_ERROR);
        }
      }
    });
  }

  protected async readData(
    cache: ReceiveBuffer,
    expectedSize: number,
  ): Promise<void> {
    if (this.reader == null) throw new Error("No reader");

    while (cache.byteLength < expectedSize) {
      const { value: readData, done: isDone } = await this.reader.read();

      if (isDone || readData === undefined) throw new Error("No data");

      if (readData.byteLength === 0) continue;
      cache.append(readData);
    }
  }

  protected async startReader(): Promise<void> {
    await runPacketReader({
      readData: (cache, expectedSize) => this.readData(cache, expectedSize),
      shiftCallback: (commandId, commandExtendedId) =>
        this.pendingRequests.shift(commandId, commandExtendedId),
      reportWarning: (message, details) => {
        if (!this.#closing) this.emitWarning(message, details);
      },
      close: () => this.close(),
    });
  }

  protected emitWarning(message: string, details?: unknown): void {
    this.emitSafely("warning", { message, details });
  }

  async request<T extends HostBoundPacket>(
    packet: DeviceBoundPacket,
    replyType: HostBoundPacketConstructor<T>,
    timeout = 1000,
  ): Promise<T | null> {
    const result = await this.writeDataAsync(packet, timeout);
    return result instanceof replyType ? result : null;
  }

  private emitSafely<K extends keyof VexSerialConnectionEvents>(
    eventName: K,
    data: VexSerialConnectionEvents[K],
  ): void {
    try {
      this.emit(eventName, data);
    } catch {}
  }

  async query1(): Promise<Query1ReplyD2HPacket | null> {
    const result = await this.writeDataAsync(new Query1H2DPacket(), 100);
    return result instanceof Query1ReplyD2HPacket ? result : null;
  }

  async getSystemVersion(): Promise<VexFirmwareVersion | null> {
    const result = await this.writeDataAsync(new SystemVersionH2DPacket());
    return result instanceof SystemVersionReplyD2HPacket
      ? result.version
      : null;
  }
}

export class V5SerialConnection extends VexSerialConnection {
  filters: SerialPortFilter[] = [
    { usbVendorId: 10376, usbProductId: SerialDeviceType.V5_BRAIN },
    { usbVendorId: 10376, usbProductId: SerialDeviceType.V5_BRAIN_DFU },
    { usbVendorId: 10376, usbProductId: SerialDeviceType.V5_CONTROLLER },
  ];

  constructor(
    serial: SerialAdapter,
    options: VexSerialConnectionOptions = {},
  ) {
    super(serial, options);
  }

  async getDeviceStatus(): Promise<GetDeviceStatusReplyD2HPacket | null> {
    const result = await this.writeDataAsync(new GetDeviceStatusH2DPacket());
    return result instanceof GetDeviceStatusReplyD2HPacket ? result : null;
  }

  async getRadioStatus(): Promise<GetRadioStatusReplyD2HPacket | null> {
    const result = await this.writeDataAsync(new GetRadioStatusH2DPacket());
    return result instanceof GetRadioStatusReplyD2HPacket ? result : null;
  }

  async getSystemFlags(): Promise<GetSystemFlagsReplyD2HPacket | null> {
    const result = await this.writeDataAsync(new GetSystemFlagsH2DPacket());
    return result instanceof GetSystemFlagsReplyD2HPacket ? result : null;
  }

  async getSystemStatus(
    timeout = 1000,
  ): Promise<GetSystemStatusReplyD2HPacket | null> {
    const result = await this.writeDataAsync(
      new GetSystemStatusH2DPacket(),
      timeout,
    );
    return result instanceof GetSystemStatusReplyD2HPacket ? result : null;
  }

  async getMatchStatus(): Promise<MatchStatusReplyD2HPacket | null> {
    const result = await this.writeDataAsync(new GetMatchStatusH2DPacket());
    return result instanceof MatchStatusReplyD2HPacket ? result : null;
  }

  async uploadProgramToDevice(
    iniConfig: ProgramIniConfig,
    binFileBuf: Uint8Array,
    coldFileBuf: Uint8Array | undefined,
    progressCallback: (state: string, current: number, total: number) => void,
  ): Promise<boolean | undefined> {
    return this.fileTransfers.run(() =>
      this.uploadProgramToDeviceUnlocked(
        iniConfig,
        binFileBuf,
        coldFileBuf,
        progressCallback,
      ),
    );
  }

  private async uploadProgramToDeviceUnlocked(
    iniConfig: ProgramIniConfig,
    binFileBuf: Uint8Array,
    coldFileBuf: Uint8Array | undefined,
    progressCallback: (state: string, current: number, total: number) => void,
  ): Promise<boolean | undefined> {
    if ((await this.stopProgram()) === null) return false;

    const iniFileBuffer = new TextEncoder().encode(iniConfig.createIni());
    // VEXos added compressed file support in 1.0.5. Raw binaries are still
    // valid on newer versions and are the safe fallback when the version query
    // is unavailable.
    const systemVersion = await this.getSystemVersion();
    const canCompress =
      systemVersion !== null &&
      systemVersion.compare(VexFirmwareVersion.fromString("1.0.5")) >= 0;
    const hotBuf = canCompress ? await gzipBytes(binFileBuf) : binFileBuf;
    const coldBuf =
      coldFileBuf !== undefined && canCompress
        ? await gzipBytes(coldFileBuf)
        : coldFileBuf;

    const basename = iniConfig.baseName;

    const iniRequest = {
      filename: basename + ".ini",
      buf: iniFileBuffer,
      downloadTarget: FileDownloadTarget.FILE_TARGET_QSPI,
      vendor: FileVendor.USER,
      autoRun: false,
    };
    const r1 = await this.uploadFileToDeviceUnlocked(iniRequest, (current, total) => {
      progressCallback("INI", current, total);
    });
    if (!r1) return false;

    // let prjRequest = { filename: basename + '.prj', buf: prjfile, vid: FileVendor.USER, loadAddr: undefined, exttype: 0, linkedFile: undefined };
    // await this.uploadFileToDeviceAsync(prjRequest, onProgress);

    const coldRequest =
      coldBuf !== undefined
        ? {
            filename:
              iniConfig.libraryName ??
              generateProsColdLibraryName(
                iniConfig.libraryTemplates ?? ["kernel", "liblvgl"],
              ),
            buf: coldBuf,
            downloadTarget: FileDownloadTarget.FILE_TARGET_QSPI,
            vendor: FileVendor.DEV2,
            loadAddress: iniConfig.libraryAddress,
            autoRun: false,
            exttype: "bin",
          }
        : undefined;
    if (coldRequest != null) {
      const r2 = await this.uploadFileToDeviceUnlocked(
        coldRequest,
        (current, total) => {
          progressCallback("COLD", current, total);
        },
      );
      if (!r2) return false;
    }

    const after =
      iniConfig.after !== FileExitAction.EXIT_NONE || iniConfig.autorun
        ? iniConfig.after !== FileExitAction.EXIT_NONE
          ? iniConfig.after
          : FileExitAction.EXIT_RUN
        : FileExitAction.EXIT_NONE;

    const binRequest = {
      filename: basename + ".bin",
      buf: hotBuf,
      downloadTarget: FileDownloadTarget.FILE_TARGET_QSPI,
      vendor: FileVendor.USER,
      loadAddress:
        coldBuf != null ? iniConfig.programAddress : undefined,
      autoRun: after !== FileExitAction.EXIT_NONE,
      exitAction: after,
      exttype: "bin",
      linkedFile: coldRequest,
    };
    const r3 = await this.uploadFileToDeviceUnlocked(binRequest, (current, total) => {
      progressCallback("BIN", current, total);
    });

    return r3;
  }

  async downloadFileToHost(
    request: IFileBasicInfo,
    downloadTarget = FileDownloadTarget.FILE_TARGET_QSPI,
    progressCallback?: (current: number, total: number) => void,
  ): Promise<Uint8Array> {
    return this.fileTransfers.run(() =>
      this.downloadFileToHostUnlocked(
        request,
        downloadTarget,
        progressCallback,
      ),
    );
  }

  /** Download without taking the file-transfer lock. */
  async downloadFileToHostUnlocked(
    request: IFileBasicInfo,
    downloadTarget = FileDownloadTarget.FILE_TARGET_QSPI,
    progressCallback?: (current: number, total: number) => void,
  ): Promise<Uint8Array> {
    if (!this.isConnected && this.writer === undefined) {
      throw new Error("Not connected");
    }

    const { filename, vendor, loadAddress, size } = request;

    let nextAddress = loadAddress ?? USER_FLASH_USR_CODE_START;

    const p1 = await this.writeDataAsync(
      new InitFileTransferH2DPacket(
        FileInitAction.READ,
        downloadTarget,
        vendor,
        FileInitOption.NONE,
        new Uint8Array(),
        nextAddress,
        filename,
        "",
      ),
    );

    if (!(p1 instanceof InitFileTransferReplyD2HPacket))
      throw new Error("InitFileTransferH2DPacket failed");

    try {
      const fileSize = size ?? p1.fileSize;
      if (!Number.isSafeInteger(fileSize) || fileSize < 0) {
        throw new Error(`Invalid file size: ${fileSize}`);
      }
      if (fileSize > this.maxFileDownloadBytes) {
        throw new Error(
          `File size ${fileSize} exceeds the ${this.maxFileDownloadBytes}-byte download limit`,
        );
      }

      const bufferChunkSize = Math.max(4, getTransferChunkSize(p1.windowSize));
      let bufferOffset = 0;
      const fileBuf = new Uint8Array(fileSize);

      progressCallback?.(0, fileSize);
      while (bufferOffset < fileSize) {
        const remaining = fileSize - bufferOffset;
        const requestedSize = Math.min(
          0xffff,
          Math.min(bufferChunkSize, (remaining + 3) & ~3),
        );

        const p2 = await this.writeDataAsync(
          new ReadFileH2DPacket(nextAddress, requestedSize),
          3000,
        );

        if (!(p2 instanceof ReadFileReplyD2HPacket))
          throw new Error("ReadFileReplyD2HPacket failed");

        if (
          p2.addr !== nextAddress ||
          p2.length <= 0 ||
          p2.length > requestedSize ||
          p2.buf.byteLength < p2.length
        ) {
          throw new Error("ReadFileReplyD2HPacket returned invalid data");
        }

        const received = Math.min(p2.length, remaining);
        fileBuf.set(new Uint8Array(p2.buf).subarray(0, received), bufferOffset);
        bufferOffset += received;
        nextAddress += received;
        progressCallback?.(bufferOffset, fileSize);
      }
      return fileBuf;
    } finally {
      const exit = await this.writeDataAsync(
        new ExitFileTransferH2DPacket(FileExitAction.EXIT_HALT),
        30000,
      );
      if (!(exit instanceof ExitFileTransferReplyD2HPacket)) {
        this.emitWarning("file download did not exit transfer mode cleanly", exit);
      }
    }
  }

  async uploadFileToDevice(
    request: IFileWriteRequest,
    progressCallback?: (current: number, total: number) => void,
  ): Promise<boolean> {
    return this.fileTransfers.run(() =>
      this.uploadFileToDeviceUnlocked(request, progressCallback),
    );
  }

  /** Upload without taking the file-transfer lock. */
  async uploadFileToDeviceUnlocked(
    request: IFileWriteRequest,
    progressCallback?: (current: number, total: number) => void,
  ): Promise<boolean> {
    let {
      filename,
      buf,
      downloadTarget,
      vendor,
      loadAddress,
      exttype,
      autoRun,
      exitAction,
      linkedFile,
    } = request;

    if (buf === undefined || (!this.isConnected && this.writer === undefined)) {
      return false;
    }

    downloadTarget = downloadTarget ?? FileDownloadTarget.FILE_TARGET_QSPI;
    vendor = vendor ?? FileVendor.USER;

    let nextAddress = loadAddress ?? USER_FLASH_USR_CODE_START;

    const p1 = await this.writeDataAsync(
      new InitFileTransferH2DPacket(
        FileInitAction.WRITE,
        downloadTarget,
        vendor,
        FileInitOption.OVERWRITE,
        buf,
        nextAddress,
        filename,
        exttype,
      ),
    );

    if (!(p1 instanceof InitFileTransferReplyD2HPacket))
      throw new Error("InitFileTransferH2DPacket failed");

    let exit: HostBoundPacket | ArrayBuffer | Uint8Array | AckType =
      AckType.NOT_CONNECTED;
    try {
      if (linkedFile !== undefined) {
        const p3 = await this.writeDataAsync(
          new LinkFileH2DPacket(
            linkedFile.vendor ?? FileVendor.USER,
            linkedFile.filename,
            0,
          ),
          10000,
        );

        if (!(p3 instanceof LinkFileReplyD2HPacket))
          throw new Error("LinkFileH2DPacket failed");
      }

      const bufferChunkSize = Math.max(4, getTransferChunkSize(p1.windowSize));
      let bufferOffset = 0;
      progressCallback?.(0, buf.byteLength);

      while (bufferOffset < buf.byteLength) {
        const remaining = buf.byteLength - bufferOffset;
        const chunkLength = Math.min(bufferChunkSize, remaining);
        const paddedLength = (chunkLength + 3) & ~3;
        const tmpbuf = new Uint8Array(paddedLength);
        tmpbuf.set(buf.subarray(bufferOffset, bufferOffset + chunkLength));

        const p2 = await this.writeDataAsync(
          new WriteFileH2DPacket(nextAddress, tmpbuf),
          3000,
        );

        if (!(p2 instanceof WriteFileReplyD2HPacket))
          throw new Error("WriteFileReplyD2HPacket failed");

        bufferOffset += chunkLength;
        nextAddress += chunkLength;
        progressCallback?.(bufferOffset, buf.byteLength);
      }
    } finally {
      exit = await this.writeDataAsync(
        new ExitFileTransferH2DPacket(
          exitAction ??
            (autoRun ? FileExitAction.EXIT_RUN : FileExitAction.EXIT_NONE),
        ),
        30000,
      );
    }

    return exit instanceof ExitFileTransferReplyD2HPacket;
  }

  async withFileTransfer<T>(operation: () => Promise<T> | T): Promise<T> {
    return this.fileTransfers.run(operation);
  }

  async removeFile(request: IFileBasicInfo | string): Promise<boolean> {
    const vendor = typeof request === "string" ? FileVendor.USER : request.vendor;
    const filename = typeof request === "string" ? request : request.filename;
    return this.fileTransfers.run(async () => {
      const result = await this.writeDataAsync(
        new EraseFileH2DPacket(vendor, filename),
      );
      const exit = await this.writeDataAsync(
        new ExitFileTransferH2DPacket(FileExitAction.EXIT_HALT),
        30000,
      );
      return (
        result instanceof EraseFileReplyD2HPacket &&
        exit instanceof ExitFileTransferReplyD2HPacket
      );
    });
  }

  async removeAllFiles(): Promise<boolean> {
    return this.fileTransfers.run(async () => {
      let result: HostBoundPacket | ArrayBuffer | Uint8Array | AckType;
      try {
        result = await this.writeDataAsync(
          new FileClearUpH2DPacket(FileVendor.USER),
          30000,
        );
      } finally {
        await this.writeDataAsync(
          new ExitFileTransferH2DPacket(FileExitAction.EXIT_HALT),
          30000,
        );
      }
      return result instanceof FileClearUpReplyD2HPacket;
    });
  }

  async captureScreenSetup(): Promise<ScreenCaptureReplyD2HPacket | null> {
    const result = await this.writeDataAsync(new ScreenCaptureH2DPacket(0));
    return result instanceof ScreenCaptureReplyD2HPacket ? result : null;
  }

  async captureScreen(
    progressCallback?: (current: number, total: number) => void,
  ): Promise<Uint8Array | undefined> {
    return this.fileTransfers.run(async () => {
      const response = await this.captureScreenSetup();
      if (response === null) return undefined;

      const framebuffer = await this.downloadFileToHostUnlocked(
        {
          filename: "screen",
          vendor: FileVendor.SYS,
          loadAddress: 0,
          size: 512 * 272 * 4,
        },
        FileDownloadTarget.FILE_TARGET_CBUF,
        progressCallback,
      );
      return convertScreenCapture(framebuffer);
    });
  }

  async readUserFifo(
    channel: UserFifoChannel = UserFifoChannel.STDOUT,
    timeout = DEFAULT_USER_FIFO_TIMEOUT,
  ): Promise<Uint8Array | undefined> {
    const result = await this.writeDataAsync(
      new UserFifoH2DPacket(channel),
      timeout,
    );
    return result instanceof UserFifoReplyD2HPacket
      ? trimTrailingNuls(result.buf)
      : undefined;
  }

  async writeUserFifo(
    data: Uint8Array | string,
    channel: UserFifoChannel = UserFifoChannel.STDIN,
    timeout = DEFAULT_USER_FIFO_TIMEOUT,
  ): Promise<number | undefined> {
    const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
    for (let offset = 0; offset < bytes.byteLength; ) {
      const chunk = bytes.subarray(
        offset,
        offset + USER_FIFO_MAX_WRITE_SIZE,
      );
      const result = await this.writeDataAsync(
        new UserFifoH2DPacket(channel, chunk),
        timeout,
      );
      if (!(result instanceof UserFifoReplyD2HPacket)) return undefined;
      offset += chunk.byteLength;
    }
    return bytes.byteLength;
  }

  async setMatchMode(mode: MatchMode): Promise<MatchModeReplyD2HPacket | null> {
    const result = await this.writeDataAsync(
      new UpdateMatchModeH2DPacket(mode, 0),
    );
    return result instanceof MatchModeReplyD2HPacket ? result : null;
  }

  async loadProgram(
    value: SlotNumber | string,
  ): Promise<LoadFileActionReplyD2HPacket | null> {
    const result = await this.writeDataAsync(
      new LoadFileActionH2DPacket(FileVendor.USER, FileLoadAction.RUN, value),
    );
    return result instanceof LoadFileActionReplyD2HPacket ? result : null;
  }

  async stopProgram(): Promise<LoadFileActionReplyD2HPacket | null> {
    const result = await this.writeDataAsync(
      new LoadFileActionH2DPacket(FileVendor.USER, FileLoadAction.STOP, ""),
    );
    return result instanceof LoadFileActionReplyD2HPacket ? result : null;
  }

  async runProgram(
    value: SlotNumber | string,
  ): Promise<LoadFileActionReplyD2HPacket | null> {
    return this.loadProgram(value);
  }

  async mockTouch(
    x: number,
    y: number,
    press: boolean,
  ): Promise<SendDashTouchReplyD2HPacket | null> {
    const result = await this.writeDataAsync(
      new SendDashTouchH2DPacket(x, y, press),
    );
    return result instanceof SendDashTouchReplyD2HPacket ? result : null;
  }

  /** @param port untested */
  async openScreen(
    screen: number | SelectDashScreen,
    port: number,
  ): Promise<SelectDashReplyD2HPacket | null> {
    const result = await this.writeDataAsync(
      new SelectDashH2DPacket(screen, port),
    );
    return result instanceof SelectDashReplyD2HPacket ? result : null;
  }
}

function trimTrailingNuls(bytes: Uint8Array): Uint8Array {
  let end = bytes.byteLength;
  while (end > 0 && bytes[end - 1] === 0) end--;
  return end === bytes.byteLength ? bytes : bytes.slice(0, end);
}

function getTransferChunkSize(windowSize: number): number {
  return windowSize > 0 && windowSize <= USER_PROG_CHUNK_SIZE
    ? windowSize
    : USER_PROG_CHUNK_SIZE;
}

function gzipBytes(data: Uint8Array): Promise<Uint8Array> {
  const bun = (
    globalThis as {
      Bun?: {
        gzipSync?: (d: Uint8Array) => Uint8Array;
        spawnSync?: (opts: {
          cmd: string[];
          stdin: Uint8Array;
        }) => { success: boolean; stdout: Uint8Array };
      };
    }
  ).Bun;
  // Same payload as PROS compress_file: gzip.GzipFile(..., mtime=0)
  if (bun?.spawnSync !== undefined) {
    const proc = bun.spawnSync({
      cmd: [
        "python3",
        "-c",
        "import sys,gzip,io\nraw=sys.stdin.buffer.read()\nbuf=io.BytesIO()\nwith gzip.GzipFile(fileobj=buf,mode='wb',mtime=0) as f:\n    f.write(raw)\nsys.stdout.buffer.write(buf.getvalue())",
      ],
      stdin: data,
    });
    if (proc.success && proc.stdout.byteLength > 2) {
      return Promise.resolve(new Uint8Array(proc.stdout));
    }
  }
  const finish = (gzipped: Uint8Array): Uint8Array => {
    const out = new Uint8Array(gzipped);
    if (out.byteLength >= 8) {
      out[4] = 0;
      out[5] = 0;
      out[6] = 0;
      out[7] = 0;
    }
    return out;
  };
  if (bun?.gzipSync !== undefined) {
    return Promise.resolve(finish(bun.gzipSync(data)));
  }
  if (typeof CompressionStream === "undefined") {
    return Promise.resolve(data);
  }
  const copy = new Uint8Array(data.byteLength);
  copy.set(data);
  const stream = new Blob([copy]).stream().pipeThrough(
    new CompressionStream("gzip"),
  );
  return new Response(stream)
    .arrayBuffer()
    .then((buffer) => finish(new Uint8Array(buffer)));
}

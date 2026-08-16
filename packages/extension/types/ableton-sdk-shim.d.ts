/**
 * MINIMAL type shim for @ableton-extensions/sdk, used ONLY for typechecking in
 * environments without the SDK (CI, containers). The real SDK (from
 * vendor/ableton-sdk/, never committed) is what esbuild bundles on the dev
 * machine — `pnpm setup:sdk` extracts it and the build fails loudly if absent.
 *
 * Declarations mirror .claude/skills/ableton-extension/references/api.md
 * (verified against @ableton-extensions/sdk@1.0.0-beta.1 dist types on the
 * dev machine). Kept to exactly the surface src/ uses — this is not a general
 * SDK reference. Note: the real SDK's model classes are generic over Version;
 * this shim elides the generic (safe: it only affects type positions, and we
 * typecheck against the shim while esbuild bundles the real SDK).
 */
declare module "@ableton-extensions/sdk" {
  export interface ActivationContext {
    readonly hostApiVersion: string;
    readonly [key: string]: unknown;
  }

  export interface Handle {
    readonly id: bigint;
  }

  export class DataModelObject {
    readonly handle: Handle;
    get parent(): DataModelObject | null;
  }

  // -- helper types ---------------------------------------------------------

  export type NoteDescription = {
    pitch: number;
    startTime: number;
    duration: number;
    velocity?: number;
    velocityDeviation?: number;
    releaseVelocity?: number;
    probability?: number;
    muted?: boolean;
    selected?: boolean;
  };

  export interface ClipLoopSettings {
    startMarker: number;
    endMarker: number;
    loopStart: number;
    loopEnd: number;
    looping: boolean;
  }

  export interface WarpMarker {
    beatTime: number;
    sampleTime: number;
  }

  export interface DeviceParameterValueItem {
    name: string;
    shortName: string;
  }

  // -- devices --------------------------------------------------------------

  export class DeviceParameter extends DataModelObject {
    get name(): string;
    get min(): number;
    get max(): number;
    get defaultValue(): number;
    get isQuantized(): boolean;
    get valueItems(): DeviceParameterValueItem[];
    getValue(): Promise<number>;
    setValue(value: number): Promise<void>;
  }

  export class Device extends DataModelObject {
    get name(): string;
    get parameters(): DeviceParameter[];
  }

  export class Chain extends DataModelObject {
    get devices(): Device[];
    get mixer(): ChainMixer;
    insertDevice(deviceName: string, index: number): Promise<Device>;
    deleteDevice(device: Device): Promise<void>;
    duplicateDevice(device: Device): Promise<Device>;
  }

  // No `name` accessor — verified against the real SDK, which exposes only
  // receivingNote on DrumChain. sdkLiveBridge.ts derives a display name from
  // the chain's first device instead.
  export class DrumChain extends Chain {
    get receivingNote(): number;
    set receivingNote(note: number);
  }

  export class RackDevice extends Device {
    get chains(): Chain[];
    insertChain(index: number): Promise<Chain>;
  }

  export class DrumRack extends RackDevice {
    get chains(): DrumChain[];
  }

  export class Sample extends DataModelObject {
    get filePath(): string;
  }

  export class Simpler extends Device {
    get sample(): Sample | null;
    replaceSample(filePath: string): Promise<Sample>;
  }

  export class TrackMixer extends DataModelObject {
    get volume(): DeviceParameter;
    get panning(): DeviceParameter;
    get sends(): DeviceParameter[];
  }

  export class ChainMixer extends DataModelObject {
    get volume(): DeviceParameter;
    get panning(): DeviceParameter;
    get sends(): DeviceParameter[];
  }

  // -- clips ----------------------------------------------------------------

  export class Clip extends DataModelObject {
    get name(): string;
    set name(name: string);
    get color(): number;
    set color(color: number);
    get muted(): boolean;
    set muted(muted: boolean);
    get looping(): boolean;
    set looping(looping: boolean);
    get startTime(): number;
    get endTime(): number;
    get duration(): number;
    get startMarker(): number;
    get endMarker(): number;
    get loopStart(): number;
    get loopEnd(): number;
  }

  export class AudioClip extends Clip {
    get filePath(): string;
    get warping(): boolean;
    set warping(warping: boolean);
    get warpMarkers(): WarpMarker[];
  }

  export class MidiClip extends Clip {
    get notes(): NoteDescription[];
    set notes(notes: NoteDescription[]);
  }

  export class ClipSlot extends DataModelObject {
    get clip(): Clip | null;
    createAudioClip(args: {
      filePath: string;
      isWarped?: boolean;
      loopSettings?: ClipLoopSettings;
    }): Promise<AudioClip>;
    createMidiClip(length: number): Promise<MidiClip>;
    deleteClip(): Promise<void>;
  }

  // -- tracks ---------------------------------------------------------------

  export class TakeLane extends DataModelObject {
    get clips(): Clip[];
    get name(): string;
    set name(name: string);
    createMidiClip(startTime: number, duration: number): Promise<MidiClip>;
  }

  export class Track extends DataModelObject {
    get name(): string;
    set name(name: string);
    get arm(): boolean;
    set arm(arm: boolean);
    get mute(): boolean;
    set mute(mute: boolean);
    get solo(): boolean;
    set solo(solo: boolean);
    get arrangementClips(): Clip[];
    get clipSlots(): ClipSlot[];
    get takeLanes(): TakeLane[];
    get devices(): Device[];
    get mixer(): TrackMixer;
    clearClipsInRange(startTime: number, endTime: number): Promise<void>;
    deleteClip(clip: Clip): Promise<void>;
    insertDevice(deviceName: string, index: number): Promise<Device>;
    deleteDevice(device: Device): Promise<void>;
    duplicateDevice(device: Device): Promise<Device>;
  }

  export class AudioTrack extends Track {
    createAudioClip(args: {
      filePath: string;
      startTime: number;
      duration?: number;
      isWarped?: boolean;
      loopSettings?: ClipLoopSettings;
    }): Promise<AudioClip>;
  }

  export class MidiTrack extends Track {
    createMidiClip(startTime: number, duration: number): Promise<MidiClip>;
  }

  // -- song / application ---------------------------------------------------

  export class Scene extends DataModelObject {
    get name(): string;
    set name(name: string);
  }

  export class CuePoint extends DataModelObject {
    get name(): string;
    set name(name: string);
    get time(): number;
  }

  export class Song extends DataModelObject {
    get tracks(): Track[];
    get returnTracks(): Track[];
    get mainTrack(): Track;
    get scenes(): Scene[];
    get cuePoints(): CuePoint[];
    get tempo(): number;
    set tempo(tempo: number);
    get rootNote(): number;
    get scaleMode(): boolean;
    get scaleName(): string;
    createMidiTrack(): Promise<MidiTrack>;
    createAudioTrack(): Promise<AudioTrack>;
    createScene(index: number): Promise<Scene>;
    deleteTrack(track: Track): Promise<void>;
    deleteScene(scene: Scene): Promise<void>;
    duplicateTrack(track: Track): Promise<Track>;
    duplicateScene(scene: Scene): Promise<Scene>;
  }

  export class Application extends DataModelObject {
    get song(): Song;
  }

  // -- services -------------------------------------------------------------

  export interface Environment {
    readonly storageDirectory: string | undefined;
    readonly tempDirectory: string | undefined;
  }

  export interface Resources {
    importIntoProject(filePath: string): Promise<string>;
    renderPreFxAudio(track: AudioTrack, startTime: number, endTime: number): Promise<string>;
  }

  export interface Ui {
    registerContextMenuAction(
      scope: string,
      title: string,
      commandId: string,
    ): Promise<() => Promise<void>>;
  }

  export interface Commands {
    registerCommand(commandId: string, callback: (...args: unknown[]) => void): void;
    executeCommand(commandId: string, ...args: unknown[]): void;
  }

  export interface ExtensionContext {
    readonly application: Application;
    readonly environment: Environment;
    readonly ui: Ui;
    readonly commands: Commands;
    readonly resources: Resources;
    getObjectFromHandle<T>(handle: Handle, type: new (...args: never[]) => T): T;
    withinTransaction<T>(fn: () => T): T;
  }

  export function initialize(
    activationContext: ActivationContext,
    apiVersion: string,
  ): ExtensionContext;
}

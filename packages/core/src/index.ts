export {
  BridgeError,
  type BridgeInfo,
  type ClipDetail,
  type ClipSummary,
  type CreateAudioClipArgs,
  type CreateMidiClipArgs,
  type DeviceDetail,
  type DeviceParamInfo,
  type DeviceSummary,
  type DrumPadSummary,
  type LiveBridge,
  type MidiClipTarget,
  type MixerArgs,
  type NoteSpec,
  type SceneSummary,
  type SetSummary,
  type TrackKind,
  type TrackSummary,
  type UpdateClipArgs,
  type UpdateTrackArgs,
} from "./bridge/types.js";
export {
  childPath,
  formatPath,
  parsePath,
  type PathSegment,
} from "./bridge/paths.js";
export {
  buildOpRegistry,
  type OpContext,
  type OpDefinition,
  type OpHandler,
} from "./bridge/ops.js";
export {
  DEFAULT_GATEWAY_PORT,
  createGatewayServer,
  type GatewayOptions,
  type GatewayServer,
} from "./bridge/server.js";
export { FakeLiveBridge } from "./fake/fakeLiveBridge.js";
export {
  midiToPitch,
  parseNotation,
  pitchToMidi,
  serializeNotation,
  type NotationOptions,
  type ParsedNotation,
} from "./notation/barbeat.js";

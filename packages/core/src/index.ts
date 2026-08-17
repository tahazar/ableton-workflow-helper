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
export {
  clampPitch,
  numParam,
  sortNotes,
  strParam,
  type Params,
  type ScaleContext,
  type Transform,
  type TransformContext,
  type TransformDef,
} from "./transforms/types.js";
export { makeRng, variantSeed } from "./transforms/rng.js";
export { SCALES, parseScale, shiftDegrees, snapToScale } from "./transforms/scales.js";
export {
  applyPipeline,
  listTransforms,
  parsePipeline,
  registerTransform,
  type PipelineStep,
} from "./transforms/registry.js";
export {
  tileNotes,
  validateSectionsPlan,
  type LayerDirective,
  type RenderedClip,
  type SectionSpec,
  type SectionsPlan,
} from "./sections/types.js";
export { renderSections, type RenderOptions, type SourceClip } from "./sections/render.js";
export { listForms, planFromForm } from "./sections/presets.js";

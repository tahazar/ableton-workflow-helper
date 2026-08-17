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
export {
  parseClipEntry,
  serializeClipEntry,
  slugify,
  validateClipEntry,
  type ClipEntry,
  type EntrySource,
  type EntryTier,
} from "./library/entry.js";
export {
  LibraryStore,
  findLibraryRoot,
  type ClipFilter,
  type StoredClipEntry,
} from "./library/store.js";
export {
  gzipAlc,
  inspectAlcTemplate,
  renderAlcClip,
  ungzipAlc,
  type AlcTemplateInfo,
  type RenderClipSpec,
} from "./alc/template.js";
export { parseAlcClip, type ParsedAlcClip } from "./alc/parse.js";
export {
  FOLDER_INFO_DIR,
  PACK_XMP_FILE,
  PROPERTIES_FILE,
  packPropertiesCfg,
  packXmp,
  writePack,
  type PackItem,
  type PackProperties,
} from "./alc/pack.js";
export { type DrumContext, type DrumKit, type DrumRole } from "./drums/types.js";
export { GM_DRUM_KIT, mapPadRoles, roleOfNote } from "./drums/roles.js";
export {
  TRAP_KICK_CELLS,
  TRAP_STYLE_SPEC,
  generateDrumPattern,
  generateDrumPatternDetailed,
  listDrumStyles,
  listDrumVariants,
  type GeneratePatternOptions,
  type GeneratedPattern,
  type TrapKickCell,
} from "./drums/grammars.js";
export {
  drumFill,
  humanizeDrums,
  varyDrums,
  type FillOptions,
  type HumanizeDrumsOptions,
  type VaryDrumsOptions,
} from "./drums/fills.js";
export {
  parseDrumStyleSpec,
  type TrapFamilyKickCell,
  type TrapFamilyStyleSpec,
  type TrapHatBaseName,
} from "./drums/styleSpec.js";
export {
  extractFencedBlock,
  parseKnowledgeEntry,
  serializeKnowledgeEntry,
  validateKnowledgeEntry,
  type KnowledgeEntry,
} from "./knowledge/entry.js";
export {
  KnowledgeStore,
  type KnowledgeFilter,
  type MeasurementRecordSummary,
  type ReferenceRecordSummary,
  type StoredKnowledgeEntry,
} from "./knowledge/store.js";

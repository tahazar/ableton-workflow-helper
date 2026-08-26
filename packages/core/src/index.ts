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
  type OutboxEntry,
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
export { listForms, planFromForm, planFromReferenceSections } from "./sections/presets.js";
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
  HOUSE_STYLE_SPEC,
  TECHNO_STYLE_SPEC,
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
  type DrumStyleSpec,
  type HouseFamilyStyleSpec,
  type HouseHatGridConfig,
  type HouseRideConfig,
  type HouseRumbleKicksConfig,
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
  type DrumStatsRecordSummary,
  type MeasurementRecordSummary,
  type ReferenceRecordSummary,
  type StoredKnowledgeEntry,
} from "./knowledge/store.js";
export { parseProgression, type ChordSpec, type ScaleContextLike } from "./harmony/progression.js";
export {
  renderChords,
  voiceProgression,
  type RenderChordsOptions,
  type VoicedChord,
  type VoicingOptions,
} from "./harmony/voicing.js";
export {
  clampNotesToLength,
  clipLengthBeats,
  parseQuantizeGrid,
  quantizeNotes,
  secondsToBeats,
  QUANTIZE_GRIDS,
} from "./a2m/quantize.js";
export {
  BASS_MUSIC_CR_SPEC,
  RESPONSE_RECIPE_NAMES,
  listPhraseStyles,
  listPhraseVariants,
  parsePhraseSpec,
  type CallCell,
  type EvolutionAction,
  type EvolutionStep,
  type PhraseSpec,
  type ResponseRecipeName,
  type TurnaroundKind,
} from "./phrase/spec.js";
export {
  applyResponseRecipe,
  fitResponseToWindow,
  type RecipeResult,
  type ResponseRecipe,
} from "./phrase/recipes.js";
export {
  generatePhrase,
  generateResponses,
  type GeneratePhraseOptions,
  type GenerateResponsesOptions,
  type GeneratedPhrase,
  type ResponseCandidate,
} from "./phrase/phrase.js";
export { parseOperatorRecipe, type OperatorRecipe } from "./operator/recipe.js";
export {
  BASIC_UP_SPEC,
  MELODIC_TECHNO_16THS_SPEC,
  arpRateBeats,
  checkArpGate,
  listArpStyles,
  listArpVariants,
  parseArpSpec,
  type ArpContour,
  type ArpEuclidSpec,
  type ArpSpec,
  type ArpVelocitySpec,
  type ArpWalkSpec,
  type VelocityShape,
} from "./arp/spec.js";
export {
  ARP_BEATS_PER_BAR,
  chordsFromNotes,
  euclideanMask,
  generateArp,
  type ArpChordSpan,
  type ChordsFromNotesResult,
  type GenerateArpOptions,
  type GeneratedArp,
} from "./arp/engine.js";
export {
  parseEndlessSpec,
  validateEndlessSpec,
  type EndlessFluctuation,
  type EndlessLayer,
  type EndlessLayerFluctuate,
  type EndlessRules,
  type EndlessSection,
  type EndlessSpec,
  type EndlessTransitionEdge,
} from "./endless/spec.js";

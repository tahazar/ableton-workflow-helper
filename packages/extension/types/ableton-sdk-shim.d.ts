/**
 * MINIMAL type shim for @ableton-extensions/sdk, used ONLY for typechecking in
 * environments without the SDK (CI, containers). The real SDK (from
 * vendor/ableton-sdk/, never committed) is what esbuild bundles on the dev
 * machine — `pnpm setup:sdk` extracts it and the build fails loudly if absent.
 *
 * Verified against vendor/ableton-sdk/sdk/package/dist/index.d.mts
 * (@ableton-extensions/sdk@1.0.0-beta.1) on first build. Keep this shim to
 * exactly the surface src/main.ts and src/sdkLiveBridge.ts use — it is not a
 * general SDK reference (see .claude/skills/ableton-extension/references/api.md
 * for that).
 */
declare module "@ableton-extensions/sdk" {
  export interface ActivationContext {
    readonly hostApiVersion: string;
    readonly [key: string]: unknown;
  }

  export class Song {
    get tempo(): number;
    get tracks(): unknown[];
    get scenes(): unknown[];
  }

  export class Application {
    get song(): Song;
  }

  export interface Environment {
    readonly storageDirectory: string | undefined;
    readonly tempDirectory: string | undefined;
  }

  export interface Ui {
    registerContextMenuAction(
      scope: string,
      title: string,
      commandId: string,
    ): Promise<() => Promise<void>>;
  }

  export interface Commands {
    registerCommand(
      commandId: string,
      callback: (...args: unknown[]) => void,
    ): void;
    executeCommand(commandId: string, ...args: unknown[]): void;
  }

  export interface ExtensionContext {
    readonly application: Application;
    readonly environment: Environment;
    readonly ui: Ui;
    readonly commands: Commands;
    withinTransaction<T>(fn: () => T): T;
  }

  export function initialize(
    activationContext: ActivationContext,
    apiVersion: string,
  ): ExtensionContext;
}

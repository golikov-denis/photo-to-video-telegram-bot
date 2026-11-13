import type { AppConfig } from "../domain/types";
import { KlingProvider } from "./kling";
import { MockRunwayProvider, RunwayProvider } from "./runway";
import type { VideoProvider } from "./types";

let singleton: VideoProvider | undefined;

export function getVideoProvider(config: AppConfig): VideoProvider {
  if (!singleton) {
    singleton = config.useMockRunway
      ? new MockRunwayProvider()
      : config.videoProvider === "kling"
        ? new KlingProvider(config.klingApiKey!)
        : new RunwayProvider(config.runwayApiKey!);
  }
  return singleton;
}

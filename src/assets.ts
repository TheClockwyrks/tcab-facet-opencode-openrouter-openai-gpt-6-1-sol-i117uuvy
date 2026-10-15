import type { InitApi, UpdateApi } from "@clockwyrks/simple-2d";
import type { ParticleSystem } from "@clockwyrks/particle-runtime";
import type { DeepReadonly } from "ts-essentials";
import * as C from "./constants";
import type { FacetState, ReadState } from "./game";

export interface AssetLibrary {
  readonly images: Readonly<Record<string, ImageBitmap>>;
  readonly effects: Readonly<Record<string, DeepReadonly<ParticleSystem>>>;
}
export async function loadAssets(
  api: InitApi<FacetState>,
): Promise<AssetLibrary> {
  const paths: string[] = ["board-frame", "brilliant", "star"];
  for (const kind of [...C.GEM_KINDS, "prism"])
    for (let strain = 0; strain <= C.MAX_STRAIN; strain++)
      paths.push(`${kind}-${strain}`);
  for (const kind of C.GEM_KINDS)
    for (let frame = 0; frame < 6; frame++)
      paths.push(`break/${kind}/${frame}`);
  for (let frame = 0; frame < 12; frame++) paths.push(`prism-turn/${frame}`);
  const images: Record<string, ImageBitmap> = {};
  const effects: Record<string, ParticleSystem> = {};
  const loads: Promise<unknown>[] = paths.map(async (path) => {
    images[path] = await api.assets.loadImage(`gems/${path}.png`);
  });
  for (const name of ["clear", "flawed", "cut", "aura"])
    loads.push(
      (async () => {
        effects[name] = JSON.parse(
          await (await api.assets.load(`fx/${name}/system.json`)).text(),
        ) as ParticleSystem;
      })(),
    );
  for (const cue of Object.values(C.CUES))
    loads.push(
      api.audio.load(
        cue,
        `audio/${cue === C.CUES.clear ? "shatter" : cue}.wav`,
      ),
    );
  for (let rung = 1; rung <= C.MAX_MULTIPLIER; rung++)
    loads.push(api.audio.load(`chain-${rung}`, `audio/chain-${rung}.wav`));
  for (const name of ["title", "play"])
    loads.push(api.audio.load(`music-${name}`, `audio/${name}.wav`));
  // Wait for every attempted load, including failures, before exposing the surface.
  const outcomes = await Promise.allSettled(loads);
  const failure = outcomes.find((r) => r.status === "rejected");
  if (failure?.status === "rejected") throw failure.reason;
  return { images, effects };
}
export function updateAudio(
  s: ReadState,
  api: UpdateApi,
  cues: ReadonlySet<string>,
): void {
  for (const cue of cues) {
    api.audio.play(cue);
  }
  const title = s.screen === "title" || s.screen === "howto";
  api.audio.stop(title ? "music-play" : "music-title");
  api.audio.loop(title ? "music-title" : "music-play");
}

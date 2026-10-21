import type { Game } from './game';
import { getWorldMeta, saveWorldMeta, type WorldMeta } from '../storage/worldStore';

export const STUNNING_COAST = { id: 'projectstunning-coast-v1', seed: '20261020', x: 696.5, y: 70, z: -600.5, yaw: 90, pitch: 13 };

/** A normal, persistent seeded world. Reopening resumes its saved player state. */
export async function startStunningCoast(game: Game): Promise<void> {
  let meta = await getWorldMeta(STUNNING_COAST.id);
  if (!meta) {
    const now = Date.now(), c = STUNNING_COAST;
    meta = {
      id: c.id, name: 'ProjectStunning — Turquoise Coast', seed: c.seed,
      gameMode: 'creative', difficulty: 'peaceful', hardcore: false, allowCommands: true,
      created: now, lastPlayed: now, dayTime: 3500, gameTime: 0,
      raining: false, thundering: false, rainTime: 0, thunderTime: 0, clearWeatherTime: 0,
      player: {
        x: c.x, y: c.y, z: c.z, yaw: c.yaw, pitch: c.pitch,
        health: 20, food: 20, saturation: 5, exhaustion: 0,
        xpLevel: 0, xpProgress: 0, xpTotal: 0,
        gameMode: 'creative', flying: true, selected: 0,
        inventory: [], armor: [], spawn: [697, 70, -601], dimension: 'overworld',
      },
      version: 1, structures: true, bonusChest: false, worldSpawn: [697, 70, -601],
    } satisfies WorldMeta;
    await saveWorldMeta(meta);
    game.opts.hyperShader = true;
    game.saveOptions();
  }
  await game.startWorld(meta);
}

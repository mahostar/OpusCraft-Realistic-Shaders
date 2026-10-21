import type { Game } from '../game/game';
import { CycleButton } from './screen';

/** One persisted graphics preference, shared by title and pause menus. */
export function hyperShaderToggle(game: Game, x: number, y: number, width: number): CycleButton<boolean> {
  const button = new CycleButton(x, y, width, 20, 'hyperShader', [false, true], game.opts.hyperShader,
    value => value ? 'ON' : 'OFF', value => {
      game.opts.hyperShader = value;
      game.saveOptions();
    });
  button.tooltip = 'Cinematic water, lighting and atmosphere in every world. The title background also follows this setting.';
  return button;
}

import { deepmerge } from 'deepmerge-ts';
import { allPlugins } from 'virtual:plugins';

import { restart } from '@/providers/app-controls';

import { store } from './store';

import type { PluginConfig } from '@/types/plugins';

// MusicSense: complementos que forman parte de la app y no se pueden
// desactivar (solo ajustar sus opciones)
export const ALWAYS_ENABLED = new Set(['liquid-glass']);

// MusicSense: complementos de Pear descartados. Chocan con el diseño de
// Liquid Glass o repiten algo que ya hace: siempre desactivados y ocultos en
// los menús.
export const DISCARDED = new Set([
  'navigation',
  'blur-nav-bar',
  'album-color-theme',
  'ambient-mode',
  'transparent-player',
  'visualizer',
  'video-toggle',
  'precise-volume',
  'exponential-volume',
  'clock',
  'picture-in-picture',
  'album-actions',
  'music-together',
  'touchbar',
]);

export function getPlugins() {
  const plugins = store.get('plugins') as Record<string, PluginConfig>;
  const forced: Record<string, PluginConfig> = {};
  for (const id of ALWAYS_ENABLED)
    forced[id] = { ...plugins?.[id], enabled: true };
  for (const id of DISCARDED) forced[id] = { ...plugins?.[id], enabled: false };
  return { ...plugins, ...forced };
}

export async function isEnabled(plugin: string) {
  if (ALWAYS_ENABLED.has(plugin)) return true;
  if (DISCARDED.has(plugin)) return false;
  const pluginConfig = deepmerge(
    (await allPlugins())[plugin]?.config ?? { enabled: false },
    (store.get('plugins') as Record<string, PluginConfig>)[plugin] ?? {},
  );
  return pluginConfig !== undefined && pluginConfig.enabled;
}

/**
 * Set options for a plugin
 * @param plugin Plugin name
 * @param options Options to set
 * @param exclude Options to exclude from the options object
 */
export function setOptions<T>(
  plugin: string,
  options: T,
  exclude: string[] = ['enabled'],
) {
  const plugins = store.get('plugins') as Record<string, T>;
  // HACK: This is a workaround for preventing changed options from being overwritten
  exclude.forEach((key) => {
    if (Object.prototype.hasOwnProperty.call(options, key)) {
      delete options[key as keyof T];
    }
  });
  store.set('plugins', {
    ...plugins,
    [plugin]: {
      ...plugins[plugin],
      ...options,
    },
  });
}

export function setMenuOptions<T>(
  plugin: string,
  options: T,
  exclude: string[] = ['enabled'],
) {
  setOptions(plugin, options, exclude);
  if (store.get('options.restartOnConfigChanges')) {
    restart();
  }
}

export function getOptions<T>(plugin: string): T {
  return (store.get('plugins') as Record<string, T>)[plugin];
}

export function enable(plugin: string) {
  if (DISCARDED.has(plugin)) return;
  setMenuOptions(plugin, { enabled: true }, []);
}

export function disable(plugin: string) {
  if (ALWAYS_ENABLED.has(plugin)) return;
  setMenuOptions(plugin, { enabled: false }, []);
}

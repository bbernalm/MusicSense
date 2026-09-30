import { getSongInfo } from '@/providers/song-info-front';
import { createRenderer } from '@/utils';
import { waitForElement } from '@/utils/wait-for-element';

import { disposeReactiveRoot } from './reactive-root';
import { isVisible, setConfig, setCurrentTime } from './renderer';
import { fetchLyrics } from './store';
import { selectors, tabStates } from './utils';

import type { SyncedLyricsPluginConfig } from '../types';
import type { SongInfo } from '@/providers/song-info';
import type { RendererContext } from '@/types/contexts';
import type { MusicPlayer } from '@/types/music-player';

export let _ytAPI: MusicPlayer | null = null;
export let netFetch: (
  url: string,
  init?: RequestInit,
) => Promise<[number, string, Record<string, string>]>;

export const renderer = createRenderer<
  {
    observerCallback: MutationCallback;
    observer?: MutationObserver;
    videoDataChange: () => Promise<void>;
    updateTimestampInterval?: NodeJS.Timeout | string | number;
  },
  SyncedLyricsPluginConfig
>({
  onConfigChange(newConfig) {
    setConfig(newConfig);
  },

  observerCallback(mutations: MutationRecord[]) {
    for (const mutation of mutations) {
      const header = mutation.target as HTMLElement;

      switch (mutation.attributeName) {
        case 'disabled':
          header.removeAttribute('disabled');
          break;
        case 'aria-selected':
          tabStates[header.ariaSelected ?? 'false']();
          break;
      }
    }
  },

  async onPlayerApiReady(api: MusicPlayer) {
    _ytAPI = api;

    api.addEventListener('videodatachange', this.videoDataChange);

    await this.videoDataChange();
  },
  async videoDataChange() {
    // MusicSense: el tiempo se lee en cada fotograma (antes cada 100 ms, y la
    // línea y el relleno de palabras iban con retraso)
    if (!this.updateTimestampInterval) {
      // Con la letra oculta basta con 4 veces por segundo (ahorra CPU)
      let last = -1;
      let lastUpdate = 0;
      const tick = (now: number) => {
        this.updateTimestampInterval = requestAnimationFrame(tick);
        if (!isVisible() && now - lastUpdate < 250) return;
        lastUpdate = now;
        const time = (_ytAPI?.getCurrentTime() ?? 0) * 1000;
        if (time !== last) setCurrentTime(time);
        last = time;
      };
      this.updateTimestampInterval = requestAnimationFrame(tick);
    }

    // prettier-ignore
    this.observer ??= new MutationObserver(this.observerCallback);
    this.observer.disconnect();

    // Force the lyrics tab to be enabled at all times.
    const header = await waitForElement<HTMLElement>(selectors.head);
    {
      header.removeAttribute('disabled');
      tabStates[header.ariaSelected ?? 'false']();
    }

    this.observer.observe(header, { attributes: true });
    header.removeAttribute('disabled');
  },

  async start(ctx: RendererContext<SyncedLyricsPluginConfig>) {
    netFetch = ctx.ipc.invoke.bind(ctx.ipc, 'synced-lyrics:fetch');

    setConfig(await ctx.getConfig());

    ctx.ipc.on('peard:update-song-info', (info: SongInfo) => {
      fetchLyrics(info);
    });

    // MusicSense: Pear anuncia la canción en cuanto existe el reproductor,
    // a veces antes de que este complemento empiece a escuchar (al abrir o
    // recargar la app); sin esto la letra se quedaba "cargando"
    const current = getSongInfo();
    if (current?.videoId) fetchLyrics(current);
  },

  stop() {
    disposeReactiveRoot();
  },
});

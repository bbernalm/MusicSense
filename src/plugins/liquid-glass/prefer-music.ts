/*
 * Preferir música (sin videos).
 * - En los videoclips activa el modo "Canción" de YouTube Music (su selector
 *   Canción/Video está oculto, pero existe): reproduce solo el audio.
 * - En la pantalla del reproductor oculta el video y muestra la portada
 *   (la miniatura en alta resolución) con el mismo diseño que las canciones.
 * La clase lg-prefer-music activa los estilos de now-playing.css.
 */

import type { MusicPlayer } from '@/types/music-player';

const PREFER_CLASS = 'lg-prefer-music';

type Thumbnail = { url: string };

export class PreferMusic {
  private api: MusicPlayer | null = null;
  private timer: number | null = null;
  private switchedFor = '';

  start(api: MusicPlayer) {
    this.api = api;
    document.body.classList.add(PREFER_CLASS);
    this.timer = window.setInterval(() => this.tick(), 500);
    this.tick();
  }

  stop() {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
    document.body.classList.remove(PREFER_CLASS);
    this.switchedFor = '';
  }

  private tick() {
    const details = this.api?.getPlayerResponse()?.videoDetails as
      | {
          videoId?: string;
          musicVideoType?: string;
          thumbnail?: { thumbnails?: Thumbnail[] };
        }
      | undefined;
    if (!details?.videoId) return;
    const isSong = details.musicVideoType === 'MUSIC_VIDEO_TYPE_ATV';

    // Modo "Canción" una vez por videoclip
    const toggle = document.querySelector('ytmusic-av-toggle');
    const songButton = toggle?.querySelector<HTMLElement>('.song-button');
    if (
      !isSong &&
      this.switchedFor !== details.videoId &&
      toggle?.hasAttribute('audio-only-playback-available') &&
      songButton?.getAttribute('aria-pressed') === 'false'
    ) {
      songButton.click();
      this.switchedFor = details.videoId;
    }

    // Portada en alta resolución en lugar del video
    if (!isSong) {
      const image = document.querySelector<HTMLImageElement>(
        'ytmusic-player-page #song-image img#img',
      );
      const url = details.thumbnail?.thumbnails?.at(-1)?.url.split('?')[0];
      if (image && url && image.src !== url) image.src = url;
    }
  }
}

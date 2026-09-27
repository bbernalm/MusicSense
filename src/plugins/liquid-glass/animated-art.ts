/*
 * Portadas animadas (como Better Lyrics Shaders / Apple Music).
 *
 * Para cada canción se pregunta al servicio de portadas de Better Lyrics
 * (artwork.boidu.dev, el mismo que usa su extensión "Better Lyrics Shaders")
 * con título, artista, duración y álbum. Si existe, devuelve un video .mp4
 * en bucle de Apple Music, que se pinta encima de la portada de la pantalla
 * del reproductor.
 *
 * Si ese servicio no la tiene, se busca directamente en Apple Music desde el
 * proceso principal (apple-motion.ts).
 *
 * - Una sola petición por canción; el resultado se guarda en localStorage
 *   (también los "no encontrado", que se reintentan pasados unos días).
 * - El video solo se descarga con la pantalla del reproductor abierta y se
 *   pausa junto con la música.
 * - Los videos musicales (modo video) no tienen portada animada.
 */

import type { MusicPlayer } from '@/types/music-player';

const ARTWORK_API = 'https://artwork.boidu.dev/';
const CACHE_PREFIX = 'lg-animated-art:';
const NOT_FOUND_TTL_MS = 3 * 24 * 60 * 60 * 1000;
const VIDEO_CLASS = 'lg-animated-art';

type CacheEntry = { url: string } | { notFoundAt: number };

type SongKey = {
  videoId: string;
  title: string;
  artist: string;
  album: string;
  duration: number;
};

const readCache = (key: string): string | null | undefined => {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + key);
    if (!raw) return undefined;
    const entry = JSON.parse(raw) as CacheEntry;
    if ('url' in entry) return entry.url;
    return Date.now() - entry.notFoundAt < NOT_FOUND_TTL_MS ? null : undefined;
  } catch {
    return undefined;
  }
};

const writeCache = (key: string, url: string | null) => {
  try {
    const entry: CacheEntry = url ? { url } : { notFoundAt: Date.now() };
    localStorage.setItem(CACHE_PREFIX + key, JSON.stringify(entry));
  } catch {
    // Sin espacio o sin acceso: se volverá a preguntar la próxima vez
  }
};

type AppleMotion = (query: {
  artist: string;
  album: string;
  title: string;
}) => Promise<unknown>;

export class AnimatedArtwork {
  constructor(private readonly appleMotion: AppleMotion) {}

  private api: MusicPlayer | null = null;
  private timer: number | null = null;
  private song: SongKey | null = null;
  private videoUrl: string | null = null;
  private request: AbortController | null = null;
  // El video NO se añade a la página: el núcleo de la app y varios
  // complementos usan document.querySelector('video') para el reproductor.
  // Se reproduce suelto y sus fotogramas se pintan en un canvas.
  private video: HTMLVideoElement | null = null;
  private canvas: HTMLCanvasElement | null = null;

  start(api: MusicPlayer) {
    this.api = api;
    this.timer = window.setInterval(() => this.tick(), 500);
    this.tick();
  }

  stop() {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
    this.request?.abort();
    this.request = null;
    this.removeVideo();
    this.song = null;
    this.videoUrl = null;
  }

  private tick() {
    const song = this.readSong();
    // La barra tarda un poco en mostrar la canción nueva: se espera a que
    // su título coincida para leer bien el artista y el álbum
    const barTitle = document
      .querySelector('ytmusic-player-bar .content-info-wrapper .title')
      ?.textContent?.trim();
    if (song && barTitle !== song.title.trim()) return;

    if (song?.videoId !== this.song?.videoId) {
      this.song = song;
      this.videoUrl = null;
      this.removeVideo();
      if (song) this.lookup(song).catch(console.error);
    }
    this.syncVideo();
  }

  // Datos de la canción actual; null en videos musicales o sin canción
  private readSong(): SongKey | null {
    const details = this.api?.getPlayerResponse()?.videoDetails as
      | {
          videoId?: string;
          title?: string;
          author?: string;
          lengthSeconds?: string;
          musicVideoType?: string;
        }
      | undefined;
    if (!details?.videoId || !details.title) return null;
    if (
      details.musicVideoType &&
      details.musicVideoType !== 'MUSIC_VIDEO_TYPE_ATV'
    )
      return null;

    // La línea de la barra es "Artista • Álbum • Año" en las canciones
    const byline =
      document
        .querySelector('ytmusic-player-bar .content-info-wrapper .byline')
        ?.textContent?.split('•')
        .map((part) => part.trim()) ?? [];
    const album =
      byline.length >= 3 && /^\d{4}$/.test(byline.at(-1) ?? '')
        ? byline[1]
        : '';

    return {
      videoId: details.videoId,
      title: details.title,
      artist: byline[0] || details.author || '',
      album,
      duration: Number(details.lengthSeconds) || 0,
    };
  }

  private async lookup(song: SongKey) {
    const cacheKey = [song.artist, song.album || song.title]
      .join('|')
      .toLowerCase();
    const cached = readCache(cacheKey);
    if (cached !== undefined) {
      this.videoUrl = cached;
      return;
    }

    this.request?.abort();
    const request = new AbortController();
    this.request = request;
    const params = new URLSearchParams({
      s: song.title,
      a: song.artist,
      d: String(Math.round(song.duration)),
      al: song.album,
    });

    try {
      const response = await fetch(`${ARTWORK_API}?${params.toString()}`, {
        signal: request.signal,
      });
      if (!response.ok) return;
      const data = (await response.json()) as { videoUrl?: string | null };
      let url = data.videoUrl ?? null;
      // Alternativa: directamente de Apple Music (apple-motion.ts)
      if (!url && !request.signal.aborted) {
        url = ((await this.appleMotion({
          artist: song.artist,
          album: song.album,
          title: song.title,
        })) ?? null) as string | null;
      }
      if (request.signal.aborted) return;
      writeCache(cacheKey, url);
      if (this.song?.videoId === song.videoId) this.videoUrl = url;
    } catch (error) {
      if ((error as Error).name !== 'AbortError') console.error(error);
    }
  }

  // Coloca, reproduce o pausa el video según el estado de la pantalla
  private syncVideo() {
    const open = document.body.classList.contains('lg-np');
    const container = document.querySelector<HTMLElement>(
      'ytmusic-player-page #song-image',
    );
    if (!open || !this.videoUrl || !container) {
      this.removeVideo();
      return;
    }

    if (
      !this.video ||
      !this.canvas?.isConnected ||
      this.video.dataset.src !== this.videoUrl
    ) {
      this.removeVideo();
      this.createVideo(this.videoUrl, container);
    }
    if (!this.video || !this.canvas) return;

    // Resolución del lienzo = tamaño en pantalla (sin la escala de la pausa)
    const ratio = window.devicePixelRatio || 1;
    const width = Math.round(container.offsetWidth * ratio);
    const height = Math.round(container.offsetHeight * ratio);
    if (width > 0 && this.canvas.width !== width) this.canvas.width = width;
    if (height > 0 && this.canvas.height !== height)
      this.canvas.height = height;

    const paused = document.body.classList.contains('lg-paused');
    if (paused && !this.video.paused) this.video.pause();
    if (!paused && this.video.paused) this.video.play().catch(() => {});
  }

  private createVideo(url: string, container: HTMLElement) {
    const canvas = document.createElement('canvas');
    canvas.className = VIDEO_CLASS;
    container.append(canvas);

    const video = document.createElement('video');
    video.muted = true;
    video.loop = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.dataset.src = url;
    video.src = url;
    video.addEventListener('error', () => this.removeVideo(), { once: true });

    const context = canvas.getContext('2d');
    // Pinta cada fotograma nuevo recortado como "cover" (los videos pueden
    // no ser cuadrados). Un video fuera de la página no avisa de cada
    // fotograma, así que se revisa en cada refresco de pantalla.
    let lastTime = -1;
    let lastWidth = 0;
    const draw = () => {
      if (this.video !== video || !context) return;
      requestAnimationFrame(draw);
      const { videoWidth, videoHeight } = video;
      const changed =
        video.currentTime !== lastTime || canvas.width !== lastWidth;
      if (
        changed &&
        video.readyState >= 2 &&
        videoWidth > 0 &&
        videoHeight > 0 &&
        canvas.width > 0
      ) {
        lastTime = video.currentTime;
        lastWidth = canvas.width;
        const scale = Math.max(
          canvas.width / videoWidth,
          canvas.height / videoHeight,
        );
        const drawWidth = videoWidth * scale;
        const drawHeight = videoHeight * scale;
        const offsetX = (canvas.width - drawWidth) / 2;
        const offsetY = (canvas.height - drawHeight) / 2;
        context.drawImage(video, offsetX, offsetY, drawWidth, drawHeight);
        canvas.classList.add('ready');
      }
    };
    requestAnimationFrame(draw);

    this.video = video;
    this.canvas = canvas;
  }

  private removeVideo() {
    if (this.video) {
      this.video.pause();
      this.video.removeAttribute('src');
      this.video.load();
      this.video = null;
    }
    this.canvas?.remove();
    this.canvas = null;
  }
}

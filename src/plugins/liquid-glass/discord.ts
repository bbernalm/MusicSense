import { Client } from '@xhayper/discord-rpc';
import { ActivityType, StatusDisplayType } from 'discord-api-types/v10';
import { type BrowserWindow, net } from 'electron';

import { APPLICATION_NAME, t } from '@/i18n';
import {
  registerCallback,
  type SongInfo,
  SongInfoEvent,
} from '@/providers/song-info';

import type { SetActivity } from '@xhayper/discord-rpc/dist/structures/ClientUser';

/*
 * Estado de Discord propio de MusicSense (proceso principal). Sustituye al
 * complemento Discord Rich Presence de Pear:
 *
 *   Listening to <MusicSense | canción | artista>     ← cabecera (a elegir)
 *   [portada]  Canción
 *   [icono]    Artista
 *              Álbum
 *              00:26 ━━━━━━━━━━━━━ 04:23
 *
 * - Cabecera: Discord deja cambiar el nombre de la actividad (name) y qué se
 *   ve en la lista de miembros (status_display_type).
 * - Portada grande: la de la canción. Icono pequeño (abajo a la izquierda de
 *   la portada): el de la app (el de la aplicación de Discord), la portada o
 *   la foto del artista (la página la busca y la manda con
 *   liquid-glass:discord-art).
 * - Discord solo acepta imágenes con dirección pública: las portadas animadas
 *   son videos que se dibujan en la app, así que no se pueden mandar.
 *
 * IPC: liquid-glass:discord-state, discord-options, discord-art. Al cambiar
 * la conexión se avisa a la página con liquid-glass:discord-changed.
 */

// Aplicación de Discord de Pear Desktop ("YouTube Music"). Con una propia
// (Ajustes → Discord → Avanzado) sale su icono en vez del de YouTube Music
const PEAR_CLIENT_ID = '1177081335727267940';
const RETRY_MS = 10_000;

export type DiscordConfig = {
  enabled: boolean;
  header: 'app' | 'song' | 'artist';
  small: 'app' | 'album' | 'artist' | 'none';
  progress: boolean;
  button: boolean;
  // Minutos en pausa antes de quitar el estado (0 = nunca)
  pauseTimeout: number;
  clientId: string;
};

export const defaultDiscord: DiscordConfig = {
  enabled: false,
  header: 'app',
  small: 'app',
  progress: true,
  button: true,
  pauseTimeout: 10,
  clientId: '',
};

const HEADERS = ['app', 'song', 'artist'] as const;
const SMALLS = ['app', 'album', 'artist', 'none'] as const;

// Imágenes de la canción que suena, enviadas por la página
type Art = { videoId: string; cover: string; artist: string };

type Getter = () => Promise<DiscordConfig>;
type Setter = (next: DiscordConfig) => Promise<void> | void;
type Handle = (event: string, listener: CallableFunction) => void;

// Discord pide textos de 2 a 128 caracteres
const text = (value: string | null | undefined) => {
  const trimmed = (value ?? '').trim();
  if (!trimmed) return undefined;
  const short = trimmed.length > 128 ? `${trimmed.slice(0, 125)}...` : trimmed;
  return short.length < 2 ? short.padEnd(2, 'ㅤ') : short;
};

export class DiscordPresence {
  private client: Client | null = null;
  private clientId = '';
  private ready = false;
  private active = true;
  private retry: NodeJS.Timeout | null = null;
  private pauseTimer: NodeJS.Timeout | null = null;
  private song: SongInfo | null = null;
  private art: Art | null = null;
  private appIcon = '';
  private lastSent = '';

  constructor(
    private readonly window: BrowserWindow,
    private readonly getConfig: Getter,
    private readonly setConfig: Setter,
  ) {}

  start(handle: Handle, on: Handle, send: (channel: string) => void) {
    this.active = true;
    // Para detectar saltos dentro de la canción hace falta el aviso de tiempo
    on('peard:player-api-loaded', () =>
      send('peard:setup-time-changed-listener'),
    );
    registerCallback((info, event) => {
      if (!this.active) return;
      // El avance normal no cambia nada (Discord cuenta solo el tiempo);
      // solo se reenvía si se salta a otro punto de la canción
      if (event === SongInfoEvent.TimeChanged) {
        const before = this.song?.elapsedSeconds ?? 0;
        const now = info.elapsedSeconds ?? 0;
        this.song = { ...info };
        if (Math.abs(now - before) <= 2) return;
      } else {
        this.song = { ...info };
      }
      this.update().catch(console.error);
    });

    handle('liquid-glass:discord-state', () => this.state());
    handle('liquid-glass:discord-options', (options: Partial<DiscordConfig>) =>
      this.setOptions(options),
    );
    handle('liquid-glass:discord-art', (art: Art) => {
      if (!art?.videoId) return;
      this.art = {
        videoId: String(art.videoId),
        cover: String(art.cover ?? ''),
        artist: String(art.artist ?? ''),
      };
      this.update().catch(console.error);
    });

    this.connect().catch(console.error);
  }

  stop() {
    this.active = false;
    this.disconnect();
  }

  static readonly channels = [
    'liquid-glass:discord-state',
    'liquid-glass:discord-options',
    'liquid-glass:discord-art',
  ];

  // ---------- Conexión ----------

  private notify() {
    if (!this.window.isDestroyed())
      this.window.webContents.send('liquid-glass:discord-changed');
  }

  private disconnect() {
    if (this.retry) clearTimeout(this.retry);
    this.retry = null;
    if (this.pauseTimer) clearTimeout(this.pauseTimer);
    this.pauseTimer = null;
    const client = this.client;
    this.client = null;
    this.ready = false;
    this.lastSent = '';
    if (client) {
      client.removeAllListeners();
      client.destroy().catch(() => undefined);
    }
  }

  // Se conecta a Discord (si está abierto) y lo reintenta cada 10 s
  private async connect() {
    const config = await this.getConfig();
    const clientId = config.clientId.trim() || PEAR_CLIENT_ID;
    if (!this.active || !config.enabled) {
      this.disconnect();
      this.notify();
      return;
    }
    if (this.client && this.clientId === clientId) return;
    this.disconnect();
    this.clientId = clientId;
    this.appIcon = '';
    const client = new Client({ clientId });
    this.client = client;
    client.on('ready', () => {
      if (this.client !== client) return;
      this.ready = true;
      this.notify();
      this.update().catch(console.error);
    });
    client.on('disconnected', () => {
      if (this.client !== client) return;
      this.disconnect();
      this.notify();
      this.scheduleRetry();
    });
    this.loadAppIcon(clientId).catch(() => undefined);
    try {
      await client.login();
    } catch {
      if (this.client !== client) return;
      this.disconnect();
      this.notify();
      this.scheduleRetry();
    }
  }

  private scheduleRetry() {
    if (!this.active || this.retry) return;
    this.retry = setTimeout(() => {
      this.retry = null;
      this.connect().catch(console.error);
    }, RETRY_MS);
  }

  // Icono de la aplicación de Discord (el de MusicSense si usas una propia)
  private async loadAppIcon(clientId: string) {
    const response = await net.fetch(
      `https://discord.com/api/v10/applications/${clientId}/rpc`,
    );
    const app = (await response.json()) as { icon?: string };
    if (app.icon && this.clientId === clientId) {
      this.appIcon = `https://cdn.discordapp.com/app-icons/${clientId}/${app.icon}.png?size=256`;
      this.lastSent = '';
      this.update().catch(console.error);
    }
  }

  // ---------- Actividad ----------

  private build(song: SongInfo, config: DiscordConfig): SetActivity | null {
    const title = text(song.alternativeTitle || song.title);
    const artist = text(song.tags?.at(0) || song.artist);
    if (!title || !artist) return null;
    const art = this.art?.videoId === song.videoId ? this.art : null;
    const cover = art?.cover || song.imageSrc || undefined;
    const album = text(song.album);
    const paused = Boolean(song.isPaused);

    const names = { app: APPLICATION_NAME, song: title, artist };
    const small = {
      app: this.appIcon,
      album: cover,
      artist: art?.artist,
      none: undefined,
    }[config.small];
    const smallText = {
      app: APPLICATION_NAME,
      album,
      artist,
      none: undefined,
    }[config.small];

    const activity: SetActivity = {
      name: names[config.header],
      type: ActivityType.Listening,
      // Lo que se lee en la lista de miembros: lo mismo que la cabecera
      statusDisplayType: StatusDisplayType.Name,
      // Sin enlaces (detailsUrl/stateUrl): Discord los subraya en azul
      details: title,
      state: artist,
      largeImageKey: cover,
      // Texto al pasar el ratón por la portada (y tercera línea: el álbum)
      largeImageText: paused ? '⏸︎' : album,
      smallImageKey: small || undefined,
      smallImageText: small ? text(smallText) : undefined,
    };
    // Tus amigos no tienen MusicSense: el botón abre la canción en YouTube Music
    if (config.button && song.url)
      activity.buttons = [
        {
          label: t('plugins.liquid-glass.discord.listen-button').slice(0, 32),
          url: song.url,
        },
      ];
    if (
      config.progress &&
      !paused &&
      song.songDuration > 0 &&
      typeof song.elapsedSeconds === 'number'
    ) {
      const elapsed = song.elapsedSeconds * 1000;
      const start = Date.now() - elapsed;
      activity.startTimestamp = Math.floor(start / 1000);
      const length = song.songDuration * 1000;
      activity.endTimestamp = Math.floor((start + length) / 1000);
    }
    return activity;
  }

  private async update() {
    const client = this.client;
    if (!client || !this.ready || !this.song) return;
    const config = await this.getConfig();
    if (!config.enabled) return;
    const activity = this.build(this.song, config);
    if (!activity) {
      await client.user?.clearActivity().catch(() => undefined);
      this.lastSent = '';
      return;
    }
    // Pausa larga: se quita el estado
    if (this.pauseTimer) clearTimeout(this.pauseTimer);
    this.pauseTimer = null;
    if (this.song.isPaused && config.pauseTimeout > 0)
      this.pauseTimer = setTimeout(
        () => {
          this.lastSent = '';
          client.user?.clearActivity().catch(() => undefined);
        },
        config.pauseTimeout * 60 * 1000,
      );

    // Sin cambios (salvo el segundo exacto de inicio): no se reenvía
    const key = JSON.stringify({
      ...activity,
      startTimestamp: undefined,
      endTimestamp: activity.endTimestamp
        ? Math.round(Number(activity.endTimestamp) / 3)
        : undefined,
    });
    if (key === this.lastSent) return;
    this.lastSent = key;
    await client.user?.setActivity(activity).catch((error: unknown) => {
      this.lastSent = '';
      console.error('[MusicSense] Discord:', error);
    });
  }

  // ---------- Página ----------

  private async state() {
    const config = await this.getConfig();
    return {
      ...config,
      connected: this.ready,
      customApp: Boolean(config.clientId.trim()),
      appIcon: this.appIcon,
    };
  }

  private async setOptions(options: Partial<DiscordConfig>) {
    const config = await this.getConfig();
    const next = { ...config };
    if (typeof options.enabled === 'boolean') next.enabled = options.enabled;
    if (typeof options.progress === 'boolean') next.progress = options.progress;
    if (typeof options.button === 'boolean') next.button = options.button;
    const header = HEADERS.find((value) => value === options.header);
    if (header) next.header = header;
    const small = SMALLS.find((value) => value === options.small);
    if (small) next.small = small;
    if (typeof options.pauseTimeout === 'number')
      next.pauseTimeout = Math.max(0, Math.min(120, options.pauseTimeout));
    if (typeof options.clientId === 'string')
      next.clientId = options.clientId.replace(/\D/g, '').slice(0, 25);
    await this.setConfig(next);
    this.lastSent = '';
    await this.connect();
    await this.update();
    this.notify();
    return { ok: true };
  }
}

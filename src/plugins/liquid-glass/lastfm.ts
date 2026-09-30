import crypto from 'node:crypto';

import { BrowserWindow, net, shell } from 'electron';

import {
  MediaType,
  registerCallback,
  type SongInfo,
  SongInfoEvent,
} from '@/providers/song-info';

/*
 * Last.fm propio de MusicSense (proceso principal). Sustituye al complemento
 * Scrobbler de Pear: solo Last.fm, con dos formas de conectar la cuenta:
 *
 * - Autorizar la aplicación: se abre la web de Last.fm en una ventana y, en
 *   cuanto pulsas "Permitir", la ventana se cierra sola (se pregunta a
 *   Last.fm cada 2 s si el permiso ya está dado: auth.getSession).
 * - Iniciar sesión con usuario y contraseña (auth.getMobileSession). La
 *   contraseña solo viaja a Last.fm por HTTPS; nunca se guarda.
 *
 * Scrobbling (normas de Last.fm): la canción debe durar más de 30 s y se
 * registra cuando llevas escuchada la mitad o 4 minutos (lo que llegue antes).
 * Se cuenta el tiempo que suena de verdad: saltar hacia delante no cuenta.
 * Si Last.fm no responde, la escucha se guarda y se envía con la siguiente
 * (hasta 50 por envío).
 *
 * IPC (liquid-glass:lastfm-*): state, authorize, login, logout, options,
 * api-key, open-profile. Al cambiar algo se avisa a la página con
 * liquid-glass:lastfm-changed.
 */

// Clave pública de Pear Desktop (registrada por @semvis123). Se puede poner
// una propia en Ajustes → Last.fm → Clave de API propia
export const LASTFM_DEFAULT_KEY = '04d76faaac8726e60988e14c105d421a';
export const LASTFM_DEFAULT_SECRET = 'a5d2a36fdf64819290f6982481eaffa2';

const API_ROOT = 'https://ws.audioscrobbler.com/2.0/';
const MAX_PENDING = 200;
const BATCH = 50;

export type LastFmConfig = {
  scrobble: boolean;
  nowPlaying: boolean;
  otherMedia: boolean;
  alternativeTitles: boolean;
  alternativeArtist: boolean;
  sessionKey: string;
  user: string;
  apiKey: string;
  secret: string;
  pending: Scrobble[];
};

export const defaultLastFm: LastFmConfig = {
  scrobble: true,
  nowPlaying: true,
  otherMedia: true,
  alternativeTitles: true,
  alternativeArtist: true,
  sessionKey: '',
  user: '',
  apiKey: LASTFM_DEFAULT_KEY,
  secret: LASTFM_DEFAULT_SECRET,
  pending: [],
};

// Opciones que puede cambiar la página
const OPTION_KEYS = [
  'scrobble',
  'nowPlaying',
  'otherMedia',
  'alternativeTitles',
  'alternativeArtist',
] as const;

type Scrobble = {
  artist: string;
  track: string;
  album?: string;
  duration?: number;
  timestamp: number;
};

type Params = Record<string, string | number | undefined>;

type ApiAnswer = {
  error?: number;
  message?: string;
  [key: string]: unknown;
};

// Resultado para la página: ok o el código de error de Last.fm
// (4 = usuario/contraseña, 10/26 = clave de API, 11/16 = caído, 0 = red)
export type LastFmResult = { ok: boolean; error?: number };

// YouTube Music añade los artistas invitados al título según el idioma
// ("Kiss Me More (con SZA)", "(feat. X)", "(with X)"...). Last.fm reconoce
// mejor la canción sin esa parte.
const FEATURING =
  /\s*[([](?:con|feat\.?|ft\.?|featuring|with|avec|mit|com|part\.?)\s[^)\]]*[)\]]/gi;

export const cleanTrackTitle = (title: string) =>
  title.replaceAll(FEATURING, '').trim() || title;

// Firma de Last.fm: parámetros en orden alfabético (sin format), el secreto
// al final y MD5. Ver https://www.last.fm/api/authspec
const sign = (params: Params, secret: string) => {
  const text = Object.keys(params)
    .filter((key) => key !== 'format' && params[key] !== undefined)
    .sort()
    .map((key) => `${key}${params[key]}`)
    .join('');
  return crypto
    .createHash('md5')
    .update(text + secret, 'utf8')
    .digest('hex');
};

const encode = (params: Params) => {
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(params))
    if (value !== undefined) body.append(key, String(value));
  return body;
};

type Getter = () => Promise<LastFmConfig>;
type Setter = (next: LastFmConfig) => Promise<void> | void;
type Handle = (event: string, listener: CallableFunction) => void;

export class LastFm {
  private active = true;
  private timer: NodeJS.Timeout | null = null;
  private authWindow: BrowserWindow | null = null;

  // Canción que suena y cuánto se ha escuchado de ella
  private song: SongInfo | null = null;
  private playing = false;
  private played = 0;
  private scrobbled = false;
  private startedAt = 0;

  constructor(
    private readonly window: BrowserWindow,
    private readonly getConfig: Getter,
    private readonly setConfig: Setter,
  ) {}

  start(handle: Handle) {
    this.active = true;
    registerCallback((info, event) => {
      if (!this.active || event === SongInfoEvent.TimeChanged) return;
      this.onSong(info, event);
    });
    this.timer = setInterval(() => this.tick(), 1000);

    handle('liquid-glass:lastfm-state', (quick?: boolean) =>
      this.state(quick === true),
    );
    handle('liquid-glass:lastfm-authorize', () => this.authorize());
    handle('liquid-glass:lastfm-login', (user: string, password: string) =>
      this.login(String(user ?? ''), String(password ?? '')),
    );
    handle('liquid-glass:lastfm-logout', () => this.logout());
    handle('liquid-glass:lastfm-options', (options: Partial<LastFmConfig>) =>
      this.setOptions(options),
    );
    handle('liquid-glass:lastfm-api-key', (key: string, secret: string) =>
      this.setApiKey(String(key ?? ''), String(secret ?? '')),
    );
    handle('liquid-glass:lastfm-open-profile', async () => {
      const { user } = await this.getConfig();
      if (user)
        await shell.openExternal(
          `https://www.last.fm/user/${encodeURIComponent(user)}`,
        );
    });
  }

  stop() {
    // registerCallback no permite quitar la función: se ignora al estar parado
    this.active = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.authWindow && !this.authWindow.isDestroyed())
      this.authWindow.close();
  }

  static readonly channels = [
    'liquid-glass:lastfm-state',
    'liquid-glass:lastfm-authorize',
    'liquid-glass:lastfm-login',
    'liquid-glass:lastfm-logout',
    'liquid-glass:lastfm-options',
    'liquid-glass:lastfm-api-key',
    'liquid-glass:lastfm-open-profile',
  ];

  // ---------- API ----------

  private async call(
    params: Params,
    config: LastFmConfig,
    post = false,
  ): Promise<ApiAnswer> {
    const full: Params = {
      ...params,
      api_key: config.apiKey,
      format: 'json',
    };
    const signed = { ...full, api_sig: sign(full, config.secret) };
    try {
      const response = post
        ? await net.fetch(API_ROOT, { method: 'POST', body: encode(signed) })
        : await net.fetch(`${API_ROOT}?${encode(signed).toString()}`);
      return (await response.json()) as ApiAnswer;
    } catch {
      return { error: 0, message: 'network' };
    }
  }

  private async save(changes: Partial<LastFmConfig>) {
    const config = await this.getConfig();
    await this.setConfig({ ...config, ...changes });
    if (!this.window.isDestroyed())
      this.window.webContents.send('liquid-glass:lastfm-changed');
  }

  private async connected(session: unknown): Promise<LastFmResult> {
    const { key, name } = (session ?? {}) as { key?: string; name?: string };
    if (!key) return { ok: false, error: 0 };
    await this.save({ sessionKey: key, user: name ?? '' });
    this.flush().catch(console.error);
    return { ok: true };
  }

  // ---------- Conectar la cuenta ----------

  // quick: sin foto ni número de escuchas (no consulta a Last.fm)
  private async state(quick = false) {
    const config = await this.getConfig();
    const options = Object.fromEntries(
      OPTION_KEYS.map((key) => [key, config[key]]),
    );
    const base = {
      connected: Boolean(config.sessionKey),
      user: config.user,
      options,
      customKey: config.apiKey !== LASTFM_DEFAULT_KEY,
      apiKey: config.apiKey === LASTFM_DEFAULT_KEY ? '' : config.apiKey,
      pending: config.pending.length,
      image: '',
      playcount: 0,
    };
    if (quick || !config.sessionKey || !config.user) return base;
    // Foto y número de escuchas (no hace falta la sesión)
    const answer = await this.call(
      { method: 'user.getInfo', user: config.user },
      config,
    );
    const user = answer.user as
      | { playcount?: string; image?: { '#text': string; 'size': string }[] }
      | undefined;
    const image =
      user?.image?.find((item) => item.size === 'extralarge')?.['#text'] ??
      user?.image?.at(-1)?.['#text'] ??
      '';
    return { ...base, image, playcount: Number(user?.playcount ?? 0) };
  }

  private async login(user: string, password: string): Promise<LastFmResult> {
    if (!user || !password) return { ok: false, error: 4 };
    const config = await this.getConfig();
    const answer = await this.call(
      { method: 'auth.getMobileSession', username: user, password },
      config,
      true,
    );
    if (answer.error !== undefined) return { ok: false, error: answer.error };
    return this.connected(answer.session);
  }

  private async authorize(): Promise<LastFmResult> {
    if (this.authWindow && !this.authWindow.isDestroyed()) {
      this.authWindow.focus();
      return { ok: false, error: -1 };
    }
    const config = await this.getConfig();
    const tokenAnswer = await this.call({ method: 'auth.getToken' }, config);
    const token = tokenAnswer.token as string | undefined;
    if (!token) return { ok: false, error: tokenAnswer.error ?? 0 };

    const popup = new BrowserWindow({
      parent: this.window,
      modal: true,
      width: 520,
      height: 720,
      minWidth: 400,
      minHeight: 520,
      title: 'Last.fm',
      backgroundColor: '#ffffff',
      autoHideMenuBar: true,
      show: false,
      webPreferences: {
        // Sesión aparte: la cuenta de Last.fm queda recordada en la ventana
        partition: 'persist:lastfm',
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
      },
    });
    this.authWindow = popup;
    popup.setMenu(null);
    popup.once('ready-to-show', () => popup.show());
    popup.webContents.setWindowOpenHandler(({ url }) => {
      shell.openExternal(url).catch(console.error);
      return { action: 'deny' };
    });
    popup
      .loadURL(
        `https://www.last.fm/api/auth/?api_key=${encodeURIComponent(config.apiKey)}&token=${encodeURIComponent(token)}`,
      )
      .catch(console.error);

    // Se pregunta a Last.fm hasta que el permiso esté dado o se cierre la
    // ventana (máximo 10 minutos)
    const result = await new Promise<LastFmResult>((resolve) => {
      let done = false;
      const finish = (value: LastFmResult) => {
        if (done) return;
        done = true;
        clearInterval(poll);
        if (!popup.isDestroyed()) popup.close();
        resolve(value);
      };
      const started = Date.now();
      const poll = setInterval(async () => {
        if (Date.now() - started > 10 * 60 * 1000)
          return finish({ ok: false, error: -2 });
        const answer = await this.call(
          { method: 'auth.getSession', token },
          config,
        );
        if (answer.session) finish(await this.connected(answer.session));
      }, 2000);
      popup.on('closed', () => finish({ ok: false, error: -2 }));
    });
    this.authWindow = null;
    return result;
  }

  private async logout() {
    await this.save({ sessionKey: '', user: '' });
    return { ok: true };
  }

  private async setOptions(options: Partial<LastFmConfig>) {
    const changes: Partial<LastFmConfig> = {};
    for (const key of OPTION_KEYS)
      if (typeof options?.[key] === 'boolean') changes[key] = options[key];
    await this.save(changes);
    return { ok: true };
  }

  // Clave propia (vacía = la de Pear). La sesión va ligada a la clave, así que
  // al cambiarla hay que volver a conectar
  private async setApiKey(key: string, secret: string) {
    const custom = key.trim() && secret.trim();
    await this.save({
      apiKey: custom ? key.trim() : LASTFM_DEFAULT_KEY,
      secret: custom ? secret.trim() : LASTFM_DEFAULT_SECRET,
      sessionKey: '',
      user: '',
    });
    return { ok: true };
  }

  // ---------- Scrobbling ----------

  private onSong(info: SongInfo, event: SongInfoEvent) {
    const isNew =
      event === SongInfoEvent.VideoSrcChanged &&
      (info.videoId !== this.song?.videoId ||
        // La misma canción otra vez (repetir): empieza de cero
        (this.scrobbled && (info.elapsedSeconds ?? 0) < 3));
    const wasPlaying = this.playing;
    this.song = { ...info };
    this.playing = !info.isPaused;
    if (isNew) {
      this.played = 0;
      this.scrobbled = false;
      this.startedAt =
        Math.floor(Date.now() / 1000) - (info.elapsedSeconds ?? 0);
    }
    // "Escuchando ahora" al empezar y al reanudar
    if (this.playing && (isNew || !wasPlaying))
      this.sendNowPlaying().catch(console.error);
  }

  private tick() {
    if (!this.playing || !this.song || this.scrobbled) return;
    this.played += 1;
    const duration = this.song.songDuration;
    if (duration <= 30) return;
    const needed = Math.min(Math.ceil(duration / 2), 4 * 60);
    if (this.played < needed) return;
    this.scrobbled = true;
    this.sendScrobble(this.song, this.startedAt).catch(console.error);
  }

  // Título y artista según las opciones (como el complemento de Pear)
  private describe(info: SongInfo, config: LastFmConfig) {
    if (
      !config.otherMedia &&
      info.mediaType !== MediaType.Audio &&
      info.mediaType !== MediaType.OriginalMusicVideo
    )
      return null;
    const title =
      config.alternativeTitles && info.alternativeTitle
        ? info.alternativeTitle
        : info.title;
    const tag = info.tags?.at(0);
    const artist = config.alternativeArtist && tag ? tag : info.artist;
    if (!title || !artist) return null;
    return {
      track: cleanTrackTitle(title),
      artist,
      album: info.album ?? undefined,
      duration: info.songDuration || undefined,
    };
  }

  private async sendNowPlaying() {
    const config = await this.getConfig();
    if (!config.sessionKey || !config.nowPlaying || !this.song) return;
    const track = this.describe(this.song, config);
    if (!track) return;
    const answer = await this.call(
      { method: 'track.updateNowPlaying', sk: config.sessionKey, ...track },
      config,
      true,
    );
    await this.checkSession(answer);
  }

  private async sendScrobble(info: SongInfo, timestamp: number) {
    const config = await this.getConfig();
    if (!config.scrobble || !config.sessionKey) return;
    const track = this.describe(info, config);
    if (!track) return;
    await this.flush([{ ...track, timestamp }]);
  }

  // Envía las escuchas pendientes (y la nueva, si hay). Si falla por la red
  // o porque Last.fm está caído, se guardan para el siguiente intento
  private async flush(extra: Scrobble[] = []) {
    const config = await this.getConfig();
    const queue = [...config.pending, ...extra];
    if (!queue.length || !config.sessionKey) return;
    const batch = queue.slice(-BATCH);
    const params: Params = { method: 'track.scrobble', sk: config.sessionKey };
    batch.forEach((item, index) => {
      params[`artist[${index}]`] = item.artist;
      params[`track[${index}]`] = item.track;
      params[`timestamp[${index}]`] = item.timestamp;
      if (item.album) params[`album[${index}]`] = item.album;
      if (item.duration) params[`duration[${index}]`] = item.duration;
    });
    const answer = await this.call(params, config, true);
    const retry = [0, 11, 16, 29].includes(answer.error ?? -1);
    const rest = queue.slice(0, -BATCH);
    const pending = retry ? queue : rest;
    if (
      pending.length !== config.pending.length ||
      pending.some((item, index) => item !== config.pending[index])
    )
      await this.save({ pending: pending.slice(-MAX_PENDING) });
    await this.checkSession(answer);
  }

  // Error 9: la sesión ya no vale (permiso retirado en Last.fm)
  private async checkSession(answer: ApiAnswer) {
    if (answer.error === 9) await this.save({ sessionKey: '', user: '' });
  }
}

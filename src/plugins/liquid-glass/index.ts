import { t } from '@/i18n';
import { createPlugin } from '@/utils';

import { AnimatedArtwork } from './animated-art';
import { AudioEngine, EQ_PRESETS } from './audio-engine';
import { backend } from './backend';
import { LiquidBackground } from './liquid-background';
import { LyricsMode } from './lyrics';
import lyricsStyle from './lyrics.css?inline';
import nowPlayingStyle from './now-playing.css?inline';
import { PanelActions } from './panel-actions';
import { PlayerLayout } from './player';
import { PreferMusic } from './prefer-music';
import { ProfilePage } from './profile';
import { UpNext } from './queue';
import { LiquidRefraction } from './refraction';
import { SettingsPanel } from './settings';
import settingsStyle from './settings.css?inline';
import { LibrarySidebar } from './sidebar';
import style from './style.css?inline';
import { TopBar } from './topbar';
import topBarStyle from './topbar.css?inline';
import { Visualizer } from './visualizer';
import { WaveProgress } from './wave';

import type { MusicPlayer } from '@/types/music-player';

type LiquidGlassConfig = {
  enabled: boolean;
  animatedBackground: boolean;
  aberration: boolean;
  animatedArtwork: boolean;
  preferMusic: boolean;
  visualizer: boolean;
  spatialAudio: boolean;
  eqPreset: string;
  crossfade: number;
  translateLyrics: boolean;
  // 'balatro' era el estilo anterior: ahora cuenta como 'liquid'
  background: 'artwork' | 'liquid' | 'balatro';
  blur: number;
};

// Activado de fábrica y sin opción de desactivarlo (ALWAYS_ENABLED en
// src/config/plugins.ts): es el diseño de MusicSense
const defaultConfig: LiquidGlassConfig = {
  enabled: true,
  animatedBackground: true,
  aberration: true,
  animatedArtwork: true,
  preferMusic: false,
  visualizer: false,
  spatialAudio: false,
  eqPreset: 'flat',
  crossfade: 0,
  translateLyrics: true,
  background: 'liquid',
  blur: 15,
};

type Invoke = (channel: string, ...args: unknown[]) => Promise<unknown>;

const BODY_CLASS = 'liquid-glass';
const ANIMATED_CLASS = 'liquid-glass-animated';
const BACKDROP_ID = 'liquid-glass-backdrop';

// Color de acento tomado de la portada: el color más vivo (saturado y no
// demasiado oscuro), aclarado para leerse sobre el vidrio oscuro. Se usa en
// el elemento activo del menú lateral, corazón, etc. (--lg-accent).
// Imagen aparte con crossOrigin: si la portada no permite leerla, se queda
// el acento anterior sin afectar al fondo.
const updateAccent = (url: string) => {
  const image = new Image();
  image.crossOrigin = 'anonymous';
  image.onload = () => {
    try {
      const size = 24;
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const context = canvas.getContext('2d');
      if (!context) return;
      context.drawImage(image, 0, 0, size, size);
      const pixels = context.getImageData(0, 0, size, size).data;
      let best = { score: -1, r: 250, g: 45, b: 72 };
      for (let i = 0; i < pixels.length; i += 4) {
        const [r, g, b] = [pixels[i], pixels[i + 1], pixels[i + 2]];
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        const saturation = max === 0 ? 0 : (max - min) / max;
        const brightness = max / 255;
        const vivid = saturation * 0.7;
        const light = brightness * 0.3;
        const score = vivid + light;
        if (brightness > 0.25 && score > best.score) best = { score, r, g, b };
      }
      // Mezcla con blanco para que tenga buen contraste sobre fondo oscuro
      const lift = (value: number) => {
        const extra = (255 - value) * 0.25;
        return Math.round(value + extra);
      };
      document.body.style.setProperty(
        '--lg-accent',
        `rgb(${lift(best.r)}, ${lift(best.g)}, ${lift(best.b)})`,
      );
    } catch {
      // Portada sin permiso de lectura: se mantiene el acento anterior
    }
  };
  image.src = url;
};

// Pide la portada en alta resolución (las URLs de Google permiten cambiar el tamaño)
const toHighResArtwork = (url: string) =>
  url
    .replace(/=w\d+-h\d+[^&?]*/, '=w1080-h1080-l90-rj')
    .replace(
      /\/(default|mqdefault|hqdefault|sddefault)\.jpg/,
      '/maxresdefault.jpg',
    );

export default createPlugin({
  name: () => t('plugins.liquid-glass.name'),
  description: () => t('plugins.liquid-glass.description'),
  restartNeeded: false,
  config: defaultConfig,
  stylesheets: [
    style,
    lyricsStyle,
    nowPlayingStyle,
    settingsStyle,
    topBarStyle,
  ],
  backend,
  menu: async ({ getConfig, setConfig }) => {
    const config = await getConfig();
    // Efecto del vidrio: de Suave (más desenfoque) a Intenso (menos
    // desenfoque, se nota más la lente y el irisado de los bordes)
    const blurLevels = [50, 30, 15];

    return [
      {
        label: t('plugins.liquid-glass.menu.prefer-music'),
        type: 'checkbox',
        checked: config.preferMusic,
        click(item) {
          setConfig({ preferMusic: item.checked });
        },
      },
      {
        label: t('plugins.liquid-glass.menu.visualizer'),
        type: 'checkbox',
        checked: config.visualizer,
        click(item) {
          setConfig({ visualizer: item.checked });
        },
      },
      {
        label: t('plugins.liquid-glass.menu.translate-lyrics'),
        type: 'checkbox',
        checked: config.translateLyrics,
        click(item) {
          setConfig({ translateLyrics: item.checked });
        },
      },
      {
        label: t('plugins.liquid-glass.menu.equalizer.label'),
        submenu: Object.keys(EQ_PRESETS).map((preset) => ({
          label: t(`plugins.liquid-glass.menu.equalizer.submenu.${preset}`),
          type: 'radio',
          checked: config.eqPreset === preset,
          click() {
            setConfig({ eqPreset: preset });
          },
        })),
      },
      {
        label: t('plugins.liquid-glass.menu.crossfade.label'),
        submenu: [0, 3, 6, 10].map((seconds) => ({
          label: seconds
            ? t('plugins.liquid-glass.menu.crossfade.seconds', { seconds })
            : t('plugins.liquid-glass.menu.crossfade.off'),
          type: 'radio',
          checked: config.crossfade === seconds,
          click() {
            setConfig({ crossfade: seconds });
          },
        })),
      },
      {
        label: t('plugins.liquid-glass.menu.spatial-audio'),
        type: 'checkbox',
        checked: config.spatialAudio,
        click(item) {
          setConfig({ spatialAudio: item.checked });
        },
      },
      {
        label: t('plugins.liquid-glass.menu.background.label'),
        submenu: (['artwork', 'liquid'] as const).map((background) => ({
          label: t(
            `plugins.liquid-glass.menu.background.submenu.${background}`,
          ),
          type: 'radio',
          checked:
            (config.background === 'artwork' ? 'artwork' : 'liquid') ===
            background,
          click() {
            setConfig({ background });
          },
        })),
      },
      {
        label: t('plugins.liquid-glass.menu.animated-background'),
        type: 'checkbox',
        checked: config.animatedBackground,
        click(item) {
          setConfig({ animatedBackground: item.checked });
        },
      },
      {
        label: t('plugins.liquid-glass.menu.aberration'),
        type: 'checkbox',
        checked: config.aberration,
        click(item) {
          setConfig({ aberration: item.checked });
        },
      },
      {
        label: t('plugins.liquid-glass.menu.animated-artwork'),
        type: 'checkbox',
        checked: config.animatedArtwork,
        click(item) {
          setConfig({ animatedArtwork: item.checked });
        },
      },
      {
        label: t('plugins.liquid-glass.menu.blur.label'),
        submenu: blurLevels.map((blur) => ({
          label: t(`plugins.liquid-glass.menu.blur.submenu.${blur}`),
          type: 'radio',
          checked: config.blur === blur,
          click() {
            setConfig({ blur });
          },
        })),
      },
    ];
  },
  renderer: {
    backdrop: null as HTMLDivElement | null,
    activeLayer: 0,
    lastArtwork: '',
    refraction: null as LiquidRefraction | null,
    wave: null as WaveProgress | null,
    lyrics: null as LyricsMode | null,
    player: null as PlayerLayout | null,
    onDataChange: null as ((event: Event) => void) | null,
    settings: null as SettingsPanel | null,
    topBar: null as TopBar | null,
    sidebar: null as LibrarySidebar | null,
    upNext: null as UpNext | null,
    panelActions: null as PanelActions | null,
    profile: null as ProfilePage | null,
    invoke: null as Invoke | null,
    playerApi: null as MusicPlayer | null,
    animatedArt: null as AnimatedArtwork | null,
    animatedArtEnabled: true,
    preferMusic: null as PreferMusic | null,
    preferMusicEnabled: false,
    visualizer: null as Visualizer | null,
    audio: null as AudioEngine | null,
    liquid: null as LiquidBackground | null,

    async start({ getConfig, ipc }) {
      document.body.classList.add(BODY_CLASS);
      this.invoke = (channel, ...args) => ipc.invoke(channel, ...args);
      this.settings = new SettingsPanel(
        {
          title: t('plugins.liquid-glass.settings'),
          search: t('plugins.liquid-glass.settings-panel.search'),
          enabled: t('plugins.liquid-glass.settings-panel.enabled'),
          available: t('plugins.liquid-glass.settings-panel.available'),
          empty: t('plugins.liquid-glass.settings-panel.empty'),
          general: t('plugins.liquid-glass.settings-panel.general'),
          ownPlugin: t('plugins.liquid-glass.name'),
        },
        (channel, ...args) => ipc.invoke(channel, ...args),
      );
      this.settings.start();
      this.topBar = new TopBar(
        {
          back: t('plugins.liquid-glass.topbar.back'),
          forward: t('plugins.liquid-glass.topbar.forward'),
          home: t('plugins.liquid-glass.topbar.home'),
          explore: t('plugins.liquid-glass.topbar.explore'),
          library: t('plugins.liquid-glass.topbar.library'),
          history: t('plugins.liquid-glass.topbar.history'),
          profile: t('plugins.liquid-glass.topbar.profile'),
          yourProfile: t('plugins.liquid-glass.topbar.your-profile'),
          signIn: t('plugins.liquid-glass.topbar.sign-in'),
          signOut: t('plugins.liquid-glass.topbar.sign-out'),
          settings: t('plugins.liquid-glass.topbar.settings'),
          tabProfile: t('plugins.liquid-glass.topbar.tab-profile'),
          tabPlugins: t('plugins.liquid-glass.topbar.tab-plugins'),
          tabYouTube: t('plugins.liquid-glass.topbar.tab-youtube'),
        },
        (anchor) => {
          this.settings?.toggle(anchor).catch(console.error);
        },
      );
      this.topBar.start();

      this.sidebar = new LibrarySidebar({
        playlists: t('plugins.liquid-glass.sidebar.playlists'),
        albums: t('plugins.liquid-glass.sidebar.albums'),
        artists: t('plugins.liquid-glass.sidebar.artists'),
        empty: t('plugins.liquid-glass.sidebar.empty'),
      });
      this.sidebar.start();
      this.profile = new ProfilePage(
        {
          integrations: t('plugins.liquid-glass.profile.integrations'),
          stats: t('plugins.liquid-glass.profile.stats'),
          statsEmpty: t('plugins.liquid-glass.profile.stats-empty'),
          statsSince: (date) =>
            t('plugins.liquid-glass.profile.stats-since', { date }),
          minutes: (count) =>
            t('plugins.liquid-glass.profile.minutes', { count }),
          discord: 'Discord',
          scrobbler: t('plugins.liquid-glass.profile.scrobbler'),
          share: t('plugins.liquid-glass.profile.share'),
        },
        (channel, ...args) => ipc.invoke(channel, ...args),
      );
      this.profile.start();

      this.wave = new WaveProgress();
      this.wave.start();
      this.lyrics = new LyricsMode(
        {
          button: t('plugins.liquid-glass.lyrics-button'),
          credit: (provider) =>
            t('plugins.liquid-glass.lyrics-credit', { provider }),
          notFound: t('plugins.liquid-glass.lyrics-not-found'),
          search: t('plugins.liquid-glass.lyrics-search'),
        },
        (query) => {
          ipc.invoke('liquid-glass:search-lyrics', query).catch(console.error);
        },
        (text, target) =>
          ipc.invoke('liquid-glass:translate', text, target) as Promise<{
            language: string;
            text: string;
          } | null>,
      );
      this.lyrics.start();

      this.upNext = new UpNext({
        button: t('plugins.liquid-glass.queue.button'),
        yours: t('plugins.liquid-glass.queue.yours'),
        next: t('plugins.liquid-glass.queue.next'),
        hint: t('plugins.liquid-glass.queue.hint'),
        remove: t('plugins.liquid-glass.queue.remove'),
        added: t('plugins.liquid-glass.queue.added'),
      });
      this.upNext.start();

      const upNext = this.upNext;
      this.panelActions = new PanelActions(
        {
          addToQueue: t('plugins.liquid-glass.queue.add'),
          more: t('plugins.liquid-glass.queue.more'),
          linkCopied: t('plugins.liquid-glass.queue.link-copied'),
        },
        {
          addToQueue: (videoId) => upNext.addToQueue(videoId),
          playNext: (videoId) => upNext.addToQueue(videoId, true),
          toast: (message) => upNext.toast(message),
        },
      );
      this.panelActions.start();
      this.player = new PlayerLayout({
        showVideo: t('plugins.liquid-glass.player.show-video'),
        showArtwork: t('plugins.liquid-glass.player.show-artwork'),
        autoplay: t('plugins.liquid-glass.player.autoplay'),
        addToPlaylist: t('plugins.liquid-glass.add-to-playlist'),
        share: t('plugins.liquid-glass.player.share'),
        loading: t('plugins.liquid-glass.player.loading'),
        idle: t('plugins.liquid-glass.player.idle'),
      });
      this.player.start();

      const backdrop = document.createElement('div');
      backdrop.id = BACKDROP_ID;
      backdrop.innerHTML =
        '<div class="lg-layer"></div><div class="lg-layer"></div><div class="lg-shade"></div>';
      document.body.prepend(backdrop);
      this.backdrop = backdrop;

      this.audio = new AudioEngine();
      this.audio.start();

      this.applyConfig(await getConfig());
    },

    // Solo lo que necesita la API del reproductor; el resto arranca en start()
    // (sin ninguna canción cargada YouTube Music tarda en crear el reproductor)
    onPlayerApiReady(playerApi) {
      this.player?.setApi(playerApi);
      this.playerApi = playerApi;
      this.updateAnimatedArt();
      this.updatePreferMusic();

      const update = () => {
        const thumbnails =
          playerApi.getPlayerResponse()?.videoDetails?.thumbnail?.thumbnails;
        const url = thumbnails?.at(-1)?.url;
        if (url) this.setArtwork(toHighResArtwork(url));
      };

      this.onDataChange = (event: Event) => {
        const { detail } = event as CustomEvent<{ name: string }>;
        if (detail?.name === 'dataloaded') update();
      };
      document.addEventListener('videodatachange', this.onDataChange);
      update();
    },

    onConfigChange(newConfig) {
      this.applyConfig(newConfig);
    },

    stop() {
      document.body.classList.remove(BODY_CLASS, ANIMATED_CLASS);
      document.documentElement.style.removeProperty('--lg-blur');
      if (this.onDataChange) {
        document.removeEventListener('videodatachange', this.onDataChange);
        this.onDataChange = null;
      }
      this.backdrop?.remove();
      this.backdrop = null;
      this.refraction?.stop();
      this.refraction = null;
      this.wave?.stop();
      this.wave = null;
      this.lyrics?.stop();
      this.lyrics = null;
      this.upNext?.stop();
      this.upNext = null;
      this.panelActions?.stop();
      this.panelActions = null;
      this.player?.stop();
      this.player = null;
      this.settings?.stop();
      this.settings = null;
      this.topBar?.stop();
      this.topBar = null;
      this.sidebar?.stop();
      this.sidebar = null;
      this.profile?.stop();
      this.profile = null;
      this.animatedArt?.stop();
      this.animatedArt = null;
      this.preferMusic?.stop();
      this.preferMusic = null;
      this.visualizer?.stop();
      this.visualizer = null;
      this.audio?.stop();
      this.audio = null;
      this.liquid?.stop();
      this.liquid = null;
      this.playerApi = null;
      this.lastArtwork = '';
    },

    // Arranca o detiene las portadas animadas según la opción del menú
    updateAnimatedArt(this: {
      playerApi: MusicPlayer | null;
      animatedArt: AnimatedArtwork | null;
      animatedArtEnabled: boolean;
      invoke: Invoke | null;
    }) {
      if (this.animatedArtEnabled && this.playerApi && !this.animatedArt) {
        const invoke = this.invoke;
        this.animatedArt = new AnimatedArtwork(async (channel, ...args) =>
          invoke ? invoke(channel, ...args) : null,
        );
        this.animatedArt.start(this.playerApi);
      } else if (!this.animatedArtEnabled && this.animatedArt) {
        this.animatedArt.stop();
        this.animatedArt = null;
      }
    },

    // Arranca o detiene "Preferir música" según la opción del menú
    updatePreferMusic(this: {
      playerApi: MusicPlayer | null;
      preferMusic: PreferMusic | null;
      preferMusicEnabled: boolean;
    }) {
      if (this.preferMusicEnabled && this.playerApi && !this.preferMusic) {
        this.preferMusic = new PreferMusic();
        this.preferMusic.start(this.playerApi);
      } else if (!this.preferMusicEnabled && this.preferMusic) {
        this.preferMusic.stop();
        this.preferMusic = null;
      }
    },

    applyConfig(
      this: {
        refraction: LiquidRefraction | null;
        lyrics: LyricsMode | null;
        visualizer: Visualizer | null;
        audio: AudioEngine | null;
        liquid: LiquidBackground | null;
        backdrop: HTMLDivElement | null;
        lastArtwork: string;
        animatedArtEnabled: boolean;
        preferMusicEnabled: boolean;
        updateAnimatedArt: () => void;
        updatePreferMusic: () => void;
      },
      config: LiquidGlassConfig,
    ) {
      if (config.visualizer && !this.visualizer) {
        this.visualizer = new Visualizer();
        this.visualizer.start();
      } else if (!config.visualizer && this.visualizer) {
        this.visualizer.stop();
        this.visualizer = null;
      }
      this.audio?.setSpatial(config.spatialAudio);
      this.audio?.setEq(config.eqPreset);
      this.audio?.setCrossfade(config.crossfade);
      this.lyrics?.setTranslate(config.translateLyrics);

      // Fondo líquido (liquid-background.ts) en lugar de la portada
      // desenfocada
      const liquid = config.background !== 'artwork';
      if (liquid && !this.liquid && this.backdrop) {
        this.liquid = new LiquidBackground();
        this.liquid.start(this.backdrop);
        this.liquid.setArtwork(this.lastArtwork);
      } else if (!liquid && this.liquid) {
        this.liquid.stop();
        this.liquid = null;
      }
      document.body.classList.toggle('lg-liquid-bg', Boolean(this.liquid));

      this.animatedArtEnabled = config.animatedArtwork;
      this.updateAnimatedArt();
      this.preferMusicEnabled = config.preferMusic;
      this.updatePreferMusic();
      document.body.classList.toggle(ANIMATED_CLASS, config.animatedBackground);
      document.documentElement.style.setProperty(
        '--lg-blur',
        `${config.blur}px`,
      );

      if (config.aberration && !this.refraction) {
        this.refraction = new LiquidRefraction();
        this.refraction.start(config.blur);
      } else if (!config.aberration && this.refraction) {
        this.refraction.stop();
        this.refraction = null;
      } else {
        this.refraction?.setBlur(config.blur);
      }
    },

    // Cambia la portada del fondo con un fundido entre dos capas
    setArtwork(
      this: {
        backdrop: HTMLDivElement | null;
        activeLayer: number;
        lastArtwork: string;
        liquid: LiquidBackground | null;
      },
      url: string,
    ) {
      if (!this.backdrop || url === this.lastArtwork) return;
      this.lastArtwork = url;

      const image = new Image();
      image.onload = () => {
        if (!this.backdrop || this.lastArtwork !== url) return;
        const layers =
          this.backdrop.querySelectorAll<HTMLDivElement>('.lg-layer');
        const next = (this.activeLayer + 1) % layers.length;
        layers[next].style.backgroundImage = `url("${url}")`;
        layers[next].classList.add('visible');
        layers[this.activeLayer].classList.remove('visible');
        this.activeLayer = next;
      };
      image.src = url;
      updateAccent(url);
      this.liquid?.setArtwork(url);
    },
  },
});

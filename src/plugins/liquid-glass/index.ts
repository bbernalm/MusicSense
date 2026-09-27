import { t } from '@/i18n';
import { createPlugin } from '@/utils';

import { AnimatedArtwork } from './animated-art';
import { backend } from './backend';
import { LyricsMode } from './lyrics';
import lyricsStyle from './lyrics.css?inline';
import nowPlayingStyle from './now-playing.css?inline';
import { PlayerLayout } from './player';
import { PreferMusic } from './prefer-music';
import { ProfilePage } from './profile';
import { LiquidRefraction } from './refraction';
import { SettingsPanel } from './settings';
import settingsStyle from './settings.css?inline';
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
  blur: 30,
};

type Invoke = (channel: string, ...args: unknown[]) => Promise<unknown>;

const BODY_CLASS = 'liquid-glass';
const ANIMATED_CLASS = 'liquid-glass-animated';
const BACKDROP_ID = 'liquid-glass-backdrop';

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
    const blurLevels = [15, 30, 50];

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
    profile: null as ProfilePage | null,
    invoke: null as Invoke | null,
    playerApi: null as MusicPlayer | null,
    animatedArt: null as AnimatedArtwork | null,
    animatedArtEnabled: true,
    preferMusic: null as PreferMusic | null,
    preferMusicEnabled: false,
    visualizer: null as Visualizer | null,

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
        t('plugins.liquid-glass.lyrics-button'),
        (provider) => t('plugins.liquid-glass.lyrics-credit', { provider }),
      );
      this.lyrics.start();
      this.player = new PlayerLayout({
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
      this.player?.stop();
      this.player = null;
      this.settings?.stop();
      this.settings = null;
      this.topBar?.stop();
      this.topBar = null;
      this.profile?.stop();
      this.profile = null;
      this.animatedArt?.stop();
      this.animatedArt = null;
      this.preferMusic?.stop();
      this.preferMusic = null;
      this.visualizer?.stop();
      this.visualizer = null;
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
        visualizer: Visualizer | null;
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
    },
  },
});

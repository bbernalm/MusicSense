import { t } from '@/i18n';
import { createPlugin } from '@/utils';

import { LiquidRefraction } from './refraction';
import style from './style.css?inline';
import { WaveProgress } from './wave';

type LiquidGlassConfig = {
  enabled: boolean;
  animatedBackground: boolean;
  aberration: boolean;
  blur: number;
};

const defaultConfig: LiquidGlassConfig = {
  enabled: false,
  animatedBackground: true,
  aberration: true,
  blur: 30,
};

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
  stylesheets: [style],
  menu: async ({ getConfig, setConfig }) => {
    const config = await getConfig();
    const blurLevels = [15, 30, 50];

    return [
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
    onDataChange: null as ((event: Event) => void) | null,

    async start({ getConfig }) {
      document.body.classList.add(BODY_CLASS);

      const backdrop = document.createElement('div');
      backdrop.id = BACKDROP_ID;
      backdrop.innerHTML =
        '<div class="lg-layer"></div><div class="lg-layer"></div><div class="lg-shade"></div>';
      document.body.prepend(backdrop);
      this.backdrop = backdrop;

      this.applyConfig(await getConfig());
    },

    onPlayerApiReady(playerApi) {
      this.wave = new WaveProgress();
      this.wave.start();

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
      this.lastArtwork = '';
    },

    applyConfig(
      this: { refraction: LiquidRefraction | null },
      config: LiquidGlassConfig,
    ) {
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

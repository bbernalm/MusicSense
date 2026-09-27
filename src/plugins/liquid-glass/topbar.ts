/*
 * Barra superior:
 * - [inicio][biblioteca] [‹][›] a la izquierda del buscador;
 * - [historial][perfil] a su derecha (historial solo con sesión iniciada);
 * - menú del perfil: foto y nombre, "Tu perfil", cambiar de cuenta y
 *   "Cerrar sesión" (con sesión) o "Acceder" y "Ajustes" (sin sesión);
 * - en la página de tu perfil, una cápsula bajo el buscador con las
 *   pestañas Perfil / Complementos (panel de ajustes) / YouTube (ajustes de
 *   YouTube Music, solo los apartados elegidos);
 * - sin menciones a YouTube Music Premium.
 *
 * Los menús de YouTube Music se leen y se pulsan "por dentro": se abren con
 * la clase lg-silent-menu (invisibles), se busca la opción por su ícono y se
 * pulsa, así que hacen exactamente lo mismo que el original.
 */

import APP_ICON_SVG from '@assets/icon.svg?raw';

import type { MusicPlayerAppElement } from '@/types/music-player-app-element';

const SILENT_MENU_CLASS = 'lg-silent-menu';
const PROFILE_PAGE_CLASS = 'lg-profile-page';

// Íconos de YouTube Music que se consideran publicidad de Premium
const PREMIUM_ICONS = new Set([
  'UNLIMITED',
  'YOUTUBE_MUSIC_PREMIUM',
  'PREMIUM',
]);

// Apartados de los ajustes de YouTube que no se muestran
const HIDDEN_SETTINGS = new Set([
  'SETTING_CAT_MUSIC_DOWNLOADS',
  'SETTING_CAT_MUSIC_CHANNEL_SETTINGS',
  'SETTING_CAT_MUSIC_RECOMMENDATIONS',
  'SETTING_CAT_ABOUT',
]);

// Opciones del menú de la cuenta que se muestran en el menú del perfil
const PROFILE_ICONS = ['ACCOUNT_BOX', 'SWITCH_ACCOUNTS', 'EXIT_TO_APP'];

const svg = (body: string, size = 22) =>
  `<svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true">${body}</svg>`;
const stroke =
  'fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"';

const BACK_ICON = svg(`<path d="M15 5l-7 7 7 7" ${stroke}/>`);
const FORWARD_ICON = svg(`<path d="M9 5l7 7-7 7" ${stroke}/>`);
const HOME_ICON = svg(
  `<path d="M4 10.5 12 4l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5.5h-5V20H5a1 1 0 0 1-1-1Z" ${stroke}/>`,
);
// Biblioteca: libros en una estantería (como en Apple Music)
export const LIBRARY_ICON = svg(
  `<path d="M5 4.5v15M9 4.5v15M13.2 5.2l4.6 13.6" ${stroke} stroke-width="2"/><path d="M3.5 20h17" ${stroke}/>`,
);
const HISTORY_ICON = svg(
  `<path d="M4 12a8 8 0 1 0 2.4-5.7M4 4.5v3.8h3.8" ${stroke}/><path d="M12 8v4.3l3 1.8" ${stroke}/>`,
);
const PERSON_ICON = svg(
  '<circle cx="12" cy="8.5" r="4" fill="currentColor"/><path d="M4.5 20c.8-3.8 4-6 7.5-6s6.7 2.2 7.5 6" fill="currentColor"/>',
  24,
);
const GEAR_ICON = svg(
  `<path ${stroke} stroke-width="1.6" d="M10.3 3.2h3.4l.5 2.4c.6.2 1.1.5 1.6.9l2.3-.8 1.7 2.9-1.8 1.6c.1.6.1 1.2 0 1.8l1.8 1.6-1.7 2.9-2.3-.8c-.5.4-1 .7-1.6.9l-.5 2.4h-3.4l-.5-2.4c-.6-.2-1.1-.5-1.6-.9l-2.3.8-1.7-2.9 1.8-1.6a6 6 0 0 1 0-1.8L4.2 8.6l1.7-2.9 2.3.8c.5-.4 1-.7 1.6-.9Z"/><circle cx="12" cy="12" r="2.8" ${stroke} stroke-width="1.6"/>`,
  20,
);
const SIGN_IN_ICON = svg(
  `<path d="M10 17l5-5-5-5M15 12H3M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4" ${stroke}/>`,
  20,
);

type MenuEntry = {
  label: string;
  icon: string;
  svg: string;
  browseId: string;
};

type PolymerElement = HTMLElement & {
  data?: {
    icon?: { iconType?: string };
    navigationEndpoint?: { browseEndpoint?: { browseId?: string } };
  };
  close?: () => void;
};

export type TopBarLabels = {
  back: string;
  forward: string;
  home: string;
  library: string;
  history: string;
  profile: string;
  yourProfile: string;
  signIn: string;
  signOut: string;
  settings: string;
  tabProfile: string;
  tabPlugins: string;
  tabYouTube: string;
};

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = '',
  text = '',
) => {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text) element.textContent = text;
  return element;
};

const iconButton = (
  className: string,
  icon: string,
  label: string,
  action: () => void,
) => {
  const button = el('button', className);
  button.type = 'button';
  button.title = label;
  button.setAttribute('aria-label', label);
  button.innerHTML = icon;
  button.addEventListener('click', (event) => {
    event.stopPropagation();
    action();
  });
  return button;
};

const isSignedIn = () =>
  Boolean(document.querySelector('ytmusic-nav-bar ytmusic-settings-button'));

const navigate = (browseId: string) =>
  document
    .querySelector<MusicPlayerAppElement>('ytmusic-app')
    ?.navigate(browseId);

// Botón que abre el menú de YouTube Music: el avatar con sesión, ⋮ sin ella
const menuTrigger = () =>
  document.querySelector<HTMLElement>(
    isSignedIn()
      ? 'ytmusic-nav-bar ytmusic-settings-button button, ytmusic-nav-bar ytmusic-settings-button #button'
      : 'ytmusic-nav-bar #menu-button button, ytmusic-nav-bar #menu-button',
  );

const openDropdown = () =>
  [
    ...document.querySelectorAll<PolymerElement>(
      'ytmusic-popup-container tp-yt-iron-dropdown',
    ),
  ].find(
    (dropdown) =>
      getComputedStyle(dropdown).display !== 'none' &&
      dropdown.querySelector('ytd-compact-link-renderer'),
  );

const menuItems = (dropdown: HTMLElement) => [
  ...dropdown.querySelectorAll<PolymerElement>('ytd-compact-link-renderer'),
];

export class TopBar {
  private appIcon: HTMLDivElement | null = null;
  private leftGroup: HTMLDivElement | null = null;
  private rightGroup: HTMLDivElement | null = null;
  private history: HTMLButtonElement | null = null;
  private profile: HTMLButtonElement | null = null;
  private profileMenu: HTMLDivElement | null = null;
  private profileTabs: HTMLDivElement | null = null;
  private entries: MenuEntry[] = [];
  private entriesSignedIn: boolean | null = null;
  private accountName = '';
  private accountHandle = '';
  private playlistThumbnails = new Map<string, string>();
  private thumbnailsLoadedAt = 0;
  private loadingThumbnails = false;
  private reading = false;
  private timer: number | null = null;
  private readonly onOutside = () => this.closeProfileMenu();

  constructor(
    private readonly labels: TopBarLabels,
    private readonly openSettings: (anchor: DOMRect) => void,
  ) {}

  start() {
    this.timer = window.setInterval(() => this.tick(), 500);
    document.addEventListener('click', this.onOutside);
    this.tick();
  }

  stop() {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
    document.removeEventListener('click', this.onOutside);
    for (const element of [
      this.appIcon,
      this.leftGroup,
      this.rightGroup,
      this.profileMenu,
      this.profileTabs,
    ]) {
      element?.remove();
    }
    this.leftGroup = null;
    this.rightGroup = null;
    this.history = null;
    this.profile = null;
    this.profileMenu = null;
    this.profileTabs = null;
    document.body.classList.remove(PROFILE_PAGE_CLASS);
  }

  // Id del canal propio (de "Tu canal" en el menú de la cuenta)
  get channelId() {
    return (
      this.entries.find((entry) => entry.icon === 'ACCOUNT_BOX')?.browseId ?? ''
    );
  }

  get name() {
    return this.accountName;
  }

  private tick() {
    this.ensureNavControls();
    this.updateAvatar();
    this.markEntries();

    // Lee las opciones del menú de YouTube Music al empezar y al cambiar la sesión
    if (this.entriesSignedIn !== isSignedIn() && !this.reading) {
      this.readEntries().catch(console.error);
    }
    this.updateProfilePage();
  }

  // ---------- Botones junto al buscador ----------
  // Icono de MusicSense en la franja superior izquierda (sobre el botón del
  // menú lateral)
  private ensureAppIcon() {
    if (this.appIcon?.isConnected) return;
    const icon = el('div', 'lg-app-icon');
    icon.innerHTML = APP_ICON_SVG;
    icon.setAttribute('aria-hidden', 'true');
    document.body.append(icon);
    this.appIcon = icon;
  }

  private ensureNavControls() {
    this.ensureAppIcon();
    const search = document.querySelector<HTMLElement>(
      'ytmusic-nav-bar .center-content ytmusic-search-box',
    );
    if (!search) return;

    if (!this.leftGroup?.isConnected) {
      const group = el('div', 'lg-nav-arrows');
      group.append(
        iconButton('lg-nav-capsule', HOME_ICON, this.labels.home, () =>
          navigate('FEmusic_home'),
        ),
        iconButton('lg-nav-capsule', LIBRARY_ICON, this.labels.library, () =>
          navigate('FEmusic_library_landing'),
        ),
        el('span', 'lg-nav-separator'),
        iconButton('lg-nav-capsule', BACK_ICON, this.labels.back, () =>
          history.back(),
        ),
        iconButton('lg-nav-capsule', FORWARD_ICON, this.labels.forward, () =>
          history.forward(),
        ),
      );
      search.before(group);
      this.leftGroup = group;
    }

    if (!this.rightGroup?.isConnected) {
      const group = el('div', 'lg-nav-arrows');
      this.history = iconButton(
        'lg-nav-capsule lg-history-button',
        HISTORY_ICON,
        this.labels.history,
        () => navigate('FEmusic_history'),
      );
      this.profile = iconButton(
        'lg-profile-button',
        PERSON_ICON,
        this.labels.profile,
        () => this.toggleProfileMenu(),
      );
      group.append(this.history, this.profile);
      search.after(group);
      this.rightGroup = group;
    }
    this.history?.classList.toggle('hidden', !isSignedIn());
  }

  // Muestra la foto de la cuenta si hay sesión
  private updateAvatar() {
    if (!this.profile) return;
    const src =
      document.querySelector<HTMLImageElement>(
        'ytmusic-nav-bar ytmusic-settings-button img',
      )?.src ?? '';
    const current = this.profile.querySelector('img')?.src ?? '';
    if (src && src !== current) {
      const image = el('img');
      image.src = src;
      image.alt = '';
      this.profile.replaceChildren(image);
    } else if (!src && current) {
      this.profile.innerHTML = PERSON_ICON;
    }
  }

  // ---------- Menú del perfil ----------
  private toggleProfileMenu() {
    if (this.profileMenu?.classList.contains('open')) {
      this.closeProfileMenu();
      return;
    }
    if (!this.profile) return;
    if (!this.profileMenu) {
      this.profileMenu = el('div', 'lg-profile-menu');
      this.profileMenu.addEventListener('click', (event) =>
        event.stopPropagation(),
      );
      document.body.append(this.profileMenu);
    }
    this.renderProfileMenu();
    const rect = this.profile.getBoundingClientRect();
    this.profileMenu.style.top = `${Math.round(rect.bottom + 10)}px`;
    this.profileMenu.style.right = `${Math.round(
      Math.max(12, window.innerWidth - rect.right - 60),
    )}px`;
    requestAnimationFrame(() => this.profileMenu?.classList.add('open'));
  }

  private closeProfileMenu() {
    this.profileMenu?.classList.remove('open');
  }

  private renderProfileMenu() {
    if (!this.profileMenu) return;
    const rows: HTMLElement[] = [];
    const signedIn = isSignedIn();

    const header = el('div', 'lg-profile-header');
    const avatar = el('div', 'lg-profile-avatar');
    const image = this.profile?.querySelector('img');
    if (image) avatar.append(image.cloneNode());
    else avatar.innerHTML = PERSON_ICON;
    header.append(avatar);
    if (signedIn && this.accountName)
      header.append(el('div', 'lg-profile-name', this.accountName));
    rows.push(header);

    const addRow = (icon: string, label: string, action: () => void) => {
      const row = el('button', 'lg-profile-row');
      row.type = 'button';
      const iconElement = el('span', 'lg-profile-icon');
      iconElement.innerHTML = icon;
      row.append(iconElement, el('span', '', label));
      row.addEventListener('click', () => {
        this.closeProfileMenu();
        action();
      });
      rows.push(row);
    };

    if (signedIn) {
      // "Tu perfil", "Cambiar de cuenta" y "Cerrar sesión"; los ajustes están
      // en la cápsula de la página del perfil
      for (const icon of PROFILE_ICONS) {
        const entry = this.entries.find((item) => item.icon === icon);
        if (!entry) continue;
        const label =
          icon === 'ACCOUNT_BOX'
            ? this.labels.yourProfile
            : icon === 'EXIT_TO_APP'
              ? this.labels.signOut
              : entry.label;
        addRow(entry.svg, label, () => {
          if (icon === 'ACCOUNT_BOX' && entry.browseId)
            navigate(entry.browseId);
          else this.pressEntry(entry).catch(console.error);
        });
      }
    } else {
      addRow(SIGN_IN_ICON, this.labels.signIn, () => {
        document
          .querySelector<HTMLElement>('ytmusic-nav-bar .sign-in-link')
          ?.click();
      });
      addRow(GEAR_ICON, this.labels.settings, () => {
        if (this.profile)
          this.openSettings(this.profile.getBoundingClientRect());
      });
    }
    this.profileMenu.replaceChildren(...rows);
  }

  // ---------- Página del perfil: cápsula de pestañas ----------
  private updateProfilePage() {
    // La dirección puede ser /channel/<id> o /@<usuario>
    const id = this.channelId;
    const path = decodeURIComponent(location.pathname);
    const onProfile =
      isSignedIn() &&
      ((Boolean(id) && path.includes(id)) ||
        (Boolean(this.accountHandle) && path === `/${this.accountHandle}`));
    document.body.classList.toggle(PROFILE_PAGE_CLASS, onProfile);

    if (!onProfile) {
      this.profileTabs?.remove();
      this.profileTabs = null;
      return;
    }
    // Justo debajo del buscador, centrada con él
    const search = document
      .querySelector('ytmusic-nav-bar ytmusic-search-box')
      ?.getBoundingClientRect();
    if (search) {
      const half = search.width / 2;
      const center = search.left + half;
      document.body.style.setProperty(
        '--lg-tabs-top',
        `${Math.round(search.bottom + 10)}px`,
      );
      document.body.style.setProperty(
        '--lg-tabs-left',
        `${Math.round(center)}px`,
      );
    }
    if (this.profileTabs?.isConnected) return;

    const tabs = el('div', 'lg-profile-tabs');
    const addTab = (label: string, active: boolean, action: () => void) => {
      const tab = el('button', 'lg-profile-tab', label);
      tab.type = 'button';
      tab.classList.toggle('active', active);
      tab.addEventListener('click', (event) => {
        event.stopPropagation();
        action();
      });
      tabs.append(tab);
      return tab;
    };
    addTab(this.labels.tabProfile, true, () =>
      document
        .querySelector('ytmusic-app-layout')
        ?.scrollTo({ top: 0, behavior: 'smooth' }),
    );
    const plugins = addTab(this.labels.tabPlugins, false, () =>
      this.openSettings(plugins.getBoundingClientRect()),
    );
    addTab(this.labels.tabYouTube, false, () => {
      const entry = this.entries.find((item) => item.icon === 'SETTINGS');
      if (entry) this.pressEntry(entry).catch(console.error);
    });
    document.body.append(tabs);
    this.profileTabs = tabs;
  }

  // ---------- Opciones del menú ⋮ / cuenta ----------
  private async readEntries() {
    const trigger = menuTrigger();
    if (!trigger) return;
    this.reading = true;
    const signedIn = isSignedIn();
    document.body.classList.add(SILENT_MENU_CLASS);
    try {
      trigger.click();
      let dropdown: PolymerElement | undefined;
      for (let i = 0; i < 30 && !dropdown; i++) {
        await wait(50);
        dropdown = openDropdown();
      }
      if (!dropdown) return;
      // Los íconos se dibujan un poco después de abrir el menú
      for (
        let i = 0;
        i < 20 &&
        menuItems(dropdown).some((item) => !item.querySelector('yt-icon svg'));
        i++
      ) {
        await wait(50);
      }
      this.entries = menuItems(dropdown)
        .map((item) => ({
          label: item.textContent?.trim().replace(/\s+/g, ' ') ?? '',
          icon: item.data?.icon?.iconType ?? '',
          svg: item.querySelector('yt-icon svg')?.outerHTML ?? '',
          browseId:
            item.data?.navigationEndpoint?.browseEndpoint?.browseId ?? '',
        }))
        .filter((entry) => entry.label && !PREMIUM_ICONS.has(entry.icon));
      this.accountName =
        dropdown.querySelector('#account-name')?.textContent?.trim() ?? '';
      this.accountHandle =
        dropdown.querySelector('#channel-handle')?.textContent?.trim() ?? '';
      this.entriesSignedIn = signedIn;
      dropdown.close?.();
    } finally {
      await wait(250);
      document.body.classList.remove(SILENT_MENU_CLASS);
      this.reading = false;
    }
  }

  // Abre el menú original sin mostrarlo y pulsa la opción equivalente
  private async pressEntry(entry: MenuEntry) {
    const trigger = menuTrigger();
    if (!trigger) return;
    document.body.classList.add(SILENT_MENU_CLASS);
    try {
      trigger.click();
      for (let i = 0; i < 30; i++) {
        await wait(50);
        const dropdown = openDropdown();
        if (!dropdown) continue;
        const item = menuItems(dropdown).find(
          (candidate) => (candidate.data?.icon?.iconType ?? '') === entry.icon,
        );
        if (item) {
          (
            item.querySelector<HTMLElement>('a#endpoint, tp-yt-paper-item') ??
            item
          ).click();
          return;
        }
      }
    } finally {
      await wait(250);
      document.body.classList.remove(SILENT_MENU_CLASS);
    }
  }

  // ---------- Marcas en elementos de YouTube Music ----------
  // Ajustes de YouTube: solo General, Reproducción, Privacidad y datos, e
  // Idioma y ubicación (la configuración del canal va en la página del perfil)
  private markSettingsCategories() {
    const page = document.querySelector<
      HTMLElement & {
        data?: {
          items?: {
            settingCategoryCollectionRenderer?: { categoryId?: string };
          }[];
        };
      }
    >('ytmusic-settings-page');
    const categories = page?.data?.items ?? [];
    const items = page?.querySelectorAll(
      'tp-yt-paper-listbox tp-yt-paper-item',
    );
    items?.forEach((item, index) => {
      const id =
        categories[index]?.settingCategoryCollectionRenderer?.categoryId ?? '';
      item.classList.toggle('lg-setting-hidden', HIDDEN_SETTINGS.has(id));
    });
  }

  // ---------- Portadas de las playlists en el menú lateral ----------
  // Se piden a YouTube Music (la misma consulta que su página "Playlists"),
  // con la sesión de la app; se renuevan cada 10 minutos
  private async loadPlaylistThumbnails() {
    if (this.loadingThumbnails || !isSignedIn()) return;
    if (Date.now() - this.thumbnailsLoadedAt < 10 * 60 * 1000) return;
    this.loadingThumbnails = true;
    try {
      const app = document.querySelector<MusicPlayerAppElement>('ytmusic-app');
      const response = await app?.networkManager.fetch<
        unknown,
        { browseId: string }
      >('/browse?prettyPrint=false', { browseId: 'FEmusic_liked_playlists' });
      const thumbnails = new Map<string, string>();
      const walk = (node: unknown) => {
        if (!node || typeof node !== 'object') return;
        const item = (node as Record<string, unknown>)
          .musicTwoRowItemRenderer as
          | {
              navigationEndpoint?: { browseEndpoint?: { browseId?: string } };
              thumbnailRenderer?: {
                musicThumbnailRenderer?: {
                  thumbnail?: { thumbnails?: { url: string }[] };
                };
              };
            }
          | undefined;
        if (item) {
          const id = item.navigationEndpoint?.browseEndpoint?.browseId;
          const url =
            item.thumbnailRenderer?.musicThumbnailRenderer?.thumbnail
              ?.thumbnails?.[0]?.url;
          if (id && url) thumbnails.set(id, url);
          return;
        }
        for (const value of Object.values(node)) walk(value);
      };
      walk(response);
      this.playlistThumbnails = thumbnails;
      this.thumbnailsLoadedAt = Date.now();
    } catch (error) {
      console.error(error);
    } finally {
      this.loadingThumbnails = false;
    }
  }

  private addPlaylistThumbnail(element: PolymerElement, browseId: string) {
    const url = this.playlistThumbnails.get(browseId);
    const item = element.querySelector('tp-yt-paper-item');
    if (!url || !item) return;
    let image = item.querySelector<HTMLImageElement>('img.lg-guide-thumb');
    if (!image) {
      image = el('img', 'lg-guide-thumb');
      image.alt = '';
      item.prepend(image);
    }
    if (image.src !== url) image.src = url;
    element.classList.add('lg-playlist-entry');
  }

  // Premium oculto y la "Biblioteca" del menú lateral con el ícono de libros
  private markEntries() {
    this.markSettingsCategories();
    this.loadPlaylistThumbnails().catch(console.error);
    const selectors = [
      'ytmusic-guide-entry-renderer',
      'ytd-compact-link-renderer',
      'ytmusic-menu-navigation-item-renderer',
      'ytmusic-menu-service-item-renderer',
    ].join(',');
    for (const element of document.querySelectorAll<PolymerElement>(
      selectors,
    )) {
      const icon = element.data?.icon?.iconType ?? '';
      // La página de Premium de YouTube Music es "SPunlimited"
      const browseId =
        element.data?.navigationEndpoint?.browseEndpoint?.browseId ?? '';
      element.classList.toggle(
        'lg-premium-hidden',
        PREMIUM_ICONS.has(icon) || browseId === 'SPunlimited',
      );
      element.classList.toggle(
        'lg-library-entry',
        browseId === 'FEmusic_library_landing',
      );
      if (
        element.tagName === 'YTMUSIC-GUIDE-ENTRY-RENDERER' &&
        browseId.startsWith('VL')
      )
        this.addPlaylistThumbnail(element, browseId);
    }
  }
}

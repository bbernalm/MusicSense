/*
 * Barra superior y menú lateral:
 * - dos cápsulas (atrás / adelante) a la izquierda del buscador;
 * - botón de perfil a la derecha del buscador con un menú de vidrio:
 *   cuenta (si hay sesión), "Acceder" (si no) y los ajustes de MusicSense;
 * - las opciones del menú ⋮ de YouTube Music (Configuración, Condiciones,
 *   Ayuda, Enviar comentarios) pasan al final del menú lateral;
 * - sin menciones a YouTube Music Premium.
 *
 * Los menús de YouTube Music se leen y se pulsan "por dentro": se abren con
 * la clase lg-silent-menu (invisibles), se busca la opción por su ícono y se
 * pulsa, así que hacen exactamente lo mismo que el original.
 */

const SILENT_MENU_CLASS = 'lg-silent-menu';

// Íconos de YouTube Music que se consideran publicidad de Premium
const PREMIUM_ICONS = new Set([
  'UNLIMITED',
  'YOUTUBE_MUSIC_PREMIUM',
  'PREMIUM',
]);

// Opciones generales del menú de la cuenta / ⋮ que van al menú lateral
const GENERAL_ICONS = new Set(['SETTINGS', 'PRIVACY_INFO', 'HELP', 'FEEDBACK']);

const BACK_ICON =
  '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const FORWARD_ICON =
  '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const PERSON_ICON =
  '<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><circle cx="12" cy="8.5" r="4" fill="currentColor"/><path d="M4.5 20c.8-3.8 4-6 7.5-6s6.7 2.2 7.5 6" fill="currentColor"/></svg>';
const GEAR_ICON =
  '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" d="M10.3 3.2h3.4l.5 2.4c.6.2 1.1.5 1.6.9l2.3-.8 1.7 2.9-1.8 1.6c.1.6.1 1.2 0 1.8l1.8 1.6-1.7 2.9-2.3-.8c-.5.4-1 .7-1.6.9l-.5 2.4h-3.4l-.5-2.4c-.6-.2-1.1-.5-1.6-.9l-2.3.8-1.7-2.9 1.8-1.6a6 6 0 0 1 0-1.8L4.2 8.6l1.7-2.9 2.3.8c.5-.4 1-.7 1.6-.9Z"/><circle cx="12" cy="12" r="2.8" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>';
const SIGN_IN_ICON =
  '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M10 17l5-5-5-5M15 12H3M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';

type MenuEntry = {
  label: string;
  icon: string;
  svg: string;
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
  profile: string;
  signIn: string;
  settings: string;
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

const isSignedIn = () =>
  Boolean(document.querySelector('ytmusic-nav-bar ytmusic-settings-button'));

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
  private arrows: HTMLDivElement | null = null;
  private profile: HTMLButtonElement | null = null;
  private profileMenu: HTMLDivElement | null = null;
  private guideExtra: HTMLDivElement | null = null;
  private entries: MenuEntry[] = [];
  private entriesSignedIn: boolean | null = null;
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
      this.arrows,
      this.profile,
      this.profileMenu,
      this.guideExtra,
    ]) {
      element?.remove();
    }
    this.arrows = null;
    this.profile = null;
    this.profileMenu = null;
    this.guideExtra = null;
  }

  private tick() {
    this.ensureNavControls();
    this.updateAvatar();
    this.hidePremium();

    // Lee las opciones del menú de YouTube Music al empezar y al cambiar la sesión
    if (this.entriesSignedIn !== isSignedIn() && !this.reading) {
      this.readEntries().catch(console.error);
    }
    this.ensureGuideExtra();
  }

  // ---------- Cápsulas atrás/adelante y botón de perfil ----------
  private ensureNavControls() {
    const search = document.querySelector<HTMLElement>(
      'ytmusic-nav-bar .center-content ytmusic-search-box',
    );
    if (!search) return;

    if (!this.arrows?.isConnected) {
      const arrows = el('div', 'lg-nav-arrows');
      for (const [icon, label, action] of [
        [BACK_ICON, this.labels.back, () => history.back()],
        [FORWARD_ICON, this.labels.forward, () => history.forward()],
      ] as const) {
        const button = el('button', 'lg-nav-capsule');
        button.type = 'button';
        button.title = label;
        button.setAttribute('aria-label', label);
        button.innerHTML = icon;
        button.addEventListener('click', action);
        arrows.append(button);
      }
      search.before(arrows);
      this.arrows = arrows;
    }

    if (!this.profile?.isConnected) {
      const profile = el('button', 'lg-profile-button');
      profile.type = 'button';
      profile.title = this.labels.profile;
      profile.setAttribute('aria-label', this.labels.profile);
      profile.innerHTML = PERSON_ICON;
      profile.addEventListener('click', (event) => {
        event.stopPropagation();
        this.toggleProfileMenu();
      });
      search.after(profile);
      this.profile = profile;
    }
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
    const menu = this.profileMenu;
    const rows: HTMLElement[] = [];
    const signedIn = isSignedIn();

    const header = el('div', 'lg-profile-header');
    const avatar = el('div', 'lg-profile-avatar');
    const image = this.profile?.querySelector('img');
    if (image) avatar.append(image.cloneNode());
    else avatar.innerHTML = PERSON_ICON;
    header.append(avatar);
    rows.push(header);

    const addRow = (svg: string, label: string, action: () => void) => {
      const row = el('button', 'lg-profile-row');
      row.type = 'button';
      const icon = el('span', 'lg-profile-icon');
      icon.innerHTML = svg;
      row.append(icon, el('span', '', label));
      row.addEventListener('click', () => {
        this.closeProfileMenu();
        action();
      });
      rows.push(row);
    };

    if (!signedIn) {
      addRow(SIGN_IN_ICON, this.labels.signIn, () => {
        document
          .querySelector<HTMLElement>('ytmusic-nav-bar .sign-in-link')
          ?.click();
      });
    } else {
      // Opciones de la cuenta de YouTube Music (las generales están en el menú lateral)
      for (const entry of this.entries.filter(
        (item) => !GENERAL_ICONS.has(item.icon),
      )) {
        addRow(entry.svg, entry.label, () => {
          this.pressEntry(entry).catch(console.error);
        });
      }
    }

    addRow(GEAR_ICON, this.labels.settings, () => {
      if (this.profile) this.openSettings(this.profile.getBoundingClientRect());
    });
    menu.replaceChildren(...rows);
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
        }))
        .filter((entry) => entry.label && !PREMIUM_ICONS.has(entry.icon));
      this.entriesSignedIn = signedIn;
      dropdown.close?.();
      this.guideExtra?.remove();
      this.guideExtra = null;
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
          (candidate) =>
            (candidate.data?.icon?.iconType ?? '') === entry.icon &&
            candidate.textContent?.trim().replace(/\s+/g, ' ') === entry.label,
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

  // Opciones generales al final del menú lateral
  private ensureGuideExtra() {
    if (this.guideExtra?.isConnected) return;
    // Dentro de la lista de secciones, empujadas al fondo de la tarjeta
    const guide = document.querySelector('#guide-renderer #sections');
    const general = this.entries.filter((entry) =>
      GENERAL_ICONS.has(entry.icon),
    );
    if (!guide || general.length === 0) return;

    const extra = el('div', 'lg-guide-extra');
    for (const entry of general) {
      const row = el('button', 'lg-guide-extra-row');
      row.type = 'button';
      const icon = el('span', 'lg-guide-extra-icon');
      icon.innerHTML = entry.svg;
      row.append(icon, el('span', 'lg-guide-extra-label', entry.label));
      row.addEventListener('click', () => {
        this.pressEntry(entry).catch(console.error);
      });
      extra.append(row);
    }
    guide.append(extra);
    this.guideExtra = extra;
  }

  // ---------- Sin publicidad de Premium ----------
  private hidePremium() {
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
    }
  }
}

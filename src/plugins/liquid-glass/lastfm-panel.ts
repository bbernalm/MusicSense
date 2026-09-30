/*
 * Pestaña "Last.fm" del panel de ajustes (settings.ts). Habla con lastfm.ts
 * (proceso principal) por IPC:
 * - Sin conectar: "Autorizar en Last.fm" (recomendado) o usuario y contraseña.
 * - Conectado: foto, nombre y escuchas, ver perfil, desconectar y opciones.
 * - Avanzado: clave de API propia.
 */

type Invoke = (channel: string, ...args: unknown[]) => Promise<unknown>;
type Translate = (key: string, vars?: Record<string, unknown>) => string;

type Options = {
  scrobble: boolean;
  nowPlaying: boolean;
  otherMedia: boolean;
  alternativeTitles: boolean;
  alternativeArtist: boolean;
};

type State = {
  connected: boolean;
  user: string;
  image: string;
  playcount: number;
  options: Options;
  customKey: boolean;
  apiKey: string;
  pending: number;
};

type Result = { ok: boolean; error?: number };

const OPTIONS: { key: keyof Options; desc?: boolean }[] = [
  { key: 'scrobble' },
  { key: 'nowPlaying' },
  { key: 'otherMedia' },
  { key: 'alternativeTitles', desc: true },
  { key: 'alternativeArtist', desc: true },
];

// Logo de Last.fm simplificado (círculo rojo con "fm")
const LOGO =
  '<svg viewBox="0 0 48 48" width="44" height="44" aria-hidden="true"><circle cx="24" cy="24" r="24" fill="#d51007"/><text x="24" y="30.5" text-anchor="middle" font-family="Inter, Arial, sans-serif" font-size="17" font-weight="800" fill="#fff">fm</text></svg>';

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

export class LastFmView {
  private busy = false;
  private error = '';
  private advanced = false;
  // Se conserva al volver a dibujar (p. ej. tras un error)
  private userName = '';

  constructor(
    private readonly tr: Translate,
    private readonly invoke: Invoke,
    // Vuelve a dibujar la pestaña (settings.ts)
    private readonly refresh: () => void,
  ) {}

  async render() {
    const state = (await this.invoke('liquid-glass:lastfm-state').catch(
      () => null,
    )) as State | null;
    const fragment = document.createDocumentFragment();
    if (!state) {
      fragment.append(el('div', 'lg-settings-empty', this.tr('error.0')));
      return fragment;
    }
    if (state.connected) fragment.append(this.account(state));
    else fragment.append(...this.connect());
    fragment.append(...this.options(state), ...this.apiKey(state));
    return fragment;
  }

  private errorText(code?: number) {
    const known = [-2, 0, 4, 10, 11, 16, 26, 29];
    if (code === 16) return this.tr('error.11');
    if (code === 26) return this.tr('error.10');
    return known.includes(code ?? 0)
      ? this.tr(`error.${code ?? 0}`)
      : this.tr('error.other', { code });
  }

  private async run(action: () => Promise<unknown>) {
    if (this.busy) return;
    this.busy = true;
    this.error = '';
    this.refresh();
    const result = (await action().catch(() => ({
      ok: false,
      error: 0,
    }))) as Result | undefined;
    this.busy = false;
    // -1: la ventana de autorización ya estaba abierta
    if (result && !result.ok && result.error !== -1)
      this.error = this.errorText(result.error);
    this.refresh();
  }

  // ---------- Sin conectar ----------
  private connect() {
    const intro = el('div', 'lg-lastfm-hero');
    const logo = el('span', 'lg-lastfm-logo');
    logo.innerHTML = LOGO;
    const text = el('div', 'lg-settings-text');
    text.append(
      el('div', 'lg-settings-label', 'Last.fm'),
      el('div', 'lg-settings-desc', this.tr('intro')),
    );
    intro.append(logo, text);

    const card = el('div', 'lg-settings-card');
    card.append(intro);
    const authorize = el('div', 'lg-settings-row clickable');
    const label = el('div', 'lg-settings-text');
    label.append(
      el(
        'div',
        'lg-settings-label',
        this.busy ? this.tr('waiting') : this.tr('authorize'),
      ),
      el('div', 'lg-settings-desc', this.tr('authorize-desc')),
    );
    authorize.append(
      label,
      el('span', 'lg-lastfm-badge', this.tr('recommended')),
    );
    authorize.classList.toggle('disabled', this.busy);
    authorize.addEventListener('click', () =>
      this.run(() => this.invoke('liquid-glass:lastfm-authorize')),
    );
    card.append(authorize);

    // Usuario y contraseña (la contraseña no se guarda)
    const form = el('form', 'lg-lastfm-form');
    const user = el('input', 'lg-lastfm-input');
    user.placeholder = this.tr('user');
    user.autocomplete = 'username';
    user.spellcheck = false;
    user.value = this.userName;
    const password = el('input', 'lg-lastfm-input');
    password.type = 'password';
    password.placeholder = this.tr('password');
    password.autocomplete = 'current-password';
    const submit = el('button', 'lg-lastfm-button primary', this.tr('login'));
    submit.type = 'submit';
    submit.disabled = this.busy;
    form.append(user, password, submit);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      this.userName = user.value.trim();
      const secret = password.value;
      password.value = '';
      this.run(() =>
        this.invoke('liquid-glass:lastfm-login', this.userName, secret),
      ).catch(console.error);
    });
    const loginCard = el('div', 'lg-settings-card');
    loginCard.append(form);

    const parts: Node[] = [
      card,
      el('div', 'lg-settings-section', this.tr('or-login')),
      loginCard,
    ];
    if (this.error) parts.push(el('div', 'lg-lastfm-error', this.error));
    return parts;
  }

  // ---------- Conectado ----------
  private account(state: State) {
    const card = el('div', 'lg-settings-card lg-lastfm-account');
    if (state.image) {
      const image = el('img', 'lg-lastfm-avatar');
      image.src = state.image;
      image.alt = '';
      card.append(image);
    } else {
      const logo = el('span', 'lg-lastfm-logo');
      logo.innerHTML = LOGO;
      card.append(logo);
    }
    const text = el('div', 'lg-settings-text');
    text.append(
      el('div', 'lg-lastfm-name', state.user),
      el(
        'div',
        'lg-settings-desc',
        this.tr('scrobbles', { count: state.playcount.toLocaleString() }),
      ),
    );
    const profile = el('button', 'lg-lastfm-button', this.tr('profile'));
    profile.type = 'button';
    profile.addEventListener('click', () => {
      this.invoke('liquid-glass:lastfm-open-profile').catch(console.error);
    });
    const logout = el('button', 'lg-lastfm-button danger', this.tr('logout'));
    logout.type = 'button';
    logout.addEventListener('click', () =>
      this.run(() => this.invoke('liquid-glass:lastfm-logout')),
    );
    card.append(text, profile, logout);
    return card;
  }

  // ---------- Opciones ----------
  private options(state: State) {
    const card = el('div', 'lg-settings-card');
    for (const { key, desc } of OPTIONS) {
      const row = el('div', 'lg-settings-row clickable');
      const text = el('div', 'lg-settings-text');
      text.append(el('div', 'lg-settings-label', this.tr(`option.${key}`)));
      if (desc)
        text.append(
          el('div', 'lg-settings-desc', this.tr(`option.${key}-desc`)),
        );
      const toggle = el('button', 'lg-switch');
      toggle.type = 'button';
      toggle.setAttribute('role', 'switch');
      toggle.setAttribute('aria-checked', String(state.options[key]));
      toggle.append(el('span'));
      row.append(text, toggle);
      row.addEventListener('click', () => {
        const next = toggle.getAttribute('aria-checked') !== 'true';
        toggle.setAttribute('aria-checked', String(next));
        this.invoke('liquid-glass:lastfm-options', { [key]: next }).catch(
          console.error,
        );
      });
      card.append(row);
    }
    const parts: Node[] = [
      el('div', 'lg-settings-section', this.tr('options')),
      card,
    ];
    if (state.pending)
      parts.push(
        el(
          'div',
          'lg-lastfm-note',
          this.tr('pending', { count: state.pending }),
        ),
      );
    return parts;
  }

  // ---------- Avanzado: clave de API propia ----------
  private apiKey(state: State) {
    const card = el('div', 'lg-settings-card');
    const row = el('div', 'lg-settings-row clickable');
    const text = el('div', 'lg-settings-text');
    text.append(el('div', 'lg-settings-label', this.tr('api-key')));
    row.append(
      text,
      el(
        'span',
        'lg-settings-value',
        state.customKey ? this.tr('api-custom') : this.tr('api-default'),
      ),
    );
    row.addEventListener('click', () => {
      this.advanced = !this.advanced;
      this.refresh();
    });
    card.append(row);

    if (this.advanced) {
      const form = el('form', 'lg-lastfm-form');
      form.append(el('div', 'lg-settings-desc', this.tr('api-desc')));
      const key = el('input', 'lg-lastfm-input');
      key.placeholder = this.tr('api-key-field');
      key.value = state.apiKey;
      key.spellcheck = false;
      const secret = el('input', 'lg-lastfm-input');
      secret.type = 'password';
      secret.placeholder = this.tr('api-secret-field');
      const buttons = el('div', 'lg-lastfm-buttons');
      const save = el('button', 'lg-lastfm-button primary', this.tr('save'));
      save.type = 'submit';
      const reset = el('button', 'lg-lastfm-button', this.tr('api-reset'));
      reset.type = 'button';
      reset.addEventListener('click', () =>
        this.run(() => this.invoke('liquid-glass:lastfm-api-key', '', '')),
      );
      buttons.append(save, reset);
      form.append(key, secret, buttons);
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        if (!key.value.trim() || !secret.value.trim()) return;
        this.run(() =>
          this.invoke('liquid-glass:lastfm-api-key', key.value, secret.value),
        ).catch(console.error);
      });
      card.append(form);
    }
    return [el('div', 'lg-settings-section', this.tr('advanced')), card];
  }
}

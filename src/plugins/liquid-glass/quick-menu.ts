/*
 * Ajustes rápidos: botón (deslizadores) en la cápsula, junto al volumen y
 * las letras. Abre hacia arriba un panel de vidrio, como el del volumen, con:
 * - Sonido: ecualizador, fundido, audio espacial, estéreo amplio y sala.
 * - Reproductor: estilo del fondo, fondo animado y traducir letras.
 * - "Más ajustes": abre el panel de configuración completo.
 *
 * Las opciones son las del menú de nuestro complemento (se pulsan igual que
 * en settings.ts: liquid-glass:menu-click); se buscan por su texto traducido.
 */

type Invoke = (channel: string, ...args: unknown[]) => Promise<unknown>;

type MenuNode = {
  label: string;
  type: 'normal' | 'separator' | 'submenu' | 'checkbox' | 'radio';
  commandId: number;
  checked?: boolean;
  submenu?: { items: MenuNode[] };
};

export type QuickMenuLabels = {
  button: string;
  sound: string;
  player: string;
  more: string;
  ownPlugin: string;
  // Textos de las opciones del menú, en el orden en que se muestran
  soundItems: string[];
  playerItems: string[];
};

const ICON =
  '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/></g></svg>';

const BUTTON_CLASS = 'lg-quick-button';

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

export class QuickMenu {
  private button: HTMLButtonElement | null = null;
  private panel: HTMLDivElement | null = null;
  private timer: number | null = null;
  private readonly onDocumentDown = (event: PointerEvent) => {
    const target = event.target as Node;
    if (this.panel?.contains(target) || this.button?.contains(target)) return;
    this.close();
  };
  private readonly onKey = (event: KeyboardEvent) => {
    if (event.key === 'Escape') this.close();
  };
  private readonly onResize = () => this.close();

  constructor(
    private readonly labels: QuickMenuLabels,
    private readonly invoke: Invoke,
    private readonly openSettings: () => void,
  ) {}

  start() {
    const panel = el('div', 'lg-quick-menu');
    panel.setAttribute('role', 'dialog');
    document.body.append(panel);
    this.panel = panel;
    // YouTube Music puede volver a crear la barra: se revisa periódicamente
    this.timer = window.setInterval(() => this.attach(), 500);
    this.attach();
    document.addEventListener('pointerdown', this.onDocumentDown, true);
    window.addEventListener('keydown', this.onKey);
    window.addEventListener('resize', this.onResize);
  }

  stop() {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
    document.removeEventListener('pointerdown', this.onDocumentDown, true);
    window.removeEventListener('keydown', this.onKey);
    window.removeEventListener('resize', this.onResize);
    this.button?.remove();
    this.button = null;
    this.panel?.remove();
    this.panel = null;
  }

  private attach() {
    if (this.button?.isConnected) return;
    // En la cápsula, después del botón de letras
    const container = document.querySelector<HTMLElement>(
      'ytmusic-player-bar .right-controls-buttons',
    );
    if (!container) return;
    const button = el('button', `lg-icon-button ${BUTTON_CLASS}`);
    button.type = 'button';
    button.title = this.labels.button;
    button.setAttribute('aria-label', this.labels.button);
    button.innerHTML = ICON;
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      if (this.isOpen()) this.close();
      else this.open().catch(console.error);
    });
    const lyrics = container.querySelector('.lg-lyrics-button');
    if (lyrics) lyrics.after(button);
    else container.append(button);
    this.button = button;
  }

  private isOpen() {
    return this.panel?.classList.contains('visible') ?? false;
  }

  private close() {
    this.panel?.classList.remove('visible');
    this.button?.classList.remove('active');
  }

  private async open() {
    if (!this.panel || !this.button) return;
    await this.render();
    // Encima del botón, centrado y sin salirse de la ventana
    const rect = this.button.getBoundingClientRect();
    const width = this.panel.offsetWidth;
    const halfButton = rect.width / 2;
    const center = rect.left + halfButton;
    const halfPanel = width / 2;
    const maxLeft = window.innerWidth - width - 12;
    const left = Math.min(maxLeft, Math.max(12, center - halfPanel));
    this.panel.style.left = `${Math.round(left)}px`;
    this.panel.style.top = `${Math.round(rect.top)}px`;
    // El rebote sale desde el botón
    const origin = center - left;
    this.panel.style.transformOrigin = `${Math.round(origin)}px 100%`;
    this.panel.scrollTop = 0;
    this.panel.classList.add('visible');
    this.button.classList.add('active');
  }

  // Opciones de nuestro complemento en el menú de la app
  private async ownItems() {
    const menu = (await this.invoke('liquid-glass:get-menu')) as {
      items?: MenuNode[];
    } | null;
    const plugins = menu?.items?.[0]?.submenu?.items ?? [];
    const own = plugins.find((item) => item.label === this.labels.ownPlugin);
    return own?.submenu?.items ?? [];
  }

  private async render() {
    if (!this.panel) return;
    const items = await this.ownItems();
    const byLabel = (label: string) =>
      items.find((item) => item.label === label);

    const section = (title: string, labels: string[]) => {
      const nodes = labels
        .map(byLabel)
        .filter((node): node is MenuNode => Boolean(node));
      if (!nodes.length) return [];
      const card = el('div', 'lg-quick-card');
      for (const node of nodes) card.append(this.renderItem(node));
      return [el('div', 'lg-quick-title', title), card];
    };

    const more = el('button', 'lg-quick-more', this.labels.more);
    more.type = 'button';
    more.addEventListener('click', () => {
      this.close();
      this.openSettings();
    });

    this.panel.replaceChildren(
      ...section(this.labels.sound, this.labels.soundItems),
      ...section(this.labels.player, this.labels.playerItems),
      more,
    );
  }

  private async press(node: MenuNode) {
    await this.invoke('liquid-glass:menu-click', node.commandId);
    // Pear reconstruye el menú: se vuelve a leer para ver el estado real
    window.setTimeout(() => this.render().catch(console.error), 150);
  }

  private renderItem(node: MenuNode) {
    if (node.type === 'checkbox') {
      const row = el('div', 'lg-quick-row clickable');
      row.append(el('span', 'lg-quick-label', node.label));
      const toggle = el('button', 'lg-switch');
      toggle.type = 'button';
      toggle.setAttribute('role', 'switch');
      toggle.setAttribute('aria-checked', String(Boolean(node.checked)));
      toggle.append(el('span'));
      row.append(toggle);
      row.addEventListener('click', () => {
        toggle.setAttribute(
          'aria-checked',
          String(toggle.getAttribute('aria-checked') !== 'true'),
        );
        this.press(node).catch(console.error);
      });
      return row;
    }

    // Opciones de una lista (ecualizador, fundido, sala, fondo): fichas
    const block = el('div', 'lg-quick-block');
    block.append(el('span', 'lg-quick-label', node.label));
    const chips = el('div', 'lg-quick-chips');
    for (const option of node.submenu?.items ?? []) {
      if (option.type !== 'radio') continue;
      const chip = el('button', 'lg-quick-chip', option.label);
      chip.type = 'button';
      chip.classList.toggle('active', Boolean(option.checked));
      chip.addEventListener('click', () => {
        if (option.checked) return;
        chips
          .querySelectorAll('.lg-quick-chip')
          .forEach((other) => other.classList.toggle('active', other === chip));
        this.press(option).catch(console.error);
      });
      chips.append(chip);
    }
    block.append(chips);
    return block;
  }
}

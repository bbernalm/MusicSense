/*
 * Ajustes rápidos: botón (deslizadores) en la cápsula, junto al volumen y
 * las letras. Abre hacia arriba un panel de vidrio, como el del volumen, con:
 * - Sonido: ecualizador, fundido, audio espacial, estéreo amplio y sala.
 * - Reproductor: estilo del fondo, fondo animado, visualizador y traducir
 *   letras.
 * Las listas (ecualizador, fundido, sala, fondo) son una fila con la opción
 * elegida que abre un desplegable al lado del panel.
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

const CHEVRON =
  '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const CHECK =
  '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

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
  // Desplegable con las opciones de una lista (ecualizador, fundido...)
  private flyout: HTMLDivElement | null = null;
  private flyoutFor = '';
  private timer: number | null = null;
  private readonly onDocumentDown = (event: PointerEvent) => {
    const target = event.target as Node;
    if (this.flyout?.contains(target)) return;
    if (this.panel?.contains(target)) {
      // Clic en el panel fuera de la fila abierta: se cierra el desplegable
      if (!(target as Element).closest?.('.lg-quick-row.open'))
        this.closeFlyout();
      return;
    }
    if (this.button?.contains(target)) return;
    this.close();
  };
  private readonly onKey = (event: KeyboardEvent) => {
    if (event.key !== 'Escape') return;
    if (this.flyout?.classList.contains('visible')) this.closeFlyout();
    else this.close();
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
    const flyout = el('div', 'lg-quick-flyout');
    document.body.append(panel, flyout);
    this.panel = panel;
    this.flyout = flyout;
    // Al desplazar el panel, el desplegable ya no estaría junto a su fila
    panel.addEventListener('scroll', () => this.closeFlyout());
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
    this.flyout?.remove();
    this.flyout = null;
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
    this.closeFlyout();
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

    // Opciones de una lista (ecualizador, fundido, sala, fondo): fila con la
    // opción elegida que abre un desplegable al lado del panel
    const options = (node.submenu?.items ?? []).filter(
      (option) => option.type === 'radio',
    );
    const selected = options.find((option) => option.checked);
    const row = el('div', 'lg-quick-row clickable lg-quick-select');
    row.classList.toggle('open', this.flyoutFor === node.label);
    row.append(
      el('span', 'lg-quick-label', node.label),
      el('span', 'lg-quick-value', selected?.label ?? ''),
    );
    const chevron = el('span', 'lg-quick-chevron');
    chevron.innerHTML = CHEVRON;
    row.append(chevron);
    row.addEventListener('click', () => {
      if (this.flyoutFor === node.label) this.closeFlyout();
      else this.openFlyout(row, node.label, options);
    });
    return row;
  }

  private openFlyout(row: HTMLElement, label: string, options: MenuNode[]) {
    const flyout = this.flyout;
    const panel = this.panel;
    if (!flyout || !panel) return;
    this.panel
      ?.querySelectorAll('.lg-quick-row.open')
      .forEach((other) => other.classList.remove('open'));
    row.classList.add('open');
    this.flyoutFor = label;

    flyout.replaceChildren(
      ...options.map((option) => {
        const item = el('button', 'lg-quick-option');
        item.type = 'button';
        item.append(el('span', '', option.label));
        const mark = el('span', 'lg-quick-check');
        if (option.checked) mark.innerHTML = CHECK;
        item.append(mark);
        item.addEventListener('click', () => {
          this.closeFlyout();
          if (option.checked) return;
          // Respuesta inmediata en la fila; el estado real llega al releer
          const value = row.querySelector('.lg-quick-value');
          if (value) value.textContent = option.label;
          this.press(option).catch(console.error);
        });
        return item;
      }),
    );

    // A la derecha del panel; si no cabe, a la izquierda. Alineado con la
    // fila y sin salirse por abajo
    const panelRect = panel.getBoundingClientRect();
    const rowRect = row.getBoundingClientRect();
    flyout.classList.add('measure');
    const width = flyout.offsetWidth;
    const height = flyout.offsetHeight;
    flyout.classList.remove('measure');
    const gap = 10;
    const right = panelRect.right + gap;
    const fitsRight = right + width <= window.innerWidth - 12;
    const left = fitsRight ? right : panelRect.left - gap - width;
    const bottomLimit = window.innerHeight - height - 12;
    const top = Math.max(12, Math.min(rowRect.top - 6, bottomLimit));
    flyout.style.left = `${Math.round(left)}px`;
    flyout.style.top = `${Math.round(top)}px`;
    flyout.classList.toggle('left', !fitsRight);
    flyout.classList.add('visible');
  }

  private closeFlyout() {
    this.flyoutFor = '';
    this.flyout?.classList.remove('visible');
    this.panel
      ?.querySelectorAll('.lg-quick-row.open')
      .forEach((row) => row.classList.remove('open'));
  }
}

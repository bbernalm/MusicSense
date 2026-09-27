/*
 * Panel de configuración (botón de engranaje de la barra superior).
 * Dibuja el menú de la aplicación (Plugins, Options, View, Navigation, About)
 * como un panel de vidrio con interruptores:
 * - una pestaña por menú;
 * - en "Plugins": buscador, complementos activados y disponibles por separado,
 *   interruptor para activarlos y sus opciones desplegables;
 * - casillas → interruptores, radios → lista con marca, submenús → grupos.
 * Los cambios se aplican pulsando la opción real del menú (backend.ts), así
 * que funciona igual que el menú original.
 */

type MenuNode = {
  label: string;
  type: 'normal' | 'separator' | 'submenu' | 'checkbox' | 'radio';
  commandId: number;
  checked?: boolean;
  visible?: boolean;
  enabled?: boolean;
  toolTip?: string;
  sublabel?: string;
  submenu?: { items: MenuNode[] };
};

export type SettingsLabels = {
  title: string;
  search: string;
  enabled: string;
  available: string;
  empty: string;
  // Pestaña propia con las opciones de nuestro complemento
  general: string;
  ownPlugin: string;
};

type Tab = {
  label: string;
  kind: 'plugins' | 'items';
  items: MenuNode[];
};

type Invoke = (channel: string, ...args: unknown[]) => Promise<unknown>;

const CHEVRON =
  '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const CHECK =
  '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

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

const isVisible = (node: MenuNode) => node.visible !== false;

// Un complemento sin opciones es una casilla; con opciones, un submenú cuya
// primera casilla es "Enabled"
const pluginToggle = (node: MenuNode) =>
  node.type === 'checkbox'
    ? node
    : node.submenu?.items.find((item) => item.type === 'checkbox');

const pluginOptions = (node: MenuNode) => {
  if (node.type !== 'submenu') return [];
  const toggle = pluginToggle(node);
  const items = (node.submenu?.items ?? []).filter((item) => item !== toggle);
  while (items[0]?.type === 'separator') items.shift();
  return items;
};

export class SettingsPanel {
  private overlay: HTMLDivElement | null = null;
  private panel: HTMLDivElement | null = null;
  private body: HTMLDivElement | null = null;
  private tabs: HTMLDivElement | null = null;
  private search: HTMLInputElement | null = null;
  private menu: Tab[] = [];
  private tab = 0;
  private query = '';
  private readonly expanded = new Set<string>();
  private readonly onKey = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && this.isOpen()) this.close();
  };

  constructor(
    private readonly labels: SettingsLabels,
    private readonly invoke: Invoke,
  ) {}

  start() {
    const overlay = el('div', 'lg-settings-overlay');
    overlay.addEventListener('click', () => this.close());

    const panel = el('div', 'lg-settings');
    panel.setAttribute('role', 'dialog');
    panel.addEventListener('click', (event) => event.stopPropagation());

    const header = el('div', 'lg-settings-header');
    header.append(el('div', 'lg-settings-title', this.labels.title));
    const tabs = el('div', 'lg-settings-tabs');
    header.append(tabs);

    const search = el('input', 'lg-settings-search');
    search.type = 'search';
    search.placeholder = this.labels.search;
    search.addEventListener('input', () => {
      this.query = search.value.trim().toLowerCase();
      this.renderBody();
    });
    header.append(search);

    const body = el('div', 'lg-settings-body');
    panel.append(header, body);
    overlay.append(panel);
    document.body.append(overlay);

    this.overlay = overlay;
    this.panel = panel;
    this.tabs = tabs;
    this.search = search;
    this.body = body;
    window.addEventListener('keydown', this.onKey);
  }

  stop() {
    window.removeEventListener('keydown', this.onKey);
    this.overlay?.remove();
    this.overlay = null;
    this.panel = null;
    this.body = null;
    this.tabs = null;
    this.search = null;
  }

  isOpen() {
    return this.overlay?.classList.contains('open') ?? false;
  }

  // Abre el panel bajo el botón que lo llamó (o lo cierra si ya está abierto)
  async toggle(anchor: DOMRect) {
    if (!this.overlay || !this.panel) return;
    if (this.isOpen()) {
      this.close();
      return;
    }
    const right = Math.max(12, window.innerWidth - anchor.right - 8);
    const top = anchor.bottom + 10;
    this.panel.style.top = `${Math.round(top)}px`;
    this.panel.style.right = `${Math.round(right)}px`;
    // Termina por encima del reproductor flotante (unos 100 px de alto)
    this.panel.style.maxHeight = `${Math.max(240, Math.round(window.innerHeight - top - 100))}px`;
    await this.refresh();
    this.overlay.classList.add('open');
  }

  close() {
    this.overlay?.classList.remove('open');
  }

  private async refresh() {
    const menu = (await this.invoke('liquid-glass:get-menu')) as {
      items?: MenuNode[];
    } | null;
    const top = (menu?.items ?? []).filter(
      (item) => isVisible(item) && item.type === 'submenu',
    );

    // 1.ª pestaña: opciones de MusicSense (las de nuestro complemento);
    // 2.ª: Plugins; después el resto de menús de la app
    const [plugins, ...rest] = top;
    const own = plugins?.submenu?.items.find(
      (item) => item.label === this.labels.ownPlugin,
    );
    const tabs: Tab[] = [];
    if (own?.type === 'submenu') {
      tabs.push({
        label: this.labels.general,
        kind: 'items',
        items: pluginOptions(own),
      });
    }
    if (plugins) {
      tabs.push({
        label: plugins.label,
        kind: 'plugins',
        items: plugins.submenu?.items ?? [],
      });
    }
    for (const item of rest) {
      tabs.push({
        label: item.label,
        kind: 'items',
        items: item.submenu?.items ?? [],
      });
    }
    this.menu = tabs;
    if (this.tab >= this.menu.length) this.tab = 0;
    this.renderTabs();
    this.renderBody();
  }

  // Pulsa la opción real del menú y vuelve a leerlo (Pear lo reconstruye)
  private async press(node: MenuNode, closeAfter = false) {
    if (node.enabled === false) return;
    await this.invoke('liquid-glass:menu-click', node.commandId);
    if (closeAfter) {
      this.close();
      return;
    }
    window.setTimeout(() => this.refresh().catch(console.error), 150);
  }

  private renderTabs() {
    if (!this.tabs) return;
    this.tabs.replaceChildren(
      ...this.menu.map((item, index) => {
        const button = el('button', 'lg-settings-tab', item.label);
        button.type = 'button';
        button.classList.toggle('active', index === this.tab);
        button.addEventListener('click', () => {
          this.tab = index;
          this.renderTabs();
          this.renderBody();
          this.body?.scrollTo({ top: 0 });
        });
        return button;
      }),
    );
    // El buscador solo tiene sentido en la pestaña de complementos
    this.search?.classList.toggle(
      'hidden',
      this.menu[this.tab]?.kind !== 'plugins',
    );
  }

  private renderBody() {
    if (!this.body) return;
    const current = this.menu[this.tab];
    const items = (current?.items ?? []).filter(isVisible);
    const content =
      current?.kind === 'plugins'
        ? this.renderPlugins(items)
        : this.renderItems(items, [current?.label ?? '']);
    this.body.replaceChildren(content);
  }

  private renderPlugins(items: MenuNode[]) {
    const fragment = document.createDocumentFragment();
    const plugins = items.filter(
      (item) =>
        item.type !== 'separator' &&
        (!this.query ||
          item.label.toLowerCase().includes(this.query) ||
          (item.toolTip ?? '').toLowerCase().includes(this.query)),
    );
    const enabled = plugins.filter((item) => pluginToggle(item)?.checked);
    const available = plugins.filter((item) => !pluginToggle(item)?.checked);

    for (const [title, group] of [
      [this.labels.enabled, enabled],
      [this.labels.available, available],
    ] as const) {
      if (group.length === 0) continue;
      fragment.append(el('div', 'lg-settings-section', title));
      const card = el('div', 'lg-settings-card');
      for (const plugin of group) card.append(this.renderPlugin(plugin));
      fragment.append(card);
    }

    if (plugins.length === 0)
      fragment.append(el('div', 'lg-settings-empty', this.labels.empty));
    return fragment;
  }

  private renderPlugin(plugin: MenuNode) {
    const wrapper = el('div', 'lg-settings-plugin');
    const toggle = pluginToggle(plugin);
    const options = pluginOptions(plugin);
    const key = `plugin:${plugin.label}`;
    const open = this.expanded.has(key);

    const row = el('div', 'lg-settings-row');
    const text = el('div', 'lg-settings-text');
    text.append(el('div', 'lg-settings-label', plugin.label));
    if (plugin.toolTip)
      text.append(el('div', 'lg-settings-desc', plugin.toolTip));
    row.append(text);

    if (options.length > 0) {
      const more = el('button', 'lg-settings-more');
      more.type = 'button';
      more.innerHTML = CHEVRON;
      more.classList.toggle('open', open);
      more.addEventListener('click', () => {
        if (open) this.expanded.delete(key);
        else this.expanded.add(key);
        this.renderBody();
      });
      row.append(more);
    }
    if (toggle) row.append(this.renderSwitch(toggle));
    wrapper.append(row);

    if (open && options.length > 0) {
      const nested = el('div', 'lg-settings-nested');
      nested.append(this.renderItems(options, [plugin.label]));
      wrapper.append(nested);
    }
    return wrapper;
  }

  private renderSwitch(node: MenuNode) {
    const button = el('button', 'lg-switch');
    button.type = 'button';
    button.setAttribute('role', 'switch');
    button.setAttribute('aria-checked', String(Boolean(node.checked)));
    button.disabled = node.enabled === false;
    button.append(el('span'));
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      // Respuesta inmediata; el estado real llega al volver a leer el menú
      button.setAttribute(
        'aria-checked',
        String(button.getAttribute('aria-checked') !== 'true'),
      );
      this.press(node).catch(console.error);
    });
    return button;
  }

  // Dibuja una lista genérica de opciones de menú
  private renderItems(items: MenuNode[], path: string[]) {
    const card = el('div', 'lg-settings-card');
    for (const item of items.filter(isVisible)) {
      if (item.type === 'separator') {
        if (card.lastElementChild && !card.lastElementChild.matches('hr'))
          card.append(el('hr', 'lg-settings-sep'));
        continue;
      }
      card.append(this.renderItem(item, path));
    }
    if (card.lastElementChild?.matches('hr')) card.lastElementChild.remove();
    return card;
  }

  private renderItem(item: MenuNode, path: string[]) {
    const row = el('div', 'lg-settings-row');
    row.classList.toggle('disabled', item.enabled === false);
    const text = el('div', 'lg-settings-text');
    text.append(el('div', 'lg-settings-label', item.label));
    if (item.toolTip && item.type !== 'radio')
      text.append(el('div', 'lg-settings-desc', item.toolTip));
    row.append(text);

    switch (item.type) {
      case 'checkbox':
        row.append(this.renderSwitch(item));
        row.addEventListener('click', () => {
          row.querySelector<HTMLButtonElement>('.lg-switch')?.click();
        });
        return row;

      case 'radio': {
        row.classList.add('clickable', 'radio');
        const mark = el('span', 'lg-settings-check');
        if (item.checked) mark.innerHTML = CHECK;
        row.append(mark);
        row.addEventListener('click', () => {
          this.press(item).catch(console.error);
        });
        return row;
      }

      case 'submenu': {
        const key = [...path, item.label].join('/');
        const open = this.expanded.has(key);
        const children = item.submenu?.items ?? [];
        const selected = children.find(
          (child) => child.type === 'radio' && child.checked,
        );
        row.classList.add('clickable');
        if (selected)
          row.append(el('span', 'lg-settings-value', selected.label));
        const chevron = el('span', 'lg-settings-more');
        chevron.innerHTML = CHEVRON;
        chevron.classList.toggle('open', open);
        row.append(chevron);
        row.addEventListener('click', () => {
          if (open) this.expanded.delete(key);
          else this.expanded.add(key);
          this.renderBody();
        });

        const group = el('div', 'lg-settings-group');
        group.append(row);
        if (open) {
          const nested = el('div', 'lg-settings-nested');
          nested.append(this.renderItems(children, [...path, item.label]));
          group.append(nested);
        }
        return group;
      }

      default:
        // Acciones (recargar, abrir enlaces, etc.): se ejecutan y se cierra el panel
        row.classList.add('clickable');
        if (item.sublabel)
          row.append(el('span', 'lg-settings-value', item.sublabel));
        row.addEventListener('click', () => {
          this.press(item, true).catch(console.error);
        });
        return row;
    }
  }
}

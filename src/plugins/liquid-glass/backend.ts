import {
  type BrowserWindow,
  Menu,
  type MenuItem,
  type WebContents,
} from 'electron';

import { t } from '@/i18n';
import { createBackend } from '@/utils';

import { findAppleMotion, type MotionQuery } from './apple-motion';
import { isLoginUrl, openLoginWindow } from './login-window';

/*
 * Proceso principal: da al panel de configuración (settings.ts) acceso al
 * menú de la aplicación (Plugins, Options, View, Navigation, About).
 * - liquid-glass:get-menu    → el menú como datos (para dibujarlo con interruptores)
 * - liquid-glass:menu-click  → pulsa una opción por su commandId
 * - liquid-glass:apple-motion → portada animada directa de Apple Music
 * Además abre el inicio de sesión en una ventana emergente (login-window.ts).
 */

// Quita las referencias internas de Electron que no se pueden enviar al renderer
const serializeMenu = (menu: Menu | null) =>
  JSON.parse(
    JSON.stringify(menu, (key: string, value: unknown) =>
      key !== 'commandsMap' && key !== 'menu' ? value : undefined,
    ),
  );

const findMenuItem = (commandId: number): MenuItem | null => {
  const stack = [...(Menu.getApplicationMenu()?.items ?? [])];
  while (stack.length > 0) {
    const item = stack.shift();
    if (!item) continue;
    if (item.commandId === commandId) return item;
    if (item.submenu) stack.push(...item.submenu.items);
  }
  return null;
};

// Evita que la ventana principal vaya a la página de Google para iniciar sesión
let onWillNavigate: ((event: Electron.Event, url: string) => void) | null =
  null;
// Si aun así llega (p. ej. al reabrir la app en esa página), vuelve a YouTube
// Music y el inicio de sesión sigue en la ventana emergente
let onDidNavigate: ((event: Electron.Event, url: string) => void) | null = null;

export const backend = createBackend({
  start({ ipc, window }) {
    const title = t('plugins.liquid-glass.topbar.sign-in');
    onWillNavigate = (event, url) => {
      if (!isLoginUrl(url)) return;
      event.preventDefault();
      openLoginWindow(window, url, title);
    };
    onDidNavigate = (_event, url) => {
      if (!isLoginUrl(url)) return;
      window.webContents
        .loadURL('https://music.youtube.com/')
        .catch(console.error);
      openLoginWindow(window, url, title);
    };
    window.webContents.on('will-navigate', onWillNavigate);
    window.webContents.on('did-navigate', onDidNavigate);

    ipc.handle('liquid-glass:get-menu', () =>
      serializeMenu(Menu.getApplicationMenu()),
    );

    // Portada animada directa de Apple Music (alternativa, ver apple-motion.ts)
    ipc.handle('liquid-glass:apple-motion', (query: MotionQuery) =>
      findAppleMotion(query),
    );

    // Igual que "In-App Menu": el click de Electron ya alterna casillas y radios
    ipc.handle('liquid-glass:menu-click', (commandId: number) => {
      const item = findMenuItem(commandId);
      if (!item) return false;
      (
        item.click as (
          event: unknown,
          focusedWindow: BrowserWindow | null,
          focusedWebContents: WebContents,
        ) => void
      )(undefined, window, window.webContents);
      return true;
    });
  },
  stop({ ipc, window }) {
    if (onWillNavigate)
      window.webContents.removeListener('will-navigate', onWillNavigate);
    onWillNavigate = null;
    if (onDidNavigate)
      window.webContents.removeListener('did-navigate', onDidNavigate);
    onDidNavigate = null;
    ipc.removeHandler('liquid-glass:get-menu');
    ipc.removeHandler('liquid-glass:menu-click');
    ipc.removeHandler('liquid-glass:apple-motion');
  },
});

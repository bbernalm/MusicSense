import {
  type BrowserWindow,
  Menu,
  type MenuItem,
  shell,
  type WebContents,
} from 'electron';

import { t } from '@/i18n';
import { createBackend } from '@/utils';

import {
  findAppleMotion,
  lookupCollectionName,
  type MotionQuery,
  sameCollection,
} from './apple-motion';
import { isLoginUrl, openLoginWindow } from './login-window';

/*
 * Proceso principal: da al panel de configuración (settings.ts) acceso al
 * menú de la aplicación (Plugins, Options, View, Navigation, About).
 * - liquid-glass:get-menu    → el menú como datos (para dibujarlo con interruptores)
 * - liquid-glass:menu-click  → pulsa una opción por su commandId
 * - liquid-glass:apple-motion → portada animada directa de Apple Music
 * Además abre el inicio de sesión en una ventana emergente (login-window.ts).
 */

// Más pequeño que esto la cápsula y el panel del reproductor ya no caben
// (incluso con el escalado)
const MIN_WIDTH = 1200;
const MIN_HEIGHT = 740;
// Tamaño para el que está pensado el diseño (zoom 1)
const REFERENCE_WIDTH = 1700;
const REFERENCE_HEIGHT = 940;

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
let onScale: (() => void) | null = null;

export const backend = createBackend({
  start({ ipc, window }) {
    // Por debajo de este tamaño el diseño (buscador centrado, píldora y
    // cápsulas, panel del reproductor) ya no cabe
    window.setMinimumSize(MIN_WIDTH, MIN_HEIGHT);
    const [width, height] = window.getSize();
    if (width < MIN_WIDTH || height < MIN_HEIGHT)
      window.setSize(Math.max(width, MIN_WIDTH), Math.max(height, MIN_HEIGHT));

    ipc.handle('liquid-glass:min-size', () => window.getMinimumSize());

    // Letra no encontrada: búsqueda en el navegador (solo Google, con el
    // texto de la canción; nunca una dirección enviada desde la página)
    ipc.handle('liquid-glass:search-lyrics', (query: string) => {
      const text = `${String(query).slice(0, 200)} lyrics`;
      return shell.openExternal(
        `https://www.google.com/search?q=${encodeURIComponent(text)}`,
      );
    });

    // Toda la interfaz se escala con el tamaño de la ventana (zoom de la
    // página): maximizada se ve más grande y al achicarla no se amontona en
    // las esquinas. El diseño está pensado para unos 1700×940.
    const applyScale = () => {
      if (window.isDestroyed()) return;
      const [innerWidth, innerHeight] = window.getContentSize();
      const factor = Math.min(
        innerWidth / REFERENCE_WIDTH,
        innerHeight / REFERENCE_HEIGHT,
      );
      const zoom = Math.round(Math.min(1.5, Math.max(0.8, factor)) * 100) / 100;
      if (Math.abs(window.webContents.getZoomFactor() - zoom) < 0.01) return;
      window.webContents.setZoomFactor(zoom);
      // La barra de título de Windows (botones de ventana) sigue al zoom
      try {
        window.setTitleBarOverlay({
          color: '#00000000',
          symbolColor: '#ffffff',
          height: Math.floor(32 * zoom),
        });
      } catch {
        // Sin barra de título superpuesta (macOS/Linux)
      }
    };
    onScale = () => applyScale();
    window.on('resize', onScale);
    window.webContents.on('did-finish-load', onScale);
    applyScale();

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
    // Comprueba que un id de álbum de Apple corresponde al nombre esperado
    ipc.handle(
      'liquid-glass:check-collection',
      async (id: string, expected: string) =>
        sameCollection(await lookupCollectionName(id), expected),
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
    if (onScale) {
      window.removeListener('resize', onScale);
      window.webContents.removeListener('did-finish-load', onScale);
      window.webContents.setZoomFactor(1);
    }
    onScale = null;
    if (onWillNavigate)
      window.webContents.removeListener('will-navigate', onWillNavigate);
    onWillNavigate = null;
    if (onDidNavigate)
      window.webContents.removeListener('did-navigate', onDidNavigate);
    onDidNavigate = null;
    ipc.removeHandler('liquid-glass:get-menu');
    ipc.removeHandler('liquid-glass:menu-click');
    ipc.removeHandler('liquid-glass:apple-motion');
    ipc.removeHandler('liquid-glass:check-collection');
    ipc.removeHandler('liquid-glass:min-size');
    ipc.removeHandler('liquid-glass:search-lyrics');
  },
});

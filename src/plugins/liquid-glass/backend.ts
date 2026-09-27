import {
  type BrowserWindow,
  Menu,
  type MenuItem,
  type WebContents,
} from 'electron';

import { createBackend } from '@/utils';

/*
 * Proceso principal: da al panel de configuración (settings.ts) acceso al
 * menú de la aplicación (Plugins, Options, View, Navigation, About).
 * - liquid-glass:get-menu    → el menú como datos (para dibujarlo con interruptores)
 * - liquid-glass:menu-click  → pulsa una opción por su commandId
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

export const backend = createBackend({
  start({ ipc, window }) {
    ipc.handle('liquid-glass:get-menu', () =>
      serializeMenu(Menu.getApplicationMenu()),
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
  stop({ ipc }) {
    ipc.removeHandler('liquid-glass:get-menu');
    ipc.removeHandler('liquid-glass:menu-click');
  },
});

import { Menu } from 'electron';

import { createBackend } from '@/utils';

/*
 * Proceso principal: abre el menú de la aplicación (Plugins, Options, View,
 * Navigation, About) como menú emergente junto al botón de configuración.
 * Así la barra de menús de "In-App Menu" puede quedar oculta.
 */
export const backend = createBackend({
  start({ ipc, window }) {
    ipc.handle('liquid-glass:open-menu', (x: number, y: number) => {
      Menu.getApplicationMenu()?.popup({
        window,
        x: Math.round(x),
        y: Math.round(y),
      });
    });
  },
  stop({ ipc }) {
    ipc.removeHandler('liquid-glass:open-menu');
  },
});

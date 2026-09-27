import { BrowserWindow, nativeTheme, shell } from 'electron';

/*
 * Inicio de sesión en una ventana emergente oscura (proceso principal).
 *
 * Pear abre la página de Google en la ventana principal, donde es fácil
 * quedarse atascado. Aquí se intercepta esa navegación y se abre una ventana
 * aparte, en modo oscuro, que comparte la sesión (cookies) de la app: al
 * terminar, la cuenta queda guardada en la app, la ventana se cierra sola y
 * la app se recarga. Un navegador externo no serviría: la sesión quedaría en
 * el navegador y no en la app.
 */

const MUSIC_HOST = 'music.youtube.com';

// La página de Google ignora el modo oscuro del sistema: se invierten sus
// colores y se vuelven a invertir las imágenes (el logo conserva sus colores)
const DARK_CSS = `
  html { background: #fff !important; filter: invert(0.92) hue-rotate(180deg) !important; }
  img, picture, video, canvas, iframe { filter: invert(1) hue-rotate(180deg) !important; }
`;

let loginWindow: BrowserWindow | null = null;

const parseUrl = (url: string) => {
  try {
    return new URL(url);
  } catch {
    return null;
  }
};

// Páginas de inicio de sesión de Google
export const isLoginUrl = (url: string) => {
  const parsed = parseUrl(url);
  return parsed?.hostname === 'accounts.google.com';
};

export const openLoginWindow = (
  parent: BrowserWindow,
  url: string,
  title: string,
) => {
  if (loginWindow && !loginWindow.isDestroyed()) {
    loginWindow.focus();
    return;
  }

  // Barra de título y controles de la ventana en oscuro
  nativeTheme.themeSource = 'dark';

  const popup = new BrowserWindow({
    parent,
    modal: true,
    width: 480,
    height: 700,
    minWidth: 380,
    minHeight: 520,
    title,
    backgroundColor: '#202124',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      // Misma sesión que la app: así las cookies de la cuenta quedan en ella
      session: parent.webContents.session,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  loginWindow = popup;
  popup.setMenu(null);
  popup.webContents.userAgent = parent.webContents.userAgent;
  popup.once('ready-to-show', () => popup.show());
  popup.on('closed', () => {
    if (loginWindow === popup) loginWindow = null;
  });

  // Enlaces de ayuda, privacidad, etc.: en el navegador
  popup.webContents.setWindowOpenHandler(({ url: target }) => {
    if (parseUrl(target)?.protocol.startsWith('http'))
      shell.openExternal(target).catch(console.error);
    return { action: 'deny' };
  });

  popup.webContents.on('dom-ready', () => {
    if (isLoginUrl(popup.webContents.getURL()))
      popup.webContents.insertCSS(DARK_CSS).catch(console.error);
  });

  // Al volver a YouTube Music la sesión ya está guardada: se cierra y se recarga
  popup.webContents.on('did-navigate', (_event, target) => {
    if (parseUrl(target)?.hostname !== MUSIC_HOST) return;
    popup.close();
    parent.webContents.loadURL(`https://${MUSIC_HOST}/`).catch(console.error);
  });

  popup.loadURL(url).catch(console.error);
};

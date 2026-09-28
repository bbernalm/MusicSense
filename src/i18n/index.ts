import i18next, { init, t as i18t, changeLanguage } from 'i18next';
import { languageResources } from 'virtual:i18n';

// MusicSense: nombre visible de la app (ventana, bandeja, notificaciones,
// accesos directos). La carpeta de datos sigue siendo la de productName.
export const APPLICATION_NAME = 'MusicSense';

export const loadI18n = async () =>
  await init({
    resources: await languageResources(),
    lng: 'en',
    fallbackLng: 'en',
    interpolation: {
      escapeValue: false,
    },
  });

export const setLanguage = async (language: string) =>
  await changeLanguage(language);

export const t = i18t.bind(i18next);

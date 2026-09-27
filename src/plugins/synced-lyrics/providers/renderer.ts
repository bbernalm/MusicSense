import { ProviderNames } from './index';
import { LRCLib } from './LRCLib';
import { LyricsGenius } from './LyricsGenius';
import { YTMusic } from './YTMusic';

import type { LyricProvider } from '../types';

// MusicSense: Musixmatch sin cuenta de pago devuelve letras "codificadas"
// (palabras sin sentido). Se deja como fuente vacía para que se use otra
// o se muestre que no se encontró la letra.
const disabledMusixMatch: LyricProvider = {
  name: 'MusixMatch',
  baseUrl: '',
  search: () => Promise.resolve(null),
};

export const providers = {
  [ProviderNames.YTMusic]: new YTMusic(),
  [ProviderNames.LRCLib]: new LRCLib(),
  [ProviderNames.MusixMatch]: disabledMusixMatch,
  [ProviderNames.LyricsGenius]: new LyricsGenius(),
  // [ProviderNames.Megalobiz]: new Megalobiz(), // Disabled because it is too unstable and slow
} as const;

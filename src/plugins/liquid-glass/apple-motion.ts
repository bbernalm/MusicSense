import { net } from 'electron';

/*
 * Portadas animadas directamente de Apple Music (proceso principal).
 * Alternativa para cuando el servicio de Better Lyrics no tiene la portada.
 * Solo usa recursos públicos, sin tokens:
 * 1. API pública de búsqueda de iTunes → el álbum en Apple Music.
 * 2. Página pública del álbum en music.apple.com → la lista .m3u8 de su
 *    portada animada ("motionDetailSquare").
 * 3. De esa lista, la variante H.264 (la que Chromium reproduce siempre) de
 *    1080 px o menos, y su archivo .mp4 (los videos de Apple van en un único
 *    .mp4 fragmentado que se puede reproducir directamente).
 */

// album: la portada del álbum de la canción (nombre exacto)
// single: la del sencillo con el nombre de la canción (videos y sencillos)
export type MotionQuery = {
  artist: string;
  album: string;
  title: string;
  mode: 'album' | 'single';
};

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';
const MAX_SIZE = 1080;

type ItunesResult = {
  artistName?: string;
  collectionName?: string;
  collectionViewUrl?: string;
};

const get = async (url: string) => {
  const response = await net.fetch(url, {
    headers: { 'User-Agent': USER_AGENT },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} ${url}`);
  return response.text();
};

// Compara nombres sin mayúsculas, acentos, signos ni "(Deluxe)", "- Single"...
const normalize = (text: string) =>
  text
    .toLowerCase()
    .normalize('NFD')
    .replaceAll(/[̀-ͯ]/g, '')
    .replaceAll(/\(.*?\)|\[.*?\]|- (single|ep)$/g, '')
    .replaceAll(/[^a-z0-9]+/g, ' ')
    .trim();

const sameArtist = (a: string, b: string) => {
  const x = normalize(a);
  const y = normalize(b);
  return Boolean(x && y) && (x.includes(y) || y.includes(x));
};

// Busca en iTunes las páginas del álbum (o sencillo) cuyo nombre coincide
// exactamente con el buscado: así una canción de un álbum nunca recibe la
// portada del sencillo, ni al revés
const findAlbumPages = async ({ artist, album, title, mode }: MotionQuery) => {
  const pages: string[] = [];
  const add = (url?: string) => {
    const clean = url?.split('?')[0];
    if (clean && !pages.includes(clean)) pages.push(clean);
  };

  const search = async (term: string, entity: 'album' | 'song') => {
    const url = `https://itunes.apple.com/search?${new URLSearchParams({
      term,
      entity,
      limit: '10',
    }).toString()}`;
    const data = JSON.parse(await get(url)) as { results?: ItunesResult[] };
    return (data.results ?? []).filter((result) =>
      sameArtist(result.artistName ?? '', artist),
    );
  };

  const name = mode === 'album' ? album : title;
  const wanted = normalize(name);
  if (!wanted) return pages;

  const matches = (result: ItunesResult) =>
    normalize(result.collectionName ?? '') === wanted;

  for (const result of await search(`${artist} ${name}`, 'album')) {
    if (matches(result)) add(result.collectionViewUrl);
  }
  // Sencillos que la búsqueda de álbumes no encuentra: por la canción
  if (mode === 'single') {
    for (const result of await search(`${artist} ${title}`, 'song')) {
      if (matches(result)) add(result.collectionViewUrl);
    }
  }
  return pages.slice(0, 3);
};

const extractMotionPlaylist = (html: string) => {
  const start = html.indexOf('"motionDetailSquare"');
  if (start === -1) return null;
  const match = /"video":"(https:[^"]+\.m3u8)"/.exec(
    html.slice(start, start + 3000),
  );
  return match?.[1] ?? null;
};

// De la lista maestra, la variante H.264 más grande hasta 1080 px (la más
// ligera de ese tamaño) y su archivo .mp4
const resolveMp4 = async (masterUrl: string) => {
  const lines = (await get(masterUrl)).split('\n');
  let best: { url: string; size: number; bandwidth: number } | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.startsWith('#EXT-X-STREAM-INF')) continue;
    if (!/CODECS="avc1/.test(line)) continue;
    const size = Number(/RESOLUTION=(\d+)x/.exec(line)?.[1] ?? 0);
    const bandwidth = Number(/BANDWIDTH=(\d+)/.exec(line)?.[1] ?? 0);
    const uri = lines[i + 1]?.trim();
    if (!uri || size > MAX_SIZE) continue;
    if (
      !best ||
      size > best.size ||
      (size === best.size && bandwidth < best.bandwidth)
    ) {
      best = { url: new URL(uri, masterUrl).toString(), size, bandwidth };
    }
  }
  if (!best) return null;

  const variant = await get(best.url);
  const map = /#EXT-X-MAP:URI="([^"]+)"/.exec(variant)?.[1];
  return map ? new URL(map, best.url).toString() : null;
};

// Nombre del álbum/sencillo de Apple Music con ese id (para comprobar lo que
// devuelve el servicio de Better Lyrics)
export const lookupCollectionName = async (id: string) => {
  try {
    const data = JSON.parse(
      await get(`https://itunes.apple.com/lookup?id=${encodeURIComponent(id)}`),
    ) as { results?: ItunesResult[] };
    return data.results?.[0]?.collectionName ?? '';
  } catch {
    return '';
  }
};

// ¿Coincide el nombre del álbum/sencillo con el buscado?
export const sameCollection = (a: string, b: string) =>
  Boolean(normalize(a)) && normalize(a) === normalize(b);

export const findAppleMotion = async (
  query: MotionQuery,
): Promise<string | null> => {
  try {
    for (const page of await findAlbumPages(query)) {
      const playlist = extractMotionPlaylist(await get(page));
      if (playlist) return await resolveMp4(playlist);
    }
  } catch (error) {
    console.error('[liquid-glass] Apple Music motion artwork:', error);
  }
  return null;
};

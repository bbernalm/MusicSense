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

export type MotionQuery = { artist: string; album: string; title: string };

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

// Busca en iTunes y devuelve las páginas de álbum candidatas, mejores primero
const findAlbumPages = async ({ artist, album, title }: MotionQuery) => {
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

  if (album) {
    const albums = await search(`${artist} ${album}`, 'album');
    const wanted = normalize(album);
    for (const result of albums) {
      if (normalize(result.collectionName ?? '') === wanted)
        add(result.collectionViewUrl);
    }
  }
  // El álbum que contiene la canción (p. ej. un sencillo que también está en
  // un álbum con portada animada)
  if (title) {
    const songs = await search(`${artist} ${title}`, 'song');
    for (const result of songs.slice(0, 3)) add(result.collectionViewUrl);
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

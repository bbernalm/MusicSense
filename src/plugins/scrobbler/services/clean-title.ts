// MusicSense: YouTube Music añade los artistas invitados al título según el
// idioma ("Kiss Me More (con SZA)", "(feat. X)", "(with X)"...). Last.fm y
// ListenBrainz reconocen mejor la canción sin esa parte.
const FEATURING =
  /\s*[([](?:con|feat\.?|ft\.?|featuring|with|avec|mit|com|part\.?)\s[^)\]]*[)\]]/gi;

export const cleanTrackTitle = (title: string) =>
  title.replaceAll(FEATURING, '').trim() || title;

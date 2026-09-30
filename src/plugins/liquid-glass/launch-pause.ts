/*
 * Al abrir la app vuelve la última canción (opción "Reanudar al iniciar" de
 * Pear), pero YouTube Music la empieza a reproducir sola. Aquí se deja en
 * pausa, como Spotify: la primera vez que empieza a sonar en los primeros
 * segundos, si tú no has tocado nada, se pausa al instante.
 *
 * Se escucha desde el arranque del complemento (antes de que exista la API
 * del reproductor, que llega unos segundos tarde): los eventos de audio no
 * suben por el documento, pero sí se pueden captar en la fase de captura.
 * YouTube Music empieza a sonar antes de que cargue este código: la ventana
 * arranca silenciada (backend.ts) y se le devuelve el sonido con onDone.
 */

// Tiempo tras abrir la app en el que se considera arranque automático
const WINDOW_MS = 20_000;

export const pauseOnLaunch = (onDone: () => void) => {
  const started = performance.now();
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    onDone();
    document.removeEventListener('play', onPlay, true);
    document.removeEventListener('playing', onPlay, true);
    window.removeEventListener('pointerdown', onTouch, true);
    window.removeEventListener('keydown', onTouch, true);
  };

  function onPlay(event: Event) {
    const video = event.target;
    if (!(video instanceof HTMLVideoElement)) return;
    // Solo el reproductor de YouTube (no las portadas animadas)
    if (!video.matches('#movie_player video.video-stream')) return;
    if (performance.now() - started > WINDOW_MS) {
      finish();
      return;
    }
    video.pause();
    finish();
  }

  // Cualquier clic o tecla tuya cuenta como "quiero que suene": se deja de
  // vigilar y se devuelve el sonido
  const onTouch = () => finish();
  window.addEventListener('pointerdown', onTouch, true);
  window.addEventListener('keydown', onTouch, true);
  document.addEventListener('play', onPlay, true);
  document.addEventListener('playing', onPlay, true);
  window.setTimeout(finish, WINDOW_MS);

  // Por si ya estaba sonando antes de empezar a escuchar
  const current = document.querySelector<HTMLVideoElement>(
    '#movie_player video.video-stream',
  );
  if (current && !current.paused) {
    current.pause();
    finish();
  }
};

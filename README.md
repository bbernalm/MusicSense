<div align="center">

# MusicSense

Cliente de escritorio de YouTube Music con una estética inspirada en Apple Music: vidrio translúcido, fondos con la portada de la canción y un reproductor flotante.

</div>

> [!IMPORTANT]
> Proyecto personal y no oficial. No está afiliado, autorizado ni respaldado por Google LLC ni por YouTube. "YouTube" y "YouTube Music" son marcas de Google LLC.

## Qué es

MusicSense es una versión modificada de [Pear Desktop](https://github.com/pear-devs/pear-desktop) (antes `th-ch/youtube-music`), un cliente de YouTube Music hecho con Electron y TypeScript que admite complementos. Conserva todo lo que ofrece Pear Desktop (bloqueador de anuncios, letras sincronizadas, descargas, integración con Discord, etc.) y añade un tema visual propio: **Liquid Glass**.

## Liquid Glass

El complemento vive en [`src/plugins/liquid-glass/`](src/plugins/liquid-glass/) y se activa desde **Plugins → Liquid Glass**.

- **Fondo vivo:** la portada de la canción actual, muy desenfocada, con un fundido al cambiar de canción y un movimiento lento opcional.
- **Superficies de vidrio:** menú lateral, barra superior, menús emergentes, pestañas y chips translúcidos con un borde de luz.
- **Reproductor flotante:** una píldora centrada con los controles, la canción y una barra de progreso ondulada, más una cápsula aparte para el volumen, repetir, aleatorio y abrir el reproductor.
- **Buscador:** campo en forma de píldora y sugerencias en un panel de vidrio.
- **Refracción:** aberración cromática sutil en los bordes del reproductor y del buscador (se puede desactivar).
- **Opciones del menú:** fondo animado, aberración cromática y nivel de desenfoque (15, 30 o 50).

Para que no haya conflictos, conviene desactivar *Album Color Theme*, *Transparent Player* y *Blur Navigation Bar*.

| Archivo | Función |
| --- | --- |
| `index.ts` | Definición del complemento, menú y fondo con la portada |
| `style.css` | Todo el diseño del tema |
| `refraction.ts` | Refracción con aberración cromática (filtros SVG) |
| `wave.ts` | Barra de progreso ondulada y corrección del tiempo al pasar el ratón |

## Desarrollo

Requisitos: Node.js 22 o superior y pnpm 11 o superior.

```bash
pnpm install --frozen-lockfile
pnpm dev
```

`pnpm dev` abre la app y la recarga al guardar cambios (los complementos nuevos solo se detectan al reiniciar).

Comprobaciones:

```bash
pnpm typecheck
pnpm lint
pnpm format:check
```

Generar el instalador de Windows:

```bash
pnpm dist:win
```

## Actualizar desde Pear Desktop

El proyecto original está configurado como el remoto `upstream` (solo lectura). Para traer sus novedades:

```bash
git fetch upstream
git merge upstream/master
```

## Créditos y licencia

Basado en [Pear Desktop](https://github.com/pear-devs/pear-desktop) y el trabajo de sus colaboradores. Se distribuye bajo la licencia MIT; ver [`license`](license).

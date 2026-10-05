import type { PixelHeaderArt } from "@/lib/profile-header-art";

/* Витрина доната показывает настоящие вещи с сайта: обычный скин и шапку
   @tomac, пони @fatiga. Это снимки на момент сборки — файлы лежат в
   public/donation/showcase, чтобы витрина не зависела от чужих профилей. */

export const SHOWCASE_PLAIN_HEADER_COLOR = "#f7b1e4";

export const SHOWCASE_HEADER = {
  color: "#001975",
  art: {
    palette: ["#c71919", "#ffd800", "#e9e2e2", "#d8d0d0", "#f0ebeb", "#16833b", "#d4d0c8", "#7a3f18", "#7f7f7f", "#e8e3e3", "#ffffff", "#a97c65", "#20d9d2", "#24408e"],
    pixels: "......................000...........1......22232..1.......1.........0000000................44442....55........1....000666000.....1.......1.32242.55.55.55.........00786886700..............24394.55555555...........78a86a7................44232...557755...........76a88a7....b...................557755...........7886767....c.....................77.............7686787....d................555555555555555555555555555555555555555555555555555555555555555555555555555555555555555555555555555555555555555555555555555555555555555555555555555555555555555555555555555555555555555555555555",
  } satisfies PixelHeaderArt,
};

/* Второй кадр — звёзды мигают: так витрина показывает живую шапку HYPE (r099). */
export const SHOWCASE_HEADER_FRAMES: PixelHeaderArt[] = [{
  ...SHOWCASE_HEADER.art,
  pixels: (() => {
    let star = 0;
    return SHOWCASE_HEADER.art.pixels.replace(/1/g, () => (star++ % 2 ? "1" : "."));
  })(),
}];

export const SHOWCASE_HUMAN_TEXTURE = "/donation/showcase/human-skin.png";
export const SHOWCASE_PONY_TEXTURE = "/donation/showcase/pony-skin.png";

/* Лицо 8×8 с текстуры 64×64 и второй слой поверх (шляпа, чёлка). */
export const faceStyle = (texture: string) => ({
  backgroundImage: `url(${texture}), url(${texture})`,
  backgroundSize: "800% 800%, 800% 800%",
  backgroundPosition: `${(40 / 56) * 100}% ${(8 / 56) * 100}%, ${(8 / 56) * 100}% ${(8 / 56) * 100}%`,
});

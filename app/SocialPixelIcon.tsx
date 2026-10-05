export type SocialPixelIconName =
  | "telegram"
  | "discord"
  | "youtube"
  | "instagram"
  | "tiktok"
  | "letterboxd"
  | "duolingo"
  | "other";

const symbols: Record<SocialPixelIconName, string> = {
  telegram: "➤",
  discord: "••",
  youtube: "▶",
  instagram: "◎",
  tiktok: "♪",
  letterboxd: "●●●",
  duolingo: "D",
  other: "+",
};

type PixelPattern = {
  rows: string[];
  colors: Record<string, string>;
};

const whitePixels = { w: "#ffffff" };

const pixelPatterns: Partial<Record<SocialPixelIconName, PixelPattern>> = {
  telegram: {
    colors: whitePixels,
    rows: [
      "............",
      ".........ww.",
      ".......wwww.",
      "....wwwwwww.",
      ".wwwwwwwwww.",
      "...www.www..",
      "....w..www..",
      "....w....w..",
      "............",
      "............",
      "............",
      "............",
    ],
  },
  discord: {
    colors: whitePixels,
    rows: [
      "............",
      "..ww....ww..",
      ".wwwwwwwwww.",
      "wwwwwwwwwwww",
      "www......www",
      "ww..wwww..ww",
      "ww..wwww..ww",
      "wwwwwwwwwwww",
      ".wwwwwwwwww.",
      "..www..www..",
      "...ww..ww...",
      "............",
    ],
  },
  youtube: {
    colors: whitePixels,
    rows: [
      "............",
      "............",
      "....w.......",
      "....www.....",
      "....wwwww...",
      "....wwwwwww.",
      "....wwwww...",
      "....www.....",
      "....w.......",
      "............",
      "............",
      "............",
    ],
  },
  instagram: {
    colors: whitePixels,
    rows: [
      "............",
      "..wwwwwwww..",
      ".ww......ww.",
      ".w.......ww.",
      ".w...ww...w.",
      ".w..w..w..w.",
      ".w..w..w..w.",
      ".w...ww...w.",
      ".w........w.",
      ".ww......ww.",
      "..wwwwwwww..",
      "............",
    ],
  },
  tiktok: {
    colors: { c: "#27edf0", w: "#ffffff", p: "#ff3159" },
    rows: [
      "......cwp...",
      "......cwp...",
      "......cwwp..",
      "......cwwwp.",
      "......cwp...",
      "......cwp...",
      "..ccc.cwp...",
      ".cwwwccwp...",
      "cwwwpwwwp...",
      "cwwwpwwp....",
      ".cwwwwwp....",
      "..cppp......",
    ],
  },
  letterboxd: {
    colors: {
      o: "#ff8000",
      y: "#f4e05b",
      g: "#00e054",
      c: "#40bcf4",
      b: "#1f87d6",
    },
    rows: [
      "............",
      "............",
      "............",
      ".ooo.ggg.bbb",
      "ooooygggcbbb",
      "ooooygggcbbb",
      "ooooygggcbbb",
      ".ooo.ggg.bbb",
      "............",
      "............",
      "............",
      "............",
    ],
  },
  duolingo: {
    colors: { w: "#ffffff", g: "#58cc02", d: "#2f8d00", o: "#ff9f1c" },
    rows: [
      "...gggggg...",
      "..gggggggg..",
      ".ggwggggwgg.",
      ".ggwggggwgg.",
      ".gggggggggg.",
      ".ggggoo.ggg.",
      "..gggggggg..",
      "...gggggg...",
      "....dggd....",
      "....d..d....",
      "............",
      "............",
    ],
  },
};

export function SocialPixelIcon({ name }: { name: SocialPixelIconName }) {
  const pattern = pixelPatterns[name];
  return (
    <span className={`social-pixel-icon social-pixel-${name}`} aria-hidden="true">
      {pattern ? (
        <span
          className="social-pixel-art"
          style={{
            gridTemplateColumns: `repeat(${pattern.rows[0].length}, 1fr)`,
            gridTemplateRows: `repeat(${pattern.rows.length}, 1fr)`,
          }}
        >
          {pattern.rows.flatMap((row, rowIndex) => [...row].map((pixel, columnIndex) => pixel !== "." ? (
            <i
              key={`${rowIndex}-${columnIndex}`}
              style={{
                gridColumn: columnIndex + 1,
                gridRow: rowIndex + 1,
                backgroundColor: pattern.colors[pixel],
              }}
            />
          ) : null))}
        </span>
      ) : symbols[name]}
    </span>
  );
}

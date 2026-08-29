import { ImageResponse } from "next/og";

/**
 * The iOS home-screen icon.
 *
 * /apple-touch-icon.png and /favicon.ico both 404'd. Nothing was broken —
 * modern browsers honour the SVG in app/icon.svg — but iOS "Add to Home Screen"
 * has no SVG path, so a saved shortcut got a screenshot of the page instead of
 * a mark.
 *
 * Drawn here rather than committed as a PNG so there is ONE definition of the
 * mark. The path below is the same "D" as app/icon.svg, and a binary copy beside
 * it would be the thing that silently drifts the next time the mark changes.
 *
 * Apple ignores transparency and squares the image anyway, so the black field is
 * drawn explicitly. Hex rather than the oklch tokens for the same reason
 * opengraph-image.tsx uses hex: the rasteriser has no oklch support at all and
 * fails silently to black — which here would be a black square with no D.
 */
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "#000000",
      }}
    >
      {/* Inline SVG, not a font glyph: ImageResponse has no guarantee of any
            particular face, and the mark must not depend on one. */}
      <svg width="180" height="180" viewBox="0 0 64 64">
        <path
          fill="#ffffff"
          d="M14 16h20c10.5 0 17 6.2 17 16s-6.5 16-17 16H14v-4h4V20h-4v-4Zm12 4v24h6.5c7.2 0 11.5-4.4 11.5-12s-4.3-12-11.5-12H26Z"
        />
      </svg>
    </div>,
    size,
  );
}

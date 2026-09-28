/**
 * Renders the PWA icon PNGs from `public/icon.svg`.
 *
 * A manifest that points at files which do not exist is worse than one without
 * them: the install prompt is offered, the icon fails to load, and the app looks
 * broken on the home screen. Android in particular wants 192px and 512px rasters
 * rather than the SVG, so the vector source alone is not enough.
 *
 * Run with: npm run icons
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import sharp from "sharp";

const ICON_SVG = join(process.cwd(), "public", "icon.svg");
const PUBLIC_DIR = join(process.cwd(), "public");

type Target = {
  file: string;
  size: number;
  /** Maskable icons are cropped to a circle by the launcher, so the mark is inset. */
  maskable: boolean;
};

const TARGETS: Target[] = [
  { file: "icon-192.png", size: 192, maskable: false },
  { file: "icon-512.png", size: 512, maskable: false },
  { file: "icon-maskable-512.png", size: 512, maskable: true },
];

const main = async (): Promise<void> => {
  const svg = await readFile(ICON_SVG);

  for (const target of TARGETS) {
    // A maskable icon must keep its content inside the safe zone: Android may
    // crop to any shape down to a circle, which discards roughly 20% off each
    // edge. Shrinking the mark into the middle is what prevents a clipped shield.
    const inset = target.maskable ? 0.78 : 1;
    const rendered = await sharp(svg, { density: 384 })
      .resize(Math.round(target.size * inset), Math.round(target.size * inset))
      .extend({
        top: Math.round((target.size * (1 - inset)) / 2),
        bottom: Math.round((target.size * (1 - inset)) / 2),
        left: Math.round((target.size * (1 - inset)) / 2),
        right: Math.round((target.size * (1 - inset)) / 2),
        background: "#4B0FA8",
      })
      .resize(target.size, target.size)
      .png({ compressionLevel: 9 })
      .toBuffer();

    await sharp(rendered).toFile(join(PUBLIC_DIR, target.file));
    console.log(`  wrote public/${target.file} (${target.size}x${target.size})`);
  }
};

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error("Icon generation failed:");
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });

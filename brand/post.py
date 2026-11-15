"""Post-process VISR logo renders (runs in CI, needs Pillow >= 10.1).

  python brand/post.py --in out/renders --out out [--final CONCEPT]

For every `<concept>.png` in --in this writes:
  out/marks/<concept>-<size>.png   tight square crop, ~6% padding, transparent
  out/strips/<concept>.png         small sizes on #ffffff and #151518 (+4x zooms)
and for the whole set:
  out/contact-sheet.png            every concept on light and dark
  out/small-strip.png              all strips stacked
With --final, the site deliverables for that concept land in out/final/.
"""

import argparse
import glob
import json
import os

from PIL import Image, ImageDraw, ImageFont

LIGHT = (255, 255, 255, 255)
DARK = (0x15, 0x15, 0x18, 255)
PAPER = (0xF4, 0xF4, 0xF5, 255)
SIZES = (1024, 512, 256, 128, 64, 32, 24, 16)
PAD = 0.06


def font(size):
    for path in (
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
    ):
        if os.path.exists(path):
            return ImageFont.truetype(path, size)
    return ImageFont.load_default(size=size)


def tight_square(im, pad=PAD):
    """Crop to the alpha bounding box and centre on a square with padding."""
    alpha = im.getchannel("A").point(lambda v: 255 if v > 6 else 0)
    bbox = alpha.getbbox()
    if bbox is None:
        return im
    crop = im.crop(bbox)
    w, h = crop.size
    side = max(w, h)
    full = int(round(side / (1.0 - 2.0 * pad)))
    canvas = Image.new("RGBA", (full, full), (0, 0, 0, 0))
    canvas.alpha_composite(crop, ((full - w) // 2, (full - h) // 2))
    return canvas


def scaled(mark, size):
    return mark.resize((size, size), Image.LANCZOS)


def on(bg, mark):
    out = Image.new("RGBA", mark.size, bg)
    out.alpha_composite(mark)
    return out


def strip(marks):
    """Actual-size 128/64/32/24/16 then 4x nearest-neighbour zooms of 32/24/16."""
    gap, margin = 20, 24
    actual = [128, 64, 32, 24, 16]
    zoom = [32, 24, 16]
    width = margin * 2 + sum(actual) + sum(z * 4 for z in zoom) + gap * (len(actual) + len(zoom) - 1) + gap
    band_h = 128 + margin * 2
    out = Image.new("RGBA", (width, band_h * 2), LIGHT)
    for row, bg in enumerate((LIGHT, DARK)):
        band = Image.new("RGBA", (width, band_h), bg)
        x = margin
        for s in actual:
            band.alpha_composite(marks[s], (x, margin + (128 - s) // 2))
            x += s + gap
        x += gap
        for s in zoom:
            z = on(bg, marks[s]).resize((s * 4, s * 4), Image.NEAREST)
            band.alpha_composite(z, (x, margin + (128 - s * 4) // 2))
            x += s * 4 + gap
        out.alpha_composite(band, (0, row * band_h))
    return out


def contact_sheet(entries, cols=3):
    """entries: list of (label, marks dict)."""
    panel, label_h, small_h, margin = 400, 44, 96, 20
    cell_w = panel * 2
    cell_h = label_h + panel + small_h
    rows = (len(entries) + cols - 1) // cols
    cols = min(cols, len(entries))
    sheet = Image.new("RGBA", (margin + cols * (cell_w + margin), margin + rows * (cell_h + margin)), PAPER)
    draw = ImageDraw.Draw(sheet)
    f = font(24)
    for i, (label, marks) in enumerate(entries):
        cx = margin + (i % cols) * (cell_w + margin)
        cy = margin + (i // cols) * (cell_h + margin)
        draw.text((cx + 4, cy + 8), label, fill=(0x15, 0x15, 0x18, 255), font=f)
        big = scaled(marks[512], 360)
        for j, bg in enumerate((LIGHT, DARK)):
            px = cx + j * panel
            py = cy + label_h
            sheet.paste(Image.new("RGBA", (panel, panel + small_h), bg), (px, py))
            sheet.alpha_composite(big, (px + (panel - 360) // 2, py + (panel - 360) // 2))
            x = px + 60
            for s in (64, 32, 24, 16):
                sheet.alpha_composite(marks[s], (x, py + panel + (small_h - s) // 2 - 8))
                x += s + 28
    return sheet


def stack(images, labels):
    f = font(18)
    label_h = 30
    width = max(im.width for im in images)
    height = sum(im.height + label_h for im in images)
    out = Image.new("RGBA", (width, height), PAPER)
    draw = ImageDraw.Draw(out)
    y = 0
    for im, label in zip(images, labels):
        draw.text((8, y + 5), label, fill=(0x15, 0x15, 0x18, 255), font=f)
        out.alpha_composite(im, (0, y + label_h))
        y += im.height + label_h
    return out


def write_final(mark, dest):
    """Site deliverables for the chosen concept."""
    brand = os.path.join(dest, "static", "brand")
    os.makedirs(brand, exist_ok=True)
    for s in (1024, 512, 256, 128, 64, 32):
        scaled(mark, s).save(os.path.join(brand, f"visr-mark-{s}.png"), optimize=True)
    scaled(mark, 32).save(os.path.join(dest, "static", "favicon-32.png"), optimize=True)
    # Apple touch icon: opaque, the OS applies its own corner mask.
    touch = Image.new("RGBA", (180, 180), DARK)
    inner = scaled(mark, 156)
    touch.alpha_composite(inner, (12, 12))
    touch.convert("RGB").save(os.path.join(dest, "static", "apple-touch-icon.png"), optimize=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="src", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--final", default="")
    args = ap.parse_args()

    # Each render shard writes its own concepts.<i>.json; merge them.
    labels, rank, final = {}, {}, args.final
    for meta_path in sorted(glob.glob(os.path.join(args.src, "concepts*.json"))):
        with open(meta_path, encoding="utf-8") as fh:
            meta = json.load(fh)
        for key, info in meta.get("concepts", {}).items():
            labels[key] = info.get("label", key)
            rank[key] = info.get("index", len(rank))
        final = final or meta.get("final", "")
        for key, err in meta.get("failed", {}).items():
            print(f"post: concept {key} failed to render:\n{err}")
    order = sorted(os.path.splitext(os.path.basename(p))[0] for p in glob.glob(os.path.join(args.src, "*.png")))
    order.sort(key=lambda k: rank.get(k, 1000))

    os.makedirs(os.path.join(args.out, "marks"), exist_ok=True)
    os.makedirs(os.path.join(args.out, "strips"), exist_ok=True)

    entries, strips, names = [], [], []
    for key in order:
        raw = Image.open(os.path.join(args.src, key + ".png")).convert("RGBA")
        mark = tight_square(raw)
        marks = {s: scaled(mark, s) for s in SIZES}
        for s, im in marks.items():
            im.save(os.path.join(args.out, "marks", f"{key}-{s}.png"), optimize=True)
        st = strip(marks)
        st.save(os.path.join(args.out, "strips", f"{key}.png"))
        label = f"{key}: {labels.get(key, key)}"
        entries.append((label, marks))
        strips.append(st)
        names.append(label)
        if key == final:
            write_final(mark, os.path.join(args.out, "final"))
            st.save(os.path.join(args.out, "final", "small-sizes.png"))

    if not entries:
        raise SystemExit("no renders found in " + args.src)
    contact_sheet(entries).convert("RGB").save(os.path.join(args.out, "contact-sheet.png"), optimize=True)
    stack(strips, names).convert("RGB").save(os.path.join(args.out, "small-strip.png"), optimize=True)
    print(f"post: {len(entries)} concept(s); final={final or 'none'}")


if __name__ == "__main__":
    main()

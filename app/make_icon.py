"""Draws the app icon (1024px PNG). Run with any Python that has Pillow."""
import sys
from PIL import Image, ImageDraw, ImageFilter

S = 1024
img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
# Rounded tile with a dark-to-charcoal gradient
tile = Image.new("RGBA", (S, S))
g = ImageDraw.Draw(tile)
for y in range(S):
    t = y / S
    g.line([(0, y), (S, y)], fill=(int(32 - 14 * t), int(33 - 14 * t), int(38 - 14 * t), 255))
mask = Image.new("L", (S, S), 0)
ImageDraw.Draw(mask).rounded_rectangle([100, 100, S - 100, S - 100], radius=185, fill=255)
img.paste(tile, (0, 0), mask)
d = ImageDraw.Draw(img)
# A gold "Z" built from three strokes
gold = (245, 197, 66, 255)
w = 92
d.rounded_rectangle([290, 300, 734, 300 + w], radius=w // 2, fill=gold)
d.rounded_rectangle([290, 724 - w, 734, 724], radius=w // 2, fill=gold)
d.polygon([(574, 350), (704, 350), (450, 674), (320, 674)], fill=gold)  # diagonal, tucked into both bars
# A small spark, top right
sx, sy, r = 720, 248, 46
d.polygon([(sx, sy - r), (sx + 12, sy - 12), (sx + r, sy), (sx + 12, sy + 12), (sx, sy + r), (sx - 12, sy + 12), (sx - r, sy), (sx - 12, sy - 12)], fill=(255, 236, 170, 255))
img.save(sys.argv[1])

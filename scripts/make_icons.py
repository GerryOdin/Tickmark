"""Render the PNG app icons (home-screen icons for iPhone/Android). Run once."""
import os

from PIL import Image, ImageDraw

OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "web", "icons")
os.makedirs(OUT, exist_ok=True)

for size in (180, 192, 512):
    s = size / 32
    img = Image.new("RGB", (size, size), "#5eead4")  # full bleed: iOS/Android round the corners
    d = ImageDraw.Draw(img)
    pts = [(7 * s, 21 * s), (13 * s, 15 * s), (17 * s, 19 * s), (25 * s, 10 * s)]
    w = max(2, round(3 * s))
    d.line(pts, fill="#0d1117", width=w, joint="curve")
    for x, y in pts[:-1]:
        d.ellipse([x - w / 2, y - w / 2, x + w / 2, y + w / 2], fill="#0d1117")
    r = 3 * s
    d.ellipse([25 * s - r, 10 * s - r, 25 * s + r, 10 * s + r], fill="#0d1117")
    img.save(os.path.join(OUT, f"icon-{size}.png"))
print("icons written to", OUT)

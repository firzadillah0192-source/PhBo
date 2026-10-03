import tempfile
import unittest
from pathlib import Path

from PIL import Image, ImageDraw

from classic_compositor import compose_classic, detect_slots


class ClassicTests(unittest.TestCase):
    def test_transparent_and_black_slots(self):
        for source in ("alpha", "black"):
            with self.subTest(source=source), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                frame = Image.new("RGBA", (120, 240), (0, 0, 0, 0))
                draw = ImageDraw.Draw(frame)
                draw.rectangle((5, 5, 114, 234), fill="gold")
                for y in (15, 70, 125, 180):
                    draw.rounded_rectangle((15, y, 104, y + 44), radius=8,
                                           fill=(0, 0, 0, 0 if source == "alpha" else 255))
                frame.save(root / "frame.png")
                self.assertEqual(len(detect_slots(frame, source)), 4)
                colors = ["red", "blue", "lime", "white"]
                paths = []
                for i, color in enumerate(colors):
                    path = root / f"photo{i}.png"
                    Image.new("RGB", (80, 160), color).save(path)
                    paths.append(path)
                for count in range(1, 5):
                    compose_classic(root / "frame.png", paths[:count], root / "result.png",
                                    slot_source=source)
                    with Image.open(root / "result.png") as result:
                        self.assertEqual(result.size, frame.size)
                        self.assertEqual(result.getpixel((0, 0)), (0, 0, 0, 0))
                        self.assertEqual(result.getpixel((10, 10)), frame.getpixel((10, 10)))
                        for i, y in enumerate((35, 90, 145, 200)):
                            with Image.open(paths[i % count]) as photo:
                                self.assertEqual(result.getpixel((60, y))[:3], photo.getpixel((0, 0)))
                with self.assertRaises(ValueError):
                    compose_classic(root / "frame.png", [], root / "result.png")
                with self.assertRaises(ValueError):
                    compose_classic(root / "frame.png", paths + paths[:1], root / "result.png")
                with self.assertRaises(ValueError):
                    compose_classic(root / "frame.png", paths[:1], paths[0])

    def test_no_holes_and_too_many_photos(self):
        with self.assertRaises(ValueError):
            detect_slots(Image.new("RGBA", (100, 100), "white"))
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            frame = Image.new("RGBA", (100, 100), "gold")
            ImageDraw.Draw(frame).rectangle((10, 10, 89, 89), fill=(0, 0, 0, 0))
            frame.save(root / "frame.png")
            with self.assertRaises(ValueError):
                compose_classic(root / "frame.png", [root / "a.png", root / "b.png"], root / "out.png")


if __name__ == "__main__":
    unittest.main()

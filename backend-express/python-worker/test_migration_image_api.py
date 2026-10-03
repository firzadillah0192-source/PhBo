import io
import json
import os
import unittest
from pathlib import Path
from fastapi.testclient import TestClient
from PIL import Image, ImageDraw
from basic_api import api


def encoded(image, format='PNG', **options):
    output = io.BytesIO()
    image.save(output, format=format, **options)
    return output.getvalue()


class MigrationImageApiTests(unittest.TestCase):
    def setUp(self):
        os.environ['AI_ENGINE_API_KEY'] = 'test-only-engine-key'
        self.client = TestClient(api)
        self.headers = {'Authorization': 'Bearer test-only-engine-key'}

    def test_normalization_auth_validation_exif_and_transparency(self):
        source = Image.new('RGB', (320, 480), 'red')
        exif = source.getexif()
        exif[274] = 6
        data = encoded(source, 'JPEG', exif=exif)
        self.assertEqual(self.client.post('/normalize-upload', files={'image': ('photo.jpg', data)}).status_code, 401)
        response = self.client.post('/normalize-upload', headers=self.headers, files={'image': ('photo.heic', data, 'image/heic')})
        self.assertEqual(response.status_code, 200, response.text[:200])
        with Image.open(io.BytesIO(response.content)) as result:
            self.assertEqual(result.size, (480, 320))
            self.assertEqual(result.format, 'JPEG')
            self.assertNotIn(274, result.getexif())
        transparent = encoded(Image.new('RGBA', (320, 480), (0, 0, 0, 0)))
        response = self.client.post('/normalize-upload', headers=self.headers, files={'image': ('photo.png', transparent, 'image/png')})
        self.assertEqual(response.status_code, 200)
        with Image.open(io.BytesIO(response.content)) as result:
            self.assertEqual(result.getpixel((160, 240)), (255, 255, 255))
        invalid = self.client.post('/normalize-upload', headers=self.headers, files={'image': ('photo.jpg', b'broken')})
        self.assertEqual(invalid.status_code, 422)
        self.assertEqual(invalid.json()['detail']['error_code'], 'IMAGE_DECODE_FAILED')

    def test_real_synthetic_heic_fixture(self):
        source = Path(os.environ['MIGRATION_HEIC_FIXTURE']).read_bytes()
        response = self.client.post('/normalize-upload', headers=self.headers, files={'image': ('photo.heic', source, 'image/heic')})
        self.assertEqual(response.status_code, 200, response.text[:200])
        with Image.open(io.BytesIO(response.content)) as result:
            self.assertEqual(result.format, 'JPEG')
            self.assertEqual(result.size, (480, 640))

    def test_classic_requires_exact_reviewed_geometry_and_preserves_overlay(self):
        slots = [{'x': 100, 'y': y, 'width': 1000, 'height': 850, 'fit': 'cover'} for y in (100, 1100, 2100)]
        frame = Image.new('RGBA', (1200, 3600), 'gold')
        draw = ImageDraw.Draw(frame)
        for slot in slots:
            draw.rectangle((slot['x'], slot['y'], slot['x'] + slot['width'] - 1, slot['y'] + slot['height'] - 1), fill=(0, 0, 0, 0))
        colors = ['red', 'blue', 'lime']
        files = [('images', ('photo.png', encoded(Image.new('RGB', (320, 480), color)), 'image/png')) for color in colors]
        files.append(('frame', ('frame.png', encoded(frame), 'image/png')))
        config = {'canvas_width': 1200, 'canvas_height': 3600, 'shot_count': 3, 'slots': slots}
        response = self.client.post('/compose-classic', headers=self.headers, data={'metadata': json.dumps(config)}, files=files)
        self.assertEqual(response.status_code, 200, response.text[:200])
        with Image.open(io.BytesIO(response.content)) as result:
            self.assertEqual(result.size, (1200, 3600))
            self.assertAlmostEqual(result.info['dpi'][0], 600, delta=0.1)
            self.assertEqual(result.getpixel((10, 10)), frame.getpixel((10, 10)))
            for color, slot in zip(colors, slots):
                self.assertEqual(result.getpixel((600, slot['y'] + 400))[:3], Image.new('RGB', (1, 1), color).getpixel((0, 0)))
        for invalid in [dict(config, shot_count=4), dict(config, canvas_width=600), dict(config, slots=[dict(slot, width=0) for slot in slots])]:
            self.assertEqual(self.client.post('/compose-classic', headers=self.headers, data={'metadata': json.dumps(invalid)}, files=files).status_code, 422)
        self.assertEqual(self.client.post('/compose-classic', data={'metadata': json.dumps(config)}, files=files).status_code, 401)


if __name__ == '__main__':
    unittest.main()

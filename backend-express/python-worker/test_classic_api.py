import io
import os
import unittest

from fastapi.testclient import TestClient
from PIL import Image, ImageDraw

from basic_api import api


def png(image):
    buffer = io.BytesIO()
    image.save(buffer, format='PNG')
    return buffer.getvalue()


class ClassicApiTests(unittest.TestCase):
    def test_health_is_available_without_authentication(self):
        client = TestClient(api)
        response = client.get('/health')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {'status': 'ok', 'service': 'classic-compositor'})

    def test_classic_multipart_and_limits(self):
        os.environ['AI_ENGINE_API_KEY'] = 'test-key'
        client = TestClient(api)
        headers = {'Authorization': 'Bearer test-key'}
        data = {'mode': 'CLASSIC', 'generationId': 'job'}
        frame = Image.new('RGBA', (120, 240), 'gold')
        draw = ImageDraw.Draw(frame)
        for y in (15, 70, 125, 180):
            draw.rectangle((15, y, 104, y + 44), fill=(0, 0, 0, 0))
        colors = ['red', 'blue', 'lime', 'white']
        photos = [('images', (f'{i}.png', png(Image.new('RGB', (80, 160), color)), 'image/png')) for i, color in enumerate(colors)]
        overlay = ('frame', ('frame.png', png(frame), 'image/png'))
        for count in range(1, 5):
            response = client.post('/generate', data=data, headers=headers, files=photos[:count] + [overlay])
            self.assertEqual(response.status_code, 200, response.text[:100])
            with Image.open(io.BytesIO(response.content)) as result:
                self.assertEqual(result.size, frame.size)
                for i, y in enumerate((35, 90, 145, 200)):
                    self.assertEqual(result.getpixel((60, y))[:3], Image.new('RGB', (1, 1), colors[i % count]).getpixel((0, 0)))
        self.assertEqual(client.post('/generate', data=data, files=photos[:1]).status_code, 401)
        self.assertEqual(client.post('/generate', data=data, headers=headers, files=photos + photos[:1] + [overlay]).status_code, 422)
        self.assertEqual(client.post('/generate', data=data, headers=headers, files=photos[:2]).status_code, 422)
        self.assertEqual(client.post('/generate', data=data, headers=headers, files=photos[:1]).status_code, 200)


if __name__ == '__main__':
    unittest.main()

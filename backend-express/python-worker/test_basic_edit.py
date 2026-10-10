import io
import os
import unittest
from unittest.mock import patch

import numpy as np
from PIL import Image, ImageDraw
from fastapi.testclient import TestClient
import basic_edit
from basic_api import api


CONTOUR = [(40, 35), (80, 35), (90, 65), (80, 95), (60, 110), (40, 95), (30, 65)]
ANCHORS = dict(left_eye=(45, 55), right_eye=(75, 55), nose=(60, 70), mouth=(60, 85), chin=(60, 110))


class BasicEditTests(unittest.TestCase):
    def setUp(self):
        self.base = Image.new('RGBA', (120, 180), (210, 110, 70, 255))
        self.edit = Image.new('RGBA', (120, 180), (80, 70, 40, 255))
        ImageDraw.Draw(self.edit).ellipse((45, 60, 75, 85), fill=(25, 20, 10, 255))
        self.geometry = patch('basic_edit.face_geometry', return_value=(CONTOUR, ANCHORS))
        self.geometry.start()
        self.addCleanup(self.geometry.stop)

    def test_frame_hair_body_footer_and_alpha_exactly_preserved(self):
        output = basic_edit.compose_basic_edit(basic_edit.encode(self.base), basic_edit.encode(self.edit))
        result = np.asarray(Image.open(io.BytesIO(output)))
        base = np.asarray(self.base)
        mask = np.asarray(basic_edit.face_mask(self.base.size, CONTOUR))
        self.assertTrue(np.array_equal(result[mask == 0], base[mask == 0]))
        self.assertTrue(np.array_equal(result[140:], base[140:]))
        self.assertTrue(np.array_equal(result[:, :, 3], base[:, :, 3]))
        self.assertFalse(np.array_equal(result[mask > 128], base[mask > 128]))
        self.assertEqual(Image.open(io.BytesIO(output)).size, self.base.size)

    def test_aspect_change_is_rejected_not_stretched(self):
        with self.assertRaisesRegex(basic_edit.BasicEditError, 'BASIC_EDIT_ASPECT_INVALID'):
            basic_edit.compose_basic_edit(basic_edit.encode(self.base), basic_edit.encode(Image.new('RGB', (120, 120))))

    def test_unchanged_template_cannot_be_reported_as_identity_success(self):
        with self.assertRaisesRegex(basic_edit.BasicEditError, 'BASIC_EDIT_UNCHANGED'):
            basic_edit.compose_basic_edit(basic_edit.encode(self.base), basic_edit.encode(self.base))

    def test_face_movement_rejected(self):
        shifted = {key: (x + 15, y) for key, (x, y) in ANCHORS.items()}
        with patch('basic_edit.face_geometry', side_effect=[(CONTOUR, ANCHORS), (CONTOUR, shifted)]):
            with self.assertRaisesRegex(basic_edit.BasicEditError, 'BASIC_EDIT_ALIGNMENT_INVALID'):
                basic_edit.compose_basic_edit(basic_edit.encode(self.base), basic_edit.encode(self.edit))

    def test_private_endpoints_require_auth_and_preserve_error_codes(self):
        os.environ['AI_ENGINE_API_KEY'] = 'test-key'
        client = TestClient(api)
        for path in ('prepare-basic-template', 'prepare-basic-identity', 'compose-basic-edit'):
            files = {'image': ('photo.png', basic_edit.encode(self.base), 'image/png')}
            if path == 'compose-basic-edit': files['template'] = files['image']
            self.assertEqual(client.post('/' + path, files=files).status_code, 401)
        with patch('basic_edit.prepare_identity', side_effect=basic_edit.BasicEditError('BASIC_FACE_NOT_FOUND')):
            response = client.post('/prepare-basic-identity', headers={'Authorization': 'Bearer test-key'}, files={'image': ('photo.png', basic_edit.encode(self.base), 'image/png')})
            self.assertEqual(response.status_code, 422)
            self.assertEqual(response.json()['detail']['error_code'], 'BASIC_FACE_NOT_FOUND')

    def test_context_scan_maps_back_to_original_coordinates_and_merges_duplicates(self):
        self.geometry.stop()
        from app.generation.basic.errors import BasicFaceNotFoundError
        pixels = np.zeros((300,200,3),dtype='uint8')
        pixels[:,:,0] = np.arange(200)[None,:]
        pixels[:,:,1] = np.arange(300,dtype='uint16')[:,None] % 256
        image = Image.fromarray(pixels)
        contour = [(80,40),(110,40),(110,90),(80,90)]
        anchors = {'left_eye':(85,55),'right_eye':(100,55),'nose':(90,65),'mouth':(90,80),'chin':(90,90)}
        def detect(crop):
            if crop.size == image.size: raise BasicFaceNotFoundError('missing')
            left,top,_ = crop.getpixel((0,0))
            shifted = [(x-left,y-top) for x,y in contour]
            if any(x<=0 or y<=0 or x>=crop.width-1 or y>=crop.height-1 for x,y in shifted):
                raise BasicFaceNotFoundError('missing')
            return shifted, {key:(x-left,y-top) for key,(x,y) in anchors.items()}, {'chin':np.asarray([90-left,90-top])}
        with patch('basic_edit._face_geometry_once',side_effect=detect):
            result = basic_edit.face_geometry(image,scan=True)
            self.assertEqual(result[0],contour);self.assertEqual(result[1],anchors)
            self.assertTrue(np.array_equal(result[2]['chin'],[90,90]))

    def test_source_photo_does_not_use_template_context_scan(self):
        self.geometry.stop()
        from app.generation.basic.errors import BasicFaceNotFoundError
        with patch('basic_edit._face_geometry_once',side_effect=BasicFaceNotFoundError('missing')) as detector:
            with self.assertRaises(BasicFaceNotFoundError): basic_edit.face_geometry(self.base)
            self.assertEqual(detector.call_count,1)

    def test_multiple_faces_cannot_be_bypassed_by_template_scan(self):
        self.geometry.stop()
        from app.generation.basic.errors import BasicMultipleFacesError
        with patch('basic_edit._face_geometry_once',side_effect=BasicMultipleFacesError('multiple')) as detector:
            with self.assertRaises(BasicMultipleFacesError): basic_edit.face_geometry(self.base,scan=True)
            self.assertEqual(detector.call_count,1)

    def test_template_and_generated_face_errors_do_not_blame_user_photo(self):
        from app.generation.basic.errors import BasicFaceNotFoundError
        for stage in ('TEMPLATE','EDIT'):
            with patch('basic_edit.face_geometry',side_effect=BasicFaceNotFoundError('missing')):
                with self.assertRaisesRegex(basic_edit.BasicEditError,'BASIC_'+stage+'_FACE_NOT_FOUND'):
                    basic_edit.staged_geometry(self.base,stage)

    def test_advanced_preparation_does_not_add_black_footer(self):
        from print_preparation import prepare_advanced_result
        white = Image.new('RGB', (2160, 3240), 'white')
        result = Image.open(io.BytesIO(prepare_advanced_result(basic_edit.encode(white))))
        self.assertEqual(result.getpixel((500, 3000)), (255, 255, 255))


if __name__ == '__main__':
    unittest.main()

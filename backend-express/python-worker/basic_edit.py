"""Template-preserving composition of a provider-edited face, never a source sticker."""
import io
import math

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageOps


class BasicEditError(ValueError):
    def __init__(self, code):
        super().__init__(code)
        self.code = code


def load(data):
    with Image.open(io.BytesIO(data)) as source:
        if source.width * source.height > 25_000_000:
            raise BasicEditError('BASIC_INPUT_INVALID')
        source.load()
        return ImageOps.exif_transpose(source).convert('RGBA')


def _face_geometry_once(image):
    # Reuse the production detector/model and thresholds, without tuning them.
    from app.generation.basic.landmarks import detect_exactly_one_face
    from app.generation.basic.real_landmarks import detect_real_dense_landmarks
    bgr = np.asarray(image.convert('RGB'))[:, :, ::-1].copy()
    box = detect_exactly_one_face(bgr)
    dense, anchors, _ = detect_real_dense_landmarks(bgr, box)
    contour = [dense.points[name] for name in sorted(dense.points) if name.startswith('inner_boundary_')]
    if len(contour) < 3:
        raise BasicEditError('BASIC_LANDMARKS_UNAVAILABLE')
    return contour, anchors, dense.points


def _scan_positions(length, side):
    return sorted(set(list(range(0, length-side+1, max(1, side//2))) + [length-side]))


def face_geometry(image, scan=False):
    from app.generation.basic.errors import BasicFaceNotFoundError, BasicMultipleFacesError
    try:
        return _face_geometry_once(image)
    except BasicFaceNotFoundError:
        if not scan:
            raise
    # Scan overlapping contexts with the SAME detector, model and thresholds.
    side = min(max(64, min(image.size)*3//5), *image.size)
    candidates = []
    for top in _scan_positions(image.height, side):
        for left in _scan_positions(image.width, side):
            try:
                contour, anchors, points = _face_geometry_once(image.crop((left, top, left+side, top+side)))
            except BasicFaceNotFoundError:
                continue
            if any(x <= 0 or y <= 0 or x >= side-1 or y >= side-1 for x,y in contour):
                continue
            shifted = [(float(x)+left, float(y)+top) for x,y in contour]
            bounds = (min(x for x,y in shifted), min(y for x,y in shifted), max(x for x,y in shifted), max(y for x,y in shifted))
            margin = min(min(x,y,side-1-x,side-1-y) for x,y in contour)
            geometry = (shifted, {key:(float(x)+left,float(y)+top) for key,(x,y) in anchors.items()},
                        {key:np.asarray(value)+[left,top] for key,value in points.items()})
            match = None
            for index,(previous,_,_) in enumerate(candidates):
                intersection = max(0,min(bounds[2],previous[2])-max(bounds[0],previous[0])) * max(0,min(bounds[3],previous[3])-max(bounds[1],previous[1]))
                area = (bounds[2]-bounds[0])*(bounds[3]-bounds[1])
                old_area = (previous[2]-previous[0])*(previous[3]-previous[1])
                if intersection/max(area+old_area-intersection,1) >= .4:
                    match=index
                    break
            if match is None:
                candidates.append((bounds,margin,geometry))
            elif margin > candidates[match][1]:
                candidates[match]=(bounds,margin,geometry)
    if not candidates:
        raise BasicFaceNotFoundError('BASIC_FACE_NOT_FOUND: no complete face detected')
    if len(candidates) != 1:
        raise BasicMultipleFacesError('BASIC_MULTIPLE_FACES: multiple distinct faces detected')
    return candidates[0][2]


def staged_geometry(image, stage):
    from app.generation.basic.errors import BasicGenerationError
    try:
        return face_geometry(image, scan=True)
    except BasicGenerationError as error:
        suffix = {'BASIC_FACE_NOT_FOUND':'FACE_NOT_FOUND', 'BASIC_MULTIPLE_FACES':'MULTIPLE_FACES',
                  'BASIC_LANDMARKS_UNAVAILABLE':'LANDMARKS_UNAVAILABLE'}.get(error.code)
        if suffix:
            raise BasicEditError(f'BASIC_{stage}_{suffix}') from None
        raise


def encode(image, format='PNG'):
    output = io.BytesIO()
    if format == 'JPEG':
        image.convert('RGB').save(output, format=format, quality=95)
    else:
        image.save(output, format=format)
    return output.getvalue()


def prepare_identity(data):
    image = load(data)
    face_geometry(image)
    from app.services.image_validation import normalize_for_provider
    output, _ = normalize_for_provider(encode(image, 'JPEG'))
    return output


def prepare_template(data):
    image = load(data)
    staged_geometry(image, 'TEMPLATE')
    return encode(image)


def face_mask(size, contour):
    if not all(math.isfinite(float(v)) for point in contour for v in point):
        raise BasicEditError('BASIC_GEOMETRY_INVALID')
    if any(x < 0 or y < 0 or x >= size[0] or y >= size[1] for x, y in contour):
        raise BasicEditError('BASIC_GEOMETRY_INVALID')
    mask = Image.new('L', size, 0)
    ImageDraw.Draw(mask).polygon([(float(x), float(y)) for x, y in contour], fill=255)
    # Feather inward. Pixels outside the detected template face stay EXACTLY unchanged.
    width = max(x for x, _ in contour) - min(x for x, _ in contour)
    radius = max(1, round(width * .035))
    eroded = mask.filter(ImageFilter.MinFilter(2 * radius + 1))
    soft = np.minimum(np.asarray(mask), np.asarray(eroded.filter(ImageFilter.GaussianBlur(radius))))
    return Image.fromarray(soft.astype('uint8'), 'L')


def compose_basic_edit(template_data, edited_data):
    template, edited = load(template_data), load(edited_data)
    ratio = template.width / template.height
    if abs(edited.width / edited.height / ratio - 1) > .005:
        raise BasicEditError('BASIC_EDIT_ASPECT_INVALID')
    edited = ImageOps.fit(edited, template.size, method=Image.Resampling.LANCZOS)
    target_geometry, actual_geometry = staged_geometry(template, 'TEMPLATE'), staged_geometry(edited, 'EDIT')
    contour, target = target_geometry[:2]
    actual_contour, actual = actual_geometry[:2]
    eye_span = math.dist(target['left_eye'], target['right_eye'])
    # Eyes must remain registered to the template head. Jaw/mouth proportions
    # can differ with identity; reject gross movement rather than deforming them.
    if eye_span < 8 or any(math.dist(target[key], actual[key]) > eye_span * .20 for key in ('left_eye', 'right_eye')) or any(math.dist(target[key], actual[key]) > eye_span for key in ('nose', 'mouth', 'chin')):
        raise BasicEditError('BASIC_EDIT_ALIGNMENT_INVALID')
    import cv2
    target_area = abs(cv2.contourArea(np.asarray(contour, dtype='float32')))
    edited_area = abs(cv2.contourArea(np.asarray(actual_contour, dtype='float32')))
    if target_area < 100 or not .65 <= edited_area / target_area <= 1.5:
        raise BasicEditError('BASIC_GEOMETRY_INVALID')
    # Both detected contours define the intended edit area. This allows a
    # natural identity jaw without clipping it to the original actor's jaw.
    # Hair, costume, scene and footer outside this bounded region are immutable.
    mask = Image.fromarray(np.maximum(np.asarray(face_mask(template.size, contour)), np.asarray(face_mask(template.size, actual_contour))), 'L')
    aligned = edited.convert('RGB')
    changed = np.abs(np.asarray(aligned, dtype='int16') - np.asarray(template.convert('RGB'), dtype='int16'))
    if not np.any(np.asarray(mask) > 128) or float(changed[np.asarray(mask) > 128].mean()) < .5:
        raise BasicEditError('BASIC_EDIT_UNCHANGED')
    # Gradient-domain blending matches the existing scene illumination at the
    # face boundary, avoiding a webcam-colored sticker edge on the neck/hair.
    binary = np.where(np.asarray(mask) > 16, 255, 0).astype('uint8')
    ys, xs = np.nonzero(binary)
    center = ((int(xs.min()) + int(xs.max())) // 2, (int(ys.min()) + int(ys.max())) // 2)
    blended = cv2.seamlessClone(np.asarray(aligned)[:, :, ::-1].copy(), np.asarray(template.convert('RGB'))[:, :, ::-1].copy(), binary, center, cv2.NORMAL_CLONE)
    output = Image.composite(Image.fromarray(blended[:, :, ::-1]).convert('RGBA'), template, mask)
    # Preserve original alpha too; the edit cannot introduce transparent face pixels.
    output.putalpha(template.getchannel('A'))
    final_change = np.abs(np.asarray(output.convert('RGB'), dtype='int16') - np.asarray(template.convert('RGB'), dtype='int16'))
    if float(final_change[np.asarray(mask) > 128].mean()) < .5:
        raise BasicEditError('BASIC_EDIT_UNCHANGED')
    return encode(output)

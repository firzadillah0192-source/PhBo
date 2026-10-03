"""Private image normalization and Classic composition helpers for Express."""
import io
import json
import os
import secrets
import tempfile
from pathlib import Path
from types import SimpleNamespace

from fastapi import FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.responses import Response
from PIL import Image
from starlette.concurrency import run_in_threadpool
from classic_compositor import compose_classic


api = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
MAX_BYTES = 25 * 1024 * 1024


def require_engine_key(authorization):
    key = os.environ.get('AI_ENGINE_API_KEY', '')
    if not key or not secrets.compare_digest(authorization or '', f'Bearer {key}'):
        raise HTTPException(401, detail={'error_code': 'UNAUTHORIZED'})


async def image_bytes(upload):
    try:
        data = await upload.read(MAX_BYTES + 1)
    finally:
        await upload.close()
    if not data or len(data) > MAX_BYTES:
        raise HTTPException(422, detail={'error_code': 'INPUT_INVALID'})
    return data


@api.post('/prepare-provider')
async def prepare_provider(image: UploadFile = File(...), authorization: str | None = Header(default=None)):
    require_engine_key(authorization)
    data = await image_bytes(image)
    from app.services.image_validation import normalize_for_provider, ImageValidationError
    try:
        output, mime = await run_in_threadpool(normalize_for_provider, data)
        return Response(output, media_type=mime)
    except ImageValidationError as error:
        raise HTTPException(422, detail={'error_code': error.code, 'message': error.message}) from None


@api.post('/prepare-advanced')
async def prepare_advanced(image: UploadFile = File(...), authorization: str | None = Header(default=None)):
    require_engine_key(authorization)
    data = await image_bytes(image)
    from app.services.branding import prepare_advanced_result
    try:
        output = await run_in_threadpool(prepare_advanced_result, data)
        return Response(output, media_type='image/png')
    except (OSError, ValueError, Image.DecompressionBombError):
        raise HTTPException(422, detail={'error_code': 'GENERATION_IMAGE_INVALID'}) from None


@api.post('/compose-classic')
async def compose_reviewed_classic(metadata: str = Form(...), images: list[UploadFile] = File(...),
                                  frame: UploadFile = File(...), authorization: str | None = Header(default=None)):
    """Native Express supplies reviewed registry geometry; never infer slots."""
    key = os.environ.get('AI_ENGINE_API_KEY', '')
    if not key or not secrets.compare_digest(authorization or '', f'Bearer {key}'):
        raise HTTPException(401, detail={'error_code': 'UNAUTHORIZED'})
    try:
        if len(metadata) > 32768:
            raise ValueError()
        config = json.loads(metadata)
        width, height, count = (config[name] for name in ('canvas_width', 'canvas_height', 'shot_count'))
        if not all(type(value) is int for value in (width, height, count)) or (width, height) != (1200, 3600) or not 1 <= count <= 4 or len(images) != count:
            raise ValueError()
        slots = config['slots']
        if not isinstance(slots, list) or len(slots) != count:
            raise ValueError()
        for slot in slots:
            if not isinstance(slot, dict) or any(type(slot.get(name)) is not int for name in ('x', 'y', 'width', 'height')):
                raise ValueError()
    except (ValueError, KeyError, TypeError):
        raise HTTPException(422, detail={'error_code': 'CLASSIC_LAYOUT_INVALID'}) from None

    async def read(upload):
        try:
            data = await upload.read(MAX_BYTES + 1)
        finally:
            await upload.close()
        if not data or len(data) > MAX_BYTES:
            raise HTTPException(422, detail={'error_code': 'CLASSIC_INPUT_INVALID'})
        return data

    captures = [await read(upload) for upload in images]
    overlay = await read(frame)

    def render_reviewed():
        from app.services.classic import compose_classic as compose, ClassicLayoutError
        with tempfile.TemporaryDirectory(prefix='nx-classic-reviewed-') as directory:
            asset = Path(directory) / 'frame.png'
            asset.write_bytes(overlay)
            layout = SimpleNamespace(canvas_width=width, canvas_height=height, shot_count=count,
                                     layout_config_json=json.dumps({'slots': slots}), frame_asset_path=str(asset))
            try:
                result = compose(layout, captures)
            except (ClassicLayoutError, Image.DecompressionBombError, OSError):
                raise HTTPException(422, detail={'error_code': 'CLASSIC_INPUT_INVALID'}) from None
            if len(result) > MAX_BYTES:
                raise HTTPException(422, detail={'error_code': 'CLASSIC_INPUT_INVALID'})
            return result

    return Response(await run_in_threadpool(render_reviewed), media_type='image/png')


@api.post('/normalize-upload')
async def normalize_upload(image: UploadFile = File(...), authorization: str | None = Header(default=None)):
    """Image-only boundary: no accounts, database, quota, job or upload writes."""
    key = os.environ.get('AI_ENGINE_API_KEY', '')
    if not key or not secrets.compare_digest(authorization or '', f'Bearer {key}'):
        raise HTTPException(401, detail={'error_code': 'UNAUTHORIZED'})
    data = await image.read(MAX_BYTES + 1)
    await image.close()
    if not data or len(data) > MAX_BYTES:
        raise HTTPException(422, detail={'error_code': 'VALIDATION_FAILED', 'message': 'The photo could not be validated.'})

    def normalize():
        from app.services.image_validation import decode_image_bytes, validate_decoded_dimensions, normalize_decoded_image, validate_canonical_image
        decoded = decode_image_bytes(data, content_type=image.content_type)
        validate_decoded_dimensions(decoded)
        canonical = normalize_decoded_image(decoded)
        validate_canonical_image(canonical)
        return canonical

    from app.services.image_validation import ImageValidationError
    try:
        result = await run_in_threadpool(normalize)
        return Response(result, media_type='image/jpeg')
    except ImageValidationError as error:
        raise HTTPException(422, detail={'error_code': error.code, 'message': error.message}) from None


@api.get('/health')
async def health():
    return {'status': 'ok', 'service': 'classic-compositor'}


@api.post('/generate')
async def generate(image: UploadFile | None = File(default=None), mode: str = Form(...),
                   generationId: str = Form(...),
                   images: list[UploadFile] | None = File(default=None), frame: UploadFile | None = File(default=None),
                   authorization: str | None = Header(default=None)):
    key = os.environ.get('AI_ENGINE_API_KEY', '')
    if not key or not secrets.compare_digest(authorization or '', f'Bearer {key}'):
        raise HTTPException(401, detail={'error_code': 'UNAUTHORIZED'})
    if mode == 'CLASSIC':
        if image or not images or not 1 <= len(images) <= 4 or (len(images) > 1 and not frame):
            raise HTTPException(422, detail={'error_code': 'INPUT_INVALID'})
        async def read_file(upload):
            try:
                data = await upload.read(MAX_BYTES + 1)
            finally:
                await upload.close()
            if not data or len(data) > MAX_BYTES:
                raise HTTPException(422, detail={'error_code': 'INPUT_INVALID'})
            return data
        photo_data = [await read_file(upload) for upload in images]
        frame_data = await read_file(frame) if frame else None
        try:
            result = await run_in_threadpool(render_classic, photo_data, frame_data)
            return Response(result, media_type='image/png')
        except (ValueError, OSError, Image.DecompressionBombError):
            raise HTTPException(422, detail={'error_code': 'CLASSIC_INPUT_INVALID'}) from None
    raise HTTPException(422, detail={'error_code': 'INPUT_INVALID'})


def render_classic(photos: list[bytes], frame: bytes | None) -> bytes:
    with tempfile.TemporaryDirectory(prefix='nx-classic-') as directory:
        root = Path(directory)
        paths = []
        for index, data in enumerate(photos):
            path = root / f'photo-{index}.png'
            with Image.open(io.BytesIO(data)) as image:
                if image.width * image.height > 25_000_000:
                    raise ValueError('Photo exceeds 25 megapixels')
                image.load()
            path.write_bytes(data)
            paths.append(path)
        output = root / 'result.png'
        if frame:
            with Image.open(io.BytesIO(frame)) as image:
                if image.width * image.height > 25_000_000:
                    raise ValueError('Frame exceeds 25 megapixels')
                image.load()
            frame_path = root / 'frame.png'
            frame_path.write_bytes(frame)
            compose_classic(frame_path, paths, output)
        else:
            from classic_compositor import load_image
            load_image(paths[0]).save(output, format='PNG')
        if output.stat().st_size > MAX_BYTES:
            raise ValueError('Output exceeds 25 MB')
        return output.read_bytes()

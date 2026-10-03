"""HTTP boundary around the original PhBo BASIC engine, without DB writes."""
import io
import os
import re
import secrets
import tempfile
from pathlib import Path

from fastapi import FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.responses import Response
from PIL import Image
from starlette.concurrency import run_in_threadpool
from classic_compositor import compose_classic


api = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
MAX_BYTES = 25 * 1024 * 1024
Image.MAX_IMAGE_PIXELS = 25_000_000


@api.get('/health')
async def health():
    return {'status': 'ok', 'service': 'classic-compositor'}


def render(data: bytes, template_id: str) -> bytes:
    from app.generation.basic import get_basic_engine
    from app.templates_registry import get_registry
    from app.core.config import get_settings
    template = get_registry().get(template_id)
    root = get_settings().templates_dir.resolve()
    asset = (root / template_id / (template.asset_filename or '')).resolve()
    if not asset.is_relative_to(root) or not asset.is_file():
        raise HTTPException(422, detail={'error_code': 'BASIC_TEMPLATE_METADATA_MISSING'})
    with tempfile.TemporaryDirectory(prefix='nx-basic-') as directory:
        source = Path(directory) / 'source.png'
        output = Path(directory) / 'result.png'
        with Image.open(io.BytesIO(data)) as image:
            image.load()
            if image.width * image.height > 25_000_000:
                raise HTTPException(422, detail={'error_code': 'INPUT_INVALID'})
            image.convert('RGB').save(source)
        get_basic_engine().generate(user_image_path=source, template_id=template_id,
            output_path=output, options={'template': template, 'template_path': asset})
        if not output.is_file() or not 0 < output.stat().st_size <= MAX_BYTES:
            raise HTTPException(502, detail={'error_code': 'BASIC_ENGINE_ERROR'})
        result = output.read_bytes()
        with Image.open(io.BytesIO(result)) as image:
            image.load()
            if image.format != 'PNG':
                raise HTTPException(502, detail={'error_code': 'BASIC_ENGINE_ERROR'})
        return result


@api.post('/generate')
async def generate(image: UploadFile | None = File(default=None), mode: str = Form(...),
                   generationId: str = Form(...), templateId: str | None = Form(default=None),
                   images: list[UploadFile] | None = File(default=None), frame: UploadFile | None = File(default=None),
                   authorization: str | None = Header(default=None)):
    key = os.environ.get('AI_ENGINE_API_KEY', '')
    if not key or not secrets.compare_digest(authorization or '', f'Bearer {key}'):
        raise HTTPException(401, detail={'error_code': 'UNAUTHORIZED'})
    if mode == 'CLASSIC':
        if image or templateId or not images or not 1 <= len(images) <= 4 or (len(images) > 1 and not frame):
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
    if mode != 'BASIC' or not image or not templateId or not re.fullmatch(r'[a-zA-Z0-9_-]{1,120}', templateId) or images or frame:
        raise HTTPException(422, detail={'error_code': 'INPUT_INVALID'})
    data = await image.read(MAX_BYTES + 1)
    await image.close()
    if not data or len(data) > MAX_BYTES:
        raise HTTPException(422, detail={'error_code': 'INPUT_INVALID'})
    from app.templates_registry import TemplateNotFound
    from app.generation.basic import BasicGenerationError
    try:
        result = await run_in_threadpool(render, data, templateId)
        return Response(result, media_type='image/png')
    except TemplateNotFound:
        raise HTTPException(404, detail={'error_code': 'TEMPLATE_NOT_FOUND'}) from None
    except BasicGenerationError as error:
        raise HTTPException(422, detail={'error_code': error.code}) from None
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(502, detail={'error_code': 'BASIC_ENGINE_ERROR'}) from None


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

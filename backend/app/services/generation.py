"""Generation job processor.

Shared by the worker process and (in tests) invoked directly. Implements the
state machine QUEUED -> PROCESSING -> COMPLETED | FAILED with honest error
codes. Never fabricates a result image.
"""

from __future__ import annotations

import io
import json
import logging
from datetime import datetime, timezone
from dataclasses import replace
from pathlib import Path

from PIL import Image
from sqlalchemy.orm import Session

from app.ai.base import AIProviderError, GenerationOptions
from app.ai.factory import get_provider
from app.catalog import ExperienceNotFound, experience_definition, get_experience_row, get_template_row, template_definition
from app.core.config import get_settings
from app.db import SessionLocal
from app.generation.basic import BasicGenerationError, get_basic_engine
from app.generation.basic.engine import make_session_output
from app.models import ErrorCode, GenerationJob, GenerationMode, JobState, Result, ClassicLayout, Upload, AdvancedFrameStyle, AdvancedOrnament
from app.services.provider_runs import complete_provider_run, fail_provider_run, start_provider_run
from app.services import storage
from app.services.control_plane import record_generation_event
from app.services.diagnostics import log_image_event
from app.services.quota import settle_for_job
from app.services.classic import ClassicLayoutError, compose_classic
from app.services.advanced_prompt import AdvancedSelectionError, compose_advanced_prompt, validate_advanced_selection
from app.services.branding import prepare_advanced_result
from app.templates_registry import TemplateNotFound

logger = logging.getLogger("photobooth.generation")


def _now() -> datetime:
    return datetime.now(timezone.utc)


def process_job(job_id: str, *, db: Session | None = None) -> str:
    """Run one generation job. Returns the resulting state.

    All failure modes are caught and persisted with an explicit error_code so
    the frontend always learns the truth instead of hanging or guessing.
    """
    own_session = db is None
    session = db or SessionLocal()
    try:
        job = session.get(GenerationJob, job_id)
        if job is None:
            print(f"[worker] job {job_id} not found in database", flush=True)
            return JobState.FAILED

        if job.state in (JobState.COMPLETED, JobState.FAILED):
            return job.state

        job.state = JobState.PROCESSING
        job.started_at = _now()
        job.error_code = None
        job.error_message = None
        record_generation_event(session, job.id, "processing_started", "Worker started processing")
        session.commit()

        try:
            _run_generation(session, job)
        except TemplateNotFound as exc:
            _fail(session, job, ErrorCode.TEMPLATE_NOT_FOUND, str(exc))
        except ExperienceNotFound as exc:
            _fail(session, job, ErrorCode.EXPERIENCE_NOT_FOUND, str(exc))
        except AIProviderError as exc:
            # Surfaces AI_PROVIDER_NOT_CONNECTED / AI_PROVIDER_ERROR / AI_EMPTY_RESULT
            _fail(session, job, exc.code, exc.message, detail=exc.detail)
        except BasicGenerationError as exc:
            _fail(session, job, exc.code, exc.message)
        except ClassicLayoutError as exc:
            _fail(session, job, "CLASSIC_LAYOUT_INVALID", str(exc))
        except AdvancedSelectionError as exc:
            _fail(session, job, "ADVANCED_SELECTION_INVALID", str(exc))
        except FileNotFoundError:
            _fail(
                session,
                job,
                ErrorCode.UPLOAD_NOT_FOUND,
                "The uploaded photo is no longer available. Please upload it again.",
            )
        except Exception as exc:  # noqa: BLE001 - must never leave a job stuck
            logger.error(
                "generation_worker_unexpected_failure job_id=%s error_type=%s",
                job_id,
                type(exc).__name__,
            )
            _fail(
                session,
                job,
                ErrorCode.INTERNAL_ERROR,
                "Generation failed unexpectedly. Please try again.",
            )

        session.refresh(job)
        return job.state
    finally:
        if own_session:
            session.close()


def _run_generation(session: Session, job: GenerationJob) -> None:
    """Happy path: load upload -> provider.generate -> persist result."""
    settings = get_settings()

    upload = job.upload
    if upload is None:
        raise FileNotFoundError(f"upload row missing for job {job.id}")

    template_row = get_template_row(session, job.template_id) if job.mode == GenerationMode.BASIC else None
    if job.mode == GenerationMode.BASIC:
        if template_row is None:
            raise TemplateNotFound(job.template_id)
        template = template_definition(session, job.template_id)
    else:
        template = None
    experience = (
        experience_definition(session, job.experience_id)
        if job.mode == GenerationMode.ADVANCED and job.experience_id
        else None
    )

    try:
        user_image = storage.read_file(upload.storage_path)
    except OSError:
        raise FileNotFoundError("temporary uploaded photo unavailable") from None
    log_image_event(
        logger,
        "reference_prepared",
        upload_id=upload.id,
        job_id=job.id,
        mode=job.mode,
        content_type=upload.content_type,
        detected_format=upload.format,
        size_bytes=len(user_image),
    )

    if job.mode == GenerationMode.CLASSIC:
        layout = session.get(ClassicLayout, job.layout_id)
        if layout is None:
            raise ClassicLayoutError("Classic layout is unavailable")
        capture_ids = json.loads(job.capture_upload_ids_json or "[]")
        if len(capture_ids) != layout.shot_count or not capture_ids or capture_ids[0] != upload.id:
            raise ClassicLayoutError("Classic capture count is invalid")
        captures = []
        for capture_id in capture_ids:
            capture = session.get(Upload, capture_id)
            if capture is None:
                raise FileNotFoundError("Classic capture unavailable")
            captures.append(storage.read_file(capture.storage_path))
        image_bytes = compose_classic(layout, captures)
        content_type = "image/png"
        job.provider = "local"
        job.model = "classic-compositor"
    elif job.mode == GenerationMode.BASIC:
        settings.ensure_runtime_dirs()
        template_path = Path(template_row.image_path)
        if not template_path.is_file():
            raise BasicGenerationError(
                f"BASIC_TEMPLATE_METADATA_MISSING: template asset missing for '{job.template_id}'",
                code=ErrorCode.BASIC_TEMPLATE_METADATA_MISSING,
            )
        output_path = make_session_output(settings.tmp_dir, job.id)
        basic_result = get_basic_engine().generate(
            user_image_path=upload.storage_path,
            template_id=template.id if template else "",
            output_path=output_path,
            options={"template": template, "template_path": template_path},
        )
        if not output_path.exists() or output_path.stat().st_size == 0:
            raise BasicGenerationError(
                "BASIC_ENGINE_ERROR: engine returned without a real PNG output"
            )
        image_bytes = output_path.read_bytes()
        content_type = "image/png"
        job.provider = "local"
        job.model = basic_result.engine_name
    elif job.mode == GenerationMode.ADVANCED:
        provider = get_provider()
        if experience is None:
            raise ValueError("ADVANCED experience preset is missing")
        experience_row = get_experience_row(session, job.experience_id)
        frame = session.get(AdvancedFrameStyle, job.frame_style_id)
        ornament_ids = json.loads(job.ornament_ids_json or "[]")
        ornaments = [session.get(AdvancedOrnament, ornament_id) for ornament_id in ornament_ids]
        validate_advanced_selection(experience_row, frame, [item for item in ornaments if item], ornament_ids)
        prompt = compose_advanced_prompt(experience.prompt, frame.prompt_fragment)
        composed_experience = replace(experience, prompt=prompt)

        job.provider = provider.name
        job.model = experience.model
        provider_run = start_provider_run(
            session,
            job=job,
            provider_name=provider.name,
            provider_model=experience.model,
        )
        session.commit()
        try:
            if not provider.is_available():
                from app.ai.base import ProviderNotConnectedError

                raise ProviderNotConnectedError(
                    "AI_PROVIDER_NOT_CONNECTED: provider "
                    f"'{provider.name}' is configured but has no usable credentials. "
                    "Set NINEROUTER_API_KEY (and NINEROUTER_BASE_URL) in the environment.",
                    operational_meta={"upstream_status": "NOT_CONNECTED", "retry_count": 0},
                )
            log_image_event(
                logger,
                "provider_request_started",
                upload_id=upload.id,
                job_id=job.id,
                content_type=upload.content_type,
                size_bytes=len(user_image),
            )
            ai_result = provider.generate(
                user_image,
                None,
                GenerationOptions(
                    width=1024,
                    height=1024,
                    extra={"experience": composed_experience, "prompt_override": prompt},
                ),
            )
            if not ai_result.image_bytes:
                from app.ai.base import ProviderEmptyResultError
                raise ProviderEmptyResultError("AI_EMPTY_RESULT: provider returned no image bytes")
            log_image_event(
                logger,
                "provider_response_received",
                upload_id=upload.id,
                job_id=job.id,
                content_type=ai_result.content_type,
                size_bytes=len(ai_result.image_bytes or b""),
            )
        except Exception as exc:  # provider boundary: persist every terminal failure
            fail_provider_run(session, provider_run, exc)
            record_generation_event(
                session,
                job.id,
                "provider_run_failed",
                str(getattr(exc, "code", ErrorCode.INTERNAL_ERROR)),
                metadata={"provider_run_id": provider_run.id, "provider": provider_run.provider_name},
            )
            session.commit()
            raise

        complete_provider_run(session, provider_run, ai_result)
        record_generation_event(
            session,
            job.id,
            "provider_run_succeeded",
            "Provider execution metadata recorded",
            metadata={
                "provider_run_id": provider_run.id,
                "provider": provider_run.provider_name,
                "usage_available": provider_run.provider_usage_raw_json is not None,
                "account_available": bool(
                    provider_run.provider_account_id or provider_run.provider_account_label
                ),
            },
        )
        image_bytes = prepare_advanced_result(ai_result.image_bytes)
        content_type = "image/png"
        job.provider = ai_result.provider
        job.model = ai_result.model
    else:
        raise ValueError(f"Unsupported generation mode: {job.mode}")

    if not image_bytes:
        from app.ai.base import ProviderEmptyResultError

        raise ProviderEmptyResultError("AI_EMPTY_RESULT: generation engine returned zero bytes.")

    # Verify the provider actually returned a decodable image before we claim
    # success. A non-image blob must never become a COMPLETED job.
    with Image.open(io.BytesIO(image_bytes)) as out_img:
        out_img.load()
        out_w, out_h = out_img.size

    result_id = _new_id()
    result_path = storage.save_result(
        result_id=result_id,
        data=image_bytes,
        content_type=content_type,
    )

    result = Result(
        id=result_id,
        job_id=job.id,
        template_id=template.id if template else job.layout_id or "",
        storage_path=str(result_path),
        content_type=content_type,
        size_bytes=len(image_bytes),
        width=out_w,
        height=out_h,
        sha256=_sha(image_bytes),
        provider=job.provider,
        model=job.model,
    )
    session.add(result)

    settle_for_job(session, job.id, successful=True)
    record_generation_event(session, job.id, "result_stored", "Generation result stored")
    job.state = JobState.COMPLETED
    job.finished_at = _now()
    job.error_code = None
    job.error_message = None
    session.commit()

    print(
        f"[worker] job {job.id} COMPLETED result={result_id} "
        f"{out_w}x{out_h} {len(image_bytes)}B "
        f"provider={job.provider} model={job.model}",
        flush=True,
    )


def _fail(
    session: Session,
    job: GenerationJob,
    code: str,
    message: str,
    *,
    detail: str | None = None,
) -> None:
    log_image_event(
        logger,
        "generation_failed",
        upload_id=job.upload_id,
        job_id=job.id,
        mode=job.mode,
        failure_code=code,
    )
    job.state = JobState.FAILED
    settle_for_job(session, job.id, successful=False)
    record_generation_event(session, job.id, "job_failed", code)
    job.error_code = code
    job.error_message = message if not detail else f"{message} | {detail[:800]}"
    job.finished_at = _now()
    session.commit()
    logger.warning("generation_job_failed job_id=%s code=%s", job.id, code)


def _new_id() -> str:
    import uuid

    return uuid.uuid4().hex


def _sha(data: bytes) -> str:
    import hashlib

    return hashlib.sha256(data).hexdigest()

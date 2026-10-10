"""Three-mode integration tests with synthetic photographs and a provider test double."""

from __future__ import annotations

import io
import json
from pathlib import Path
from types import SimpleNamespace

import pytest
from PIL import Image, ImageDraw

from app.ai.base import AIResult
from app.catalog import template_definition
from app.models import AdvancedFrameStyle, ClassicLayout, GenerationJob, JobState, ManagedExperience, ManagedTemplate
from app.services.advanced_prompt import BRANDING_RULES, COMPOSITION_RULES, FRAME_STYLE_SEEDS, STYLE_PRINCIPLE, compose_advanced_prompt
from app.services.classic import ClassicLayoutError, compose_classic, slots_for, validated_frame
from app.services.classic_events import event_frame_definitions, original_frame_definitions
from app.services.generation import process_job
from conftest import make_jpeg, make_png


def _upload(client, color=(160, 100, 70)):
    response = client.post("/api/uploads", files={"file": ("synthetic.jpg", make_jpeg(color=color), "image/jpeg")})
    assert response.status_code == 201, response.text
    return response.json()["upload_id"]


def test_classic_layouts_match_reviewed_assets(client, db_session):
    layouts = client.get("/api/classic/layouts").json()
    definitions = original_frame_definitions() + event_frame_definitions()
    expected = sorted(definitions, key=lambda item: (item["sort_order"], item["id"]))
    assert [(item["id"], item["shot_count"], item["canvas_width"], item["canvas_height"]) for item in layouts] == [
        (item["id"], item["shot_count"], item["canvas_width"], item["canvas_height"])
        for item in expected
    ]
    for item in layouts:
        assert len(item["slots"]) == item["shot_count"]
        assert client.get(item["preview_url"]).content.startswith(b"\x89PNG")
        assert validated_frame(db_session.get(ClassicLayout, item["id"])).size == (1200, 3600)


def test_classic_rejects_wrong_capture_count(client, captured_queue):
    upload_id = _upload(client)
    response = client.post("/api/generations", json={"upload_id": upload_id, "mode": "CLASSIC", "layout_id": "classic-frame-001", "capture_upload_ids": [upload_id]})
    assert response.status_code == 422
    assert response.json()["detail"]["error_code"] == "CLASSIC_SHOT_COUNT_INVALID"
    assert captured_queue == []


def test_classic_cover_crop_preserves_overlay_and_canvas(tmp_path):
    frame = Image.new("RGBA", (300, 220), (0, 0, 0, 0))
    frame.paste((255, 215, 0, 255), (0, 0, 300, 20))
    frame_path = tmp_path / "frame.png"
    frame.save(frame_path)
    layout = SimpleNamespace(frame_asset_path=str(frame_path), canvas_width=300, canvas_height=220, shot_count=1, layout_config_json=json.dumps({"slots": [{"x": 50, "y": 50, "width": 200, "height": 100, "fit": "cover"}]}))
    photo = Image.new("RGB", (100, 300))
    draw = ImageDraw.Draw(photo)
    draw.rectangle((0, 0, 100, 99), fill="red")
    draw.rectangle((0, 100, 100, 199), fill="green")
    draw.rectangle((0, 200, 100, 299), fill="blue")
    source = io.BytesIO()
    photo.save(source, "PNG")
    composite = Image.open(io.BytesIO(compose_classic(layout, [source.getvalue()])))
    assert composite.size == (300, 220)
    assert composite.getpixel((10, 10)) == (255, 215, 0, 255)
    assert composite.getpixel((150, 100))[:3] == (0, 128, 0)
    assert composite.getpixel((150, 100))[:3] == composite.getpixel((60, 100))[:3]
    with pytest.raises(ClassicLayoutError):
        compose_classic(layout, [])
    layout.layout_config_json = json.dumps({"slots": [{"x": 290, "y": 50, "width": 20, "height": 100}]})
    with pytest.raises(ClassicLayoutError):
        slots_for(layout)


def test_classic_uses_shared_result_claim_and_zero_ai_credit(client, captured_queue, stub_provider, db_session):
    before = client.get("/api/account/usage").json()["ai_remaining"]
    upload_ids = [_upload(client, color=(120 + index * 15, 100, 70)) for index in range(3)]
    created = client.post("/api/generations", json={"upload_id": upload_ids[0], "mode": "CLASSIC", "layout_id": "classic-frame-003", "capture_upload_ids": upload_ids})
    assert created.status_code == 202, created.text
    job_id = created.json()["job_id"]
    job = db_session.get(GenerationJob, job_id)
    assert json.loads(job.capture_upload_ids_json) == upload_ids
    assert process_job(job_id, db=db_session) == JobState.COMPLETED
    assert stub_provider.calls == []
    status = client.get(f"/api/generations/{job_id}").json()
    assert status["layout_id"] == "classic-frame-003"
    result_id = status["result_id"]
    result = client.get(f"/api/results/{result_id}").json()
    assert (result["width"], result["height"]) == (1200, 3600)
    assert client.get(result["download_url"]).status_code == 200
    claim = client.post(f"/api/results/{result_id}/claim", json={})
    assert claim.status_code == 200
    token = claim.json()["claim_url"].rsplit("/", 1)[-1]
    assert client.get(f"/api/public/results/{token}").status_code == 200
    assert client.get("/api/account/usage").json()["ai_remaining"] == before


def test_framed_basic_template_registered_and_preserves_outer_boundary(client, db_session):
    templates = {item["id"]: item for item in client.get("/api/templates").json()["templates"]}
    framed = templates["sci-fi-space-commander-framed-001"]
    assert framed["basic_available"] is True
    assert (framed["width"], framed["height"]) == (1024, 1536)
    assert client.get(framed["preview_url"]).status_code == 200
    assert "sci-fi-space-commander-001" in templates
    definition = template_definition(db_session, framed["id"])
    assert definition.face_region == (402, 350, 194, 194)
    assert max(y for _, y in definition.mask_polygon) < 600
    row = db_session.get(ManagedTemplate, framed["id"])
    assert row.marketing_preview_path != row.image_path
    with Image.open(Path(row.image_path)) as image:
        assert image.size == (1024, 1536) and image.mode == "RGB"
        assert image.getpixel((512, 100)) != image.getpixel((512, 1400))


def test_framed_basic_engine_keeps_title_and_footer_pixels(client, db_session, tmp_path, monkeypatch):
    from app.generation.basic.engine import BasicGenerationEngine
    from app.generation.basic.landmarks import FaceBox
    import app.generation.basic.engine as engine_module

    definition = template_definition(db_session, "sci-fi-space-commander-framed-001")
    target = Path(db_session.get(ManagedTemplate, definition.id).image_path)
    source = tmp_path / "synthetic-source.jpg"
    source.write_bytes(make_jpeg(640, 480, color=(173, 130, 105)))
    monkeypatch.setattr(engine_module, "detect_exactly_one_face", lambda _image: FaceBox(225, 110, 190, 230))
    output = tmp_path / "framed-result.png"
    BasicGenerationEngine().generate(source, definition.id, output, {"template": definition, "template_path": target, "landmark_backend": "scaffold"})
    with Image.open(target) as original, Image.open(output) as finished:
        assert finished.size == (1024, 1536)
        for point in ((512, 100), (512, 1300), (512, 1450), (20, 750), (1000, 750)):
            assert finished.getpixel(point) == original.getpixel(point)


def test_framed_basic_job_uses_existing_engine_and_shared_delivery(client, captured_queue, db_session, monkeypatch):
    from app.generation.basic.engine import BasicGenerationEngine
    from app.generation.basic.landmarks import FaceBox
    import app.generation.basic.engine as engine_module
    import app.services.generation as generation_module

    class ScaffoldForSyntheticSource:
        def generate(self, **kwargs):
            return BasicGenerationEngine().generate(
                kwargs["user_image_path"], kwargs["template_id"], kwargs["output_path"],
                {**kwargs["options"], "landmark_backend": "scaffold"},
            )

    monkeypatch.setattr(engine_module, "detect_exactly_one_face", lambda _image: FaceBox(225, 110, 190, 230))
    monkeypatch.setattr(generation_module, "get_basic_engine", lambda: ScaffoldForSyntheticSource())
    upload_id = _upload(client)
    created = client.post("/api/generations", json={"upload_id": upload_id, "mode": "BASIC", "template_id": "sci-fi-space-commander-framed-001"})
    assert created.status_code == 202, created.text
    assert process_job(created.json()["job_id"], db=db_session) == JobState.COMPLETED
    result_id = client.get(f"/api/generations/{created.json()['job_id']}").json()["result_id"]
    result = client.get(f"/api/results/{result_id}").json()
    assert (result["width"], result["height"]) == (1024, 1536)
    assert client.get(result["download_url"]).status_code == 200
    assert client.post(f"/api/results/{result_id}/claim", json={}).status_code == 200


def test_advanced_all_ten_styles_keep_experience_primary(client):
    ids = [item["id"] for item in client.get("/api/advanced/frame-styles").json()]
    assert ids == [item[0] for item in FRAME_STYLE_SEEDS]
    for slug, _, _, fragment in FRAME_STYLE_SEEDS:
        prompt = compose_advanced_prompt("EXPERIENCE_MARKER", fragment)
        assert prompt.startswith("EXPERIENCE — PRIMARY VISUAL AUTHORITY\nEXPERIENCE_MARKER")
        assert fragment in prompt and STYLE_PRINCIPLE in prompt
        assert COMPOSITION_RULES in prompt and BRANDING_RULES in prompt
        assert '"NXBooth"' in prompt and '"Powered by GenNexByte"' in prompt
        assert prompt == compose_advanced_prompt("EXPERIENCE_MARKER", fragment), slug


def test_advanced_selection_validation_and_persistence(client, captured_queue, db_session):
    experience = db_session.get(ManagedExperience, "mini-me")
    original = (experience.compatible_frame_style_ids_json, experience.compatible_ornament_ids_json, experience.max_ornaments)
    frame = db_session.get(AdvancedFrameStyle, "modern")
    original_enabled = frame.enabled
    try:
        experience.compatible_frame_style_ids_json = json.dumps(["modern"])
        experience.compatible_ornament_ids_json = json.dumps(["sparkles"])
        experience.max_ornaments = 1
        db_session.commit()
        upload_id = _upload(client)
        payload = {"upload_id": upload_id, "mode": "ADVANCED", "experience_id": "mini-me", "frame_style_id": "modern", "ornament_ids": ["sparkles"]}
        for bad in (
            {**payload, "frame_style_id": "unknown"},
            {**payload, "frame_style_id": "natural"},
            {**payload, "ornament_ids": ["hearts"]},
            {**payload, "ornament_ids": ["sparkles", "hearts"]},
        ):
            assert client.post("/api/generations", json=bad).status_code == 422
        frame.enabled = False
        db_session.commit()
        assert client.post("/api/generations", json=payload).status_code == 422
        frame.enabled = True
        db_session.commit()
        created = client.post("/api/generations", json=payload)
        assert created.status_code == 202, created.text
        status = client.get(f"/api/generations/{created.json()['job_id']}").json()
        assert status["upload_id"] == upload_id
        assert status["frame_style_id"] == "modern"
        assert status["ornament_ids"] == ["sparkles"]
        assert db_session.get(GenerationJob, status["job_id"]).frame_style_id == "modern"
    finally:
        experience.compatible_frame_style_ids_json, experience.compatible_ornament_ids_json, experience.max_ornaments = original
        frame.enabled = original_enabled
        db_session.commit()


@pytest.mark.parametrize("ornament_ids", [[], ["sparkles"], ["hearts"], ["glasses"]])
def test_advanced_provider_receives_composed_prompt_and_print_result(client, captured_queue, db_session, monkeypatch, ornament_ids):
    import app.services.generation as generation_module

    class PromptProvider:
        name = "test-provider"
        def __init__(self): self.prompt = None
        def is_available(self): return True
        def generate(self, user_image, template, options):
            self.prompt = options.extra["prompt_override"]
            return AIResult(image_bytes=make_png(256, 256), content_type="image/png", provider=self.name, model="test-model", prompt_used=self.prompt, raw_meta={})

    provider = PromptProvider()
    monkeypatch.setattr(generation_module, "get_provider", lambda: provider)
    before = client.get("/api/account/usage").json()["ai_remaining"]
    upload_id = _upload(client)
    created = client.post("/api/generations", json={"upload_id": upload_id, "mode": "ADVANCED", "experience_id": "mini-me", "frame_style_id": "film", "ornament_ids": ornament_ids})
    assert created.status_code == 202, created.text
    assert process_job(created.json()["job_id"], db=db_session) == JobState.COMPLETED
    assert "EXPERIENCE — PRIMARY VISUAL AUTHORITY" in provider.prompt
    assert "premium photographic film-inspired" in provider.prompt
    assert "OPTIONAL ORNAMENTS" not in provider.prompt
    assert "Add a few tasteful sparkles" not in provider.prompt
    from app.catalog import experience_definition
    experience = experience_definition(db_session, "mini-me")
    frame = db_session.get(AdvancedFrameStyle, "film")
    assert provider.prompt == compose_advanced_prompt(experience.prompt, frame.prompt_fragment)
    result_id = client.get(f"/api/generations/{created.json()['job_id']}").json()["result_id"]
    result = client.get(f"/api/results/{result_id}").json()
    assert (result["width"], result["height"]) == (2160, 3240)
    downloaded = client.get(result["download_url"])
    assert downloaded.status_code == 200
    with Image.open(io.BytesIO(downloaded.content)) as output:
        # Solid provider image stays solid in the footer: no application panel/text.
        assert output.getpixel((150, 3000)) == (30, 60, 120)
        assert output.getpixel((180, 3090)) == (30, 60, 120)
    assert client.get("/api/account/usage").json()["ai_remaining"] == before - 1


def test_admin_manages_three_mode_metadata_without_new_registry(client):
    headers = {"X-Admin-Token": "test-admin-token"}
    layouts = client.get("/api/admin/classic-layouts", headers=headers)
    assert layouts.status_code == 200, layouts.text
    first = next(item for item in layouts.json() if item["id"] == "classic-frame-001")
    assert first["frame_asset_present"] is True
    assert first["shot_count"] == len(first["slots"]) == 4
    patched = client.patch("/api/admin/classic-layouts/classic-frame-001", headers=headers, json={"sort_order": 20})
    assert patched.status_code == 200 and patched.json()["sort_order"] == 20
    client.patch("/api/admin/classic-layouts/classic-frame-001", headers=headers, json={"sort_order": 0})
    templates = client.get("/api/admin/templates", headers=headers).json()
    basic = next(item for item in templates if item["id"] == "sci-fi-space-commander-framed-001")
    assert basic["framed"] is True
    assert (basic["canvas_width"], basic["canvas_height"], basic["aspect_ratio"]) == (1024, 1536, "2:3")
    styles = client.get("/api/admin/advanced/frame-styles", headers=headers)
    ornaments = client.get("/api/admin/advanced/ornaments", headers=headers)
    assert len(styles.json()) == 10 and len(ornaments.json()) >= 3
    natural = next(item for item in styles.json() if item["id"] == "natural")
    updated = client.patch("/api/admin/advanced/frame-styles/natural", headers=headers, json={"prompt_fragment": "Edited natural style"})
    assert updated.status_code == 200 and updated.json()["prompt_fragment"] == "Edited natural style"
    client.patch("/api/admin/advanced/frame-styles/natural", headers=headers, json={"prompt_fragment": natural["prompt_fragment"]})
    compatible = client.patch("/api/admin/experiences/mini-me", headers=headers, json={"compatible_frame_style_ids": ["modern"], "compatible_ornament_ids": ["sparkles"], "max_ornaments": 1})
    assert compatible.status_code == 200, compatible.text
    assert compatible.json()["compatible_frame_style_ids"] == ["modern"]
    client.patch("/api/admin/experiences/mini-me", headers=headers, json={"compatible_frame_style_ids": None, "compatible_ornament_ids": None, "max_ornaments": 3})


def test_admin_rejects_invalid_classic_frame_and_slots(client):
    headers = {"X-Admin-Token": "test-admin-token"}
    created = client.post("/api/admin/classic-layouts", headers=headers, json={
        "id": "validation-layout", "slug": "validation-layout", "name": "Validation Layout",
        "canvas_width": 300, "canvas_height": 400, "shot_count": 1,
        "slots": [{"x": 20, "y": 20, "width": 200, "height": 200, "fit": "cover"}],
        "enabled": False,
    })
    assert created.status_code == 201, created.text
    assert client.patch("/api/admin/classic-layouts/validation-layout", headers=headers, json={"slots": [{"x": 290, "y": 20, "width": 20, "height": 200}]}).status_code == 422
    frame = Image.new("RGBA", (300, 400), (255, 255, 255, 255))
    encoded = io.BytesIO()
    frame.save(encoded, "PNG")
    invalid = client.post("/api/admin/classic-layouts/validation-layout/frame", headers=headers, files={"file": ("opaque.png", encoded.getvalue(), "image/png")})
    assert invalid.status_code == 422
    assert client.patch("/api/admin/classic-layouts/validation-layout", headers=headers, json={"enabled": True}).status_code == 422

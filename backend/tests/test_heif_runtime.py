from pathlib import Path

import pytest


def test_runtime_can_decode_heic_fixture_with_pinned_decoder():
    pillow_heif = pytest.importorskip("pillow_heif")
    fixture = Path(__file__).parent / "fixtures" / "synthetic-oriented.heic"

    heif = pillow_heif.open_heif(fixture.read_bytes(), convert_hdr_to_8bit=True)
    image = heif[heif.primary_index].to_pillow()

    assert image.mode in {"RGB", "RGBA"}
    assert image.size == (640, 480)

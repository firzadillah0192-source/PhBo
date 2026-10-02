"""Small isolated regressions; synthetic arrays only, no model inference."""
import socket
import unittest

import numpy as np

import compositor_detail_iteration as iteration


class CompositorTests(unittest.TestCase):
    def setUp(self):
        self.template = np.full((64, 64, 3), (140, 150, 160), dtype=np.uint8)
        self.raw = np.full((64, 64, 3), (90, 110, 130), dtype=np.uint8)
        self.mask = np.zeros((64, 64), dtype=np.float32)
        self.mask[12:52, 12:52] = 0.45
        self.mask[20:44, 20:44] = 0.94

    def test_every_variant_preserves_template_exactly_outside_mask(self):
        for mode in ("raw", "illumination", "boundary", "balanced"):
            with self.subTest(mode=mode):
                result = iteration.compose(self.template, self.raw, self.mask, mode)
                np.testing.assert_array_equal(result[self.mask == 0], self.template[self.mask == 0])

    def test_boundary_harmonization_keeps_raw_core_byte_identical(self):
        for mode in ("boundary", "balanced"):
            adjusted = iteration.bounded_adjustment(self.template, self.raw, self.mask, mode)
            np.testing.assert_array_equal(adjusted[self.mask == 0.94], self.raw[self.mask == 0.94])

    def test_balanced_alpha_does_not_expand_support_and_preserves_raw_core(self):
        core_mask = np.clip(self.mask / self.mask.max(), 0, 1)
        np.testing.assert_array_equal(core_mask > 0, self.mask > 0)
        result = iteration.compose(self.template, self.raw, core_mask, "balanced")
        np.testing.assert_array_equal(result[core_mask == 1], self.raw[core_mask == 1])

    def test_no_harmonization_control_is_exact_alpha_composition(self):
        expected = (self.raw.astype(np.float32)*self.mask[..., None] +
                    self.template.astype(np.float32)*(1-self.mask[..., None])).astype(np.uint8)
        np.testing.assert_array_equal(iteration.compose(self.template, self.raw, self.mask, "raw"), expected)

    def test_network_requests_are_blocked(self):
        with socket.socket() as connection:
            with self.assertRaisesRegex(RuntimeError, "POC_NETWORK_FORBIDDEN"):
                connection.connect(("127.0.0.1", 1))


if __name__ == "__main__":
    unittest.main()

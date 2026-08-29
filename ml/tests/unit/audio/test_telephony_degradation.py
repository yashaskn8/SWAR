from __future__ import annotations

import numpy as np
import pytest

from evaluation.telephony_degradation import RECIPE_VERSION, apply_telephony_recipe
from tests.unit.audio.conftest import tone


@pytest.mark.parametrize(
    "recipe",
    ["narrowband_mulaw_proxy", "narrowband_noise_proxy", "clipped_channel_proxy"],
)
def test_degradation_recipe_is_deterministic_bounded_and_lineaged(recipe) -> None:
    source = tone(seconds=1.0)

    first = apply_telephony_recipe(source, recipe, seed=26104)
    second = apply_telephony_recipe(source, recipe, seed=26104)

    assert first.recipe_version == RECIPE_VERSION
    assert first.recipe_name == recipe
    assert first.sample_rate_hz == 16000
    assert first.samples.size == source.size
    assert first.lineage
    assert not first.samples.flags.writeable
    assert np.max(np.abs(first.samples)) <= 1.0
    np.testing.assert_array_equal(first.samples, second.samples)


def test_unknown_recipe_fails_explicitly() -> None:
    with pytest.raises(ValueError, match="Unknown telephony degradation recipe"):
        apply_telephony_recipe(tone(seconds=1.0), "carrier-universal", seed=1)

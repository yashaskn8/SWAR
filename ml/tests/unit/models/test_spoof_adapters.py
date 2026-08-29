from __future__ import annotations

import numpy as np
import pytest
import torch

from app.models.aasist import AasistAdapter, repeat_pad
from app.models.interfaces import ModelAdapterError, ModelErrorCode
from app.models.rawnet2 import RawNet2Adapter


def test_repeat_pad_matches_official_aasist_length_rule() -> None:
    source = np.arange(64_000, dtype=np.float32)
    padded = repeat_pad(source, 64_600)
    assert padded.shape == (64_600,)
    np.testing.assert_array_equal(padded[:64_000], source)
    np.testing.assert_array_equal(padded[64_000:], source[:600])


@pytest.mark.parametrize("extractor", [RawNet2Adapter.bonafide_logit, AasistAdapter.bonafide_logit])
def test_verified_class_index_one_is_bonafide_logit(extractor: object) -> None:
    logits = torch.tensor([[-1.25, 0.75]], dtype=torch.float32)
    output = logits if extractor is RawNet2Adapter.bonafide_logit else (torch.zeros(1, 2), logits)
    assert extractor(output) == pytest.approx(0.75)  # type: ignore[operator]


def test_invalid_aasist_output_fails_closed() -> None:
    with pytest.raises(ModelAdapterError) as raised:
        AasistAdapter.bonafide_logit(torch.zeros(1, 2))
    assert raised.value.code is ModelErrorCode.MODEL_INFERENCE_FAILED

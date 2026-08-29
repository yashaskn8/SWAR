"""Stable, non-sensitive audio pipeline errors and evidence reason codes."""

from enum import StrEnum
from typing import Final


class AudioErrorCode(StrEnum):
    EMPTY_AUDIO = "EMPTY_AUDIO"
    PAYLOAD_TOO_LARGE = "PAYLOAD_TOO_LARGE"
    INVALID_PCM_LENGTH = "INVALID_PCM_LENGTH"
    DECLARED_LENGTH_MISMATCH = "DECLARED_LENGTH_MISMATCH"
    UNSUPPORTED_FORMAT = "UNSUPPORTED_FORMAT"
    UNSUPPORTED_ENDIAN = "UNSUPPORTED_ENDIAN"
    UNSUPPORTED_SAMPLE_RATE = "UNSUPPORTED_SAMPLE_RATE"
    UNSUPPORTED_CHANNELS = "UNSUPPORTED_CHANNELS"
    NON_FINITE_SAMPLE = "NON_FINITE_SAMPLE"
    AUDIO_DECODE_FAILED = "AUDIO_DECODE_FAILED"
    UNSUPPORTED_FILE_CONTAINER = "UNSUPPORTED_FILE_CONTAINER"
    UNSUPPORTED_FILE_SUBTYPE = "UNSUPPORTED_FILE_SUBTYPE"
    INVALID_CANONICAL_AUDIO = "INVALID_CANONICAL_AUDIO"
    MEDIA_FORMAT_CHANGED = "MEDIA_FORMAT_CHANGED"
    BUFFER_LIMIT_EXCEEDED = "BUFFER_LIMIT_EXCEEDED"
    PIPELINE_CLOSED = "PIPELINE_CLOSED"
    INVALID_AUDIO_CONFIG = "INVALID_AUDIO_CONFIG"


class InsufficientReasonCode(StrEnum):
    PARTIAL_WINDOW = "PARTIAL_WINDOW"
    INSUFFICIENT_SPEECH = "INSUFFICIENT_SPEECH"
    EXCESSIVE_SILENCE = "EXCESSIVE_SILENCE"
    CLIPPING = "CLIPPING"
    LOW_LEVEL = "LOW_LEVEL"
    NOISE_PROXY_HIGH = "NOISE_PROXY_HIGH"
    DISCONTINUITY = "DISCONTINUITY"
    PACKET_GAP = "PACKET_GAP"


SAFE_ERROR_MESSAGES: Final[dict[AudioErrorCode, str]] = {
    AudioErrorCode.EMPTY_AUDIO: "Audio input is empty.",
    AudioErrorCode.PAYLOAD_TOO_LARGE: "Audio input exceeds the configured bound.",
    AudioErrorCode.INVALID_PCM_LENGTH: "PCM byte length is not aligned to its declared format.",
    AudioErrorCode.DECLARED_LENGTH_MISMATCH: "Declared sample count does not match byte length.",
    AudioErrorCode.UNSUPPORTED_FORMAT: "Audio sample format is unsupported.",
    AudioErrorCode.UNSUPPORTED_ENDIAN: "Audio byte order is unsupported.",
    AudioErrorCode.UNSUPPORTED_SAMPLE_RATE: "Audio sample rate is unsupported.",
    AudioErrorCode.UNSUPPORTED_CHANNELS: "Audio channel count is unsupported.",
    AudioErrorCode.NON_FINITE_SAMPLE: "Audio contains a non-finite sample.",
    AudioErrorCode.AUDIO_DECODE_FAILED: "Audio file could not be decoded.",
    AudioErrorCode.UNSUPPORTED_FILE_CONTAINER: "Audio file container is unsupported.",
    AudioErrorCode.UNSUPPORTED_FILE_SUBTYPE: "Audio file encoding is unsupported.",
    AudioErrorCode.INVALID_CANONICAL_AUDIO: "Canonical audio invariants are not satisfied.",
    AudioErrorCode.MEDIA_FORMAT_CHANGED: "Runtime media format changed within one session.",
    AudioErrorCode.BUFFER_LIMIT_EXCEEDED: "Audio buffer limit would be exceeded.",
    AudioErrorCode.PIPELINE_CLOSED: "Audio pipeline is already closed.",
    AudioErrorCode.INVALID_AUDIO_CONFIG: "Audio configuration is invalid.",
}


class AudioPipelineError(ValueError):
    """An explicit error that never embeds audio, paths, or private content."""

    def __init__(self, code: AudioErrorCode) -> None:
        self.code = code
        super().__init__(SAFE_ERROR_MESSAGES[code])

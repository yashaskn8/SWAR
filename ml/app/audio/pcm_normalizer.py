"""PCM/file decoding and deterministic conversion to canonical 16 kHz mono float32."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import TypeAlias

import numpy as np
import soundfile as sf
import soxr

from app.audio.config import AudioConfig, load_audio_config
from app.audio.errors import AudioErrorCode, AudioPipelineError

BytesLike: TypeAlias = bytes | bytearray | memoryview


@dataclass(frozen=True)
class PcmEnvelope:
    """One bounded interleaved PCM payload with explicit media metadata."""

    payload: BytesLike
    sample_rate_hz: int
    channels: int
    sample_format: str
    samples_per_channel: int | None = None
    source_sequence: int | None = None


@dataclass(frozen=True)
class CanonicalAudio:
    """Normalized audio. Samples are read-only, mono, and in [-1, 1]."""

    samples: np.ndarray
    sample_rate_hz: int
    source_sample_rate_hz: int
    source_channels: int
    source_sequence: int | None
    input_clipped_samples: int = 0
    discontinuity_before: bool = False
    packet_gap_before: bool = False
    timeline_start_sample: int | None = None
    gap_samples: int = 0

    @property
    def sample_count(self) -> int:
        return int(self.samples.shape[0])

    @property
    def duration_ms(self) -> int:
        return round(self.sample_count * 1000 / self.sample_rate_hz)


class PcmNormalizer:
    """Fail-closed decoder shared by runtime, training, and evaluation adapters."""

    _BYTES_PER_SAMPLE = {"PCM_S16LE": 2, "PCM_F32LE": 4}

    def __init__(self, config: AudioConfig | None = None) -> None:
        self.config = config or load_audio_config()

    def normalize(self, envelope: PcmEnvelope) -> CanonicalAudio:
        """Normalize one explicit PCM envelope without disk access."""

        decoded = self.decode_pcm(envelope)
        return self.normalize_array(
            decoded,
            sample_rate_hz=envelope.sample_rate_hz,
            source_sequence=envelope.source_sequence,
        )

    def decode_pcm(self, envelope: PcmEnvelope) -> np.ndarray:
        """Validate and decode an interleaved runtime payload without resampling."""

        if envelope.sample_format.endswith("BE"):
            raise AudioPipelineError(AudioErrorCode.UNSUPPORTED_ENDIAN)
        bytes_per_sample = self._BYTES_PER_SAMPLE.get(envelope.sample_format)
        if bytes_per_sample is None:
            raise AudioPipelineError(AudioErrorCode.UNSUPPORTED_FORMAT)
        self._validate_media_metadata(envelope.sample_rate_hz, envelope.channels)
        try:
            payload = bytes(envelope.payload)
        except (TypeError, ValueError) as error:
            raise AudioPipelineError(AudioErrorCode.UNSUPPORTED_FORMAT) from error
        if not payload:
            raise AudioPipelineError(AudioErrorCode.EMPTY_AUDIO)
        if len(payload) > self.config.input.max_input_bytes:
            raise AudioPipelineError(AudioErrorCode.PAYLOAD_TOO_LARGE)
        frame_width = bytes_per_sample * envelope.channels
        if len(payload) % frame_width:
            raise AudioPipelineError(AudioErrorCode.INVALID_PCM_LENGTH)
        frame_count = len(payload) // frame_width
        if envelope.samples_per_channel is not None and envelope.samples_per_channel != frame_count:
            raise AudioPipelineError(AudioErrorCode.DECLARED_LENGTH_MISMATCH)
        if frame_count * 1000 > envelope.sample_rate_hz * self.config.input.max_frame_duration_ms:
            raise AudioPipelineError(AudioErrorCode.PAYLOAD_TOO_LARGE)

        if envelope.sample_format == "PCM_S16LE":
            decoded = np.frombuffer(payload, dtype="<i2").astype(np.float32)
            decoded /= self.config.pcm_scale
        else:
            decoded = np.frombuffer(payload, dtype="<f4").astype(np.float32)
            if not np.isfinite(decoded).all():
                raise AudioPipelineError(AudioErrorCode.NON_FINITE_SAMPLE)
        return decoded.reshape(frame_count, envelope.channels)

    def normalize_array(
        self,
        samples: np.ndarray,
        *,
        sample_rate_hz: int,
        source_sequence: int | None = None,
    ) -> CanonicalAudio:
        """Normalize a decoded frames-by-channels array through the same core."""

        mono, channels, input_clipped_samples = self.prepare_mono(
            samples,
            sample_rate_hz=sample_rate_hz,
        )
        if sample_rate_hz != self.config.sample_rate_hz:
            stream = soxr.ResampleStream(
                sample_rate_hz,
                self.config.sample_rate_hz,
                1,
                dtype="float32",
                quality=self.config.resampling_quality,
            )
            mono = stream.resample_chunk(mono, last=True)
            stream.clear()
        return self.build_canonical(
            mono,
            source_sample_rate_hz=sample_rate_hz,
            source_channels=channels,
            source_sequence=source_sequence,
            input_clipped_samples=input_clipped_samples,
        )

    def prepare_mono(
        self,
        samples: np.ndarray,
        *,
        sample_rate_hz: int,
    ) -> tuple[np.ndarray, int, int]:
        array = np.asarray(samples)
        if array.ndim == 1:
            array = array[:, np.newaxis]
        if array.ndim != 2 or array.shape[0] == 0:
            raise AudioPipelineError(AudioErrorCode.EMPTY_AUDIO)
        channels = int(array.shape[1])
        self._validate_media_metadata(sample_rate_hz, channels)
        if array.nbytes > self.config.input.max_file_bytes:
            raise AudioPipelineError(AudioErrorCode.PAYLOAD_TOO_LARGE)
        working = np.array(array, dtype=np.float32, copy=True)
        if not np.isfinite(working).all():
            raise AudioPipelineError(AudioErrorCode.NON_FINITE_SAMPLE)
        input_clipped_samples = int(np.count_nonzero(np.abs(working) > 1.0))
        np.clip(working, -1.0, 1.0, out=working)
        mono = working[:, 0] if channels == 1 else working.mean(axis=1, dtype=np.float64)
        return np.asarray(mono, dtype=np.float32), channels, input_clipped_samples

    def build_canonical(
        self,
        samples: np.ndarray,
        *,
        source_sample_rate_hz: int,
        source_channels: int,
        source_sequence: int | None,
        input_clipped_samples: int = 0,
        discontinuity_before: bool = False,
        packet_gap_before: bool = False,
        timeline_start_sample: int | None = None,
        gap_samples: int = 0,
    ) -> CanonicalAudio:
        canonical = np.ascontiguousarray(samples, dtype=np.float32)
        if canonical.size == 0 or not np.isfinite(canonical).all():
            raise AudioPipelineError(AudioErrorCode.INVALID_CANONICAL_AUDIO)
        np.clip(canonical, -1.0, 1.0, out=canonical)
        canonical.setflags(write=False)
        return CanonicalAudio(
            samples=canonical,
            sample_rate_hz=self.config.sample_rate_hz,
            source_sample_rate_hz=source_sample_rate_hz,
            source_channels=source_channels,
            source_sequence=source_sequence,
            input_clipped_samples=input_clipped_samples,
            discontinuity_before=discontinuity_before,
            packet_gap_before=packet_gap_before,
            timeline_start_sample=timeline_start_sample,
            gap_samples=gap_samples,
        )

    def decode_file(self, path: Path) -> CanonicalAudio:
        """Decode a governed WAV/FLAC file for offline training or evaluation."""

        try:
            file_size = path.stat().st_size
        except OSError as error:
            raise AudioPipelineError(AudioErrorCode.AUDIO_DECODE_FAILED) from error
        if file_size == 0:
            raise AudioPipelineError(AudioErrorCode.EMPTY_AUDIO)
        if file_size > self.config.input.max_file_bytes:
            raise AudioPipelineError(AudioErrorCode.PAYLOAD_TOO_LARGE)
        try:
            with sf.SoundFile(path, mode="r") as audio_file:
                container = audio_file.format
                subtype = audio_file.subtype
                endian = audio_file.endian
                channels = audio_file.channels
                sample_rate_hz = audio_file.samplerate
                frames = audio_file.frames
                if container not in self.config.input.allowed_file_containers:
                    raise AudioPipelineError(AudioErrorCode.UNSUPPORTED_FILE_CONTAINER)
                if subtype not in self.config.input.allowed_file_subtypes:
                    raise AudioPipelineError(AudioErrorCode.UNSUPPORTED_FILE_SUBTYPE)
                if endian == "BIG":
                    raise AudioPipelineError(AudioErrorCode.UNSUPPORTED_ENDIAN)
                self._validate_media_metadata(sample_rate_hz, channels)
                if (
                    frames * channels * np.dtype(np.float32).itemsize
                    > self.config.input.max_file_bytes
                ):
                    raise AudioPipelineError(AudioErrorCode.PAYLOAD_TOO_LARGE)
                decoded = audio_file.read(dtype="float32", always_2d=True)
        except AudioPipelineError:
            raise
        except (OSError, RuntimeError, TypeError, ValueError) as error:
            raise AudioPipelineError(AudioErrorCode.AUDIO_DECODE_FAILED) from error
        return self.normalize_array(decoded, sample_rate_hz=sample_rate_hz)

    def _validate_media_metadata(self, sample_rate_hz: int, channels: int) -> None:
        if sample_rate_hz not in self.config.input.allowed_sample_rates_hz:
            raise AudioPipelineError(AudioErrorCode.UNSUPPORTED_SAMPLE_RATE)
        if channels < 1 or channels > self.config.input.max_channels:
            raise AudioPipelineError(AudioErrorCode.UNSUPPORTED_CHANNELS)


class StreamingPcmNormalizer:
    """Chunk-boundary-invariant SoXR state for one bounded runtime media session."""

    def __init__(self, config: AudioConfig | None = None) -> None:
        self.config = config or load_audio_config()
        self.normalizer = PcmNormalizer(self.config)
        self._stream: soxr.ResampleStream | None = None
        self._media_signature: tuple[int, int, str] | None = None
        self._last_source_sequence: int | None = None
        self._pending_clipped_samples = 0
        self._pending_discontinuity = False
        self._pending_packet_gap = False
        self._pending_gap_samples = 0
        self._segment_base_sample = 0
        self._segment_source_samples = 0
        self._next_output_start_sample = 0
        self._last_frame_count: int | None = None
        self._closed = False

    def push(self, envelope: PcmEnvelope) -> CanonicalAudio | None:
        try:
            return self._push(envelope)
        except AudioPipelineError:
            self.clear()
            raise

    def _push(self, envelope: PcmEnvelope) -> CanonicalAudio | None:
        if self._closed:
            raise AudioPipelineError(AudioErrorCode.PIPELINE_CLOSED)
        decoded = self.normalizer.decode_pcm(envelope)
        signature = (envelope.sample_rate_hz, envelope.channels, envelope.sample_format)
        if self._media_signature is None:
            self._media_signature = signature
        elif signature != self._media_signature:
            self.clear()
            raise AudioPipelineError(AudioErrorCode.MEDIA_FORMAT_CHANGED)

        sequence_gap = (
            self._last_source_sequence is not None
            and envelope.source_sequence is not None
            and envelope.source_sequence != self._last_source_sequence + 1
        )
        if sequence_gap:
            assert self._media_signature is not None
            source_rate = self._media_signature[0]
            previous_segment_samples = round(
                self._segment_source_samples * self.config.sample_rate_hz / source_rate
            )
            missing_frames = 0
            if (
                self._last_frame_count is not None
                and self._last_source_sequence is not None
                and envelope.source_sequence is not None
                and envelope.source_sequence > self._last_source_sequence + 1
            ):
                missing_frames = (
                    envelope.source_sequence - self._last_source_sequence - 1
                ) * self._last_frame_count
            gap_samples = round(missing_frames * self.config.sample_rate_hz / source_rate)
            self._segment_base_sample += previous_segment_samples + gap_samples
            self._segment_source_samples = 0
            self._next_output_start_sample = self._segment_base_sample
            self._reset_resampler()
            self._pending_discontinuity = True
            self._pending_packet_gap = True
            self._pending_gap_samples = gap_samples

        mono, channels, clipped = self.normalizer.prepare_mono(
            decoded,
            sample_rate_hz=envelope.sample_rate_hz,
        )
        self._pending_clipped_samples += clipped
        self._segment_source_samples += int(decoded.shape[0])
        self._last_frame_count = int(decoded.shape[0])
        self._last_source_sequence = envelope.source_sequence
        if envelope.sample_rate_hz == self.config.sample_rate_hz:
            output = mono
        else:
            if self._stream is None:
                self._stream = self._new_stream(envelope.sample_rate_hz)
            output = self._stream.resample_chunk(mono, last=False)
        if output.size == 0:
            return None
        return self._build_output(output, envelope.sample_rate_hz, channels)

    def finish(self) -> CanonicalAudio | None:
        if self._closed:
            return None
        try:
            output = np.empty(0, dtype=np.float32)
            if self._stream is not None:
                output = self._stream.resample_chunk(np.empty(0, dtype=np.float32), last=True)
                self._stream.clear()
                self._stream = None
            self._closed = True
            if output.size == 0 or self._media_signature is None:
                return None
            return self._build_output(
                output,
                source_sample_rate_hz=self._media_signature[0],
                source_channels=self._media_signature[1],
            )
        except Exception:
            self.clear()
            raise

    def clear(self) -> None:
        self._reset_resampler()
        self._pending_clipped_samples = 0
        self._pending_gap_samples = 0
        self._closed = True

    def _new_stream(self, sample_rate_hz: int) -> soxr.ResampleStream:
        return soxr.ResampleStream(
            sample_rate_hz,
            self.config.sample_rate_hz,
            1,
            dtype="float32",
            quality=self.config.resampling_quality,
        )

    def _reset_resampler(self) -> None:
        if self._stream is not None:
            self._stream.clear()
            self._stream = None

    def _build_output(
        self,
        output: np.ndarray,
        source_sample_rate_hz: int,
        source_channels: int,
    ) -> CanonicalAudio:
        result = self.normalizer.build_canonical(
            output,
            source_sample_rate_hz=source_sample_rate_hz,
            source_channels=source_channels,
            source_sequence=None,
            input_clipped_samples=self._pending_clipped_samples,
            discontinuity_before=self._pending_discontinuity,
            packet_gap_before=self._pending_packet_gap,
            timeline_start_sample=self._next_output_start_sample,
            gap_samples=self._pending_gap_samples,
        )
        self._next_output_start_sample += result.sample_count
        self._pending_clipped_samples = 0
        self._pending_discontinuity = False
        self._pending_packet_gap = False
        self._pending_gap_samples = 0
        return result

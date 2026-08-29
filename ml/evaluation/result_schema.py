"""Phase O-compatible, claim-safe result records for Phase M baselines."""

from __future__ import annotations

from typing import Any, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, model_validator


class RuntimeEnvironment(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    python_version: str
    numpy_version: str
    operating_system: str
    operating_system_release: str
    machine: str


class BaselineMetrics(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    positive_class: Literal["SPOOF"]
    decision_threshold: float
    sample_count: int = Field(ge=2)
    positive_count: int = Field(ge=1)
    negative_count: int = Field(ge=1)
    true_positive: int = Field(ge=0)
    false_positive: int = Field(ge=0)
    true_negative: int = Field(ge=0)
    false_negative: int = Field(ge=0)
    precision: float = Field(ge=0.0, le=1.0)
    recall: float = Field(ge=0.0, le=1.0)
    f1: float = Field(ge=0.0, le=1.0)
    eer: float = Field(ge=0.0, le=1.0)
    eer_threshold: float


class BaselineRunResult(BaseModel):
    """No metrics may appear in a blocked report."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    result_schema_version: Literal["1.0.0"] = "1.0.0"
    run_id: str = Field(pattern=r"^[0-9a-f]{64}$")
    status: Literal["COMPLETED", "BLOCKED_VALIDATION_REQUIRED"]
    claim_status: Literal[
        "MEASURED_GOVERNED_BASELINE_NOT_PROMOTED",
        "BLOCKED_VALIDATION_REQUIRED",
    ]
    data_version: str | None
    manifest_sha256: str | None = Field(default=None, pattern=r"^[0-9a-f]{64}$")
    source_register_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    split_policy_version: str
    preprocessing_version: str
    seed: int
    feature_parameters: dict[str, str | int | float]
    optimizer_parameters: dict[str, str | int | float]
    runtime_environment: RuntimeEnvironment
    sample_counts: dict[str, int]
    metrics: dict[str, BaselineMetrics] | None = None
    blocker_codes: tuple[str, ...] = ()

    @model_validator(mode="after")
    def validate_claim_boundaries(self) -> Self:
        if any(value < 0 for value in self.sample_counts.values()):
            raise ValueError("sample counts cannot be negative")
        if self.status == "BLOCKED_VALIDATION_REQUIRED":
            if self.claim_status != "BLOCKED_VALIDATION_REQUIRED":
                raise ValueError("blocked runs require blocked claim status")
            if self.metrics is not None or not self.blocker_codes:
                raise ValueError("blocked runs cannot contain metrics and require blocker codes")
        else:
            if self.claim_status != "MEASURED_GOVERNED_BASELINE_NOT_PROMOTED":
                raise ValueError("completed governed runs require non-promoted claim status")
            if not self.metrics or self.blocker_codes:
                raise ValueError("completed runs require measured metrics and no blockers")
            if self.data_version is None or self.manifest_sha256 is None:
                raise ValueError("completed runs require governed data provenance")
        return self

    def serializable(self) -> dict[str, Any]:
        return self.model_dump(mode="json", exclude_none=True)

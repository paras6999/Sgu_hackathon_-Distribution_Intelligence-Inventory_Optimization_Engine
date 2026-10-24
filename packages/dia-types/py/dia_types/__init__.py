"""dia_types — shared contracts for the engine. Models are generated; edit packages/dia-types/schema instead."""
from __future__ import annotations

import json
from pathlib import Path
from typing import TypeVar

from pydantic import BaseModel, TypeAdapter

from dia_types.models import *  # noqa: F401,F403  (generated)

FIXTURES_DIR = Path(__file__).resolve().parents[2] / "fixtures"

T = TypeVar("T")


def load_fixture(name: str, model: type[T]) -> T:
    """Load packages/dia-types/fixtures/<name>.json as `model` (e.g. Plan, or list[Target])."""
    data = json.loads((FIXTURES_DIR / f"{name}.json").read_text(encoding="utf-8"))
    if isinstance(model, type) and issubclass(model, BaseModel):
        return model.model_validate(data)
    return TypeAdapter(model).validate_python(data)

from __future__ import annotations

import pytest

from dia_engine.config import get_config
from dia_engine.data.generate import generate


@pytest.fixture(autouse=True)
def tmp_data(tmp_path, monkeypatch):
    """Every test writes to its own data dir, never to <repo>/data."""
    monkeypatch.setenv("DIA_DATA_DIR", str(tmp_path / "engine"))
    yield tmp_path / "engine"


@pytest.fixture(scope="session")
def seed01(tmp_path_factory) -> str:
    """One generated scenario shared by the slower tests (about 4 s)."""
    root = tmp_path_factory.mktemp("seed01")
    mp = pytest.MonkeyPatch()
    mp.setenv("DIA_DATA_DIR", str(root))
    sid = generate(get_config(), 1)
    mp.undo()
    return str(root)

"""FR-02 Weather cache (owner: Member A). Open-Meteo archive API, fetched once, never during demo."""
from __future__ import annotations

from datetime import date
from pathlib import Path

import pandas as pd

OPEN_METEO_ARCHIVE = "https://archive-api.open-meteo.com/v1/archive"


def fetch_weather(cities: dict[str, tuple[float, float]], start: date, end: date, force: bool = False) -> Path:
    """Fetch daily tmax_c and precip_mm per city; write store table 'weather_daily'. Idempotent."""
    raise NotImplementedError("Member A: FR-02")


def load_weather() -> pd.DataFrame:
    """Columns: date, city, tmax_c, precip_mm. Must work offline from the cached parquet."""
    raise NotImplementedError("Member A: FR-02")

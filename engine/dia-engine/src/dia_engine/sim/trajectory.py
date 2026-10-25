"""FR-21 stock trajectory (owner: M1). Day-by-day stock path of one SKU at one distributor, per policy,
read from a finished experiment's sim_log."""
from __future__ import annotations

import pandas as pd

from dia_engine import store
from dia_types import OpeningState, Trajectory, TrajectoryPoint, TrajectorySeries


def trajectory(experiment_id: str, sku_id: str, dist_id: str, opening_state: OpeningState | str,
               seed: int) -> Trajectory:
    """One series per policy, points in date order. Raises FileNotFoundError when there is no sim_log
    for the experiment or no rows for the selection."""
    state = OpeningState(opening_state)
    if not store.table_exists("sim_log", experiment_id):
        raise FileNotFoundError(f"sim_log for experiment {experiment_id}")
    log = store.read_table("sim_log", experiment_id)
    rows = log[(log["node_id"] == dist_id) & (log["sku_id"] == sku_id)
               & (log["opening_state"] == state.value) & (log["seed"] == seed)]
    if rows.empty:
        raise FileNotFoundError(f"no rows for {sku_id} at {dist_id}, {state.value}, seed {seed} in {experiment_id}")
    series = []
    for policy, grp in rows.sort_values("date").groupby("policy"):
        points = [TrajectoryPoint(date=pd.Timestamp(r["date"]).date(), closing_cases=float(r["closing"]),
                                  sales_cases=float(r["sales"]), lost_cases=float(r["lost"]),
                                  expired_cases=float(r["expired"]))
                  for r in grp.to_dict("records")]
        series.append(TrajectorySeries(policy=str(policy), points=points))
    return Trajectory(experiment_id=experiment_id, sku_id=sku_id, dist_id=dist_id, opening_state=state,
                      seed=int(seed), series=series)

"""Run the full evaluation offline and cache it (owner: Member A). Usage: python -m scripts.run_experiments"""
from __future__ import annotations

import hashlib

from engine import store
from engine.config import config_hash
from engine.models import ExperimentRequest, ExperimentStatus
from engine.simulate import run_experiment


def main() -> None:
    req = ExperimentRequest()
    h = hashlib.sha256((config_hash() + req.model_dump_json()).encode()).hexdigest()[:12]
    exp_id, cached = store.create_experiment(h)
    if cached:
        print(f"{exp_id} already cached")
        return
    store.update_experiment(exp_id, ExperimentStatus.RUNNING, 0)
    run_experiment(exp_id, req, progress=lambda p: print(f"{p:5.1f}%"))
    store.update_experiment(exp_id, ExperimentStatus.DONE, 100)
    print(f"done: {exp_id}")


if __name__ == "__main__":
    main()

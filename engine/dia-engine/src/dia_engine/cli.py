"""dia-engine command line (owner: M1). Same entry point in development (`uv run dia-engine`) and in the binary.

  dia-engine serve [--host 127.0.0.1] [--port 7010]     warm worker for the backend
  dia-engine generate [--seeds N | --seed S]            build scenario tables (prints realism summary)
  dia-engine weather --fetch                            cache real Open-Meteo history
  dia-engine experiment --id EX-... --request req.json  one-shot evaluation job

`experiment` talks to the backend through stdout lines:  PROGRESS <pct> / DONE <results.json> /
NOT_IMPLEMENTED <msg>. Exit codes: 0 done, 1 error, 3 not implemented yet.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


def _serve(args: argparse.Namespace) -> int:
    import uvicorn

    from dia_engine.service.app import app
    uvicorn.run(app, host=args.host, port=args.port, log_level="warning")
    return 0


def _generate(args: argparse.Namespace) -> int:
    from dia_engine.config import get_config
    from dia_engine.data.generate import generate, summary
    cfg = get_config()
    seeds = [args.seed] if args.seed else list(range(1, (args.seeds or cfg.simulation.seeds) + 1))
    for s in seeds:
        sid = generate(cfg, s)
        stats = ", ".join(f"{k}={v:.2f}" for k, v in summary(sid).items()) if s == seeds[0] else ""
        print(f"{sid} {stats}".rstrip(), flush=True)
    return 0


def _weather(args: argparse.Namespace) -> int:
    from dia_engine.config import get_config
    from dia_engine.data.weather import fetch_weather
    cfg = get_config()
    df = fetch_weather(cfg, cfg.simulation.history[0], cfg.simulation.test_window[1])
    print(f"cached {len(df)} rows for {df['city'].nunique()} cities")
    return 0


def _experiment(args: argparse.Namespace) -> int:
    from dia_engine import store
    from dia_engine.sim.simulate import run_experiment
    from dia_types import ExperimentRequest
    req = ExperimentRequest.model_validate(json.loads(Path(args.request).read_text(encoding="utf-8")))
    try:
        run_experiment(args.id, req, progress=lambda p: print(f"PROGRESS {p:.1f}", flush=True))
    except NotImplementedError as e:
        print(f"NOT_IMPLEMENTED {e}", flush=True)
        return 3
    print(f"DONE {store.results_path(args.id)}", flush=True)
    return 0


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="dia-engine")
    sub = p.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("serve")
    s.add_argument("--host", default="127.0.0.1")
    s.add_argument("--port", type=int, default=7010)
    s.set_defaults(fn=_serve)
    g = sub.add_parser("generate")
    g.add_argument("--seeds", type=int)
    g.add_argument("--seed", type=int)
    g.set_defaults(fn=_generate)
    w = sub.add_parser("weather")
    w.add_argument("--fetch", action="store_true", required=True)
    w.set_defaults(fn=_weather)
    e = sub.add_parser("experiment")
    e.add_argument("--id", required=True)
    e.add_argument("--request", required=True)
    e.set_defaults(fn=_experiment)
    args = p.parse_args(argv)
    return args.fn(args)


if __name__ == "__main__":
    sys.exit(main())

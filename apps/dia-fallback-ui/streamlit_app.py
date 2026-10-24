"""Vitaran EMERGENCY fallback UI (owner: M2). Run: streamlit run apps/dia-fallback-ui/streamlit_app.py

Talks to the API only (never imports engine modules), so it works the same on the fake and real backends.
Primary UI is apps/dia-web. Visual rules: docs/Design.md.
"""
from __future__ import annotations

import os
from datetime import date

import pandas as pd
import requests
import streamlit as st

API = os.environ.get("VITARAN_API", "http://127.0.0.1:8000")

st.set_page_config(page_title="Vitaran", layout="wide")


def api(method: str, path: str, **kw):
    r = requests.request(method, f"{API}{path}", timeout=60, **kw)
    if r.status_code >= 400:
        st.error(f"{method} {path} -> {r.status_code}: {r.text[:300]}")
        st.stop()
    return r.json() if "json" in r.headers.get("content-type", "") else r.content


st.title("Vitaran · Distribution Intelligence")
health = api("GET", "/v1/health")
if health.get("fake_backend"):
    st.caption("Running on FAKE backend data (VITARAN_FAKE=1).")

tabs = st.tabs(["Plan", "Dispatch", "Distributor inbox", "Results", "Assumptions"])

with tabs[0]:   # J1
    c1, c2, c3, c4 = st.columns(4)
    scenario = c1.selectbox("Scenario", api("GET", "/v1/scenarios"))
    as_of = c2.date_input("As of", date(2025, 10, 13))
    temp = c3.selectbox("Temperature class", ["ambient", "chilled"])
    pi_mult = c4.slider("Stockout weight", 0.25, 4.0, 1.0, 0.25)
    if st.button("Generate plan", type="primary"):
        st.session_state.plan = api("POST", "/v1/plans", json={
            "scenario_id": scenario, "as_of": as_of.isoformat(), "temp_class": temp,
            "weights": {"pi_mult": pi_mult}})
    plan = st.session_state.get("plan")
    if plan:
        k = plan["expected_kpis"]
        m = st.columns(4)
        m[0].metric("Expected cost to serve", f"₹{k['total_inr']:,.0f}")
        m[1].metric("Freight", f"₹{k['freight_inr']:,.0f}")
        m[2].metric("Cases", f"{k['cases']:,.0f}")
        m[3].metric("Solve", f"{plan['solve']['seconds']:.2f}s ({plan['solve']['status']})")
        df = pd.DataFrame(plan["lines"])
        df["reasons"] = df["reasons"].apply(lambda rs: " | ".join(f"{r['code']}: {r['detail']}" for r in rs))
        st.dataframe(df[["line_id", "sku_name", "lot_id", "from_id", "to_id", "cases", "mode", "truck_id",
                         "consignment_id", "rsl_on_arrival_days", "freight_alloc_inr", "reasons", "status"]],
                     use_container_width=True, hide_index=True)
        st.caption(f"Plan {plan['plan_id']} v{plan['version']}")
        if st.button("Send to distributors"):
            pub = api("POST", f"/v1/plans/{plan['plan_id']}/publish", json={"version": plan["version"]})
            st.success(f"Sent {len(pub['messages'])} proposals.")

with tabs[1]:   # J3
    pid = st.text_input("Plan id", value=(st.session_state.get("plan") or {}).get("plan_id", ""), key="dpid")
    depot = st.text_input("Depot filter (optional)", "")
    if pid:
        params = {"depot": depot} if depot else {}
        d = api("GET", f"/v1/plans/{pid}/dispatch", params=params)
        for t in d["trucks"]:
            tr = t["truck"]
            with st.expander(f"{tr['truck_id']} · {tr['mode']} · {tr['from_id']} → {tr['to_id']} · "
                             f"kg {tr['kg_pct']:.0f}% · m³ {tr['m3_pct']:.0f}%"):
                st.dataframe(pd.DataFrame(t["lines"])[["lot_id", "sku_name", "expiry", "cases"]], hide_index=True)
        st.download_button("Download dispatch CSV", api("GET", f"/v1/plans/{pid}/dispatch.csv", params=params),
                           file_name=f"dispatch_{pid}.csv")

with tabs[2]:   # J2
    pid = st.text_input("Plan id", value=(st.session_state.get("plan") or {}).get("plan_id", ""), key="ipid")
    if pid:
        props = api("GET", f"/v1/plans/{pid}/proposals")
        if not props:
            st.info("Publish the plan first.")
        else:
            dist = st.selectbox("Distributor", [p["dist_id"] for p in props])
            msg = api("GET", f"/v1/plans/{pid}/inbox/{dist}")
            st.chat_message("assistant").write(msg["text"])
            plan_now = api("GET", f"/v1/plans/{pid}")
            lines = [l for l in plan_now["lines"] if l["line_id"] in msg["line_ids"]]
            actions = []
            for l in lines:
                c1, c2, c3 = st.columns([3, 1, 1])
                c1.write(f"{l['sku_name']} · {l['cases']} cases · {l['rsl_on_arrival_days']} days life on arrival")
                act = c2.selectbox("Action", ["accept", "trim", "reject"], key=f"a{l['line_id']}")
                qty = c3.number_input("Qty", 0, l["cases"], l["cases"], key=f"q{l['line_id']}")
                actions.append({"line_id": l["line_id"], "action": act, "qty": int(qty) if act == "trim" else None})
            if st.button("Send response"):
                res = api("POST", f"/v1/plans/{pid}/responses", json={
                    "dist_id": dist, "proposal_version": msg["proposal_version"], "actions": actions})
                st.success(f"Plan now v{res['plan_version']}; Δ expected cost ₹{res['delta_cost_inr']:,.0f}")
            st.subheader("Change log")
            st.dataframe(pd.DataFrame(api("GET", f"/v1/plans/{pid}/events")), hide_index=True)

with tabs[3]:   # J4
    if st.button("Run / load experiment"):
        st.session_state.exp = api("POST", "/v1/experiments", json={})["experiment_id"]
    exp = st.session_state.get("exp")
    if exp:
        info = api("GET", f"/v1/experiments/{exp}")
        st.write(f"Experiment {exp}: {info['status']} ({info['progress_pct']:.0f}%)")
        if info["status"] == "done":
            res = api("GET", f"/v1/experiments/{exp}/results")
            state = st.radio("Opening state", ["neutral", "imbalanced"], horizontal=True)
            kp = pd.DataFrame(res["kpis"])
            st.dataframe(kp[kp.opening_state == state].pivot(index="kpi", columns="policy", values="mean"))

with tabs[4]:   # FR-15
    st.dataframe(pd.DataFrame(api("GET", "/v1/assumptions")), use_container_width=True, hide_index=True)

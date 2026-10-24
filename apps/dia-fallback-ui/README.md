# dia-fallback-ui (emergency only)

Streamlit version of the planner screens. It calls the same `/v1` API as `apps/dia-web`, so it works with any backend mode.
Use it only if the web app is broken during the demo. Owner: M2. Not part of the build or release.

```bash
pip install -r apps/dia-fallback-ui/requirements.txt
VITARAN_API=http://127.0.0.1:8000 streamlit run apps/dia-fallback-ui/streamlit_app.py
```

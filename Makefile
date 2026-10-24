PY ?= python

.PHONY: install data test api api-fake app experiments

install:
	$(PY) -m pip install -r requirements.txt

data:
	$(PY) -c "from engine.config import get_config; from engine.generate import generate; [generate(get_config(), s) for s in range(1, get_config().simulation.seeds + 1)]"

test:
	$(PY) -m pytest -q -rs

api:
	$(PY) -m uvicorn api.main:app --reload

api-fake:
	VITARAN_FAKE=1 $(PY) -m uvicorn api.main:app --reload

app:
	$(PY) -m streamlit run app/streamlit_app.py

experiments:
	$(PY) -m scripts.run_experiments

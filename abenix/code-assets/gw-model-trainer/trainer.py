"""Trains one Groundwork model from a twin dataset and exports it to ONNX."""

from __future__ import annotations

import base64
import struct
import time
import zlib

import numpy as np

SPECS = {
    "gw-worker-path": {"kind": "worker_path", "type": "MLP regressor (32, 32)", "where": "Worker path 1, 2 and 3 s ahead"},
    "gw-crane-collision": {"kind": "crane_collision", "type": "Gradient boosting classifier", "where": "Envelope overlap in the next 10 s"},
    "gw-hydraulic-anomaly": {"kind": "hydraulic", "type": "Isolation forest", "where": "Hydraulic anomaly score, lower is stranger"},
    "gw-payload": {"kind": "payload", "type": "Ridge regression", "where": "Tonnes in the bucket from boom pressure and geometry"},
    "gw-gust-nowcast": {"kind": "gust", "type": "Gradient boosting regressor", "where": "Highest crane wind in the next 60 s"},
    "gw-cycle-time": {"kind": "cycle_time", "type": "Gradient boosting regressor", "where": "Minutes per truck load"},
}


def unpack(ds):
    fmt = "e" if ds.get("dtype") == "float16" else "f"
    n, kx, ky = ds["rows"], ds["x_cols"], ds["y_cols"]
    X = np.array(struct.unpack(f"<{n * kx}{fmt}", zlib.decompress(base64.b64decode(ds["X"]))), dtype=np.float32).reshape(n, kx)
    y = np.array(struct.unpack(f"<{n * ky}{fmt}", zlib.decompress(base64.b64decode(ds["y"]))), dtype=np.float32).reshape(n, ky)
    return X, y


def split(X, y, seed=3):
    rng = np.random.default_rng(seed)
    idx = rng.permutation(len(X))
    cut = int(0.8 * len(X))
    return X[idx[:cut]], X[idx[cut:]], y[idx[:cut]], y[idx[cut:]]


def to_onnx(model, n_features, classifier=False):
    from skl2onnx import convert_sklearn
    from skl2onnx.common.data_types import FloatTensorType
    opts = {id(model): {"zipmap": False}} if classifier else None
    onx = convert_sklearn(model, initial_types=[("input", FloatTensorType([None, n_features]))],
                          target_opset={"": 17, "ai.onnx.ml": 3}, options=opts)
    # older onnxruntime builds on the API image read IR version 8
    onx.ir_version = 8
    return onx.SerializeToString()


def train(name: str, ds: dict) -> dict:
    from sklearn.ensemble import GradientBoostingClassifier, GradientBoostingRegressor, IsolationForest
    from sklearn.linear_model import Ridge
    from sklearn.metrics import mean_absolute_error, r2_score, roc_auc_score
    from sklearn.neural_network import MLPRegressor

    t0 = time.perf_counter()
    X, y = unpack(ds)
    Xtr, Xte, ytr, yte = split(X, y)
    metrics = {"rows": int(len(X)), "train_rows": int(len(Xtr)), "test_rows": int(len(Xte))}
    clf = False
    if name == "gw-worker-path":
        model = MLPRegressor(hidden_layer_sizes=(32, 32), max_iter=300, early_stopping=True, random_state=1).fit(Xtr, ytr)
        p = model.predict(Xte)
        err3 = np.hypot(p[:, 4] - yte[:, 4], p[:, 5] - yte[:, 5])
        metrics.update({"mae_m": float(mean_absolute_error(yte, p)), "p90_error_3s_m": float(np.percentile(err3, 90))})
    elif name == "gw-crane-collision":
        model = GradientBoostingClassifier(n_estimators=80, max_depth=3, random_state=1).fit(Xtr, ytr.ravel().astype(int))
        pr = model.predict_proba(Xte)[:, 1]
        metrics.update({"auc": float(roc_auc_score(yte.ravel().astype(int), pr)), "positive_rate": float(yte.mean())})
        clf = True
    elif name == "gw-hydraulic-anomaly":
        normal = X[y.ravel() == 0]
        model = IsolationForest(n_estimators=40, max_samples=min(64, len(normal)), contamination=0.02, random_state=1).fit(normal)
        sc = model.score_samples(X)
        lab = y.ravel().astype(int)
        metrics.update({"auc_vs_worn": float(roc_auc_score(lab, -sc)) if 0 < lab.sum() < len(lab) else None})
    elif name == "gw-payload":
        model = Ridge(alpha=1.0).fit(Xtr, ytr.ravel())
        p = model.predict(Xte)
        metrics.update({"mae_t": float(mean_absolute_error(yte.ravel(), p)), "r2": float(r2_score(yte.ravel(), p))})
    elif name in ("gw-gust-nowcast", "gw-cycle-time"):
        model = GradientBoostingRegressor(n_estimators=80, max_depth=3, random_state=1).fit(Xtr, ytr.ravel())
        p = model.predict(Xte)
        metrics.update({"mae": float(mean_absolute_error(yte.ravel(), p)), "r2": float(r2_score(yte.ravel(), p))})
    else:
        raise ValueError(f"unknown model {name}")
    blob = to_onnx(model, X.shape[1], clf)
    metrics["train_s"] = round(time.perf_counter() - t0, 2)
    spec = SPECS[name]
    return {
        "ok": True,
        "model": name,
        "framework": "onnx",
        "onnx_b64": base64.b64encode(blob).decode(),
        "bytes": len(blob),
        "metrics": metrics,
        "input_schema": {"features": ds.get("features"), "example": [round(float(v), 4) for v in X[0]]},
        "output_schema": {"targets": ds.get("targets"), "type": "classification" if clf else ("anomaly_score" if name == "gw-hydraulic-anomaly" else "regression")},
        "card": {"type": spec["type"], "predicts": spec["where"], "data": ds.get("note"), "trained_on": f"{len(X)} rows from the gw-site-twin code asset"},
    }


def run(inp: dict) -> dict:
    name = inp.get("model")
    ds = inp.get("dataset") or {}
    if isinstance(ds, dict) and "result" in ds and "X" not in ds:
        ds = ds["result"]
    if name not in SPECS:
        return {"ok": False, "error": f"unknown model {name}"}
    if not ds.get("X"):
        return {"ok": False, "error": "dataset has no rows, pass the output of gw-site-twin op dataset"}
    return train(name, ds)

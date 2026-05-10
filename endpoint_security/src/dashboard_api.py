import csv
import os
from datetime import datetime, timedelta


BASE_DIR = os.path.dirname(os.path.abspath(__file__))
RESULTS_PATH = os.path.join(BASE_DIR, "..", "results", "anomaly_results.csv")
DATASET_PATH = os.path.join(BASE_DIR, "..", "data", "processed", "processed_dataset.csv")
DEFAULT_WINDOW = 90
DEFAULT_STEP = 6
ENDPOINT_COUNT = 12


def _read_results():
    rows = []
    if not os.path.exists(RESULTS_PATH):
        return rows

    with open(RESULTS_PATH, "r", newline="") as f:
        reader = csv.DictReader(f)
        for i, row in enumerate(reader):
            try:
                error = float(row["reconstruction_error"])
                threshold = float(row["threshold"])
                is_anomaly = int(float(row["is_anomaly"]))
            except (KeyError, TypeError, ValueError):
                continue

            rows.append({
                "index": i,
                "error": error,
                "threshold": threshold,
                "is_anomaly": is_anomaly,
            })
    return rows


def _severity(error, threshold):
    if threshold <= 0:
        return "low"
    if error >= threshold * 6:
        return "critical"
    if error >= threshold * 3:
        return "high"
    if error > threshold:
        return "medium"
    return "low"


def _endpoint_name(index):
    return f"WS-ENDPOINT-{(index % ENDPOINT_COUNT) + 1:02d}"


def _wrap_window(rows, cursor, window_size):
    total = len(rows)
    if total == 0:
        return []

    cursor = cursor % total
    start = max(0, cursor - window_size + 1)
    if cursor >= window_size - 1:
        return rows[start:cursor + 1]

    missing = window_size - (cursor + 1)
    return rows[-missing:] + rows[:cursor + 1]


def _load_dataset_stats():
    if not os.path.exists(DATASET_PATH):
        return {
            "features": 0,
            "records": 0,
            "telemetry": []
        }

    with open(DATASET_PATH, "r", newline="") as f:
        reader = csv.DictReader(f)
        fieldnames = reader.fieldnames or []
        sample = []
        count = 0
        for row in reader:
            count += 1
            if len(sample) < 5:
                sample.append(row)

    telemetry = [name.replace("_", " ").title() for name in fieldnames[:6]]
    return {
        "features": len(fieldnames),
        "records": count,
        "telemetry": telemetry
    }


def legacy_results():
    rows = _read_results()
    errors = [row["error"] for row in rows]
    anomaly_indices = [row["index"] for row in rows if row["is_anomaly"]]
    threshold = rows[-1]["threshold"] if rows else 0.0

    return {
        "total_samples": len(rows),
        "anomalies": len(anomaly_indices),
        "threshold": threshold,
        "errors": errors,
        "anomaly_indices": anomaly_indices,
    }


def endpoint_summary():
    rows = _read_results()
    endpoints = {}

    for row in rows:
        endpoint = _endpoint_name(row["index"])
        if endpoint not in endpoints:
            endpoints[endpoint] = {
                "endpoint": endpoint,
                "anomalies": 0,
                "events": 0,
                "max_error": 0.0,
            }

        endpoints[endpoint]["events"] += 1
        endpoints[endpoint]["max_error"] = max(endpoints[endpoint]["max_error"], row["error"])
        if row["is_anomaly"]:
            endpoints[endpoint]["anomalies"] += 1

    results = []
    threshold = rows[-1]["threshold"] if rows else 0.0
    for endpoint in endpoints.values():
        severity = _severity(endpoint["max_error"], threshold)
        endpoint["severity"] = severity
        endpoint["status"] = {
            "critical": "Containment Required",
            "high": "Investigating",
            "medium": "Warning",
            "low": "Healthy",
        }[severity]
        results.append(endpoint)

    return sorted(results, key=lambda item: item["anomalies"], reverse=True)


def dashboard_payload(cursor=0, window_size=DEFAULT_WINDOW, step=DEFAULT_STEP):
    rows = _read_results()
    dataset = _load_dataset_stats()
    total = len(rows)
    if total == 0:
        return {
            "cursor": 0,
            "next_cursor": 0,
            "refresh_seconds": 5,
            "kpis": {
                "total_samples": 0,
                "anomalies": 0,
                "threshold": 0.0,
                "threat_score": 0,
                "fleet_health": 100,
            },
            "chart": {"labels": [], "errors": [], "threshold": 0.0},
            "incidents": [],
            "endpoints": [],
            "model": {
                "type": "Deep Autoencoder",
                "mode": "Dataset Replay",
                "features": dataset["features"],
                "training_records": dataset["records"],
                "telemetry": dataset["telemetry"],
            },
            "activity": [],
            "threat": {"level": "Nominal", "severity": "low", "summary": "No replay data available"},
        }

    cursor = max(0, int(cursor)) % total
    window_size = max(30, min(int(window_size), 180))
    step = max(1, min(int(step), 30))
    window = _wrap_window(rows, cursor, window_size)
    threshold = rows[cursor]["threshold"]
    anomalies_total = sum(1 for row in rows if row["is_anomaly"])
    window_anomalies = [row for row in window if row["is_anomaly"]]
    max_error = max((row["error"] for row in window), default=0.0)
    anomaly_rate = len(window_anomalies) / max(len(window), 1)
    score_from_rate = min(70, int(anomaly_rate * 220))
    score_from_peak = min(30, int((max_error / max(threshold, 0.0001)) * 3))
    threat_score = min(100, score_from_rate + score_from_peak)

    if threat_score >= 75:
        level, severity, summary = "Critical", "critical", "Active endpoint compromise pattern detected"
    elif threat_score >= 45:
        level, severity, summary = "Elevated", "high", "Multiple anomalies require analyst review"
    elif threat_score >= 18:
        level, severity, summary = "Guarded", "medium", "Unusual telemetry drift detected"
    else:
        level, severity, summary = "Nominal", "low", "Fleet operating inside learned baseline"

    now = datetime.now()
    incidents = []
    for offset, row in enumerate(reversed(window_anomalies[-8:])):
        sev = _severity(row["error"], threshold)
        endpoint = _endpoint_name(row["index"])
        incidents.append({
            "id": f"INC-{row['index']:05d}",
            "time": (now - timedelta(seconds=offset * 38)).strftime("%H:%M:%S"),
            "endpoint": endpoint,
            "severity": sev,
            "score": round(row["error"], 5),
            "title": {
                "critical": "Possible credential theft behavior",
                "high": "Suspicious process and network spike",
                "medium": "Behavior outside normal endpoint baseline",
                "low": "Telemetry variance observed",
            }[sev],
            "action": {
                "critical": "Isolate host",
                "high": "Open investigation",
                "medium": "Monitor closely",
                "low": "Continue monitoring",
            }[sev],
        })

    endpoint_map = {}
    for row in window:
        endpoint = _endpoint_name(row["index"])
        item = endpoint_map.setdefault(endpoint, {
            "endpoint": endpoint,
            "events": 0,
            "anomalies": 0,
            "max_error": 0.0,
            "last_seen": "just now",
        })
        item["events"] += 1
        item["max_error"] = max(item["max_error"], row["error"])
        if row["is_anomaly"]:
            item["anomalies"] += 1

    endpoints = []
    for item in endpoint_map.values():
        sev = _severity(item["max_error"], threshold)
        item["severity"] = sev
        item["risk"] = min(100, int((item["anomalies"] / max(item["events"], 1)) * 100))
        item["status"] = {
            "critical": "Containment",
            "high": "Investigating",
            "medium": "Watchlist",
            "low": "Healthy",
        }[sev]
        item["action"] = {
            "critical": "Isolate endpoint",
            "high": "Review telemetry",
            "medium": "Increase monitoring",
            "low": "No action",
        }[sev]
        endpoints.append(item)

    endpoints = sorted(endpoints, key=lambda item: (item["risk"], item["max_error"]), reverse=True)[:10]
    activity = [
        {"time": now.strftime("%H:%M:%S"), "text": f"Replay cursor advanced to sample {cursor:,}"},
        {"time": (now - timedelta(seconds=18)).strftime("%H:%M:%S"), "text": f"Model threshold enforced at {threshold:.5f} MSE"},
        {"time": (now - timedelta(seconds=35)).strftime("%H:%M:%S"), "text": f"{len(window_anomalies)} anomalies evaluated in current window"},
        {"time": (now - timedelta(seconds=52)).strftime("%H:%M:%S"), "text": "SOC dashboard synchronized with endpoint replay feed"},
    ]

    return {
        "cursor": cursor,
        "next_cursor": (cursor + step) % total,
        "refresh_seconds": 5,
        "kpis": {
            "total_samples": total,
            "anomalies": anomalies_total,
            "threshold": threshold,
            "threat_score": threat_score,
            "fleet_health": max(0, 100 - threat_score),
            "window_anomalies": len(window_anomalies),
        },
        "chart": {
            "labels": [row["index"] for row in window],
            "errors": [row["error"] for row in window],
            "threshold": threshold,
            "cursor": cursor,
        },
        "incidents": incidents,
        "endpoints": endpoints,
        "model": {
            "type": "Deep Autoencoder",
            "mode": "Dataset Replay",
            "features": dataset["features"],
            "training_records": dataset["records"],
            "telemetry": dataset["telemetry"],
        },
        "activity": activity,
        "threat": {
            "level": level,
            "severity": severity,
            "summary": summary,
        },
    }

from flask import Flask, render_template, jsonify, request
import os
from dashboard_api import dashboard_payload, endpoint_summary, legacy_results

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

app = Flask(
    __name__,
    template_folder=os.path.join(BASE_DIR, "templates"),
    static_folder=os.path.join(BASE_DIR, "static")
)

# ================= HOME =================
@app.route("/")
def index():
    return render_template("index.html")

# ================= API =================
@app.route("/api/data")
def get_data():
    return jsonify(legacy_results())


@app.route("/api/dashboard")
def get_dashboard():
    cursor = request.args.get("cursor", 0, type=int)
    window = request.args.get("window", 90, type=int)
    step = request.args.get("step", 6, type=int)
    return jsonify(dashboard_payload(cursor=cursor, window_size=window, step=step))


@app.route("/api/endpoints")
def get_endpoints():
    return jsonify(endpoint_summary())

@app.route("/api/simulate_attack", methods=["POST"])
def simulate_attack():
    from attack_simulator import simulate_attack
    simulate_attack()
    return jsonify({"status": "attack simulated"})

if __name__ == "__main__":
    app.run(debug=True)

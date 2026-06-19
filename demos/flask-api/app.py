import os
import time
from flask import Flask, jsonify, request

app = Flask(__name__)
start_time = time.time()

# In-memory event log
events = [
    {"id": 1, "type": "deploy", "service": "api", "message": "Deployed v2.1.0 to staging", "ts": time.time() - 3600},
    {"id": 2, "type": "alert", "service": "db", "message": "Connection pool at 80%", "ts": time.time() - 1800},
    {"id": 3, "type": "resolve", "service": "db", "message": "Pool scaled to 50 connections", "ts": time.time() - 900},
]
next_id = 4

@app.route("/health")
def health():
    return jsonify(status="ok", service="demo-flask-api", events=len(events), uptime=time.time() - start_time)

@app.route("/events")
def list_events():
    event_type = request.args.get("type")
    filtered = [e for e in events if not event_type or e["type"] == event_type]
    return jsonify(events=filtered, total=len(filtered))

@app.route("/events", methods=["POST"])
def create_event():
    global next_id
    data = request.get_json(force=True)
    if not data.get("message"):
        return jsonify(error="message required"), 400
    event = {"id": next_id, "type": data.get("type", "info"), "service": data.get("service", "unknown"), "message": data["message"], "ts": time.time()}
    next_id += 1
    events.append(event)
    return jsonify(event), 201

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 3300))
    print(f"Demo Flask API running on http://localhost:{port}")
    app.run(host="0.0.0.0", port=port, debug=False)

from flask import Flask, jsonify, request
from functools import wraps
import time

app = Flask(__name__)

# Mock database
DB = {
    "users": {"1": {"name": "Alice", "role": "admin"}, "2": {"name": "Bob", "role": "user"}}
}

def require_api_key(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        api_key = request.headers.get('X-API-Key')
        if not api_key or api_key != 'secret_key_999':
            return jsonify({"error": "Unauthorized"}), 401
        return f(*args, **kwargs)
    return decorated_function

@app.route('/status')
def status():
    return jsonify({"status": "online", "time": time.time()})

@app.route('/api/v1/users/<user_id>')
@require_api_key
def get_user(user_id):
    user = DB["users"].get(user_id)
    if not user:
        return jsonify({"error": "User not found"}), 404
    return jsonify({"data": user})

@app.route('/api/v1/users', methods=['POST'])
@require_api_key
def create_user():
    data = request.get_json()
    if 'name' not in data:
        return jsonify({"error": "Name is required"}), 400
    
    new_id = str(len(DB["users"]) + 1)
    DB["users"][new_id] = {"name": data["name"], "role": data.get("role", "user")}
    return jsonify({"data": DB["users"][new_id], "id": new_id}), 201

if __name__ == '__main__':
    app.run(port=5000)

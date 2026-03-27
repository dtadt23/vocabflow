import base64 
import os
from datetime import datetime, timedelta 
from functools import wraps
from flask import Flask, request, jsonify, send_from_directory, send_file
from dotenv import load_dotenv
from pymongo import MongoClient
from bson.objectid import ObjectId
from flask_jwt_extended import create_access_token, jwt_required, JWTManager, get_jwt_identity
from flask_cors import CORS
from werkzeug.security import generate_password_hash, check_password_hash
import requests
import logging
import json 
import re 
import asyncio
from gtts import gTTS
import io
try:
    import edge_tts
except ImportError:
    edge_tts = None
import tempfile 
from io import BytesIO
from docx import Document
from pypdf import PdfReader
from group_api import groups_bp

load_dotenv()

app = Flask(__name__)
app.register_blueprint(groups_bp)

CORS(app)

app.logger.setLevel(logging.INFO)

MONGO_URI = os.getenv("MONGO_URI")
if not MONGO_URI:
    raise ValueError("MONGO_URI environment variable not set.")

app.config['SECRET_KEY'] = os.getenv("SECRET_KEY", "fallback_secret_key_for_dev")
app.config["JWT_SECRET_KEY"] = os.getenv("JWT_SECRET_KEY", "super-secret-jwt-key")
app.config["JWT_ACCESS_TOKEN_EXPIRES"] = timedelta(days=30)

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")

jwt = JWTManager(app)

AUDIO_CACHE_DIR = os.path.join(os.path.dirname(__file__), 'audio_cache')
if not os.path.exists(AUDIO_CACHE_DIR):
    os.makedirs(AUDIO_CACHE_DIR, exist_ok=True)

AVATAR_DIR = os.path.join(os.path.dirname(__file__), 'static', 'avatars')
os.makedirs(AVATAR_DIR, exist_ok=True)

# =========================================================
# MongoDB connection
# =========================================================
client = MongoClient(MONGO_URI)
db = client.vocabflow_user
users_collection = db.users
decks_collection = db.decks
progress_collection = db.progress
config_collection = db.config
voices_collection = db.voices
chat_history_collection = db.chat_history      # legacy
chat_sessions_collection = db.chat_sessions    # NEW: session-based
notifications_collection = db.notifications    # thông báo user
deleted_groups_log_collection = db.deleted_groups_log  # log nhóm bị xóa
groups_collection = db.groups                  # nhóm học (admin reference)
group_members_collection = db.group_members    # thành viên nhóm
group_progress_collection = db.group_progress  # tiến độ học nhóm


def get_config_value(key, default_value):
    try:
        config = config_collection.find_one({"key": key})
        if config:
            return config["value"]
        return default_value
    except:
        return default_value

# =========================================================
# MAINTENANCE MIDDLEWARE
# =========================================================
@app.before_request
def check_maintenance():
    """Chặn tất cả API khi bảo trì. Admin bypass qua JWT.
    Login được phép nhưng backend trả 503 riêng nếu user thường login.
    """
    # Chỉ xử lý /api/ routes
    # Static pages không cần check
    if not request.path.startswith('/api/'):
        return None

    # Luôn cho phép admin panel tự phục vụ
    admin_exempt = ['/api/admin/maintenance', '/api/admin/stats', '/api/admin/config']
    if any(request.path.startswith(e) for e in admin_exempt):
        return None

    # Kiểm tra maintenance flag
    maintenance = get_config_value("maintenance_mode", False)
    if not maintenance:
        return None

    # Admin bypass - kiểm tra JWT nếu có
    try:
        from flask_jwt_extended import verify_jwt_in_request, get_jwt_identity
        verify_jwt_in_request(optional=True)
        uid = get_jwt_identity()
        if uid:
            user = users_collection.find_one({"_id": ObjectId(uid)})
            if user and user.get("role") == "admin":
                return None
    except:
        pass

    # Lấy thông tin bảo trì
    msg = get_config_value("maintenance_message", "Hệ thống đang bảo trì, vui lòng quay lại sau.")
    eta = get_config_value("maintenance_eta", "")
    return jsonify(maintenance=True, msg=msg, eta=eta), 503



# =========================================================
# Authorization Decorators
# =========================================================
def admin_required():
    def wrapper(fn):
        @wraps(fn)
        @jwt_required()
        def decorator(*args, **kwargs):
            current_user_id = get_jwt_identity()
            try:
                user = users_collection.find_one({"_id": ObjectId(current_user_id)})
            except:
                return jsonify(msg="Truy cập bị từ chối: ID người dùng không hợp lệ"), 403
            if user and user.get("role") == "admin":
                return fn(*args, **kwargs)
            else:
                return jsonify(msg="Truy cập bị từ chối: Yêu cầu quyền Admin"), 403
        return decorator
    return wrapper

# =========================================================
# AI CORE FUNCTIONALITY
# =========================================================
def extract_text_from_file(file_storage):
    filename = file_storage.filename
    data = file_storage.read()
    if filename.lower().endswith('.pdf'):
        try:
            reader = PdfReader(BytesIO(data))
            text = ""
            for page in reader.pages:
                text += page.extract_text() or ""
            return text.strip()
        except Exception as e:
            app.logger.error(f"Lỗi trích xuất PDF: {e}")
            return None
    elif filename.lower().endswith('.docx'):
        try:
            document = Document(BytesIO(data))
            text = "\n".join([paragraph.text for paragraph in document.paragraphs])
            return text.strip()
        except Exception as e:
            app.logger.error(f"Lỗi trích xuất DOCX: {e}")
            return None
    elif filename.lower().endswith('.txt'):
        try:
            return data.decode('utf-8').strip()
        except Exception as e:
            app.logger.error(f"Lỗi đọc TXT: {e}")
            return None
    return None


def call_gemini_api_simple(contents, max_retries=2):
    api_key = get_config_value("gemini_api_key", os.getenv("GEMINI_API_KEY", "")).strip()
    model_name = get_config_value("gemini_model", "gemini-2.0-flash-lite").strip()
    if not api_key:
        raise ValueError("Chưa cấu hình Gemini API Key. Vào Admin > Cấu Hình để thêm.")
    api_version = "v1beta"
    endpoint = f"https://generativelanguage.googleapis.com/{api_version}/models/{model_name}:generateContent"
    last_error = None
    for attempt in range(max_retries + 1):
        try:
            response = requests.post(
                endpoint,
                json={"contents": contents},
                params={"key": api_key},
                timeout=60  # tăng từ 30 lên 60s cho file lớn
            )
            if response.status_code == 429:
                # Rate limit — chờ rồi retry
                if attempt < max_retries:
                    import time
                    time.sleep(2 ** attempt)  # 1s, 2s
                    continue
                raise RuntimeError("AI đang quá tải. Thử lại sau vài giây.")
            if response.status_code == 400:
                err_detail = response.json().get("error", {}).get("message", "")
                raise RuntimeError(f"Yêu cầu không hợp lệ: {err_detail}")
            if response.status_code == 404:
                raise RuntimeError(f"Model '{model_name}' không tồn tại. Kiểm tra Cấu Hình.")
            if response.status_code == 403:
                raise RuntimeError("API Key không có quyền truy cập model này.")
            response.raise_for_status()
            response_data = response.json()
            candidates = response_data.get("candidates", [])
            if not candidates:
                # Có thể bị block bởi safety filter
                block_reason = response_data.get("promptFeedback", {}).get("blockReason", "")
                if block_reason:
                    raise RuntimeError(f"Nội dung bị AI từ chối: {block_reason}")
                raise RuntimeError("AI trả về kết quả trống.")
            return candidates[0]["content"]["parts"][0]["text"]
        except RuntimeError:
            raise
        except Exception as e:
            last_error = e
            if attempt < max_retries:
                import time
                time.sleep(1)
                continue
            app.logger.error(f"Lỗi AI ({model_name}) attempt {attempt}: {str(e)}")
            raise RuntimeError(f"Lỗi kết nối AI: {str(e)}")
    raise last_error or RuntimeError("Không thể kết nối AI.")


def generate_chat_response(history: list, new_message: str):
    system_instruction = "Bạn là một AI Coach chuyên nghiệp về tiếng Anh, tên là VocabFlow Coach. Hãy trả lời ngắn gọn, thân thiện và sử dụng tiếng Việt. Tập trung vào việc giải thích ngữ pháp, từ vựng và khuyến khích người dùng luyện tập."
    gemini_history = []
    for msg in history:
        role = "user" if msg['role'] == 'user' else "model"
        if msg['content'] and msg['content'].startswith("Xin chào"):
            continue
        gemini_history.append({"role": role, "parts": [{"text": msg['content']}]})
    gemini_history.append({"role": "user", "parts":[{"text": new_message}]})
    if gemini_history:
        first_user_message = gemini_history[0]['parts'][0]['text']
        gemini_history[0]['parts'][0]['text'] = f"[SYSTEM INSTRUCTION: {system_instruction}] {first_user_message}"
    return call_gemini_api_simple(gemini_history)


def generate_word_list_from_text(raw_text_or_image_data, is_image=False, mime_type=None):
    system_instruction = """
    Bạn là một công cụ trích xuất từ vựng chuyên nghiệp.
    Nhiệm vụ: Phân tích nội dung được cung cấp và trích xuất các từ vựng tiếng Anh quan trọng.
    Yêu cầu đặc biệt: Với mỗi từ, BẮT BUỘC phải cung cấp phiên âm IPA chuẩn.
    Định dạng đầu ra: Mảng JSON (JSON Array) thuần túy.
    Cấu trúc mỗi từ: {"word": "...", "ipa": "/.../", "meaning": "...", "example_en": "...", "example_vi": "..."}
    """
    parts = []
    if is_image:
        parts.append({"text": f"[SYSTEM INSTRUCTION: {system_instruction}]\n\nHãy nhìn vào hình ảnh này và trích xuất từ vựng tiếng Anh xuất hiện trong đó."})
        parts.append({"inline_data": {"mime_type": mime_type, "data": raw_text_or_image_data}})
    else:
        combined_text = f"[SYSTEM INSTRUCTION: {system_instruction}]\n\nTrích xuất từ văn bản sau:\n---\n{raw_text_or_image_data}\n---"
        parts.append({"text": combined_text})
    contents = [{"role": "user", "parts": parts}]
    json_response_text = call_gemini_api_simple(contents)
    try:
        match = re.search(r'\[.*\]', json_response_text, re.DOTALL)
        if match:
             return json.loads(match.group(0))
        return json.loads(json_response_text)
    except json.JSONDecodeError as e:
        app.logger.error(f"Lỗi JSON: {e}. Raw: {json_response_text}")
        raise RuntimeError("AI trả về định dạng không đúng chuẩn JSON.")


# =========================================================
# Routes
# =========================================================
@app.route('/')
def home():
    return jsonify(message="Welcome to VocabFlow Backend API!")

@app.route('/api/test_db')
def test_db_connection():
    try:
        db.test_collection.insert_one({"test": "connection"})
        db.test_collection.delete_many({"test": "connection"})
        return jsonify(message="Database connection successful!"), 200
    except Exception as e:
        return jsonify(message=f"Database connection failed: {str(e)}"), 500

@app.route('/admin')
def admin_page():
    return send_from_directory('.', 'admin.html')

@app.route('/maintenance.html')
def maintenance_page():
    return send_from_directory('.', 'maintenance.html')

# ── NHÓM HỌC route ──────────────────────────────────────
@app.route('/group')
def group_page():
    return send_from_directory('.', 'group.html')

# =========================================================
# User Authentication
# =========================================================
@app.route('/api/register', methods=['POST'])
def register():
    username = request.json.get('username')
    password = request.json.get('password')
    login_type = request.json.get('login_type', 'email')
    role = request.json.get('role', 'student')
    if not username or not password:
        return jsonify({"msg": "Username và mật khẩu là bắt buộc"}), 400
    if users_collection.find_one({"username": username, "login_type": login_type}):
        return jsonify({"msg": f"Tên người dùng '{username}' đã tồn tại"}), 409
    hashed_password = generate_password_hash(password)
    users_collection.insert_one({
        "username": username, "password": hashed_password,
        "login_type": login_type, "role": role, "status": "active",
        "daily_goal": 5, "theme": "light", "created_at": datetime.utcnow()
    })
    return jsonify({"msg": "Đăng ký thành công"}), 201

@app.route('/api/login', methods=['POST'])
def login():
    # Chấp nhận cả field 'username' lẫn 'email' (admin gửi 'username', frontend gửi 'username')
    username = request.json.get('username') or request.json.get('email')
    password = request.json.get('password')
    login_type = request.json.get('login_type', 'email')
    if not username or not password:
        return jsonify({"msg": "Tên người dùng và mật khẩu là bắt buộc"}), 400
    # Tìm theo username (có thể là email hoặc tên), không filter login_type cứng
    user = users_collection.find_one({"username": username})
    if not user:
        return jsonify({"msg": "Tên người dùng hoặc mật khẩu không đúng"}), 401
    if check_password_hash(user["password"], password):
        if user.get("status") == "banned":
             return jsonify({"msg": "Tài khoản của bạn đã bị cấm truy cập."}), 403
        access_token = create_access_token(identity=str(user['_id']))
        return jsonify(
            access_token=access_token, username=username,
            userId=str(user['_id']), login_type=login_type,
            role=user.get("role", "student")
        ), 200
    else:
        return jsonify({"msg": "Tên người dùng hoặc mật khẩu không đúng"}), 401

@app.route('/api/protected', methods=['GET'])
@jwt_required()
def protected():
    current_user_id = get_jwt_identity()
    try:
        user = users_collection.find_one({"_id": ObjectId(current_user_id)}, {"password": 0})
        if not user:
            return jsonify(message="OK", role="user", username=""), 200
        return jsonify(
            message=f"Chào mừng! User ID: {current_user_id}",
            role=user.get("role", "user"),
            username=user.get("username", "")
        ), 200
    except:
        return jsonify(message="OK", role="user", username=""), 200

@app.route('/api/user/me', methods=['GET'])
@jwt_required()
def get_current_user_profile():
    current_user_id = get_jwt_identity()
    user = users_collection.find_one({"_id": ObjectId(current_user_id)}, {"password": 0})
    if not user:
        return jsonify({"msg": "Người dùng không tồn tại"}), 404
    return jsonify({
        "username": user.get("username"),
        "daily_goal": user.get("daily_goal", 5),
        "theme": user.get("theme", "light"),
        "role": user.get("role", "student"),
        "preferred_voice": user.get("preferred_voice", "en-US-AriaNeural"),
        "avatar_url": user.get("avatar_url", None)
    }), 200

@app.route('/api/user/settings', methods=['PUT'])
@jwt_required()
def update_user_settings():
    current_user_id = get_jwt_identity()
    data = request.get_json()
    update_fields = {}
    if 'daily_goal' in data:
        try:
            update_fields['daily_goal'] = int(data['daily_goal'])
        except:
            return jsonify({"msg": "Mục tiêu phải là số nguyên"}), 400
    if 'theme' in data: update_fields['theme'] = data['theme']
    if 'preferred_voice' in data: update_fields['preferred_voice'] = data['preferred_voice']
    if 'new_password' in data and data['new_password']:
        if len(data['new_password']) < 6:
            return jsonify({"msg": "Mật khẩu mới phải có ít nhất 6 ký tự"}), 400
        update_fields['password'] = generate_password_hash(data['new_password'])
    if not update_fields:
        return jsonify({"msg": "Không có dữ liệu nào thay đổi"}), 400
    users_collection.update_one({"_id": ObjectId(current_user_id)}, {"$set": update_fields})
    return jsonify({"msg": "Cập nhật cài đặt thành công!"}), 200


# =========================================================
# Avatar Upload / Serve
# =========================================================
@app.route('/api/user/avatar', methods=['POST'])
@jwt_required()
def upload_avatar():
    current_user_id = get_jwt_identity()
    data = request.get_json()
    avatar_data = data.get('avatar', '')
    if not avatar_data or not avatar_data.startswith('data:image'):
        return jsonify({"msg": "Dữ liệu ảnh không hợp lệ"}), 400
    if len(avatar_data) > 300000:
        return jsonify({"msg": "Ảnh quá lớn (tối đa ~200KB)"}), 400
    try:
        header, encoded = avatar_data.split(',', 1)
        img_bytes = base64.b64decode(encoded)
        filename = f"{current_user_id}.jpg"
        filepath = os.path.join(AVATAR_DIR, filename)
        with open(filepath, 'wb') as f:
            f.write(img_bytes)
        avatar_url = f"/api/user/avatar/{current_user_id}"
        users_collection.update_one(
            {"_id": ObjectId(current_user_id)},
            {"$set": {"avatar_url": avatar_url}}
        )
        return jsonify({"msg": "Cập nhật ảnh đại diện thành công!", "avatar_url": avatar_url}), 200
    except Exception as e:
        return jsonify({"msg": f"Lỗi xử lý ảnh: {str(e)}"}), 500

@app.route('/api/user/avatar/<string:user_id>', methods=['GET'])
def serve_avatar(user_id):
    filename = f"{user_id}.jpg"
    filepath = os.path.join(AVATAR_DIR, filename)
    if not os.path.exists(filepath):
        return jsonify({"msg": "Không tìm thấy ảnh"}), 404
    return send_from_directory(AVATAR_DIR, filename, mimetype='image/jpeg')

@app.route('/api/user/avatar', methods=['DELETE'])
@jwt_required()
def delete_avatar():
    current_user_id = get_jwt_identity()
    filepath = os.path.join(AVATAR_DIR, f"{current_user_id}.jpg")
    if os.path.exists(filepath):
        os.remove(filepath)
    users_collection.update_one(
        {"_id": ObjectId(current_user_id)},
        {"$unset": {"avatar_url": ""}}
    )
    return jsonify({"msg": "Đã xóa ảnh đại diện"}), 200


# =========================================================
# AI Pronunciation Check
# =========================================================

@app.route('/api/ai/word-type', methods=['POST'])
@jwt_required()
def detect_word_type():
    """AI tự nhận diện loại từ (n./v./adj./adv./prep./pron./conj./int.)"""
    try:
        data = request.get_json()
        word = data.get('word', '').strip()
        if not word:
            return jsonify({"msg": "Missing word"}), 400

        prompt = f"""What is the primary part of speech of the English word "{word}"?
Reply with ONLY one of these abbreviations: n. v. adj. adv. prep. pron. conj. int.
No explanation, no period at end, just the abbreviation."""

        result = call_gemini_api_simple([{"role": "user", "parts": [{"text": prompt}]}])
        if not result:
            return jsonify({"msg": "AI error"}), 500

        # Parse kết quả — chỉ lấy từ viết tắt hợp lệ
        valid = {"n.", "v.", "adj.", "adv.", "prep.", "pron.", "conj.", "int."}
        cleaned = result.strip().lower().rstrip('.') + '.'
        # fallback: tìm trong result
        word_type = ""
        for v in valid:
            if v in result.lower() or v.rstrip('.') in result.lower():
                word_type = v
                break

        return jsonify({"word": word, "word_type": word_type}), 200
    except Exception as e:
        app.logger.error(f"word-type error: {e}")
        return jsonify({"msg": "Error"}), 500


@app.route('/api/pronunciation/check', methods=['POST'])
@jwt_required()
def check_pronunciation():
    try:
        data = request.get_json()
        word = data.get('word', '').strip()
        ipa = data.get('ipa', '').strip()
        audio_b64 = data.get('audio', '')
        if not word or not audio_b64:
            return jsonify({"msg": "Thiếu dữ liệu"}), 400
        if ',' in audio_b64:
            audio_b64 = audio_b64.split(',', 1)[1]
        audio_bytes = base64.b64decode(audio_b64)
        api_key = get_config_value("gemini_api_key", os.getenv("GEMINI_API_KEY", "")).strip()
        model_name = get_config_value("gemini_model", "gemini-2.0-flash-lite").strip()
        if not api_key:
            return jsonify({"msg": "Chưa cấu hình API Key"}), 500
        ipa_hint = f" (IPA chuẩn: {ipa})" if ipa else ""
        prompt = f"""Bạn là giáo viên phát âm tiếng Anh chuyên nghiệp.
Người học vừa đọc từ "{word}"{ipa_hint}.
Hãy lắng nghe audio và đánh giá phát âm theo format JSON sau (KHÔNG thêm markdown):
{{
  "score": <0-100>,
  "overall": "<Xuất sắc|Tốt|Khá|Cần cải thiện>",
  "correct": "<những điểm phát âm đúng>",
  "errors": "<những lỗi cụ thể nếu có, ví dụ: âm /θ/ phát âm thành /d/>",
  "tip": "<1 mẹo ngắn để cải thiện>",
  "phonetic_feedback": "<phân tích từng âm tiết nếu cần>"
}}"""
        contents = [{"role": "user", "parts": [
            {"inline_data": {"mime_type": "audio/webm", "data": base64.b64encode(audio_bytes).decode('utf-8')}},
            {"text": prompt}
        ]}]
        endpoint = f"https://generativelanguage.googleapis.com/v1beta/models/{model_name}:generateContent"
        response = requests.post(endpoint, json={"contents": contents}, params={"key": api_key}, timeout=30)
        response.raise_for_status()
        resp_data = response.json()
        result_text = resp_data['candidates'][0]['content']['parts'][0]['text']
        import json as json_mod
        clean = result_text.strip().replace('```json', '').replace('```', '').strip()
        result = json_mod.loads(clean)
        return jsonify(result), 200
    except Exception as e:
        app.logger.error(f"Pronunciation check error: {str(e)}")
        return jsonify({"msg": f"Lỗi phân tích: {str(e)}"}), 500


# =========================================================
# Admin User Management
# =========================================================
@app.route('/api/admin/users', methods=['GET'])
@admin_required()
def admin_get_all_users():
    try:
        users_cursor = users_collection.find({}, {"password": 0})
        users = []
        for user in users_cursor:
            users.append({
                "_id": str(user["_id"]),
                "username": user.get("username", ""),
                "role": user.get("role", "student"),
                "status": user.get("status", "active"),
                "created_at": user.get("created_at", datetime.utcnow()).strftime("%Y-%m-%d") if user.get('created_at') else 'N/A'
            })
        return jsonify(users=users), 200
    except Exception as e:
        return jsonify({"msg": str(e)}), 500

@app.route('/api/admin/users/<string:user_id>', methods=['PUT', 'DELETE'])
@admin_required()
def admin_manage_single_user(user_id):
    if not ObjectId.is_valid(user_id):
        return jsonify({"msg": "ID người dùng không hợp lệ"}), 400
    user_object_id = ObjectId(user_id)
    if request.method == 'PUT':
        data = request.get_json()
        update_fields = {}
        if 'username' in data: update_fields['username'] = data['username']
        if 'password' in data and data['password']: update_fields['password'] = generate_password_hash(data['password'])
        if 'status' in data: update_fields['status'] = data['status']
        if 'role' in data: update_fields['role'] = data['role']
        if not update_fields:
            return jsonify({"msg": "Không có trường nào được cung cấp để cập nhật"}), 400
        result = users_collection.update_one({"_id": user_object_id}, {"$set": update_fields})
        if result.matched_count == 0:
            return jsonify({"msg": "Không tìm thấy người dùng"}), 404
        return jsonify({"msg": "Cập nhật tài khoản thành công"}), 200
    elif request.method == 'DELETE':
        users_collection.delete_one({"_id": user_object_id})
        decks_collection.delete_many({"user_id": user_object_id})
        progress_collection.delete_many({"user_id": user_object_id})
        chat_history_collection.delete_many({"user_id": user_object_id})
        chat_sessions_collection.delete_many({"user_id": user_object_id})
        return jsonify({"msg": "Đã xóa người dùng và dữ liệu liên quan"}), 200

@app.route('/api/admin/users', methods=['POST'])
@admin_required()
def admin_create_user():
    data = request.get_json()
    username = data.get('username') or data.get('email')
    password = data.get('password')
    role = data.get('role', 'student')
    status = data.get('status', 'active')
    if not username or not password:
        return jsonify({"msg": "Email/Username và mật khẩu là bắt buộc"}), 400
    if users_collection.find_one({"username": username}):
        return jsonify({"msg": f"Người dùng {username} đã tồn tại"}), 409
    hashed_password = generate_password_hash(password)
    result = users_collection.insert_one({
        "username": username, "password": hashed_password,
        "role": role, "status": status,
        "login_type": "email", "created_at": datetime.utcnow()
    })
    return jsonify({"msg": "Tạo người dùng thành công", "userId": str(result.inserted_id)}), 201

@app.route('/api/admin/stats', methods=['GET'])
@admin_required()
def get_admin_dashboard_stats():
    try:
        total_users = users_collection.count_documents({})
        total_decks = decks_collection.count_documents({})
        total_progress = progress_collection.count_documents({})
        total_learned = progress_collection.count_documents({"status": "learned"})
        public_decks = decks_collection.count_documents({"is_public": True})
        private_decks = total_decks - public_decks
        today = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
        seven_days_ago = today - timedelta(days=6)
        pipeline_user_growth = [
            {"$match": {"created_at": {"$gte": seven_days_ago}}},
            {"$group": {"_id": {"$dateToString": {"format": "%Y-%m-%d", "date": "$created_at"}}, "count": {"$sum": 1}}},
            {"$sort": {"_id": 1}}
        ]
        user_growth_raw = list(users_collection.aggregate(pipeline_user_growth))
        pipeline_activity = [
            {"$match": {"status": "learned", "updated_at": {"$gte": seven_days_ago}}},
            {"$group": {"_id": {"$dateToString": {"format": "%Y-%m-%d", "date": "$updated_at"}}, "count": {"$sum": 1}}},
            {"$sort": {"_id": 1}}
        ]
        activity_raw = list(progress_collection.aggregate(pipeline_activity))
        def fill_time_series(raw_data):
            data_map = {item['_id']: item['count'] for item in raw_data}
            series = []
            curr = seven_days_ago
            for i in range(7):
                date_str = curr.strftime("%Y-%m-%d")
                series.append({"date": date_str, "count": data_map.get(date_str, 0)})
                curr += timedelta(days=1)
            return series
        total_groups = groups_collection.count_documents({})
        total_notifs = notifications_collection.count_documents({"read": False})
        return jsonify({
            "total_users": total_users, "total_decks": total_decks,
            "total_groups": total_groups, "total_notifs": total_notifs,
            "total_learning_records": total_progress, "total_learned": total_learned,
            "deck_breakdown": {"public": public_decks, "private": private_decks},
            "user_growth": fill_time_series(user_growth_raw),
            "system_activity": fill_time_series(activity_raw),
            "online_users": 0
        }), 200
    except Exception as e:
        app.logger.error(f"Admin Stats Error: {e}")
        return jsonify({"msg": str(e)}), 500

@app.route('/api/admin/decks', methods=['GET'])
@admin_required()
def admin_get_all_decks():
    try:
        decks = decks_collection.find().sort("is_public", -1)
        results = []
        for deck in decks:
            author = users_collection.find_one({"_id": deck["user_id"]})
            author_name = author.get("username", "Unknown") if author else "System"
            results.append({
                "id": str(deck["_id"]), "name": deck["name"],
                "word_count": len(deck.get("words", [])),
                "author": author_name, "is_public": deck.get("is_public", False),
                "downloads": deck.get("downloads", 0),
                "created_at": deck["created_at"].strftime("%Y-%m-%d")
            })
        return jsonify(decks=results), 200
    except Exception as e:
        return jsonify({"msg": str(e)}), 500

@app.route('/api/admin/decks/<string:deck_id>', methods=['DELETE'])
@admin_required()
def admin_delete_deck(deck_id):
    decks_collection.delete_one({"_id": ObjectId(deck_id)})
    progress_collection.delete_many({"deck_id": deck_id})
    return jsonify({"msg": "Đã xóa bộ từ thành công"}), 200
@app.route('/api/admin/decks/<string:deck_id>', methods=['GET'])
@admin_required()
def admin_get_deck_detail(deck_id):
    """Admin xem chi tiết bộ từ bao gồm toàn bộ words."""
    try:
        deck = decks_collection.find_one({"_id": ObjectId(deck_id)})
        if not deck:
            return jsonify({"msg": "Không tìm thấy bộ từ"}), 404
        author = users_collection.find_one({"_id": deck.get("user_id")}, {"username": 1, "email": 1})
        return jsonify({
            "id":           str(deck["_id"]),
            "name":         deck.get("name", ""),
            "words":        deck.get("words", []),
            "word_count":   len(deck.get("words", [])),
            "is_public":    deck.get("is_public", False),
            "share_status": deck.get("share_status", "private"),
            "downloads":    deck.get("downloads", 0),
            "created_at":   deck["created_at"].isoformat() if deck.get("created_at") else "",
            "updated_at":   deck["updated_at"].isoformat() if deck.get("updated_at") else "",
            "author": {
                "id":       str(deck.get("user_id", "")),
                "username": author.get("username", "Unknown") if author else "System",
            },
            "update_history": deck.get("update_history", [])
        }), 200
    except Exception as e:
        return jsonify({"msg": str(e)}), 500

@app.route('/api/admin/decks', methods=['POST'])
@admin_required()
def admin_create_deck():
    """Admin tạo bộ từ công khai mới (thêm thẳng vào thư viện)."""
    try:
        current_user_id = get_jwt_identity()
        data = request.get_json() or {}
        name = data.get("name", "").strip()
        words = data.get("words", [])
        is_public = data.get("is_public", True)  # Admin tạo mặc định public
        if not name:
            return jsonify({"msg": "Tên bộ từ là bắt buộc"}), 400
        if not words:
            return jsonify({"msg": "Bộ từ phải có ít nhất 1 từ"}), 400
        # Validate và chuẩn hóa words
        import uuid
        clean_words = []
        for w in words:
            if not w.get("word") or not w.get("meaning"):
                continue
            clean_words.append({
                "id":         w.get("id") or str(uuid.uuid4())[:8],
                "word":       w["word"].strip(),
                "ipa":        w.get("ipa", "").strip(),
                "meaning":    w["meaning"].strip(),
                "example_en": w.get("example_en", "").strip(),
                "example_vi": w.get("example_vi", "").strip(),
            })
        if not clean_words:
            return jsonify({"msg": "Không có từ hợp lệ (cần có word và meaning)"}), 400
        new_deck = {
            "user_id":      ObjectId(current_user_id),
            "name":         name,
            "words":        clean_words,
            "is_public":    is_public,
            "share_status": "approved" if is_public else "private",
            "downloads":    0,
            "created_at":   datetime.utcnow(),
            "updated_at":   datetime.utcnow(),
            "update_history": []
        }
        result = decks_collection.insert_one(new_deck)
        return jsonify({"msg": f"Đã tạo bộ từ '{name}' thành công!", "id": str(result.inserted_id)}), 201
    except Exception as e:
        return jsonify({"msg": str(e)}), 500

@app.route('/api/admin/decks/<string:deck_id>', methods=['PUT'])
@admin_required()
def admin_update_deck(deck_id):
    """Admin sửa bộ từ (tên, words, trạng thái public)."""
    try:
        data = request.get_json() or {}
        update = {"updated_at": datetime.utcnow()}
        if "name" in data:        update["name"]        = data["name"].strip()
        if "words" in data:       update["words"]       = data["words"]
        if "is_public" in data:
            update["is_public"]    = bool(data["is_public"])
            update["share_status"] = "approved" if data["is_public"] else "private"
        result = decks_collection.update_one({"_id": ObjectId(deck_id)}, {"$set": update})
        if result.matched_count == 0:
            return jsonify({"msg": "Không tìm thấy bộ từ"}), 404
        return jsonify({"msg": "Đã cập nhật bộ từ thành công!"}), 200
    except Exception as e:
        return jsonify({"msg": str(e)}), 500



# =========================================================
# Admin Library Management
# =========================================================
@app.route('/api/admin/ai/analyze', methods=['POST'])
@admin_required()
def admin_ai_analyze():
    """Admin dùng AI phân tích text/file để tạo bộ từ nhanh. Hỗ trợ nhiều file."""
    raw_data = ""
    is_image = False
    mime_type = ""
    texts = []
    files = request.files.getlist('file') or request.files.getlist('files')
    if files and files[0].filename:
        for file in files[:5]:
            fn = file.filename.lower()
            if fn.endswith(('.png', '.jpg', '.jpeg', '.webp')):
                if not is_image:
                    is_image = True
                    mime_type = file.mimetype or "image/jpeg"
                    raw_data = base64.b64encode(file.read()).decode('utf-8')
            else:
                extracted = extract_text_from_file(file)
                if extracted:
                    texts.append(extracted)
        if texts:
            raw_data = "\n\n".join(texts)
            is_image = False
    if not raw_data and 'text' in request.form:
        raw_data = request.form['text']
    elif not raw_data and request.is_json:
        raw_data = (request.get_json() or {}).get('text', '')
    if not raw_data:
        return jsonify({"msg": "Vui lòng nhập văn bản hoặc upload file."}), 400
    if not is_image and len(raw_data) > 30000:
        raw_data = raw_data[:30000]
    try:
        word_list = generate_word_list_from_text(raw_data, is_image=is_image, mime_type=mime_type)
        return jsonify(word_list=word_list), 200
    except RuntimeError as e:
        return jsonify({"msg": str(e)}), 422
    except Exception as e:
        app.logger.error(f"Admin AI Analyze Error: {e}")
        return jsonify({"msg": f"Lỗi AI: {str(e)}"}), 500

@app.route('/api/admin/pending_decks', methods=['GET'])
@admin_required()
def get_pending_decks():
    pending_decks = list(decks_collection.find({"share_status": "pending"}))
    results = []
    for deck in pending_decks:
        author = users_collection.find_one({"_id": deck["user_id"]})
        results.append({
            "id": str(deck["_id"]), "name": deck.get("name", "Untitled Deck"),
            "author": author.get("username", "Unknown") if author else "Unknown",
            "words": deck.get("words", []),
            "request_type": deck.get("request_type", "publish"),
            "submitted_at": deck.get("submitted_at", datetime.utcnow()).strftime("%Y-%m-%d %H:%M"),
            "last_public_version": next((h for h in deck.get("update_history", []) if h.get('action') == 'approve'), None)
        })
    return jsonify(pending_decks=results), 200

@app.route('/api/admin/approve_deck/<string:deck_id>', methods=['POST'])
@admin_required()
def approve_deck(deck_id):
    data = request.get_json()
    action = data.get("action")
    deck = decks_collection.find_one({"_id": ObjectId(deck_id)})
    if not deck:
        return jsonify({"msg": "Không tìm thấy bộ từ"}), 404
    current_history = deck.get("update_history", [])
    last_entry_index = len(current_history) - 1 if current_history else -1
    if action == 'approve':
        if deck.get("request_type") == "publish":
            decks_collection.update_one(
                {"_id": ObjectId(deck_id)},
                {"$set": {"is_public": True, "share_status": "approved", "approved_at": datetime.utcnow()}}
            )
            if last_entry_index != -1:
                decks_collection.update_one({"_id": ObjectId(deck_id)}, {"$set": {f"update_history.{last_entry_index}.action": "approved_publish"}})
            return jsonify({"msg": "Đã phê duyệt và đưa bộ từ lên thư viện!"}), 200
        elif deck.get("request_type") == "delete":
            decks_collection.delete_one({"_id": ObjectId(deck_id)})
            progress_collection.delete_many({"deck_id": deck_id})
            return jsonify({"msg": "Đã phê duyệt yêu cầu xóa."}), 200
    else:
        decks_collection.update_one(
            {"_id": ObjectId(deck_id)},
            {"$set": {"share_status": "rejected", "is_public": deck.get("is_public_before_pending", False)}}
        )
        if last_entry_index != -1:
            decks_collection.update_one({"_id": ObjectId(deck_id)}, {"$set": {f"update_history.{last_entry_index}.action": "rejected"}})
        return jsonify({"msg": "Đã từ chối yêu cầu này."}), 200

@app.route('/api/admin/deck_history/<string:deck_id>', methods=['GET'])
@admin_required()
def get_deck_history(deck_id):
    try:
        deck = decks_collection.find_one({"_id": ObjectId(deck_id)}, {"update_history": 1, "name": 1})
        if not deck:
            return jsonify({"msg": "Không tìm thấy bộ từ"}), 404
        history = deck.get("update_history", [])
        formatted_history = []
        for entry in history:
            if isinstance(entry, dict):
                entry_timestamp = entry.get("timestamp", datetime.min).strftime("%Y-%m-%d %H:%M:%S")
                action_text = ""
                action_class = "text-muted"
                version_tag = entry.get('version_tag', '')
                if entry.get("action") in ("submit_update", "submit_update_public_deck"):
                    action_text = f"Yêu cầu chia sẻ/cập nhật phiên bản {version_tag}"
                    action_class = "text-primary"
                elif entry.get("action") == "request_delete":
                    action_text = "Yêu cầu gỡ bỏ bộ từ"
                    action_class = "text-danger"
                elif entry.get("action") == "approved_publish":
                    action_text = f"Admin đã phê duyệt đăng phiên bản {version_tag}"
                    action_class = "text-success"
                elif entry.get("action") == "approved_delete":
                    action_text = "Admin đã phê duyệt gỡ bỏ bộ từ"
                    action_class = "text-danger"
                elif entry.get("action") == "rejected":
                    action_text = f"Admin đã từ chối yêu cầu cho phiên bản {version_tag}"
                    action_class = "text-warning"
                else:
                    action_text = f"Hành động không xác định ({entry.get('action', 'N/A')})"
                formatted_history.append({
                    "timestamp": entry_timestamp, "action": entry.get("action"),
                    "action_text": action_text, "action_class": action_class,
                    "version_tag": version_tag, "name": entry.get("name")
                })
        return jsonify(deck_name=deck.get("name"), history=formatted_history), 200
    except Exception as e:
        app.logger.error(f"Lỗi API get_deck_history: {e}")
        return jsonify({"msg": "Lỗi khi lấy lịch sử."}), 500

# =========================================================
# Deck Management
# =========================================================
@app.route('/api/decks', methods=['GET'])
@jwt_required()
def get_user_decks():
    current_user_id = get_jwt_identity()
    user_decks = decks_collection.find({"user_id": ObjectId(current_user_id)})
    decks = []
    for deck in user_decks:
        deck["id"] = str(deck.pop("_id"))
        deck["user_id"] = str(deck["user_id"])
        decks.append(deck)
    return jsonify(decks=decks), 200

@app.route('/api/decks', methods=['POST'])
@jwt_required()
def create_user_deck():
    current_user_id = get_jwt_identity()
    user = users_collection.find_one({"_id": ObjectId(current_user_id)})
    is_admin = user and user.get("role") == "admin"
    data = request.get_json()
    words = data.get("words", [])
    is_public = data.get("is_public", False) if is_admin else False
    new_deck = {
        "user_id": ObjectId(current_user_id),
        "name": data.get("name", "Untitled Deck"),
        "words": words, "is_public": is_public, "downloads": 0,
        "created_at": datetime.utcnow(), "updated_at": datetime.utcnow(),
        "share_status": "private", "update_history": []
    }
    result = decks_collection.insert_one(new_deck)
    new_deck["id"] = str(new_deck.pop("_id"))
    new_deck["user_id"] = str(new_deck["user_id"])
    return jsonify(deck=new_deck, msg="Bộ từ đã được tạo thành công"), 201

@app.route('/api/decks/<string:deck_id>', methods=['GET', 'PUT', 'DELETE'])
@jwt_required()
def manage_single_deck(deck_id):
    current_user_id = get_jwt_identity()
    if not ObjectId.is_valid(deck_id):
        return jsonify({"msg": "Deck ID không hợp lệ"}), 400
    deck_object_id = ObjectId(deck_id)
    query = {"_id": deck_object_id, "user_id": ObjectId(current_user_id)}
    if request.method == 'GET':
        deck = decks_collection.find_one(query)
        if not deck:
            return jsonify({"msg": "Không tìm thấy bộ từ"}), 404
        deck["id"] = str(deck.pop("_id"))
        deck["user_id"] = str(deck["user_id"])
        return jsonify(deck=deck), 200
    elif request.method == 'PUT':
        data = request.get_json()
        update_fields = {}
        if "name" in data: update_fields["name"] = data["name"]
        if "words" in data: update_fields["words"] = data["words"]
        update_fields["updated_at"] = datetime.utcnow()
        user = users_collection.find_one({"_id": ObjectId(current_user_id)})
        is_admin = user and user.get("role") == "admin"
        current_deck_info = decks_collection.find_one(query)
        if not current_deck_info:
            return jsonify({"msg": "Không tìm thấy bộ từ hoặc bạn không có quyền"}), 404
        current_share_status = current_deck_info.get("share_status", "private")
        current_is_public = current_deck_info.get("is_public", False)
        if current_share_status == "approved" and current_is_public:
            update_fields["share_status"] = "pending"
            update_fields["request_type"] = "publish"
            update_fields["submitted_at"] = datetime.utcnow()
            update_fields["is_public_before_pending"] = True
            update_fields["is_public"] = False
            history_entry = {
                "version_tag": datetime.utcnow().strftime("%Y%m%d%H%M%S"),
                "timestamp": datetime.utcnow(), "action": "submit_update_public_deck",
                "word_count": len(update_fields.get("words", current_deck_info.get("words", []))),
                "name": update_fields.get("name", current_deck_info.get("name"))
            }
            result = decks_collection.update_one(query, {"$set": update_fields, "$push": {"update_history": history_entry}})
            if result.matched_count == 0:
                return jsonify({"msg": "Không tìm thấy bộ từ hoặc bạn không có quyền"}), 404
            return jsonify({"msg": "Đã lưu bản nháp và gửi yêu cầu cập nhật lên Admin!"}), 200
        else:
            if is_admin and "is_public" in data:
                update_fields["is_public"] = data["is_public"]
                update_fields["share_status"] = "approved" if data["is_public"] else "private"
                if data["is_public"]:
                    update_fields["is_public_before_pending"] = True
            result = decks_collection.update_one(query, {"$set": update_fields})
            if result.matched_count == 0:
                return jsonify({"msg": "Không tìm thấy bộ từ hoặc bạn không có quyền"}), 404
            return jsonify({"msg": "Cập nhật bộ từ thành công!"}), 200
    elif request.method == 'DELETE':
        progress_collection.delete_many({"user_id": ObjectId(current_user_id), "deck_id": deck_id})
        result = decks_collection.delete_one(query)
        if result.deleted_count == 0:
            return jsonify({"msg": "Không tìm thấy bộ từ"}), 404
        return jsonify({"msg": "Xóa bộ từ thành công"}), 200

@app.route('/api/decks/submit/<string:deck_id>', methods=['POST'])
@jwt_required()
def submit_deck_to_library(deck_id):
    current_user_id = get_jwt_identity()
    deck = decks_collection.find_one({"_id": ObjectId(deck_id), "user_id": ObjectId(current_user_id)})
    if not deck:
        return jsonify({"msg": "Không tìm thấy bộ từ"}), 404
    if not deck.get("words") or len(deck["words"]) == 0:
        return jsonify({"msg": "Bộ từ trống không thể chia sẻ."}), 400
    history_entry = {
        "version_tag": datetime.utcnow().strftime("%Y%m%d%H%M%S"),
        "timestamp": datetime.utcnow(), "action": "submit_update",
        "word_count": len(deck.get("words", [])), "name": deck.get("name")
    }
    decks_collection.update_one(
        {"_id": ObjectId(deck_id)},
        {"$set": {"is_public": False, "share_status": "pending", "request_type": "publish",
                  "submitted_at": datetime.utcnow(), "is_public_before_pending": deck.get("is_public", False)},
         "$push": {"update_history": history_entry}}
    )
    return jsonify({"msg": "Yêu cầu chia sẻ đã được gửi lên Admin để kiểm duyệt!"}), 200

@app.route('/api/decks/request_delete/<string:deck_id>', methods=['POST'])
@jwt_required()
def request_delete_from_library(deck_id):
    current_user_id = get_jwt_identity()
    deck = decks_collection.find_one({"_id": ObjectId(deck_id), "user_id": ObjectId(current_user_id)})
    if not deck:
        return jsonify({"msg": "Không tìm thấy bộ từ"}), 404
    history_entry = {
        "version_tag": datetime.utcnow().strftime("%Y%m%d%H%M%S"),
        "timestamp": datetime.utcnow(), "action": "request_delete", "name": deck.get("name")
    }
    decks_collection.update_one(
        {"_id": ObjectId(deck_id), "user_id": ObjectId(current_user_id)},
        {"$set": {"share_status": "pending", "request_type": "delete",
                  "submitted_at": datetime.utcnow(), "is_public": False,
                  "is_public_before_pending": deck.get("is_public", False)},
         "$push": {"update_history": history_entry}}
    )
    return jsonify({"msg": "Đã gửi yêu cầu gỡ bỏ bộ từ."}), 200

@app.route('/api/user/submissions', methods=['GET'])
@jwt_required()
def get_user_submissions():
    current_user_id = get_jwt_identity()
    submissions = list(decks_collection.find({
        "user_id": ObjectId(current_user_id),
        "share_status": {"$exists": True, "$ne": "private"}
    }))
    results = []
    for s in submissions:
        results.append({
            "id": str(s["_id"]), "name": s["name"],
            "word_count": len(s.get("words", [])),
            "share_status": s.get("share_status", "private"),
            "request_type": s.get("request_type", "publish"),
            "submitted_at": s.get("submitted_at", datetime.utcnow()).strftime("%Y-%m-%d %H:%M"),
            "is_public": s.get("is_public", False),
            "history_count": len(s.get("update_history", []))
        })
    return jsonify(submissions=results), 200

# =========================================================
# Progress Management
# =========================================================
@app.route('/api/progress', methods=['GET'])
@jwt_required()
def get_all_user_progress():
    current_user_id = get_jwt_identity()
    user_progress_records = progress_collection.find({"user_id": ObjectId(current_user_id)})
    formatted_progress = {}
    for record in user_progress_records:
        deck_id = record.get("deck_id")
        word_id = record.get("word_id")
        status = record.get("status")
        if deck_id not in formatted_progress:
            formatted_progress[deck_id] = {"learnedWords": []}
        if status == "learned" and word_id:
            formatted_progress[deck_id]["learnedWords"].append(word_id)
    return jsonify(progress=formatted_progress), 200

@app.route('/api/progress/<string:deck_id>', methods=['PUT'])
@jwt_required()
def update_deck_progress(deck_id):
    current_user_id = get_jwt_identity()
    data = request.get_json()
    word_id = data.get("word_id")
    status = data.get("status")
    if not word_id or not status:
        return jsonify({"msg": "Word ID và Status là bắt buộc"}), 400
    update_data = {
        "deck_id": deck_id, "user_id": ObjectId(current_user_id),
        "word_id": word_id, "status": status, "updated_at": datetime.utcnow()
    }
    progress_collection.update_one(
        {"deck_id": deck_id, "user_id": ObjectId(current_user_id), "word_id": word_id},
        {"$set": update_data}, upsert=True
    )
    return jsonify({"msg": "Tiến độ đã được cập nhật"}), 200

@app.route('/api/user/study_action', methods=['POST'])
@jwt_required()
def record_study_action():
    current_user_id = get_jwt_identity()
    user = users_collection.find_one({"_id": ObjectId(current_user_id)})
    if not user:
        return jsonify({"msg": "User not found"}), 404
    today = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
    last_study_date = user.get("last_study_date")
    current_streak = user.get("streak", 0)
    total_xp = user.get("xp", 0)
    new_streak = current_streak
    if last_study_date:
        if isinstance(last_study_date, str):
            try:
                last_study_date = datetime.strptime(last_study_date, "%Y-%m-%d %H:%M:%S")
            except:
                pass
        diff = (today - last_study_date).days
        if diff == 0: pass
        elif diff == 1: new_streak += 1
        else: new_streak = 1
    else:
        new_streak = 1
    xp_bonus = int(get_config_value("xp_per_word", 10))
    new_xp = total_xp + xp_bonus
    users_collection.update_one(
        {"_id": ObjectId(current_user_id)},
        {"$set": {"last_study_date": today, "streak": new_streak, "xp": new_xp}}
    )
    return jsonify({"msg": "Recorded", "streak": new_streak, "xp": new_xp, "first_time_today": (last_study_date != today)}), 200

# =========================================================
# Leaderboard API
# =========================================================
@app.route('/api/leaderboard', methods=['GET'])
@jwt_required()
def get_leaderboard():
    current_user_id = get_jwt_identity()
    try:
        current_user = users_collection.find_one({"_id": ObjectId(current_user_id)})
        user_xp = current_user.get("xp", 0) if current_user else 0
        my_rank = users_collection.count_documents({"role": "student", "xp": {"$gt": user_xp}}) + 1
        top_users = list(users_collection.find(
            {"role": "student"}, {"_id": 0, "username": 1, "xp": 1, "streak": 1}
        ).sort("xp", -1).limit(10))
        return jsonify({"leaderboard": top_users, "my_rank": my_rank, "my_xp": user_xp}), 200
    except Exception as e:
        app.logger.error(f"Leaderboard Error: {e}")
        return jsonify({"msg": "Lỗi khi tính toán xếp hạng"}), 500

# =========================================================
# AI Chat Routes — SESSION-BASED
# =========================================================
@app.route('/api/ai/sessions', methods=['GET'])
@jwt_required()
def get_chat_sessions():
    current_user_id = get_jwt_identity()
    sessions = list(chat_sessions_collection.find(
        {"user_id": ObjectId(current_user_id)},
        {"messages": 0}
    ).sort("updated_at", -1))
    results = []
    for s in sessions:
        results.append({
            "id": str(s["_id"]),
            "title": s.get("title", "Cuộc trò chuyện mới"),
            "message_count": s.get("message_count", 0),
            "created_at": s.get("created_at", datetime.utcnow()).isoformat(),
            "updated_at": s.get("updated_at", datetime.utcnow()).isoformat(),
        })
    return jsonify({"sessions": results}), 200

@app.route('/api/ai/sessions', methods=['POST'])
@jwt_required()
def create_chat_session():
    current_user_id = get_jwt_identity()
    data = request.get_json() or {}
    title = data.get("title", "Cuộc trò chuyện mới")
    now = datetime.utcnow()
    new_session = {
        "user_id": ObjectId(current_user_id),
        "title": title, "messages": [],
        "message_count": 0, "created_at": now, "updated_at": now,
    }
    result = chat_sessions_collection.insert_one(new_session)
    return jsonify({
        "id": str(result.inserted_id), "title": title,
        "message_count": 0, "created_at": now.isoformat(), "updated_at": now.isoformat(),
    }), 201

@app.route('/api/ai/sessions/<string:session_id>', methods=['GET'])
@jwt_required()
def get_session_messages(session_id):
    current_user_id = get_jwt_identity()
    if not ObjectId.is_valid(session_id):
        return jsonify({"msg": "Session ID không hợp lệ"}), 400
    session = chat_sessions_collection.find_one({
        "_id": ObjectId(session_id),
        "user_id": ObjectId(current_user_id)
    })
    if not session:
        return jsonify({"msg": "Không tìm thấy phiên chat"}), 404
    messages = session.get("messages", [])
    for msg in messages:
        if isinstance(msg.get("timestamp"), datetime):
            msg["timestamp"] = msg["timestamp"].isoformat()
    return jsonify({
        "id": str(session["_id"]),
        "title": session.get("title", "Cuộc trò chuyện mới"),
        "messages": messages
    }), 200

@app.route('/api/ai/sessions/<string:session_id>', methods=['DELETE'])
@jwt_required()
def delete_chat_session(session_id):
    current_user_id = get_jwt_identity()
    if not ObjectId.is_valid(session_id):
        return jsonify({"msg": "Session ID không hợp lệ"}), 400
    result = chat_sessions_collection.delete_one({
        "_id": ObjectId(session_id),
        "user_id": ObjectId(current_user_id)
    })
    if result.deleted_count == 0:
        return jsonify({"msg": "Không tìm thấy phiên chat"}), 404
    return jsonify({"msg": "Đã xóa phiên chat."}), 200

@app.route('/api/ai/chat', methods=['POST'])
@jwt_required()
def ai_chat():
    data = request.get_json()
    user_message = data.get('user_message')
    session_id = data.get('session_id')
    history = data.get('history', [])
    current_user_id = get_jwt_identity()
    if not user_message:
        return jsonify({"msg": "Tin nhắn người dùng là bắt buộc"}), 400
    try:
        response_text = generate_chat_response(history, user_message)
        now = datetime.utcnow()
        new_messages = [
            {"role": "user", "content": user_message, "timestamp": now},
            {"role": "assistant", "content": response_text, "timestamp": now}
        ]
        actual_session_id = None
        if session_id and ObjectId.is_valid(session_id):
            result = chat_sessions_collection.update_one(
                {"_id": ObjectId(session_id), "user_id": ObjectId(current_user_id)},
                {
                    "$push": {"messages": {"$each": new_messages}},
                    "$inc": {"message_count": 2},
                    "$set": {"updated_at": now}
                }
            )
            if result.matched_count == 0:
                return jsonify({"msg": "Không tìm thấy phiên chat"}), 404
            actual_session_id = session_id
        else:
            title = user_message[:40] + ("..." if len(user_message) > 40 else "")
            new_session = {
                "user_id": ObjectId(current_user_id),
                "title": title, "messages": new_messages,
                "message_count": 2, "created_at": now, "updated_at": now,
            }
            insert_result = chat_sessions_collection.insert_one(new_session)
            actual_session_id = str(insert_result.inserted_id)
        return jsonify({"response": response_text, "session_id": actual_session_id}), 200
    except Exception as e:
        app.logger.error(f"Chat Error: {e}")
        return jsonify({"msg": f"Lỗi AI: {str(e)}"}), 500

# =========================================================
# Legacy Chat History Routes (Backward compat)
# =========================================================
@app.route('/api/ai/history', methods=['GET'])
@jwt_required()
def get_chat_history():
    current_user_id = get_jwt_identity()
    record = chat_history_collection.find_one({"user_id": ObjectId(current_user_id)})
    if not record:
        return jsonify({"history": []}), 200
    messages = record.get("messages", [])
    for msg in messages:
        if isinstance(msg.get("timestamp"), datetime):
            msg["timestamp"] = msg["timestamp"].isoformat()
    return jsonify({"history": messages}), 200

@app.route('/api/ai/history', methods=['DELETE'])
@jwt_required()
def clear_chat_history():
    current_user_id = get_jwt_identity()
    chat_history_collection.delete_one({"user_id": ObjectId(current_user_id)})
    return jsonify({"msg": "Đã xóa lịch sử trò chuyện."}), 200

@app.route('/api/ai/analyze_text', methods=['POST'])
@jwt_required()
def ai_analyze_text():
    """Phân tích văn bản/file để trích xuất từ vựng.
    Nhận: file (single/multiple), text (JSON hoặc form).
    """
    raw_data = ""
    is_image = False
    mime_type = ""
    file_errors = []

    # Nhận nhiều file — ghép text lại
    files = request.files.getlist('file') or request.files.getlist('files')
    if files and files[0].filename:
        texts = []
        for file in files[:5]:  # tối đa 5 file
            filename = file.filename.lower()
            if filename.endswith(('.png', '.jpg', '.jpeg', '.webp')):
                # Chỉ dùng ảnh đầu tiên (API Gemini nhận 1 ảnh)
                if not is_image:
                    is_image = True
                    mime_type = file.mimetype or "image/jpeg"
                    raw_data = base64.b64encode(file.read()).decode('utf-8')
            else:
                extracted = extract_text_from_file(file)
                if extracted:
                    texts.append(f"=== {file.filename} ===\n{extracted}")
                else:
                    file_errors.append(file.filename)
        if texts:
            raw_data = "\n\n".join(texts)
            is_image = False

    # Fallback: text từ form hoặc JSON
    if not raw_data:
        if 'text' in request.form:
            raw_data = request.form['text']
        elif request.is_json:
            raw_data = (request.get_json() or {}).get('text', '')

    if not raw_data:
        if file_errors:
            return jsonify({"msg": f"Không thể đọc file: {', '.join(file_errors)}. Hỗ trợ: PDF, DOCX, TXT, ảnh."}), 400
        return jsonify({"msg": "Vui lòng cung cấp văn bản hoặc file."}), 400

    # Giới hạn 30000 ký tự (tăng từ 10000)
    if not is_image and len(raw_data) > 30000:
        raw_data = raw_data[:30000]

    try:
        word_list = generate_word_list_from_text(raw_data, is_image=is_image, mime_type=mime_type)
        result = {"word_list": word_list}
        if file_errors:
            result["warning"] = f"Không đọc được: {', '.join(file_errors)}"
        return jsonify(result), 200
    except RuntimeError as e:
        return jsonify({"msg": str(e)}), 422
    except Exception as e:
        app.logger.error(f"Analyze Error: {e}")
        return jsonify({"msg": f"Lỗi AI: {str(e)}"}), 500

# =========================================================
# Statistics Route
# =========================================================
@app.route('/api/statistics', methods=['GET'])
@jwt_required()
def get_user_statistics():
    current_user_id = get_jwt_identity()
    user_id_obj = ObjectId(current_user_id)
    user = users_collection.find_one({"_id": user_id_obj})
    if not user:
        return jsonify({"msg": "User not found"}), 404
    today_start = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
    words_learned_today = progress_collection.count_documents({
        "user_id": user_id_obj, "status": "learned", "updated_at": {"$gte": today_start}
    })
    learned_count = progress_collection.count_documents({"user_id": user_id_obj, "status": "learned"})
    review_count = progress_collection.count_documents({"user_id": user_id_obj, "status": "review"})
    all_word_ids = set()
    for deck in decks_collection.find({"user_id": user_id_obj}, {"words.id": 1}):
        for w in deck.get("words", []):
            if 'id' in w: all_word_ids.add(w['id'])
    total_unique_words = len(all_word_ids)
    pending_count = max(0, total_unique_words - learned_count - review_count)
    mastery_rate = round((learned_count / total_unique_words * 100), 1) if total_unique_words > 0 else 0
    seven_days_ago = today_start - timedelta(days=6)
    pipeline_daily = [
        {"$match": {"user_id": user_id_obj, "status": "learned", "updated_at": {"$gte": seven_days_ago}}},
        {"$group": {"_id": {"$dateToString": {"format": "%Y-%m-%d", "date": "$updated_at"}}, "count": {"$sum": 1}}},
        {"$sort": {"_id": 1}}
    ]
    daily_raw = list(progress_collection.aggregate(pipeline_daily))
    daily_map = {item['_id']: item['count'] for item in daily_raw}
    words_learned_daily = []
    for i in range(7):
        ds = (seven_days_ago + timedelta(days=i)).strftime("%Y-%m-%d")
        words_learned_daily.append({"date": ds, "count": daily_map.get(ds, 0)})
    recent_raw = list(progress_collection.find({"user_id": user_id_obj}).sort("updated_at", -1).limit(5))
    detailed_activities = []
    for act in recent_raw:
        try:
            deck = decks_collection.find_one({"_id": ObjectId(act["deck_id"])})
            if deck:
                word_obj = next((w for w in deck["words"] if w["id"] == act["word_id"]), None)
                if word_obj:
                    detailed_activities.append({
                        "word": word_obj["word"], "meaning": word_obj["meaning"],
                        "deck_name": deck["name"], "status": act["status"],
                        "updated_at": act["updated_at"].strftime("%Y-%m-%d")
                    })
        except: continue
    return jsonify({
        "learned_words_count": learned_count, "review_words_count": review_count,
        "pending_words_count": pending_count, "mastery_rate": mastery_rate,
        "streak_days": user.get("streak", 0), "total_xp": user.get("xp", 0),
        "daily_goal": user.get("daily_goal", 5), "words_learned_today": words_learned_today,
        "words_learned_daily": words_learned_daily,
        "average_weekly_words": round(sum(d['count'] for d in words_learned_daily) / 7, 1),
        "recent_activities": detailed_activities
    }), 200

# =========================================================
# Library Routes
# =========================================================
@app.route('/api/library', methods=['GET'])
@jwt_required()
def get_public_library():
    public_decks = decks_collection.find({"is_public": True})
    results = []
    for deck in public_decks:
        author = users_collection.find_one({"_id": deck["user_id"]})
        author_name = author.get("username", "System") if author else "System"
        results.append({
            "id": str(deck["_id"]), "name": deck["name"],
            "word_count": len(deck.get("words", [])),
            "author": author_name, "downloads": deck.get("downloads", 0),
            "created_at": deck["created_at"].strftime("%d/%m/%Y")
        })
    return jsonify(library=results), 200

@app.route('/api/library/clone/<string:deck_id>', methods=['POST'])
@jwt_required()
def clone_deck(deck_id):
    current_user_id = get_jwt_identity()
    original_deck = decks_collection.find_one({"_id": ObjectId(deck_id)})
    if not original_deck:
        return jsonify({"msg": "Bộ từ không tồn tại"}), 404
    new_deck = {
        "user_id": ObjectId(current_user_id),
        "name": f"{original_deck['name']} (Copy)",
        "words": original_deck.get("words", []),
        "is_public": False, "origin_id": deck_id,
        "created_at": datetime.utcnow(), "updated_at": datetime.utcnow()
    }
    decks_collection.insert_one(new_deck)
    decks_collection.update_one({"_id": ObjectId(deck_id)}, {"$inc": {"downloads": 1}})
    return jsonify({"msg": "Đã tải bộ từ về thành công!"}), 201

# =========================================================
# Admin System Configuration API
# =========================================================
@app.route('/api/admin/config', methods=['GET'])
@admin_required()
def get_system_config():
    try:
        configs = list(config_collection.find({}, {"_id": 0}))
        default_configs = [
            {"key": "gemini_model", "value": "gemini-2.5-flash", "label": "Tên Model AI (Gemini)"},
            {"key": "gemini_api_key", "value": os.getenv("GEMINI_API_KEY", ""), "label": "Google Gemini API Key"},
            {"key": "xp_per_word", "value": 10, "label": "XP nhận được cho mỗi từ đã học"},
            {"key": "daily_goal_limit", "value": 100, "label": "Giới hạn mục tiêu hàng ngày tối đa"}
        ]
        if not configs:
            config_collection.insert_many(default_configs)
            return jsonify(configs=default_configs), 200
        existing_keys = [c['key'] for c in configs]
        for default in default_configs:
            if default['key'] not in existing_keys:
                config_collection.insert_one(default)
                configs.append(default)
        return jsonify(configs=configs), 200
    except Exception as e:
        return jsonify({"msg": str(e)}), 500

@app.route('/api/admin/config', methods=['PUT'])
@admin_required()
def update_system_config():
    try:
        data = request.get_json()
        key = data.get("key")
        value = data.get("value")
        if not key:
            return jsonify({"msg": "Thiếu khóa cấu hình"}), 400
        result = config_collection.update_one({"key": key}, {"$set": {"value": value}})
        if result.matched_count == 0:
            return jsonify({"msg": "Không tìm thấy tham số này"}), 404
        return jsonify({"msg": f"Đã cập nhật {key} thành công"}), 200
    except Exception as e:
        return jsonify({"msg": str(e)}), 500

# =========================================================
# Edge-TTS Audio & Voice Management
# =========================================================
@app.route('/api/audio', methods=['GET'])
def get_audio():
    text = request.args.get('text')
    voice = request.args.get('voice', 'en-US-AriaNeural')
    if not text:
        return jsonify({"msg": "Missing text"}), 400

    safe_text = re.sub(r'[^a-zA-Z0-9]', '_', text.strip()[:50])

    # Thử edge_tts trước (có đầy đủ giọng nam/nữ)
    filename_edge = f"edge_{voice}_{safe_text}.mp3"
    filepath_edge = os.path.join(AUDIO_CACHE_DIR, filename_edge)

    if not os.path.exists(filepath_edge):
        try:
            import edge_tts as _edge_tts
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            async def _gen():
                communicate = _edge_tts.Communicate(text, voice)
                await communicate.save(filepath_edge)
            loop.run_until_complete(_gen())
            loop.close()
        except Exception as e:
            app.logger.warning(f"edge_tts failed ({e}), falling back to gTTS")
            # Fallback: gTTS với accent tương ứng
            tld_map = {'en-US': 'com', 'en-GB': 'co.uk', 'en-AU': 'com.au', 'en-IN': 'co.in'}
            tld = 'com'
            for prefix, t in tld_map.items():
                if voice.startswith(prefix):
                    tld = t
                    break
            filename_gtts = f"gtts_{tld}_{safe_text}.mp3"
            filepath_gtts = os.path.join(AUDIO_CACHE_DIR, filename_gtts)
            if not os.path.exists(filepath_gtts):
                try:
                    tts = gTTS(text=text, lang='en', tld=tld, slow=False)
                    tts.save(filepath_gtts)
                except Exception as e2:
                    app.logger.error(f"gTTS also failed: {e2}")
                    return jsonify({"msg": "Error generating audio"}), 500
            return send_file(filepath_gtts, mimetype="audio/mpeg")

    return send_file(filepath_edge, mimetype="audio/mpeg")

@app.route('/api/voices', methods=['GET'])
@jwt_required()
def get_active_voices():
    voices = list(voices_collection.find({"status": "on"}, {"_id": 0}))
    return jsonify(voices=voices), 200

@app.route('/api/admin/voices', methods=['GET'])
@admin_required()
def admin_get_all_voices():
    voices = list(voices_collection.find({}, {"_id": 0}))
    return jsonify(voices=voices), 200

@app.route('/api/admin/voices/<string:voice_id>', methods=['PUT'])
@admin_required()
def admin_update_voice(voice_id):
    data = request.get_json()
    update_fields = {}
    if "status" in data: update_fields["status"] = data["status"]
    if "name" in data: update_fields["name"] = data["name"]
    if not update_fields:
        return jsonify({"msg": "No data"}), 400
    voices_collection.update_one({"id": voice_id}, {"$set": update_fields})
    return jsonify({"msg": "Đã cập nhật giọng đọc!"}), 200

# =========================================================
# MAINTENANCE MODE API
# =========================================================
@app.route('/api/admin/maintenance', methods=['GET'])
@admin_required()
def get_maintenance():
    return jsonify({
        "maintenance_mode":    get_config_value("maintenance_mode", False),
        "maintenance_message": get_config_value("maintenance_message", "Hệ thống đang bảo trì."),
        "maintenance_eta":     get_config_value("maintenance_eta", ""),
    }), 200

@app.route('/api/admin/maintenance', methods=['PUT'])
@admin_required()
def set_maintenance():
    data = request.get_json() or {}
    fields = {
        "maintenance_mode":    data.get("maintenance_mode", False),
        "maintenance_message": data.get("maintenance_message", "Hệ thống đang bảo trì, vui lòng quay lại sau."),
        "maintenance_eta":     data.get("maintenance_eta", ""),
    }
    for key, value in fields.items():
        config_collection.update_one({"key": key}, {"$set": {"key": key, "value": value}}, upsert=True)
    # Nếu bật bảo trì → gửi notification cho tất cả user
    if fields["maintenance_mode"]:
        eta_text = f" Dự kiến hoàn thành: {fields['maintenance_eta']}." if fields["maintenance_eta"] else ""
        _broadcast_notification(
            user_ids=None,  # None = tất cả
            notif_type="maintenance",
            title="🔧 Thông báo bảo trì hệ thống",
            message=fields["maintenance_message"] + eta_text
        )
    return jsonify({"msg": "Đã cập nhật trạng thái bảo trì!"}), 200

# =========================================================
# NOTIFICATIONS API
# =========================================================
def _create_notification(user_id, notif_type, title, message, extra=None):
    """Tạo 1 notification cho 1 user."""
    doc = {
        "user_id":    str(user_id),
        "type":       notif_type,   # system|group_deleted|group_joined|member_joined|broadcast|maintenance
        "title":      title,
        "message":    message,
        "read":       False,
        "created_at": datetime.utcnow(),
        "extra":      extra or {}
    }
    notifications_collection.insert_one(doc)

def _broadcast_notification(user_ids, notif_type, title, message, extra=None):
    """Gửi notification cho nhiều user. user_ids=None → tất cả."""
    if user_ids is None:
        users = list(users_collection.find({}, {"_id": 1}))
        user_ids = [str(u["_id"]) for u in users]
    docs = [{
        "user_id":    str(uid),
        "type":       notif_type,
        "title":      title,
        "message":    message,
        "read":       False,
        "created_at": datetime.utcnow(),
        "extra":      extra or {}
    } for uid in user_ids]
    if docs:
        notifications_collection.insert_many(docs)

@app.route('/api/notifications', methods=['GET'])
@jwt_required()
def get_notifications():
    uid = get_jwt_identity()
    page     = int(request.args.get('page', 1))
    per_page = int(request.args.get('per_page', 20))
    skip     = (page - 1) * per_page
    notifs = list(notifications_collection.find(
        {"user_id": str(uid)},
        sort=[("created_at", -1)]
    ).skip(skip).limit(per_page))
    unread_count = notifications_collection.count_documents({"user_id": str(uid), "read": False})
    result = []
    for n in notifs:
        result.append({
            "id":         str(n["_id"]),
            "type":       n.get("type", "system"),
            "title":      n.get("title", ""),
            "message":    n.get("message", ""),
            "read":       n.get("read", False),
            "created_at": n["created_at"].isoformat() if n.get("created_at") else "",
            "extra":      n.get("extra", {})
        })
    return jsonify({"notifications": result, "unread_count": unread_count}), 200

@app.route('/api/notifications/read', methods=['PUT'])
@jwt_required()
def mark_notifications_read():
    uid  = get_jwt_identity()
    data = request.get_json() or {}
    nid  = data.get("id")  # None = đánh dấu tất cả
    if nid:
        notifications_collection.update_one(
            {"_id": ObjectId(nid), "user_id": str(uid)},
            {"$set": {"read": True}}
        )
    else:
        notifications_collection.update_many({"user_id": str(uid)}, {"$set": {"read": True}})
    return jsonify({"msg": "Đã đánh dấu đã đọc"}), 200

@app.route('/api/notifications/<string:nid>', methods=['DELETE'])
@jwt_required()
def delete_notification(nid):
    uid = get_jwt_identity()
    notifications_collection.delete_one({"_id": ObjectId(nid), "user_id": str(uid)})
    return jsonify({"msg": "Đã xóa thông báo"}), 200

@app.route('/api/notifications/clear', methods=['DELETE'])
@jwt_required()
def clear_notifications():
    uid = get_jwt_identity()
    notifications_collection.delete_many({"user_id": str(uid)})
    return jsonify({"msg": "Đã xóa tất cả thông báo"}), 200

# =========================================================
# ADMIN — BROADCAST NOTIFICATION
# =========================================================
@app.route('/api/admin/notifications/broadcast', methods=['POST'])
@admin_required()
def admin_broadcast():
    data    = request.get_json() or {}
    title   = data.get("title", "").strip()
    message = data.get("message", "").strip()
    target  = data.get("target", "all")   # all | user_ids | group_id
    if not title or not message:
        return jsonify(msg="Thiếu tiêu đề hoặc nội dung"), 400

    if target == "all":
        _broadcast_notification(None, "broadcast", title, message)
        count = users_collection.count_documents({})
    elif target == "user_ids":
        uid_list = data.get("user_ids", [])
        _broadcast_notification(uid_list, "broadcast", title, message)
        count = len(uid_list)
    elif target == "group_id":
        gid = data.get("group_id", "")
        try:
            members = list(group_members_collection.find({"group_id": ObjectId(gid)}, {"user_id": 1}))
        except:
            members = []
        uid_list = [str(m["user_id"]) for m in members]
        _broadcast_notification(uid_list, "broadcast", title, message)
        count = len(uid_list)
    else:
        return jsonify(msg="target không hợp lệ"), 400

    # Lưu lịch sử broadcast
    db.broadcast_log.insert_one({
        "title": title, "message": message,
        "target": target, "recipient_count": count,
        "sent_at": datetime.utcnow(),
        "sent_by": get_jwt_identity()
    })
    return jsonify({"msg": f"Đã gửi thông báo đến {count} người dùng"}), 200

@app.route('/api/admin/notifications/broadcast/history', methods=['GET'])
@admin_required()
def admin_broadcast_history():
    logs = list(db.broadcast_log.find({}, sort=[("sent_at", -1)]).limit(50))
    result = []
    for l in logs:
        result.append({
            "id":              str(l["_id"]),
            "title":           l.get("title", ""),
            "message":         l.get("message", ""),
            "target":          l.get("target", ""),
            "recipient_count": l.get("recipient_count", 0),
            "sent_at":         l["sent_at"].isoformat() if l.get("sent_at") else "",
        })
    return jsonify({"history": result}), 200

# =========================================================
# ADMIN — QUẢN LÝ NHÓM
# =========================================================
@app.route('/api/admin/groups', methods=['GET'])
@admin_required()
def admin_list_groups():
    search = request.args.get('search', '').strip()
    page   = int(request.args.get('page', 1))
    per_page = int(request.args.get('per_page', 20))
    skip   = (page - 1) * per_page
    query  = {}
    if search:
        query["name"] = {"$regex": search, "$options": "i"}
    groups = list(groups_collection.find(query, sort=[("created_at", -1)]).skip(skip).limit(per_page))
    total  = groups_collection.count_documents(query)
    result = []
    for g in groups:
        gid = g["_id"]
        member_count = group_members_collection.count_documents({"group_id": gid})
        deck_count   = len(g.get("decks", []))
        owner = users_collection.find_one({"_id": g.get("owner_id")}, {"username": 1, "email": 1})
        result.append({
            "id":           str(gid),
            "name":         g.get("name", ""),
            "code":         g.get("code", ""),
            "owner":        {"id": str(g.get("owner_id", "")), "username": owner.get("username", "") if owner else "", "email": owner.get("email", "") if owner else ""},
            "member_count": member_count,
            "deck_count":   deck_count,
            "created_at":   g["created_at"].isoformat() if g.get("created_at") else "",
        })
    return jsonify({"groups": result, "total": total, "page": page, "per_page": per_page}), 200

@app.route('/api/admin/groups/<string:gid>', methods=['GET'])
@admin_required()
def admin_get_group(gid):
    try:
        group = groups_collection.find_one({"_id": ObjectId(gid)})
    except:
        return jsonify(msg="ID không hợp lệ"), 400
    if not group:
        return jsonify(msg="Không tìm thấy nhóm"), 404
    members_raw = list(group_members_collection.find({"group_id": ObjectId(gid)}))
    members = []
    for m in members_raw:
        u = users_collection.find_one({"_id": m["user_id"]}, {"username": 1, "email": 1})
        members.append({
            "user_id":  str(m["user_id"]),
            "username": u.get("username", "") if u else "",
            "email":    u.get("email", "") if u else "",
            "role":     m.get("role", "member"),
            "joined_at": m["joined_at"].isoformat() if m.get("joined_at") else ""
        })
    return jsonify({
        "id":      str(group["_id"]),
        "name":    group.get("name", ""),
        "code":    group.get("code", ""),
        "decks":   group.get("decks", []),
        "members": members,
        "created_at": group["created_at"].isoformat() if group.get("created_at") else ""
    }), 200

@app.route('/api/admin/groups/<string:gid>', methods=['DELETE'])
@admin_required()
def admin_delete_group(gid):
    data = request.get_json() or {}
    reason_code = data.get("reason_code", "other")
    reason_note = data.get("reason_note", "")
    notify      = data.get("notify_members", True)
    REASON_LABELS = {
        "abandoned":            "Nhóm không có hoạt động trong thời gian dài",
        "inappropriate_content":"Nhóm chứa nội dung không phù hợp",
        "owner_deleted":        "Chủ nhóm đã xóa tài khoản",
        "spam":                 "Nhóm được tạo với mục đích spam",
        "request":              "Theo yêu cầu của chủ nhóm",
        "other":                reason_note or "Lý do khác",
    }
    try:
        oid = ObjectId(gid)
        group = groups_collection.find_one({"_id": oid})
    except:
        return jsonify(msg="ID không hợp lệ"), 400
    if not group:
        return jsonify(msg="Không tìm thấy nhóm"), 404
    group_name    = group.get("name", "Nhóm không tên")
    reason_label  = REASON_LABELS.get(reason_code, reason_note or "Lý do khác")
    # Lấy danh sách thành viên trước khi xóa
    members = list(group_members_collection.find({"group_id": oid}, {"user_id": 1}))
    member_ids = [str(m["user_id"]) for m in members]
    # Gửi notification
    if notify and member_ids:
        _broadcast_notification(
            user_ids=member_ids,
            notif_type="group_deleted",
            title=f"Nhóm \"{group_name}\" đã bị xóa",
            message=f"Lý do: {reason_label}" + (f"\nGhi chú: {reason_note}" if reason_note and reason_code != "other" else ""),
            extra={"group_id": gid, "group_name": group_name, "reason_code": reason_code}
        )
    # Lưu log
    deleted_groups_log_collection.insert_one({
        "group_id":    gid,
        "group_name":  group_name,
        "owner_id":    str(group.get("owner_id", "")),
        "member_ids":  member_ids,
        "reason_code": reason_code,
        "reason_note": reason_note,
        "deleted_at":  datetime.utcnow(),
        "deleted_by":  get_jwt_identity(),
    })
    # Xóa nhóm + thành viên + progress
    groups_collection.delete_one({"_id": oid})
    group_members_collection.delete_many({"group_id": oid})
    group_progress_collection.delete_many({"group_id": oid})
    return jsonify({"msg": f"Đã xóa nhóm \"{group_name}\""}), 200

@app.route('/api/admin/groups/<string:gid>/transfer', methods=['PUT'])
@admin_required()
def admin_transfer_group_owner(gid):
    data       = request.get_json() or {}
    new_owner_id = data.get("new_owner_id", "")
    try:
        oid = ObjectId(gid)
        new_oid = ObjectId(new_owner_id)
    except:
        return jsonify(msg="ID không hợp lệ"), 400
    group = groups_collection.find_one({"_id": oid})
    if not group:
        return jsonify(msg="Không tìm thấy nhóm"), 404
    # Kiểm tra new_owner có trong nhóm không
    member = group_members_collection.find_one({"group_id": oid, "user_id": new_oid})
    if not member:
        return jsonify(msg="Người dùng này không phải thành viên nhóm"), 400
    old_owner_id = group.get("owner_id")
    # Cập nhật owner nhóm
    groups_collection.update_one({"_id": oid}, {"$set": {"owner_id": new_oid}})
    # Cập nhật role trong group_members
    group_members_collection.update_one({"group_id": oid, "user_id": new_oid}, {"$set": {"role": "owner"}})
    if old_owner_id:
        group_members_collection.update_one({"group_id": oid, "user_id": old_owner_id}, {"$set": {"role": "member"}})
    new_user = users_collection.find_one({"_id": new_oid}, {"username": 1})
    _create_notification(
        str(new_oid), "system",
        f"Bạn là chủ mới của nhóm \"{group.get('name', '')}\"",
        "Admin đã chuyển quyền sở hữu nhóm cho bạn.",
        extra={"group_id": gid}
    )
    return jsonify({"msg": f"Đã chuyển ownership cho {new_user.get('username', '') if new_user else new_owner_id}"}), 200

@app.route('/api/admin/groups/deleted-log', methods=['GET'])
@admin_required()
def admin_deleted_groups_log():
    logs = list(deleted_groups_log_collection.find({}, sort=[("deleted_at", -1)]).limit(50))
    result = []
    for l in logs:
        result.append({
            "group_id":   l.get("group_id", ""),
            "group_name": l.get("group_name", ""),
            "reason_code":l.get("reason_code", ""),
            "reason_note":l.get("reason_note", ""),
            "member_count": len(l.get("member_ids", [])),
            "deleted_at": l["deleted_at"].isoformat() if l.get("deleted_at") else "",
        })
    return jsonify({"logs": result}), 200

# Main
if __name__ == '__main__':
    if os.getenv("FLASK_ENV") == "development" or os.getenv("CREATE_ADMIN") == "true":
        admin_username = os.getenv("ADMIN_EMAIL", "admin@vocabflow.com")
        admin_password = os.getenv("ADMIN_PASSWORD", "adminpass")
        if users_collection.find_one({"username": admin_username, "role": "admin"}) is None:
            hashed_password = generate_password_hash(admin_password)
            users_collection.insert_one({
                "username": admin_username, "password": hashed_password,
                "login_type": "email", "role": "admin", "status": "active",
                "daily_goal": 5, "theme": "light", "created_at": datetime.utcnow()
            })
            print(f"--- Created Admin: {admin_username} ---")

    with app.app_context():
        if not config_collection.find_one({"key": "gemini_api_key"}):
            config_collection.insert_one({"key": "gemini_api_key", "value": os.getenv("GEMINI_API_KEY", ""), "label": "Google Gemini API Key"})
        config_collection.update_one({"key": "gemini_model"}, {"$set": {"value": "gemini-2.5-flash"}}, upsert=True)
        config_collection.update_one({"key": "xp_per_word"}, {"$set": {"value": 10}}, upsert=True)
        config_collection.update_one({"key": "daily_goal_limit"}, {"$set": {"value": 100}}, upsert=True)
        print("--- ĐÃ CẬP NHẬT CẤU HÌNH DATABASE ---")

        chat_sessions_collection.create_index([("user_id", 1), ("updated_at", -1)])
        try:
            chat_history_collection.create_index("user_id", unique=True)
        except: pass

        # ── Group indexes ──────────────────────────────────────
        from pymongo import ASCENDING as ASC
        db.groups.create_index("code", unique=True, background=True)
        db.group_members.create_index([("group_id", ASC), ("user_id", ASC)], unique=True, background=True)
        db.group_progress.create_index([("group_id", ASC), ("deck_id", ASC), ("user_id", ASC)], background=True)
        print("--- ĐÃ KHỞI TẠO INDEX CHO NHÓM HỌC ---")

        if voices_collection.count_documents({}) == 0:
            default_voices = [
                {"id": "en-US-AriaNeural",   "name": "Cô Aria (Mỹ - Nữ)",     "gender": "Female", "region": "US", "tld": "com",    "status": "on"},
                {"id": "en-US-GuyNeural",    "name": "Thầy Guy (Mỹ - Nam)",   "gender": "Male",   "region": "US", "tld": "com",    "status": "on"},
                {"id": "en-GB-SoniaNeural",  "name": "Cô Sonia (Anh - Nữ)",   "gender": "Female", "region": "UK", "tld": "co.uk",  "status": "on"},
                {"id": "en-GB-RyanNeural",   "name": "Thầy Ryan (Anh - Nam)",  "gender": "Male",   "region": "UK", "tld": "co.uk",  "status": "on"},
                {"id": "en-AU-NatashaNeural","name": "Cô Natasha (Úc - Nữ)",  "gender": "Female", "region": "AU", "tld": "com.au", "status": "on"},
                {"id": "en-AU-WilliamNeural","name": "Thầy William (Úc - Nam)","gender": "Male",  "region": "AU", "tld": "com.au", "status": "on"},
            ]
            voices_collection.insert_many(default_voices)
            print("--- ĐÃ KHỞI TẠO 5 GIỌNG ĐỌC EDGE-TTS MẶC ĐỊNH ---")

    if not GEMINI_API_KEY:
        print("CẢNH BÁO: GEMINI_API_KEY KHÔNG ĐƯỢC THIẾT LẬP.")
    try:
        client.admin.command('ismaster')
        print("Successfully connected to MongoDB!")
    except Exception as e:
        print(f"Could not connect to MongoDB: {e}")
        exit(1)

    app.run(host="0.0.0.0", port=8080)
# --- START OF FILE app.py ---

import os
from datetime import datetime
from functools import wraps
from flask import Flask, request, jsonify
from dotenv import load_dotenv
from pymongo import MongoClient
from bson.objectid import ObjectId
from flask_jwt_extended import create_access_token, jwt_required, JWTManager, get_jwt_identity
from flask_cors import CORS
from werkzeug.security import generate_password_hash, check_password_hash
import requests # NEW: Import requests library for API calls
import logging # NEW: Import logging for better error tracking

# =========================================================
# Load environment variables
# =========================================================
load_dotenv()

app = Flask(__name__)
CORS(app)

# Thiết lập Logger
app.logger.setLevel(logging.INFO)

# Config
MONGO_URI = os.getenv("MONGO_URI")
if not MONGO_URI:
    raise ValueError("MONGO_URI environment variable not set. Please check your .env file.")

app.config['SECRET_KEY'] = os.getenv("SECRET_KEY", "fallback_secret_key_for_dev")
app.config["JWT_SECRET_KEY"] = os.getenv("JWT_SECRET_KEY", "super-secret-jwt-key")

# Lấy khóa API cho AI
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY") 

jwt = JWTManager(app)

# =========================================================
# MongoDB connection
# =========================================================
client = MongoClient(MONGO_URI)
db = client.vocabflow_user
users_collection = db.users
decks_collection = db.decks
progress_collection = db.progress

# =========================================================
# Authorization Decorators
# =========================================================

def admin_required():
    """Decorator to restrict access only to users with 'admin' role."""
    def wrapper(fn):
        @wraps(fn)
        @jwt_required()
        def decorator(*args, **kwargs):
            current_user_id = get_jwt_identity()
            try:
                user = users_collection.find_one({"_id": ObjectId(current_user_id)})
            except:
                return jsonify(msg="Truy cập bị từ chối: ID người dùng không hợp lệ"), 403

            # Kiểm tra vai trò
            if user and user.get("role") == "admin":
                return fn(*args, **kwargs)
            else:
                return jsonify(msg="Truy cập bị từ chối: Yêu cầu quyền Admin"), 403
        return decorator
    return wrapper

# =========================================================
# AI CORE FUNCTIONALITY (CHỨC NĂNG CHAT)
# =========================================================

def generate_chat_response(history: list, new_message: str):
    if not GEMINI_API_KEY:
        raise ValueError("AI API Key không được thiết lập cho Chatbot.")

    # Xây dựng lịch sử chat theo định dạng của Gemini
    gemini_history = []
    
    # SYSTEM INSTRUCTION (Hướng dẫn cho Bot)
    system_instruction = "Bạn là một AI Coach chuyên nghiệp về tiếng Anh, tên là VocabFlow Coach. Hãy trả lời ngắn gọn, thân thiện và sử dụng tiếng Việt. Tập trung vào việc giải thích ngữ pháp, từ vựng và khuyến khích người dùng luyện tập."
    
    # Chuyển đổi lịch sử từ Frontend format sang Gemini format (role: user/model)
    for msg in history:
        # Frontend sử dụng 'user' và 'bot'. Gemini sử dụng 'user' và 'model'.
        role = "user" if msg['role'] == 'user' else "model"
        
        # Bỏ qua tin nhắn chào đầu tiên của Bot trong lịch sử nếu nó không phải là phản hồi thực tế
        if msg['content'] and msg['content'].startswith("Xin chào"):
            continue 
            
        gemini_history.append({"role": role, "parts": [{"text": msg['content']}]})
        
    # Thêm tin nhắn hiện tại
    gemini_history.append({"role": "user", "parts": [{"text": new_message}]})

    
    headers = {
        "Content-Type": "application/json",
    }
    
    data = {
        "contents": gemini_history,
        "config": {
            # Sử dụng system_instruction trong config
            "system_instruction": system_instruction, 
            "temperature": 0.7 
        }
    }
    
    # Thêm Key vào query parameters (Cách phổ biến cho Gemini API)
    params = {
        "key": GEMINI_API_KEY
    }
    
    # Sử dụng mô hình flash mạnh mẽ và nhanh chóng cho Chat
    GEMINI_API_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent"

    response = None
    try:
        # Gửi request với Key trong params
        response = requests.post(GEMINI_API_ENDPOINT, headers=headers, json=data, params=params)
        response.raise_for_status() 
        
        response_data = response.json()
        
        # Trích xuất phản hồi từ AI
        if 'candidates' in response_data and response_data['candidates']:
             return response_data['candidates'][0]['content']['parts'][0]['text']
        else:
             # Xử lý trường hợp AI bị chặn hoặc phản hồi trống
             raise RuntimeError(f"AI không thể tạo ra phản hồi. Response: {response_data}")

    except requests.exceptions.RequestException as e:
        app.logger.error(f"Lỗi gọi API AI Chat: {e}, Response: {response.text if response is not None else 'No response'}")
        # Quan trọng: Hiển thị lỗi HTTP cụ thể hơn nếu có
        status_code = response.status_code if response is not None else 'No response status'
        raise RuntimeError(f"Lỗi kết nối hoặc phản hồi từ AI API. Status: {status_code}. Vui lòng kiểm tra API Key.")
    except Exception as e:
        app.logger.error(f"Lỗi xử lý phản hồi AI Chat: {e}", exc_info=True)
        raise RuntimeError("Lỗi cấu trúc phản hồi từ AI Chat.")


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

# =========================================================
# User Authentication
# =========================================================
@app.route('/api/register', methods=['POST'])
def register():
    username = request.json.get('username')
    password = request.json.get('password')
    login_type = request.json.get('login_type', 'email')
    
    # Cố định vai trò mặc định cho đăng ký
    role = request.json.get('role', 'student') 

    if not username or not password:
        return jsonify({"msg": "Username và mật khẩu là bắt buộc"}), 400

    # Kiểm tra xem người dùng với username và login_type này đã tồn tại chưa
    if users_collection.find_one({"username": username, "login_type": login_type}):
        return jsonify({"msg": f"Tên người dùng '{username}' đã tồn tại"}), 409

    # Hashing mật khẩu bằng Werkzeug (Bảo mật)
    hashed_password = generate_password_hash(password)

    users_collection.insert_one({
        "username": username,
        "password": hashed_password,
        "login_type": login_type,
        "role": role, # Lưu vai trò
        "status": "active", # Trạng thái mặc định
        "created_at": datetime.utcnow()
    })

    return jsonify({"msg": "Đăng ký thành công"}), 201


@app.route('/api/login', methods=['POST'])
def login():
    username = request.json.get('username')
    password = request.json.get('password')
    login_type = request.json.get('login_type', 'email')

    if not username or not password:
        return jsonify({"msg": "Tên người dùng và mật khẩu là bắt buộc"}), 400

    # Tìm người dùng dựa trên username VÀ login_type
    user = users_collection.find_one({"username": username, "login_type": login_type})
    if not user:
        return jsonify({"msg": "Tên người dùng hoặc mật khẩu không đúng"}), 401
    
    # Kiểm tra mật khẩu bằng check_password_hash
    if check_password_hash(user["password"], password):
        # Đảm bảo người dùng không bị cấm
        if user.get("status") == "banned":
             return jsonify({"msg": "Tài khoản của bạn đã bị cấm truy cập."}), 403

        access_token = create_access_token(identity=str(user['_id']))
        return jsonify(
            access_token=access_token,
            username=username,
            userId=str(user['_id']),
            login_type=login_type,
            role=user.get("role", "student") # Trả về vai trò
        ), 200
    else:
        return jsonify({"msg": "Tên người dùng hoặc mật khẩu không đúng"}), 401


@app.route('/api/protected', methods=['GET'])
@jwt_required()
def protected():
    current_user_id = get_jwt_identity()
    return jsonify(message=f"Chào mừng! Bạn đã truy cập tài nguyên được bảo vệ với user ID: {current_user_id}"), 200

# =========================================================
# Admin User Management
# =========================================================

@app.route('/api/admin/users', methods=['GET'])
@admin_required() # Chỉ admin mới được truy cập
def admin_get_all_users():
    # Lấy thông tin cơ bản của tất cả người dùng
    users_cursor = users_collection.find({}, {"password": 0}) # Loại trừ mật khẩu
    users = []
    for user in users_cursor:
        user['_id'] = str(user['_id'])
        # Định dạng ngày tháng cho frontend
        user['created_at'] = user['created_at'].strftime("%Y-%m-%d") if user.get('created_at') else 'N/A'
        users.append(user)
    
    return jsonify(users=users), 200

@app.route('/api/admin/users/<string:user_id>', methods=['PUT', 'DELETE'])
@admin_required()
def admin_manage_single_user(user_id):
    if not ObjectId.is_valid(user_id):
        return jsonify({"msg": "ID người dùng không hợp lệ"}), 400

    user_object_id = ObjectId(user_id)
    
    if request.method == 'PUT':
        data = request.get_json()
        update_fields = {}
        
        # Cập nhật Email/Username
        if 'email' in data:
            update_fields['username'] = data['email']
        
        # Cập nhật Mật khẩu (Chỉ khi có dữ liệu mới)
        if 'password' in data and data['password']:
            update_fields['password'] = generate_password_hash(data['password'])
        
        # Cập nhật Trạng thái và Vai trò
        if 'status' in data:
            update_fields['status'] = data['status']
        
        if 'role' in data:
            update_fields['role'] = data['role']

        if not update_fields:
            return jsonify({"msg": "Không có trường nào được cung cấp để cập nhật"}), 400

        result = users_collection.update_one(
            {"_id": user_object_id},
            {"$set": update_fields}
        )
        
        if result.matched_count == 0:
            return jsonify({"msg": "Không tìm thấy người dùng"}), 404
            
        return jsonify({"msg": "Cập nhật tài khoản thành công"}), 200

    elif request.method == 'DELETE':
        result = users_collection.delete_one({"_id": user_object_id})
        
        if result.deleted_count == 0:
            return jsonify({"msg": "Không tìm thấy người dùng"}), 404
            
        return jsonify({"msg": "Xóa người dùng thành công"}), 200


@app.route('/api/admin/users', methods=['POST'])
@admin_required()
def admin_create_user():
    data = request.get_json()
    username = data.get('email') # Sử dụng 'email' cho trường 'username'
    password = data.get('password')
    role = data.get('role', 'student')
    status = data.get('status', 'active')

    if not username or not password:
        return jsonify({"msg": "Email và mật khẩu là bắt buộc"}), 400

    if users_collection.find_one({"username": username}):
        return jsonify({"msg": f"Người dùng {username} đã tồn tại"}), 409

    hashed_password = generate_password_hash(password)

    new_user = {
        "username": username,
        "password": hashed_password,
        "role": role,
        "status": status,
        "login_type": "admin_created", # Loại đăng nhập đặc biệt cho tài khoản được Admin tạo
        "created_at": datetime.utcnow()
    }
    result = users_collection.insert_one(new_user)
    
    return jsonify({"msg": "Tạo người dùng thành công", "userId": str(result.inserted_id)}), 201

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
        deck["id"] = str(deck.pop("_id")) # Đổi _id thành id để Frontend dễ xử lý
        deck["user_id"] = str(deck["user_id"])
        # Chúng ta sẽ trả về toàn bộ dữ liệu (bao gồm words)
        decks.append(deck)
    return jsonify(decks=decks), 200


@app.route('/api/decks', methods=['POST'])
@jwt_required()
def create_user_deck():
    current_user_id = get_jwt_identity()
    data = request.get_json()
    
    # NEW: Kiểm tra và lấy mảng words
    words = data.get("words", []) 
    # TODO: Cần validation cấu trúc của từng từ trong mảng words

    new_deck = {
        "user_id": ObjectId(current_user_id),
        "name": data.get("name", "Untitled Deck"),
        "words": words, # LƯU TRỮ MẢNG WORDS
        "created_at": datetime.utcnow(),
        "updated_at": datetime.utcnow()
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
            return jsonify({"msg": "Không tìm thấy deck"}), 404
        deck["id"] = str(deck.pop("_id"))
        deck["user_id"] = str(deck["user_id"])
        return jsonify(deck=deck), 200

    elif request.method == 'PUT':
        data = request.get_json()
        update_fields = {}
        
        # Cập nhật Name
        if "name" in data:
            update_fields["name"] = data["name"]
            
        # Cập nhật Words (BẮT BUỘC, vì Frontend gửi toàn bộ mảng words)
        if "words" in data:
            update_fields["words"] = data["words"]
        
        update_fields["updated_at"] = datetime.utcnow()

        update_operation = {"$set": update_fields}
        
        result = decks_collection.update_one(query, update_operation)
        
        if result.matched_count == 0:
            return jsonify({"msg": "Không tìm thấy deck hoặc bạn không có quyền"}), 404
        return jsonify({"msg": "Cập nhật bộ từ thành công"}), 200

    elif request.method == 'DELETE':
        # Xóa tiến độ liên quan trước (tùy chọn nhưng nên làm)
        progress_collection.delete_many({"user_id": ObjectId(current_user_id), "deck_id": deck_id})
        
        # Xóa deck chính
        result = decks_collection.delete_one(query)
        
        if result.deleted_count == 0:
            return jsonify({"msg": "Không tìm thấy deck"}), 404
        return jsonify({"msg": "Xóa bộ từ và tiến độ liên quan thành công"}), 200

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
        # Cần chuyển đổi ObjectId sang chuỗi nếu có trong record, nhưng ở đây chỉ lấy deck_id và word_id
        deck_id = record.get("deck_id")
        word_id = record.get("word_id")
        status = record.get("status")

        if deck_id not in formatted_progress:
            # Lưu trữ tiến độ theo deck_id
            formatted_progress[deck_id] = {"learnedWords": []}
        
        # Chỉ thêm các từ đã học (status="learned") vào danh sách
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
        # deck_id không cần phải là ObjectId nếu nó là ID của một deck trong một collection khác
        "deck_id": deck_id, 
        "user_id": ObjectId(current_user_id),
        "word_id": word_id,
        "status": status,
        "updated_at": datetime.utcnow()
    }
    
    # Tìm kiếm theo deck_id, user_id, và word_id để cập nhật hoặc chèn
    progress_collection.update_one(
        {"deck_id": deck_id, "user_id": ObjectId(current_user_id), "word_id": word_id},
        {"$set": update_data},
        upsert=True # Nếu không tìm thấy, sẽ chèn mới
    )
    return jsonify({"msg": "Tiến độ đã được cập nhật"}), 200

# =========================================================
# AI Chat Route
# =========================================================
@app.route('/api/ai/chat', methods=['POST'])
@jwt_required()
def ai_chat():
    data = request.get_json()
    user_message = data.get('user_message')
    history = data.get('history', [])

    if not user_message:
        return jsonify({"msg": "Tin nhắn người dùng là bắt buộc"}), 400

    try:
        response_text = generate_chat_response(history, user_message)
        return jsonify({"response": response_text}), 200
    except ValueError as e:
        app.logger.error(f"Lỗi cấu hình AI: {e}")
        return jsonify({"msg": f"Lỗi cấu hình server: {str(e)}"}), 503
    except RuntimeError as e:
        app.logger.error(f"Lỗi API AI: {e}")
        return jsonify({"msg": f"Đã xảy ra lỗi với AI Coach: {str(e)}"}), 500
    except Exception as e:
        app.logger.error(f"Lỗi không xác định trong Chatbot: {e}", exc_info=True)
        return jsonify({"msg": "Lỗi không xác định khi xử lý tin nhắn AI."}), 500


# =========================================================
# Main
# =========================================================
if __name__ == '__main__':
    # LOGIC TẠO TÀI KHOẢN ADMIN MẶC ĐỊNH
    if os.getenv("FLASK_ENV") == "development" or os.getenv("CREATE_ADMIN") == "true": # Thêm biến môi trường để kích hoạt
        admin_username = os.getenv("ADMIN_EMAIL", "admin@vocabflow.com")
        admin_password = os.getenv("ADMIN_PASSWORD", "adminpass")
        
        # Chỉ tạo nếu chưa tồn tại người dùng với username và role là admin
        if users_collection.find_one({"username": admin_username, "role": "admin"}) is None:
            hashed_password = generate_password_hash(admin_password)
            users_collection.insert_one({
                "username": admin_username,
                "password": hashed_password,
                "login_type": "email",
                "role": "admin",
                "status": "active",
                "created_at": datetime.utcnow()
            })
            print(f"--- Đã tạo Admin mặc định: {admin_username}/{admin_password} ---")

    # Kiểm tra Key AI đã được tải chưa
    if not GEMINI_API_KEY:
        print("CẢNH BÁO: GEMINI_API_KEY KHÔNG ĐƯỢC THIẾT LẬP. Các chức năng AI sẽ bị lỗi.")
        
    try:
        client.admin.command('ismaster')
        print("Successfully connected to MongoDB!")
    except Exception as e:
        print(f"Could not connect to MongoDB: {e}")
        exit(1)
        # 
# run app

    app.run(debug=True, port=5000)
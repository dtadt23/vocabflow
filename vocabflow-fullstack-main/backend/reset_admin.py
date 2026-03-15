from pymongo import MongoClient
from werkzeug.security import generate_password_hash
from dotenv import load_dotenv
import os

# 1. Nạp biến môi trường
load_dotenv()

# 2. Kết nối Database
MONGO_URI = os.getenv("MONGO_URI")
if not MONGO_URI:
    print("❌ Lỗi: Không tìm thấy MONGO_URI trong file .env")
    exit()

client = MongoClient(MONGO_URI)
db = client.vocabflow_user  # Tên database (check kỹ trong MongoDB Compass nếu khác)
users_collection = db.users

# 3. Thông tin Admin cần reset
email = "admin@vocabflow.com"
new_pass = "adminpass"

# 4. Thực hiện Reset
hashed_password = generate_password_hash(new_pass)

# Tìm và cập nhật (nếu chưa có thì tạo mới luôn - upsert=True)
result = users_collection.update_one(
    {"username": email},
    {
        "$set": {
            "password": hashed_password,
            "role": "admin",
            "status": "active",
            "login_type": "email"
        }
    },
    upsert=True
)

print("-" * 30)
print(f"✅ ĐÃ RESET TÀI KHOẢN ADMIN THÀNH CÔNG!")
print(f"📧 Email:    {email}")
print(f"🔑 Mật khẩu: {new_pass}")
print("-" * 30)
import requests

API_KEY = "AIzaSyB-B-kyZ1uDzEb2VCTBqTHyNtbEiBI2PXw"
# THỬ LẠI 1.5 NHƯNG DÙNG CỔNG v1 (KHÔNG CÓ CHỮ BETA)
url = f"https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent?key={API_KEY}"

headers = {'Content-Type': 'application/json'}
data = {"contents": [{"parts": [{"text": "Say OK if you hear me"}]}]}

print("--- ĐANG KIỂM TRA MODEL 1.5 TRÊN CỔNG V1 (STABLE) ---")
try:
    response = requests.post(url, headers=headers, json=data)
    if response.status_code == 200:
        print("✅ THÀNH CÔNG RỰC RỠ! Model 1.5 đã sống.")
        print("AI:", response.json()['candidates'][0]['content']['parts'][0]['text'])
    else:
        print(f"❌ VẪN LỖI {response.status_code}:")
        print(response.text)
except Exception as e:
    print(f"❌ LỖI: {e}")
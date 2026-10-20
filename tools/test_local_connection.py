import os
import requests
from dotenv import load_dotenv

load_dotenv()

BASE_URL = os.getenv("LOCAL_AI_BASE_URL", "http://127.0.0.1:5001/v1").rstrip("/")
MODEL_NAME = os.getenv("LOCAL_AI_MODEL", "qwen2.5-coder")

def test_connection():
    print(f"[*] Checking connection to KoboldCpp endpoint: {BASE_URL}")
    try:
        res = requests.post(
            f"{BASE_URL}/chat/completions",
            json={
                "model": MODEL_NAME,
                "messages": [{"role": "user", "content": "Ping"}],
                "max_tokens": 10
            },
            timeout=10
        )
        res.raise_for_status()
        reply = res.json()["choices"][0]["message"]["content"]
        print(f"[+] Connected successfully! Model response: {reply.strip()}")
    except Exception as e:
        print(f"[-] Connection failed: {e}")

if __name__ == "__main__":
    test_connection()
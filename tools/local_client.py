import os
import requests
from dotenv import load_dotenv

load_dotenv()

BASE_URL = os.getenv("LOCAL_AI_BASE_URL", "http://127.0.0.1:5001/v1").rstrip("/")
MODEL_NAME = os.getenv("LOCAL_AI_MODEL", "qwen2.5-coder")
TIMEOUT = int(os.getenv("LOCAL_AI_TIMEOUT", "180"))
TEMPERATURE = float(os.getenv("LOCAL_AI_TEMPERATURE", "0.2"))

def call_local_chat(system_prompt: str, user_prompt: str, json_mode: bool = False) -> str:
    headers = {"Content-Type": "application/json"}
    payload = {
        "model": MODEL_NAME,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt}
        ],
        "temperature": TEMPERATURE,
        "max_tokens": 4096
    }
    
    if json_mode:
        payload["response_format"] = {"type": "json_object"}

    response = requests.post(f"{BASE_URL}/chat/completions", headers=headers, json=payload, timeout=TIMEOUT)
    response.raise_for_status()
    data = response.json()
    return data["choices"][0]["message"]["content"]
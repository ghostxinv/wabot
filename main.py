import requests
import json
import os
import sys
import time

def _load_key():
    key = os.environ.get("GEMINI_API_KEY")
    if key:
        return key
    try:
        with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "bot", ".env")) as f:
            for line in f:
                if line.strip().startswith("GEMINI_API_KEY="):
                    return line.split("=", 1)[1].strip()
    except OSError:
        pass
    return ""

API_KEY = _load_key()
MODEL = os.environ.get("GEMINI_MODEL", "gemini-3.6-flash")
URL = f"https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent?key={API_KEY}"

def chat(prompt, retries=3):
    payload = {
        "contents": [{"parts": [{"text": prompt}]}]
    }
    for attempt in range(retries):
        try:
            response = requests.post(URL, json=payload, timeout=30)
            if response.status_code == 503:
                if attempt < retries - 1:
                    print(f"\nServer busy, retrying... (attempt {attempt + 2}/{retries})")
                    time.sleep(3)
                    continue
            if response.status_code != 200:
                print(f"Error {response.status_code}: {response.text}")
                return
            data = response.json()
            text = data["candidates"][0]["content"]["parts"][0]["text"]
            print(text)
            return
        except requests.exceptions.Timeout:
            if attempt < retries - 1:
                print(f"\nRequest timed out, retrying... (attempt {attempt + 2}/{retries})")
                time.sleep(3)
            else:
                print("Request timed out. Please try again later.")
        except Exception as e:
            print(f"Error: {e}")
            return

if __name__ == "__main__":
    if len(sys.argv) > 1:
        chat(" ".join(sys.argv[1:]))
    else:
        print("Gemini AI Chat (type 'quit' to exit)\n")
        while True:
            user_input = input("You: ")
            if user_input.lower() in ("quit", "exit"):
                break
            print("Gemini: ", end="")
            chat(user_input)
            print()

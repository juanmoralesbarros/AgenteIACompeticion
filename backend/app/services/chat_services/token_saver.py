# token_saver.py
from tiktoken import encoding_for_model

class TokenManager:
    def __init__(self, model="gpt-4o-mini", max_tokens=3000):
        self.enc = encoding_for_model(model)
        self.max_tokens = max_tokens

    def count_tokens(self, messages):
        text = "".join([m["content"] for m in messages])
        return len(self.enc.encode(text))

    def truncate_history(self, messages):
        while self.count_tokens(messages) > self.max_tokens and len(messages) > 2:
            summary = f"(Resumen) {messages[0]['content'][:100]}..."
            messages = [{"role": "system", "content": summary}] + messages[2:]
        return messages

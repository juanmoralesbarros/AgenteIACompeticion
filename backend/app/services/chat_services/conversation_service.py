# conversation_service.py
import os
import json
from openai import AsyncOpenAI
from .token_saver import TokenManager
from .prompt_system import SYSTEM_PROMPT

class ConversationService:
    def __init__(self):
        self.client = AsyncOpenAI(api_key=os.getenv("OPENAI_API_KEY"))
        self.history = [{"role": "system", "content": SYSTEM_PROMPT}]
        self.token_manager = TokenManager(max_tokens=3000)

    async def handle_message(self, user_msg: str):
        self.history.append({"role": "user", "content": user_msg})
        self.history = self.token_manager.truncate_history(self.history)

        completion = await self.client.chat.completions.create(
            model="gpt-4o-mini",
            messages=self.history,
            max_tokens=400,
            temperature=0.7,
            response_format={"type": "json_object"}  # Forzamos JSON
        )

        content = completion.choices[0].message.content
        try:
            parsed = json.loads(content)
        except:
            parsed = content

        self.history.append({"role": "assistant", "content": content})
        return parsed

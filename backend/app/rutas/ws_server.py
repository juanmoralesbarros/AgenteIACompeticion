# app/rutas/ws_server.py
from fastapi import APIRouter, WebSocket
from app.services.chat_services.conversation_service import ConversationService

router = APIRouter()
service = ConversationService()

@router.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    await ws.accept()
    while True:
        try:
            user_msg = await ws.receive_text()
            ai_response = await service.handle_message(user_msg)
            if isinstance(ai_response, dict) and "action" in ai_response:
                await ws.send_json(ai_response)
            else:
                await ws.send_text(ai_response)
        except Exception as e:
            await ws.send_text(f"Error: {str(e)}")
            break

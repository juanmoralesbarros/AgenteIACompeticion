# tools/guia_usuario.py

def listar_fuentes():
    return ["Instagram", "Twitter", "Archivos PDF", "Archivos CSV"]

def subir_documentos():
    return {
        "formatos": ["PDF", "CSV", "TXT"],
        "tamaño_max_mb": 50,
        "privacidad": "Los documentos se procesan de forma segura y no se comparten."
    }

def buscar(query: str):
    return f"Buscando información para: {query}"

def resumir(texto: str):
    return texto[:200] + "..."

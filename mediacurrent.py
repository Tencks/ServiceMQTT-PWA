import time
import json
import sys
import paho.mqtt.client as mqtt
import asyncio # Importar asyncio para manejar operaciones asíncronas
import socket # Para obtener el hostname
import platform # Para detectar el sistema operativo
import subprocess # Para ejecutar comandos de PowerShell
import os # Para construir rutas de archivos
from winsdk.windows.media.control import (
    GlobalSystemMediaTransportControlsSessionManager as MediaManager,
    GlobalSystemMediaTransportControlsSessionPlaybackStatus
)

# Configuración MQTT
MQTT_BROKER = "localhost"
MQTT_PORT = 1883
HOSTNAME = socket.gethostname() # Obtener el hostname del equipo
MQTT_TOPIC_STATUS = f"media/status/{HOSTNAME}" # Tema para publicar el estado
MQTT_TOPIC_COMMANDS = f"media/commands/{HOSTNAME}" # Tema para suscribirse a comandos

# Configurar salida UTF-8
sys.stdout.reconfigure(encoding='utf-8')

last_media_info = {}
mqtt_client = None
session_manager = None # Nueva variable global para el gestor de sesiones

# Rutas a los scripts de PowerShell
# Asegúrate de que estas rutas sean correctas en tu entorno
SCRIPT_DIR = os.path.join(os.path.dirname(__file__))
PLAYPAUSE_SCRIPT = os.path.join(SCRIPT_DIR, "playpause.ps1")
NEXT_SCRIPT = os.path.join(SCRIPT_DIR, "next.ps1")
PREV_SCRIPT = os.path.join(SCRIPT_DIR, "prev.ps1")

def run_powershell_script(script_path):
    """Ejecuta un script de PowerShell."""
    if platform.system() == "Windows":
        try:
            # Usar subprocess.run para esperar a que el comando termine
            result = subprocess.run(
                ["powershell.exe", "-ExecutionPolicy", "Bypass", "-File", script_path],
                capture_output=True,
                text=True,
                check=True # Lanza una excepción si el comando devuelve un código de error
            )
            print(f"[Python Debug] Script {os.path.basename(script_path)} ejecutado. Salida: {result.stdout.strip()}", file=sys.stderr)
        except subprocess.CalledProcessError as e:
            print(f"[Python Debug] Error al ejecutar {os.path.basename(script_path)}: {e.stderr.strip()}", file=sys.stderr)
        except FileNotFoundError:
            print(f"[Python Debug] Error: powershell.exe no encontrado. Asegúrate de que PowerShell esté instalado y en el PATH.", file=sys.stderr)
    else:
        print(f"[Python Debug] No se pueden ejecutar scripts de PowerShell en {platform.system()}.", file=sys.stderr)

def play_pause_media():
    run_powershell_script(PLAYPAUSE_SCRIPT)

def next_media():
    run_powershell_script(NEXT_SCRIPT)

def previous_media():
    run_powershell_script(PREV_SCRIPT)

# Actualizar la firma de on_connect para CallbackAPIVersion.VERSION2
def on_connect(client, userdata, flags, rc, properties=None):
    if rc == 0:
        print(f"[Python Debug] Conectado al broker MQTT! Hostname: {HOSTNAME}", file=sys.stderr)
        # Suscribirse al tema de comandos específico de este hostname
        client.subscribe(MQTT_TOPIC_COMMANDS)
        print(f"[Python Debug] Suscrito a {MQTT_TOPIC_COMMANDS}", file=sys.stderr)
    else:
        print(f"[Python Debug] Fallo al conectar, código de retorno {rc}", file=sys.stderr)

# Manejador de mensajes MQTT
def on_message(client, userdata, msg):
    print(f"[Python Debug] Mensaje MQTT recibido en {msg.topic}: {msg.payload.decode()}", file=sys.stderr)
    # try:
    #     command = json.loads(msg.payload.decode())
    #     action = command.get("action")
    #     if action == "playpause":
    #         # play_pause_media()
    #         print("[Python Debug] Comando playpause ejecutado", file=sys.stderr)
    #     elif action == "next":
    #         # next_media()
    #         print("[Python Debug] Comando playpause ejecutado", file=sys.stderr)
    #     elif action == "prev":
    #         # previous_media()
    #         print("[Python Debug] Comando playpause ejecutado", file=sys.stderr)
    #     else:
    #         print(f"[Python Debug] Comando desconocido: {action}", file=sys.stderr)
    # except json.JSONDecodeError:
    #     print(f"[Python Debug] Error al decodificar JSON del mensaje: {msg.payload.decode()}", file=sys.stderr)
    # except Exception as e:
    #     print(f"[Python Debug] Error al procesar comando MQTT: {e}", file=sys.stderr)

# Hacer que get_media_info sea una función asíncrona
async def get_media_info():
    """Obtiene la información de reproducción actual de forma asíncrona."""
    try:
        manager = await MediaManager.request_async()
        current_session = manager.get_current_session()

        if not current_session:
            print("[Python Debug] No hay sesión de medios actual.", file=sys.stderr)
            return {
                "status": "no_media",
                "title": "",
                "artist": "",
                "album": "",
                "playback_status": "stopped",
                "duration_seconds": 0,
                "position_seconds": 0,
                "speed":1
            }

        media_properties = await current_session.try_get_media_properties_async()
        playback_info = current_session.get_playback_info()
        timeline_properties = current_session.get_timeline_properties()


        status_map = {
            GlobalSystemMediaTransportControlsSessionPlaybackStatus.PLAYING: "playing",
            GlobalSystemMediaTransportControlsSessionPlaybackStatus.PAUSED: "paused",
            GlobalSystemMediaTransportControlsSessionPlaybackStatus.STOPPED: "stopped",
            GlobalSystemMediaTransportControlsSessionPlaybackStatus.CHANGING: "changing",
            GlobalSystemMediaTransportControlsSessionPlaybackStatus.CLOSED: "closed"
        }

        info = {
            "status": "success",
            "title": media_properties.title or "",
            "artist": media_properties.artist or "",
            "album": media_properties.album_title or "",
            "playback_status": status_map.get(playback_info.playback_status, "unknown"),
            "duration_seconds": timeline_properties.end_time.total_seconds() if timeline_properties.end_time else 0,
            "position_seconds": timeline_properties.position.total_seconds() if timeline_properties.position else 0,
            "speed": 1
        }
        print(f"[Python Debug] Información de medios obtenida: {info}", file=sys.stderr)
        return info

    except Exception as e:
        print(f"[Python Debug] Error al obtener información de medios: {e}", file=sys.stderr)
        return {
            "status": "error",
            "message": str(e),
            "title": "",
            "artist": "",
            "album": "",
            "playback_status": "unknown",
            "duration_seconds": 0,
            "position_seconds": 0,
            "speed": 1
        }

async def monitor_media_sessions():
    global last_media_info, mqtt_client, session_manager
    
    # Inicializar last_media_info con la información actual al inicio
    last_media_info = await get_media_info()
    print(f"[Python Debug] last_media_info inicializado: {last_media_info}", file=sys.stderr)
    
    print("[Python Debug] Inicialización de sesión de medios completada.", file=sys.stderr)

    while True:
        current_info = await get_media_info()

        # Crear copias para comparación sin 'position_seconds' y 'duration_seconds'
        current_info_for_comparison = current_info.copy()
        if "position_seconds" in current_info_for_comparison:
            del current_info_for_comparison["position_seconds"]
        if "duration_seconds" in current_info_for_comparison:
            del current_info_for_comparison["duration_seconds"]

        last_media_info_for_comparison = last_media_info.copy() if last_media_info is not None else {}
        if "position_seconds" in last_media_info_for_comparison:
            del last_media_info_for_comparison["position_seconds"]
        if "duration_seconds" in last_media_info_for_comparison:
            del last_media_info_for_comparison["duration_seconds"]

        # Publicar solo si hay cambios en la información de medios (excluyendo position_seconds y duration_seconds)
        if current_info_for_comparison != last_media_info_for_comparison:
            print("[Python Debug] ¡Cambios detectados! Publicando en MQTT.", file=sys.stderr)
            print(f"[Python Debug] current_info antes de la comparación: {current_info}", file=sys.stderr)
            print(f"[Python Debug] last_media_info antes de la comparación: {last_media_info}", file=sys.stderr)
            print(f"[Python Debug] current_info para comparación (sin position_seconds y duration_seconds): {current_info_for_comparison}", file=sys.stderr)
            print(f"[Python Debug] last_media_info para comparación (sin position_seconds y duration_seconds): {last_media_info_for_comparison}", file=sys.stderr)
            payload = json.dumps(current_info, ensure_ascii=False) # Publicar el objeto completo
            mqtt_client.publish(MQTT_TOPIC_STATUS, payload, retain=True)
            last_media_info = current_info.copy() # Actualizar last_media_info con el objeto completo
            print(f"[Python Debug] last_media_info actualizado: {last_media_info}", file=sys.stderr)
            print(f"[Python Debug] Publicado en MQTT: {payload}", file=sys.stderr)
        else:
            print("[Python Debug] No se detectaron cambios significativos. No se publica en MQTT.", file=sys.stderr)

        # Esperar un intervalo antes de la próxima verificación
        await asyncio.sleep(3) # Polling cada 3 segundos

def main():
    print(f"[Python Debug] Iniciando script mediacurrent.py (modo MQTT) en {HOSTNAME}", file=sys.stderr)
    global last_media_info, mqtt_client

    mqtt_client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)
    mqtt_client.on_connect = on_connect
    mqtt_client.on_message = on_message
    mqtt_client.connect(MQTT_BROKER, MQTT_PORT, 60)
    mqtt_client.loop_start()

    last_media_info = {} # Inicializar para asegurar que la primera publicación ocurra

    # Ejecutar el monitor asíncrono para las sesiones de medios
    asyncio.run(monitor_media_sessions())

if __name__ == "__main__":
    main()
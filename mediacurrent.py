import time
import json
import sys
import paho.mqtt.client as mqtt
import asyncio # Importar asyncio para manejar operaciones asíncronas
from winsdk.windows.media.control import (
    GlobalSystemMediaTransportControlsSessionManager as MediaManager,
    GlobalSystemMediaTransportControlsSessionPlaybackStatus
)

# Configuración MQTT
MQTT_BROKER = "localhost"
MQTT_PORT = 1883
MQTT_TOPIC = "media/info"

# Configurar salida UTF-8
sys.stdout.reconfigure(encoding='utf-8')

last_media_info = None
mqtt_client = None

# Actualizar la firma de on_connect para CallbackAPIVersion.VERSION2
def on_connect(client, userdata, flags, rc, properties=None):
    if rc == 0:
        print("[Python Debug] Conectado al broker MQTT!", file=sys.stderr)
    else:
        print(f"[Python Debug] Fallo al conectar, código de retorno {rc}", file=sys.stderr)

# Hacer que get_media_info sea una función asíncrona
async def get_media_info():
    """Obtiene la información de reproducción actual de forma asíncrona."""
    try:
        manager = await MediaManager.request_async()
        current_session = manager.get_current_session()

        if not current_session:
            return {
                "status": "no_media",
                "title": "",
                "artist": "",
                "album": "",
                "playback_status": "stopped",
                "duration_seconds": 0,
                "position_seconds": 0
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

        return {
            "status": "success",
            "title": media_properties.title or "",
            "artist": media_properties.artist or "",
            "album": media_properties.album_title or "",
            "playback_status": status_map.get(playback_info.playback_status, "unknown"),
            "duration_seconds": timeline_properties.end_time.total_seconds() if timeline_properties.end_time else 0,
            "position_seconds": timeline_properties.position.total_seconds() if timeline_properties.position else 0
        }

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
            "position_seconds": 0
        }

def main():
    print("[Python Debug] Iniciando script mediacurrent.py (modo MQTT)", file=sys.stderr)
    global last_media_info, mqtt_client

    # Usar CallbackAPIVersion.VERSION2 para evitar DeprecationWarning
    mqtt_client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)
    mqtt_client.on_connect = on_connect
    mqtt_client.connect(MQTT_BROKER, MQTT_PORT, 60)
    mqtt_client.loop_start() # Inicia un hilo en segundo plano para manejar la red MQTT

    last_media_info = {} # Inicializar para asegurar que la primera publicación ocurra

    # Obtener o crear un bucle de eventos para ejecutar tareas asíncronas
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError: # No hay un bucle de eventos en ejecución
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)

    while True:
        # Ejecutar la función asíncrona get_media_info de forma síncrona
        current_info = loop.run_until_complete(get_media_info())
        if current_info != last_media_info:
            payload = json.dumps(current_info, ensure_ascii=False)
            mqtt_client.publish(MQTT_TOPIC, payload)
            last_media_info = current_info
            print(f"[Python Debug] Publicado en MQTT: {payload}", file=sys.stderr)
        time.sleep(1) # Polling cada 1 segundo

if __name__ == "__main__":
    main()
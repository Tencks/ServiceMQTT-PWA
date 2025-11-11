
import pkg from "native-sound-mixer";
import { execFile, spawn } from "child_process";
import path from "path";
import { fileURLToPath } from 'url';
import mqtt from 'mqtt'; // Importar la librería MQTT
import os from 'os'; // Importar el módulo OS para obtener el hostname

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuración del Server
const SERVER_ID = os.hostname(); // Obtener el hostname para usarlo como ID del servidor

// Configuración y conexión MQTT
const MQTT_BROKER_URL = 'mqtt://localhost:1883';
const MQTT_TOPIC_BASE = 'media/status';
const MQTT_TOPIC = `${MQTT_TOPIC_BASE}/${SERVER_ID}`;
const MQTT_TOPIC_COMMANDS = `media/commands/${SERVER_ID}`;

const mqttClient = mqtt.connect(MQTT_BROKER_URL);

const { default: SoundMixer } = pkg;

const playScript = path.join(__dirname, "playpause.ps1");
const nextScript = path.join(__dirname, "next.ps1");
const prevScript = path.join(__dirname, "prev.ps1");
const mediaCurrentScript = path.join(__dirname, "mediacurrent.py"); // Ya no es necesario

function runPS(scriptPath) {
  execFile("powershell.exe", ["-ExecutionPolicy", "Bypass", "-File", scriptPath], (err) => {
    if (err) {
      console.error('Error al ejecutar PowerShell:', err.message);
    }
  })}

mqttClient.on('connect', () => {
  console.log('Conectado al broker MQTT');
   mqttClient.subscribe(MQTT_TOPIC_COMMANDS, (err) => {
    if (!err) {
      console.log(`Suscrito al tema de comandos MQTT: ${MQTT_TOPIC_COMMANDS}`);
    } else {
      console.error('Error al suscribirse al tema de comandos MQTT:', err);
    }
  });
  
});

mqttClient.on('message', (topic, message) => {
  // message es un Buffer, convertir a string
  const payload = message.toString();
  console.log(`Mensaje MQTT recibido en ${topic}: ${payload}`);

  if (topic === MQTT_TOPIC_COMMANDS) {
    try {
      const command = JSON.parse(payload);
      console.log('Comando MQTT recibido:', command);
      // Aquí puedes implementar la lógica para ejecutar los comandos
      // Por ejemplo, si el comando es { action: "playpause" }
      if (command.action === "play" ) {
        runPS(playScript);
      } else if (command.action === "pause" ) {
        runPS(playScript);
      } else if (command.action === "next" ) {
        runPS(nextScript);
      } else if (command.action === "prev" ) {
        runPS(prevScript);
      } else if (command.action === "devices" ) {
        const devices = SoundMixer.devices.map((device, i) => ({
          id: i,
          name: device.name,
          type: device.type,
          volume: device.volume,
          mute: device.mute,
          sessions: device.sessions.map((s, j) => ({
            id: `${i}-${j}`,
            name: s.name,
            volume: s.volume,
            mute: s.mute,
          })),
        }));
        mqttClient.publish(`media/status/${SERVER_ID}/devices`, JSON.stringify(devices), { qos: 0, retain: false});
      }
      // Puedes añadir más comandos aquí
    } catch (e) {
      console.error('Error al parsear el comando MQTT:', e);
    }
} else if (topic.startsWith(`media/commands/${SERVER_ID}/`)) {
    try {
      const command = JSON.parse(payload);
      console.log('Comando de control MQTT recibido:', command);

      if (command.serverId !== SERVER_ID) {
        console.log('Comando ignorado: no es para este servidor.');
        return;
      }

      if (command.action === "setVolume") {
        const device = SoundMixer.devices[command.deviceId];
        if (device) {
          device.volume = Math.max(0, Math.min(1, command.volume));
          console.log(`Dispositivo ${command.deviceId} volumen ajustado a ${device.volume}`);
        }
      } else if (command.action === "setMute") {
        const device = SoundMixer.devices[command.deviceId];
        if (device) {
          device.mute = !!command.mute;
          console.log(`Dispositivo ${command.deviceId} mute ajustado a ${device.mute}`);
        }
      } else if (command.action === "setSessionVolume") {
        const device = SoundMixer.devices[command.deviceId];
        if (device) {
          const session = device.sessions[command.sessionId];
          if (session) {
            session.volume = Math.max(0, Math.min(1, command.volume));
            console.log(`Sesión ${command.sessionId} de dispositivo ${command.deviceId} volumen ajustado a ${session.volume}`);
          }
        }
      } else if (command.action === "setSessionMute") {
        const device = SoundMixer.devices[command.deviceId];
        if (device) {
          const session = device.sessions[command.sessionId];
          if (session) {
            session.mute = !!command.mute;
            console.log(`Sesión ${command.sessionId} de dispositivo ${command.deviceId} mute ajustado a ${session.mute}`);
          }
        }
      }
    } catch (e) {
      console.error('Error al parsear el comando de control MQTT:', e);
    }
  }
});

mqttClient.on('error', (err) => {
  console.error('Error en el cliente MQTT:', err);
});

// Iniciar el script de Python como un proceso hijo de larga duración
const pythonProcess = spawn('python.exe', [mediaCurrentScript], { encoding: 'utf8' });

// Solo para depuración, ya que la comunicación principal es por MQTT
pythonProcess.stdout.on('data', (data) => {
  console.log(`Info de Python (stdout): ${data.toString().trim()}`);
});

pythonProcess.stderr.on('data', (data) => {
  console.error(`Info de Python (stderr): ${data.toString().trim()}`);
});

pythonProcess.on('close', (code) => {
  console.log(`Proceso Python mediacurrent.py cerrado con código ${code}`);
});

pythonProcess.on('error', (err) => {
  console.error('Error al iniciar o ejecutar el proceso Python:', err);
});
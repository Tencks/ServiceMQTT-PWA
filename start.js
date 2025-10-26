import express from "express";
import https from 'https';
import fs from 'fs';
import cors from "cors";
import bodyParser from "body-parser";
import pkg from "native-sound-mixer";
import { execFile, spawn } from "child_process";
import path from "path";
import { fileURLToPath } from 'url';
import { WebSocketServer } from "ws";
import mqtt from 'mqtt'; // Importar la librería MQTT
import os from 'os'; // Importar el módulo OS para obtener el hostname

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuración del Server
const SERVER_ID = os.hostname(); // Obtener el hostname para usarlo como ID del servidor

// Obtener la dirección IP local
function getLocalIpAddress() {
  const interfaces = os.networkInterfaces();
  for (const interfaceName in interfaces) {
    const iface = interfaces[interfaceName];
    for (let i = 0; i < iface.length; i++) {
      const alias = iface[i];
      if (alias.family === 'IPv4' && alias.address !== '127.0.0.1' && !alias.internal) {
        return alias.address;
      }
    }
  }
  return '127.0.0.1'; // Fallback
}

const SERVER_IP = getLocalIpAddress(); // Obtener la IP local real para usarlo como ID del servidor

// Configuración y conexión MQTT
const MQTT_BROKER_URL = 'mqtt://localhost:1883';
const MQTT_TOPIC_BASE = 'media/status';
const MQTT_TOPIC = `${MQTT_TOPIC_BASE}/${SERVER_ID}`;
const MQTT_TOPIC_COMMANDS = `media/commands/${SERVER_ID}`;

const mqttClient = mqtt.connect(MQTT_BROKER_URL);

const { default: SoundMixer } = pkg;
const app = express();

const playScript = path.join(__dirname, "playpause.ps1");
const nextScript = path.join(__dirname, "next.ps1");
const prevScript = path.join(__dirname, "prev.ps1");
const mediaCurrentScript = path.join(__dirname, "mediacurrent.py"); // Ya no es necesario
// Usa los mismos certificados que generaste para Angular
const options = {
  key: fs.readFileSync('localhost+3-key.pem'),
  cert: fs.readFileSync('localhost+3.pem')
};

app.use(cors('**'));
app.use(bodyParser.json());

/**
 * 🖥️ GET /devices
 * Devuelve todos los dispositivos y sesiones activas
 */
// app.get("/devices", (req, res) => { //DEVUELVE LOS DEVICES DEL EQUIPO DONDE ESTE EL SERVER EJECUTADO
//   const devices = SoundMixer.devices.map((device, i) => ({
//     id: i,
//     name: device.name,
//     type: device.type,
//     volume: device.volume,
//     mute: device.mute,
//     sessions: device.sessions.map((s, j) => ({
//       id: `${i}-${j}`,
//       name: s.name,
//       volume: s.volume,
//       mute: s.mute,
//     })),
//   }));

//   const payload = { serverId: SERVER_ID, devices: devices };
//   mqttClient.publish(`media/devices/${SERVER_ID}`, JSON.stringify(payload));
 
//   res.json(devices);
// });

app.get('/:ID_SVR/devices', (req, res) => { //DEVUELVE LOS DECICES DEL EQUIPO DETERMINADO EN EL SERVER_ID O SERVER_IP
  const requestedId = req.params.ID_SVR;
  if (requestedId !== SERVER_ID && requestedId !== SERVER_IP) {
    return res.status(400).json({ message: 'ID de servidor o IP no válido.' });
  }

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

  const payload = { serverId: SERVER_ID, devices: devices };
  mqttClient.publish(`media/${SERVER_ID}/devices`, JSON.stringify(payload));
  res.json({ message: `${SERVER_ID} devices | enviado por MQTT ✅` , devices});
});

/**
 * 🔊 POST /device/:id/volume
 * Cambia el volumen de un dispositivo
 * body: { volume: 0.5 }
 */
app.post("/:ID_SVR/device/:id/volume", (req, res) => {
  const { id } = req.params;
  const { volume } = req.body;
  const requestedId = req.params.ID_SVR;
  if (requestedId !== SERVER_ID && requestedId !== SERVER_IP) {
    return res.status(400).json({ message: 'ID de servidor o IP no válido.' });
  }
   const device = SoundMixer.devices[id];
  if(device){
    if (!device) return res.status(404).json({ error: "Device not found" });
      device.volume = Math.max(0, Math.min(1, volume)); 
  }

 const payload = { serverId: SERVER_ID, deviceId: id, volume: volume, action: "setVolume" };
  mqttClient.publish(`media/${SERVER_ID}/device/commands`, JSON.stringify(payload));
  res.json({ success: true, message: "Comando de volumen de dispositivo enviado a MQTT ✅" });
});

/**
 * 🔇 POST /device/:id/mute
 * body: { mute: true/false }
 */
app.post("/:ID_SVR/device/:id/mute", (req, res) => {
  const { id } = req.params;
  const { mute } = req.body;
  const requestedId = req.params.ID_SVR;
  const device = SoundMixer.devices[id];
  if (requestedId !== SERVER_ID && requestedId !== SERVER_IP) {
    return res.status(400).json({ message: 'ID de servidor o IP no válido.' });
  }

  if(device){
    if (!device) return res.status(404).json({ error: "Device not found" });
    device.mute = !!mute;
  }

  const payload = { serverId: SERVER_ID, deviceId: id, mute: mute, action: "setMute" };
  mqttClient.publish(`media/${SERVER_ID}/device/commands`, JSON.stringify(payload));
  res.json({ success: true, message: "Comando de mute de dispositivo enviado a MQTT ✅" });
});

/**
 * 🎧 POST /session/:deviceId/:sessionId/volume
 * body: { volume: 0.3 }
 */
app.post("/:ID_SVR/session/:deviceId/:sessionId/volume", (req, res) => {
  const { deviceId, sessionId } = req.params;
  const { volume } = req.body;
  const requestedId = req.params.ID_SVR;
   const device = SoundMixer.devices[deviceId];
  if (requestedId !== SERVER_ID && requestedId !== SERVER_IP) {
    return res.status(400).json({ message: 'ID de servidor o IP no válido.' });
  }

  if(device){
    if (!device) return res.status(404).json({ error: "Device not found" });
    const session = device.sessions[sessionId];
    if (!session) return res.status(404).json({ error: "Session not found" });
    session.volume = Math.max(0, Math.min(1, volume));
  }   
  
  const payload = { serverId: SERVER_ID, deviceId: deviceId, sessionId: sessionId, volume: volume, action: "setSessionVolume" };
  mqttClient.publish(`media/${SERVER_ID}/device/session/commands`, JSON.stringify(payload));
  res.json({ success: true, message: "Comando de volumen de sesión enviado a MQTT ✅" });
});

/**
 * 🔇 POST /session/:deviceId/:sessionId/mute
 * body: { mute: true/false }
 */
app.post("/:ID_SVR/session/:deviceId/:sessionId/mute", (req, res) => {
  const { deviceId, sessionId } = req.params;
  const { mute } = req.body;
  const requestedId = req.params.ID_SVR;
  const device = SoundMixer.devices[deviceId];
  if (requestedId !== SERVER_ID && requestedId !== SERVER_IP) {
    return res.status(400).json({ message: 'ID de servidor o IP no válido.' });
  }

  if(device){
    if (!device) return res.status(404).json({ error: "Device not found" });
    const session = device.sessions[sessionId];
    if (!session) return res.status(404).json({ error: "Session not found" });
    session.mute = !!mute;
  }
  

  const payload = { serverId: SERVER_ID, deviceId: deviceId, sessionId: sessionId, mute: mute, action: "setSessionMute" };
  mqttClient.publish(`media/${SERVER_ID}/device/session/commands`, JSON.stringify(payload));
  res.json({ success: true, message: "Comando de mute de sesión enviado a MQTT ✅" });
});



function runPS(scriptPath, res) {
  execFile("powershell.exe", ["-ExecutionPolicy", "Bypass", "-File", scriptPath], (err) => {
    if (err) {
      if (res && typeof res.status === 'function') {
        return res.status(500).json({ status: "error", message: err.message });
      } else {
        console.error('Error al ejecutar PowerShell:', err.message);
      }
    }
    if (res && typeof res.json === 'function') {
      res.json({ status: "ok", message: "Comando enviado ✅" });
    }
  });
}

app.post("/:ID_SVR/media/playpause", (req, res) => {
  const requestedId = req.params.ID_SVR;
  if (requestedId !== SERVER_ID && requestedId !== SERVER_IP) {
    return res.status(400).json({ message: 'ID de servidor o IP no válido.' });
  }
  mqttClient.publish(MQTT_TOPIC_COMMANDS, JSON.stringify({ action: "playpause", serverId: SERVER_ID }));
  res.json({ status: "ok", message: `Comando playpause recibido por: ${SERVER_ID} | enviado por MQTT ✅` });
  runPS(playScript);
});
app.post("/:ID_SVR/media/next", (req, res) => {
  const requestedId = req.params.ID_SVR;
  if (requestedId !== SERVER_ID && requestedId !== SERVER_IP) {
    return res.status(400).json({ message: 'ID de servidor o IP no válido.' });
  }
  mqttClient.publish(MQTT_TOPIC_COMMANDS, JSON.stringify({ action: "next", serverId: SERVER_ID }));
  res.json({ status: "ok", message: `Comando next recibido por: ${SERVER_ID} | enviado por MQTT ✅` });
});
app.post("/:ID_SVR/media/prev", (req, res) => {
  const requestedId = req.params.ID_SVR;
  if (requestedId !== SERVER_ID && requestedId !== SERVER_IP) {
    return res.status(400).json({ message: 'ID de servidor o IP no válido.' });
  }
  mqttClient.publish(MQTT_TOPIC_COMMANDS, JSON.stringify({ action: "prev", serverId: SERVER_ID }));
  res.json({ status: "ok", message:`Comando prev recibido por: ${SERVER_ID} | enviado por MQTT ✅` });
});



const PORT = 5000;

const server = https.createServer(options, app).listen(PORT, () => {
  console.log(`🎧 Audio control server running on port ${PORT}`);
  console.log(`Access it from your LAN at: http://${SERVER_IP}:${PORT}/devices`);
});

//WEBSOCKET
const wss = new WebSocketServer({ server });

let lastMediaInfo = {};
wss.on('connection', ws => {
  console.log('Cliente WebSocket conectado');

  ws.on('close', () => {
    console.log('Cliente WebSocket desconectado');
  });

  ws.on('error', error => {
    console.error('Error en WebSocket:', error);
  });

  if(Object.keys(lastMediaInfo).length > 0 && ws.readyState === WebSocket.OPEN){
    ws.send(JSON.stringify(lastMediaInfo));
  }

});
//////////////////////////
mqttClient.on('connect', () => {
  console.log('Conectado al broker MQTT');
   mqttClient.subscribe(MQTT_TOPIC_COMMANDS, (err) => {
    console.log(`MQTT_TOPIC configurado en start.js: ${MQTT_TOPIC}`);
    if (!err) {
      console.log(`Suscrito al tema de comandos MQTT: ${MQTT_TOPIC_COMMANDS}`);
    } else {
      console.error('Error al suscribirse al tema de comandos MQTT:', err);
    }
  });
  mqttClient.subscribe(MQTT_TOPIC); // Asegurarse de que start.js también se suscribe al tema de estado
});

mqttClient.on('message', (topic, message) => {
  // message es un Buffer, convertir a string
 const payload = message.toString();
  console.log(`Mensaje MQTT recibido en ${topic}: ${payload}`);

  if (topic === MQTT_TOPIC) {
    lastMediaInfo = JSON.parse(payload);
    console.log(`Reenviando a WebSocket - Mensaje MQTT recibido en ${topic}: ${payload}`);
    // Reenviar a todos los clientes WebSocket conectados
    wss.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        console.log(`Enviando mensaje a cliente WebSocket: ${payload}`);
        client.send(payload);
      }
    });
  } else if (topic === MQTT_TOPIC_COMMANDS) {
    try {
      const command = JSON.parse(payload);
      console.log('Comando MQTT recibido:', command);
      // Aquí puedes implementar la lógica para ejecutar los comandos
      // Por ejemplo, si el comando es { action: "playpause" }
      if (command.action === "playpause" && command.serverId === SERVER_ID) {
        runPS(playScript);
      } else if (command.action === "next" && command.serverId === SERVER_ID) {
        runPS(nextScript);
      } else if (command.action === "prev" && command.serverId === SERVER_ID) {
        runPS(prevScript);
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
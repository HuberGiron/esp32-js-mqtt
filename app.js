/* ESP32 LED MQTT Dashboard
 * - Logs en pantalla + console
 * - Estado conexión, suscripción y LED
 */

let client = null;

const $ = (id) => document.getElementById(id);

// UI
const brokerEl = $("broker");
const topicCmdEl = $("topicCmd");
const topicStateEl = $("topicState");
const qosEl = $("qos");
const retainEl = $("retain");
const autoConnectEl = $("autoConnect");

const btnConnect = $("btnConnect");
const btnDisconnect = $("btnDisconnect");
const btnOn = $("btnOn");
const btnOff = $("btnOff");
const btnAsk = $("btnAsk");

const connBadge = $("connBadge");
const subBadge = $("subBadge");

const consoleEl = $("console");
const autoScrollEl = $("autoscroll");
const btnClear = $("btnClear");

const ledDot = $("ledDot");
const ledText = $("ledText");

// ---------- Utilidades ----------
function nowStr() {
  const d = new Date();
  return d.toLocaleTimeString();
}

function log(level, msg, extra = null) {
  const line = `[${nowStr()}] ${level.padEnd(5)} | ${msg}` + (extra ? ` | ${extra}` : "");
  console.log(line);
  consoleEl.textContent += line + "\n";
  if (autoScrollEl.checked) consoleEl.scrollTop = consoleEl.scrollHeight;
}

function setConnBadge(state, text) {
  connBadge.className = "badge " + state;
  connBadge.textContent = `MQTT: ${text}`;
}

function setSubBadge(state, text) {
  subBadge.className = "badge " + state;
  subBadge.textContent = `SUB: ${text}`;
}

function setLedState(state) {
  // state: "ON" | "OFF" | "UNKNOWN"
  if (state === "ON") {
    ledDot.className = "dot dot--on";
    ledText.textContent = "ON";
  } else if (state === "OFF") {
    ledDot.className = "dot dot--off";
    ledText.textContent = "OFF";
  } else {
    ledDot.className = "dot dot--unknown";
    ledText.textContent = "Desconocido";
  }
}

function setControlsEnabled(enabled) {
  btnOn.disabled = !enabled;
  btnOff.disabled = !enabled;
  btnAsk.disabled = !enabled;
}

function saveSettings() {
  const data = {
    broker: brokerEl.value.trim(),
    topicCmd: topicCmdEl.value.trim(),
    topicState: topicStateEl.value.trim(),
    qos: qosEl.value,
    retain: retainEl.checked,
    autoConnect: autoConnectEl.checked
  };
  localStorage.setItem("mqtt_led_settings", JSON.stringify(data));
}

function loadSettings() {
  const raw = localStorage.getItem("mqtt_led_settings");
  if (!raw) return false;
  try {
    const data = JSON.parse(raw);
    if (data.broker) brokerEl.value = data.broker;
    if (data.topicCmd) topicCmdEl.value = data.topicCmd;
    if (data.topicState) topicStateEl.value = data.topicState;
    if (data.qos != null) qosEl.value = String(data.qos);
    retainEl.checked = !!data.retain;
    autoConnectEl.checked = !!data.autoConnect;
    return true;
  } catch {
    return false;
  }
}

function isConnected() {
  return !!client && client.connected;
}

function publishCmd(payload) {
  if (!isConnected()) {
    log("WARN", "No conectado: no puedo publicar CMD");
    return;
  }
  const topicCmd = topicCmdEl.value.trim();
  const qos = Number(qosEl.value);
  const retain = retainEl.checked;

  if (!topicCmd) {
    log("WARN", "Tópico CMD vacío");
    return;
  }

  log("SEND", `Publish -> ${topicCmd}`, `payload="${payload}", qos=${qos}, retain=${retain}`);
  client.publish(topicCmd, payload, { qos, retain });
}

// ---------- MQTT lifecycle ----------
function connect() {
  saveSettings();

  const broker = brokerEl.value.trim();
  const topicState = topicStateEl.value.trim();

  if (!broker) {
    log("WARN", "Broker vacío");
    return;
  }

  // Si ya existe una sesión, ciérrala antes
  if (client) {
    try { client.end(true); } catch {}
    client = null;
  }

  const clientId = "web-led-" + Math.random().toString(16).slice(2);
  log("INFO", "Paso 1: creando cliente MQTT", `clientId=${clientId}`);
  setConnBadge("badge--warn", "Conectando...");
  setSubBadge("badge--muted", "—");
  setLedState("UNKNOWN");

  client = mqtt.connect(broker, {
    clientId,
    clean: true,
    connectTimeout: 4000,
    reconnectPeriod: 1000
  });

  // Eventos
  client.on("connect", () => {
    log("INFO", "Paso 2: conectado al broker", broker);
    setConnBadge("badge--ok", "Conectado ✅");
    btnConnect.disabled = true;
    btnDisconnect.disabled = false;
    setControlsEnabled(true);

    // Suscripción a STATE
    if (topicState) {
      log("INFO", "Paso 3: suscribiendo a STATE", topicState);
      client.subscribe(topicState, { qos: 0 }, (err) => {
        if (err) {
          log("ERR", "Error al suscribirse a STATE", err.message);
          setSubBadge("badge--bad", "Error");
        } else {
          log("OK", "Suscrito a STATE", topicState);
          setSubBadge("badge--ok", "OK ✅");
        }
      });
    } else {
      log("WARN", "STATE vacío: no podré mostrar estado del LED");
      setSubBadge("badge--muted", "Sin STATE");
    }
  });

  client.on("reconnect", () => {
    log("WARN", "Reconectando...");
    setConnBadge("badge--warn", "Reconectando…");
  });

  client.on("close", () => {
    log("INFO", "Conexión cerrada");
    setConnBadge("badge--off", "Desconectado");
    setSubBadge("badge--muted", "—");
    btnConnect.disabled = false;
    btnDisconnect.disabled = true;
    setControlsEnabled(false);
  });

  client.on("error", (err) => {
    log("ERR", "MQTT error", err.message);
    setConnBadge("badge--bad", "Error");
  });

  client.on("message", (topic, payloadBuf) => {
    const payload = payloadBuf.toString();
    log("RECV", `Mensaje <- ${topic}`, `payload="${payload}"`);

    // Actualiza LED si viene del tópico state
    const topicStateNow = topicStateEl.value.trim();
    if (topicStateNow && topic === topicStateNow) {
      const p = payload.trim().toUpperCase();
      if (p === "ON" || p === "OFF") {
        setLedState(p);
      } else {
        setLedState("UNKNOWN");
      }
    }
  });
}

function disconnect() {
  if (!client) return;
  log("INFO", "Cerrando conexión...");
  try { client.end(true); } catch {}
  client = null;

  setConnBadge("badge--off", "Desconectado");
  setSubBadge("badge--muted", "—");
  btnConnect.disabled = false;
  btnDisconnect.disabled = true;
  setControlsEnabled(false);
}

// ---------- UI events ----------
btnConnect.addEventListener("click", connect);
btnDisconnect.addEventListener("click", disconnect);

btnOn.addEventListener("click", () => publishCmd("ON"));
btnOff.addEventListener("click", () => publishCmd("OFF"));
btnAsk.addEventListener("click", () => publishCmd("STATUS"));

btnClear.addEventListener("click", () => {
  consoleEl.textContent = "";
  log("INFO", "Logs limpiados");
});

// Guardar cambios al teclear
[brokerEl, topicCmdEl, topicStateEl, qosEl, retainEl, autoConnectEl].forEach(el => {
  el.addEventListener("change", saveSettings);
});

// Defaults + auto connect
(function init() {
  const had = loadSettings();

  // Defaults si no había nada guardado
  if (!had) {
    brokerEl.value = "wss://test.mosquitto.org:8081/mqtt";
    topicCmdEl.value = "huber/esp32/led/cmd";
    topicStateEl.value = "huber/esp32/led/state";
    qosEl.value = "0";
    retainEl.checked = false;
    autoConnectEl.checked = false;
    saveSettings();
  }

  setConnBadge("badge--off", "Desconectado");
  setSubBadge("badge--muted", "—");
  setLedState("UNKNOWN");
  setControlsEnabled(false);
  btnDisconnect.disabled = true;

  log("INFO", "UI lista. Configura broker/tópicos y conecta.");

  if (autoConnectEl.checked) {
    log("INFO", "Auto-conectar habilitado -> conectando...");
    connect();
  }
})();

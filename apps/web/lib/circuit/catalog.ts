/**
 * Circuit part catalog and document model, shared by the canvas (client) and
 * the copilot tools (server). Parts are Wokwi elements (@wokwi/elements):
 * realistic, pin-accurate SVG components whose types match wokwi.com
 * diagram.json, so schematics can be imported from and authored in that
 * de-facto standard format.
 */

export type CircuitPart = {
  id: string;
  /** Wokwi element type, e.g. "wokwi-esp32-devkit-v1", or "generic:<label>" for unknown/legacy parts. */
  type: string;
  /** Short reference label, e.g. R1, LED1. Defaults to the part id. */
  label?: string;
  /** Element attributes, e.g. { color: "red", value: "220" }. */
  attrs?: Record<string, string>;
  x: number;
  y: number;
  rotation?: number;
};

export type CircuitWire = {
  id: string;
  from: { part: string; pin: string };
  to: { part: string; pin: string };
};

export type CircuitDoc = {
  version: 2;
  parts: CircuitPart[];
  wires: CircuitWire[];
};

export type CatalogEntry = {
  type: string;
  name: string;
  category: string;
  keywords: string;
  defaultAttrs?: Record<string, string>;
};

export const PART_CATALOG: CatalogEntry[] = [
  // Boards
  { type: "wokwi-esp32-devkit-v1", name: "ESP32 DevKit", category: "Boards", keywords: "esp32 wifi bluetooth mcu microcontroller devkit" },
  { type: "wokwi-arduino-uno", name: "Arduino Uno", category: "Boards", keywords: "arduino uno atmega328 mcu board" },
  { type: "wokwi-arduino-nano", name: "Arduino Nano", category: "Boards", keywords: "arduino nano small mcu board" },
  { type: "wokwi-arduino-mega", name: "Arduino Mega", category: "Boards", keywords: "arduino mega 2560 mcu board" },
  { type: "wokwi-nano-rp2040-connect", name: "Nano RP2040", category: "Boards", keywords: "raspberry pi pico rp2040 nano connect wifi" },
  { type: "wokwi-franzininho", name: "Franzininho", category: "Boards", keywords: "attiny85 franzininho board" },
  // Basics
  { type: "wokwi-resistor", name: "Resistor", category: "Basics", keywords: "resistor ohm passive", defaultAttrs: { value: "220" } },
  { type: "wokwi-led", name: "LED", category: "Basics", keywords: "led light diode indicator", defaultAttrs: { color: "red" } },
  { type: "wokwi-rgb-led", name: "RGB LED", category: "Basics", keywords: "rgb led color light" },
  { type: "wokwi-led-bar-graph", name: "LED bar graph", category: "Basics", keywords: "led bar graph level meter" },
  { type: "wokwi-led-ring", name: "LED ring", category: "Basics", keywords: "led ring neopixel circle ws2812" },
  { type: "wokwi-neopixel", name: "NeoPixel", category: "Basics", keywords: "neopixel ws2812 rgb addressable led" },
  { type: "wokwi-neopixel-matrix", name: "NeoPixel matrix", category: "Basics", keywords: "neopixel matrix grid ws2812 display" },
  { type: "wokwi-pushbutton", name: "Pushbutton", category: "Basics", keywords: "button push switch momentary", defaultAttrs: { color: "red" } },
  { type: "wokwi-pushbutton-6mm", name: "Pushbutton 6mm", category: "Basics", keywords: "button push small tactile 6mm" },
  { type: "wokwi-slide-switch", name: "Slide switch", category: "Basics", keywords: "switch slide toggle spdt" },
  { type: "wokwi-dip-switch-8", name: "DIP switch ×8", category: "Basics", keywords: "dip switch 8 configuration" },
  { type: "wokwi-tilt-switch", name: "Tilt switch", category: "Basics", keywords: "tilt switch ball orientation" },
  { type: "wokwi-potentiometer", name: "Potentiometer", category: "Basics", keywords: "potentiometer pot knob analog dial" },
  { type: "wokwi-slide-potentiometer", name: "Slide pot", category: "Basics", keywords: "slide potentiometer fader analog" },
  { type: "wokwi-buzzer", name: "Buzzer", category: "Basics", keywords: "buzzer piezo speaker sound beep" },
  // Displays
  { type: "wokwi-ssd1306", name: "OLED 128×64", category: "Displays", keywords: "oled ssd1306 display screen i2c 128x64" },
  { type: "wokwi-lcd1602", name: "LCD 16×2", category: "Displays", keywords: "lcd 1602 16x2 character display" },
  { type: "wokwi-lcd2004", name: "LCD 20×4", category: "Displays", keywords: "lcd 2004 20x4 character display" },
  { type: "wokwi-ili9341", name: "TFT 240×320", category: "Displays", keywords: "tft ili9341 color display spi screen" },
  { type: "wokwi-7segment", name: "7-segment", category: "Displays", keywords: "7 seven segment digit display" },
  // Sensors
  { type: "wokwi-dht22", name: "DHT22", category: "Sensors", keywords: "dht22 temperature humidity sensor climate" },
  { type: "wokwi-hc-sr04", name: "HC-SR04", category: "Sensors", keywords: "ultrasonic distance sonar hc-sr04 sensor" },
  { type: "wokwi-mpu6050", name: "MPU6050", category: "Sensors", keywords: "mpu6050 imu accelerometer gyroscope motion" },
  { type: "wokwi-pir-motion-sensor", name: "PIR motion", category: "Sensors", keywords: "pir motion presence sensor infrared" },
  { type: "wokwi-ntc-temperature-sensor", name: "NTC thermistor", category: "Sensors", keywords: "ntc thermistor temperature analog sensor" },
  { type: "wokwi-photoresistor-sensor", name: "Photoresistor", category: "Sensors", keywords: "ldr photoresistor light sensor lux" },
  { type: "wokwi-flame-sensor", name: "Flame sensor", category: "Sensors", keywords: "flame fire ir sensor" },
  { type: "wokwi-gas-sensor", name: "Gas sensor", category: "Sensors", keywords: "gas mq air quality smoke sensor" },
  { type: "wokwi-big-sound-sensor", name: "Sound sensor (big)", category: "Sensors", keywords: "sound microphone sensor ky-037" },
  { type: "wokwi-small-sound-sensor", name: "Sound sensor (small)", category: "Sensors", keywords: "sound microphone sensor ky-038" },
  { type: "wokwi-heart-beat-sensor", name: "Heartbeat sensor", category: "Sensors", keywords: "heartbeat pulse heart rate sensor" },
  { type: "wokwi-ir-receiver", name: "IR receiver", category: "Sensors", keywords: "infrared ir receiver remote" },
  { type: "wokwi-hx711", name: "HX711 load cell", category: "Sensors", keywords: "hx711 load cell weight scale adc" },
  // Motion
  { type: "wokwi-servo", name: "Servo", category: "Motion", keywords: "servo motor sg90 pwm actuator" },
  { type: "wokwi-stepper-motor", name: "Stepper motor", category: "Motion", keywords: "stepper motor nema bipolar" },
  { type: "wokwi-biaxial-stepper", name: "Biaxial stepper", category: "Motion", keywords: "stepper biaxial clock motor" },
  // Input
  { type: "wokwi-analog-joystick", name: "Joystick", category: "Input", keywords: "joystick analog thumb stick input" },
  { type: "wokwi-ky-040", name: "Rotary encoder", category: "Input", keywords: "rotary encoder ky-040 knob input" },
  { type: "wokwi-membrane-keypad", name: "Keypad 4×4", category: "Input", keywords: "keypad membrane matrix 4x4 input" },
  { type: "wokwi-ir-remote", name: "IR remote", category: "Input", keywords: "infrared ir remote control input" },
  { type: "wokwi-rotary-dialer", name: "Rotary dialer", category: "Input", keywords: "rotary dialer phone input" },
  // Modules
  { type: "wokwi-ds1307", name: "RTC DS1307", category: "Modules", keywords: "rtc ds1307 real time clock i2c" },
  { type: "wokwi-microsd-card", name: "microSD card", category: "Modules", keywords: "microsd sd card storage spi" },
  { type: "wokwi-ks2e-m-dc5", name: "Relay 5V", category: "Modules", keywords: "relay ks2e 5v switch mains" },
];

export const PART_TYPES = PART_CATALOG.map((p) => p.type);

const CATALOG_BY_TYPE = new Map(PART_CATALOG.map((p) => [p.type, p]));

export function catalogEntry(type: string): CatalogEntry | undefined {
  return CATALOG_BY_TYPE.get(type);
}

/**
 * wokwi-* types that @wokwi/elements cannot render. wokwi.com supports more
 * parts than the open-source element library, and the copilot sometimes
 * invents types — these would fall back to generic chips, so authored
 * schematics reject them up front.
 */
export function unsupportedWokwiTypes(parts: { type: string }[]): string[] {
  return [
    ...new Set(
      parts
        .map((p) => p.type)
        .filter((t) => t.startsWith("wokwi-") && !CATALOG_BY_TYPE.has(t)),
    ),
  ];
}

export function searchCatalog(query: string): CatalogEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return PART_CATALOG;
  return PART_CATALOG.filter(
    (p) =>
      p.name.toLowerCase().includes(q) ||
      p.type.includes(q) ||
      p.keywords.includes(q) ||
      p.category.toLowerCase().includes(q),
  );
}

export const EMPTY_CIRCUIT: CircuitDoc = { version: 2, parts: [], wires: [] };

/**
 * Accepts any previously persisted circuit document (legacy v1 glyph format
 * or current v2 Wokwi format) and returns a v2 doc. Legacy parts become
 * "generic:" nodes with numeric pins so old wires stay connected.
 */
export function normalizeCircuitDoc(raw: unknown): CircuitDoc {
  if (!raw || typeof raw !== "object") return EMPTY_CIRCUIT;
  const doc = raw as Record<string, unknown>;

  if (doc.version === 2 && Array.isArray(doc.parts)) {
    return {
      version: 2,
      parts: (doc.parts as CircuitPart[]).filter((p) => p && p.id && p.type),
      wires: Array.isArray(doc.wires) ? (doc.wires as CircuitWire[]) : [],
    };
  }

  // Legacy v1: { components: [{id,type,label,value,x,y,rotation}], wires: [{from:{component,pin:number}}] }
  if (Array.isArray(doc.components)) {
    type LegacyComponent = {
      id: string;
      type: string;
      label?: string;
      value?: string;
      x: number;
      y: number;
      rotation?: number;
    };
    type LegacyWire = {
      id: string;
      from: { component: string; pin: number };
      to: { component: string; pin: number };
    };
    return {
      version: 2,
      parts: (doc.components as LegacyComponent[]).map((c) => ({
        id: c.id,
        type: `generic:${c.type}`,
        label: c.value ? `${c.label} ${c.value}` : c.label,
        x: c.x,
        y: c.y,
        rotation: c.rotation ?? 0,
      })),
      wires: (Array.isArray(doc.wires) ? (doc.wires as LegacyWire[]) : []).map((w) => ({
        id: w.id,
        from: { part: w.from.component, pin: String(w.from.pin) },
        to: { part: w.to.component, pin: String(w.to.pin) },
      })),
    };
  }

  return EMPTY_CIRCUIT;
}

/** Wokwi diagram.json (subset we care about). */
export type WokwiDiagram = {
  version?: number;
  parts: { type: string; id: string; top?: number; left?: number; attrs?: Record<string, unknown> }[];
  connections?: unknown[][];
};

/**
 * Converts a wokwi.com diagram.json into our circuit document. Unknown part
 * types are kept and rendered as generic nodes. Connections into parts that
 * are not present (e.g. the simulator's serial monitor) are dropped.
 */
export function wokwiDiagramToDoc(diagram: WokwiDiagram): CircuitDoc {
  const parts: CircuitPart[] = (diagram.parts ?? [])
    .filter((p) => p && typeof p.id === "string" && typeof p.type === "string")
    .map((p) => {
      const attrs: Record<string, string> = {};
      let rotation = 0;
      for (const [key, value] of Object.entries(p.attrs ?? {})) {
        if (key === "rotate") rotation = Number(value) || 0;
        else attrs[key] = String(value);
      }
      return {
        id: p.id,
        type: p.type,
        label: p.id,
        attrs: Object.keys(attrs).length > 0 ? attrs : undefined,
        x: Math.round(p.left ?? 0),
        y: Math.round(p.top ?? 0),
        rotation,
      };
    });

  const ids = new Set(parts.map((p) => p.id));
  const wires: CircuitWire[] = [];
  let n = 0;
  for (const conn of diagram.connections ?? []) {
    if (!Array.isArray(conn) || conn.length < 2) continue;
    const [fromRaw, toRaw] = conn;
    if (typeof fromRaw !== "string" || typeof toRaw !== "string") continue;
    const [fromPart, ...fromPin] = fromRaw.split(":");
    const [toPart, ...toPin] = toRaw.split(":");
    if (!fromPart || !toPart || !ids.has(fromPart) || !ids.has(toPart)) continue;
    wires.push({
      id: `w${++n}`,
      from: { part: fromPart, pin: fromPin.join(":") },
      to: { part: toPart, pin: toPin.join(":") },
    });
  }

  return { version: 2, parts, wires };
}

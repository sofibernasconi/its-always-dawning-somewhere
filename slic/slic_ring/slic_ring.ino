// slic_ring — the Arduino side of the birdsong SLIC (Silvertel Ag1171)
//
// The Ag1171 acts as the "telephone exchange" for the fax and the modem: it powers the line
// and can RING the fax, so the fax answers by itself (no HOOK button).
//
// Wiring (Arduino Nano):            Ag1171 pin
//   D2  -> F/R (forward/reverse)      3   toggled at 20 Hz while ringing
//   D3  -> RM  (ringing mode)         4   HIGH only while ringing
//   D4  <- SHK (switch hook)          5   HIGH = the fax (or modem) is off-hook
//   GND -- GNDPWR                     12  shared ground with the 5 V supply
//   PD  (pin 14) not connected (it powers down when pulled LOW; never drive it HIGH)
//
// Serial commands (9600 baud, one letter):
//   R  ring until something goes off-hook (or 30 s), then stop     -> "RINGING", "ANSWERED" / "NO ANSWER"
//   S  stop ringing now                                             -> "STOPPED"
//   Q  tell me the hook state                                       -> "OFFHOOK" / "ONHOOK"
// It also reports "OFFHOOK" / "ONHOOK" by itself whenever the state changes.

const int PIN_FR = 2, PIN_RM = 3, PIN_SHK = 4;
const unsigned long RING_ON_MS = 1000, RING_OFF_MS = 3000;   // UK/US-like cadence, RM duty 25% (< 33% max)
const unsigned long HALF_PERIOD_MS = 25;                      // 20 Hz
const unsigned long RING_TIMEOUT_MS = 30000;

bool ringing = false, offHook = false;
unsigned long ringStart = 0, cycleStart = 0, lastToggle = 0, shkChange = 0;
bool frState = true, shkRaw = false;

void stopRinging(const char *why) {
  digitalWrite(PIN_FR, HIGH);       // F/R permanently high first...
  delay(15);                        // ...and only >10 ms later RM low (datasheet)
  digitalWrite(PIN_RM, LOW);
  ringing = false;
  Serial.println(why);
}

void setup() {
  pinMode(PIN_FR, OUTPUT); pinMode(PIN_RM, OUTPUT); pinMode(PIN_SHK, INPUT);
  digitalWrite(PIN_FR, HIGH); digitalWrite(PIN_RM, LOW);
  Serial.begin(9600);
  offHook = digitalRead(PIN_SHK);
  Serial.println("SLIC READY");
}

void loop() {
  // hook state, debounced 10 ms (ringing makes SHK noisy, so it's only trusted between bursts too)
  bool raw = digitalRead(PIN_SHK);
  if (raw != shkRaw) { shkRaw = raw; shkChange = millis(); }
  if (millis() - shkChange > 10 && shkRaw != offHook) {
    offHook = shkRaw;
    Serial.println(offHook ? "OFFHOOK" : "ONHOOK");
    if (offHook && ringing) stopRinging("ANSWERED");      // ring trip: stop within 500 ms
  }

  if (Serial.available()) {
    char c = Serial.read();
    if (c == 'R' && !ringing) {
      if (offHook) { Serial.println("ALREADY OFFHOOK"); }
      else { ringing = true; ringStart = cycleStart = millis(); Serial.println("RINGING"); }
    } else if (c == 'S' && ringing) {
      stopRinging("STOPPED");
    } else if (c == 'Q') {
      Serial.println(offHook ? "OFFHOOK" : "ONHOOK");
    }
  }

  if (ringing) {
    unsigned long now = millis();
    if (now - ringStart > RING_TIMEOUT_MS) { stopRinging("NO ANSWER"); return; }
    unsigned long inCycle = (now - cycleStart) % (RING_ON_MS + RING_OFF_MS);
    if (inCycle < RING_ON_MS) {                         // a burst of ringing
      digitalWrite(PIN_RM, HIGH);
      if (now - lastToggle >= HALF_PERIOD_MS) { frState = !frState; digitalWrite(PIN_FR, frState); lastToggle = now; }
    } else if (digitalRead(PIN_RM) == HIGH) {           // silence between bursts
      digitalWrite(PIN_FR, HIGH); delay(15); digitalWrite(PIN_RM, LOW);
    }
  }
}

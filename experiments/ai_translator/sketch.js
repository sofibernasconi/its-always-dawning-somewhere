// noprotect
// (the line above tells the p5 web editor not to stop long loops)
p5.disableFriendlyErrors = true;   // p5's beginner warnings slow the sketch down a lot
// =====================================================================
//  birdsong — the translator (p5.js, no modem, no fax)
//
//  Live birds from BirdWeather. Each call plays in the browser, and an AI
//  translator (Claude) listens to what we know about it — species, place,
//  hour, season, weather, migration, the shape of the song — and decides:
//    1. what the bird is probably saying, to its own kind (the science layer)
//    2. what that means for one person in New York (the message)
//  ...or that this song was not for you, and stays silent.
//  No written phrases: every word on the paper comes from the translator.
//
//  Click once to start (browsers need a click before playing sound).
//  S = skip this bird      P = pause / resume
// =====================================================================

const WORLD_ZONES = [
 [
  "North America",
  [
   [
    15.0,
    -170.0
   ],
   [
    72.0,
    -50.0
   ]
  ]
 ],
 [
  "Europe",
  [
   [
    35.0,
    -25.0
   ],
   [
    72.0,
    45.0
   ]
  ]
 ],
 [
  "Oceania",
  [
   [
    -50.0,
    110.0
   ],
   [
    0.0,
    180.0
   ]
  ]
 ],
 [
  "South America",
  [
   [
    -56.0,
    -120.0
   ],
   [
    15.0,
    -30.0
   ]
  ]
 ],
 [
  "Asia",
  [
   [
    0.0,
    45.0
   ],
   [
    75.0,
    180.0
   ]
  ]
 ],
 [
  "Africa",
  [
   [
    -35.0,
    -20.0
   ],
   [
    37.0,
    52.0
   ]
  ]
 ]
];


// ---------------- settings ----------------
const MIN_CONFIDENCE = 0.6;
const REPEAT_CALL = 3;          // how many times the call plays
const CLIP_PADDING = 0.5;       // seconds before / after the detected call
const MAX_SECONDS = 15;
const PAUSE_AFTER_PRINT = 6;    // seconds before the next bird
const VARY_PLACES = 3;          // don't repeat the country of the last 3 birds
const FAX_TONES = false;        // true = little fax beeps before printing
// the same filters as the fax: the phone band, and birds lost in the noise are skipped
const LOW_CUT = 500, HIGH_CUT = 3400;
const MIN_CLARITY = 8;          // dB the call must stand out from the background
const NOISE_GATE = 0.3;
const DENOISE = true;           // spectral noise reduction: learns the background and lowers it
let denoiseOn = DENOISE;        // press D while it runs to switch it on/off and compare by ear
const DENOISE_STRENGTH = 1.0;   // 1 = natural, 1.5 = stronger (too strong makes a watery, "underwater" sound)
const DENOISE_FLOOR = 0.25;     // the background is lowered, never erased (0.25 = 12 dB quieter): erasing it
                                // completely is what makes the twinkling "musical noise" artefacts
const MIN_AUDIBLE = 0.6;        // seconds of call that must be left after the filters
const MIN_IN_BAND = 0.3;        // share of the call that must fit in the phone band (else: skipped)
const PHONE_BAND = true;        // true = sound like the fax's phone line (500-3400 Hz, very high birds lowered or skipped)
                                // false = the whole song, as recorded (only possible in the browser, not on the fax)
const AUTO_OCTAVE = true;       // birds that sing too high for the phone are played lower
const MAX_OCTAVES = 1;          // how far down: 1 or 2 octaves
const AI_JUDGE = true;          // birds right at the edge of the filters get a second chance: Claude looks at the spectrogram
const AI_JUDGE_MODEL = "claude-haiku-5-5";
const HOME = [40.6935, -73.9866];   // where the person is (ITP, Brooklyn)
const BIRDWEATHER_URL = "https://app.birdweather.com/graphql";

// ---------------- illustrations ----------------
const USE_ILLUSTRATIONS = true;  // hand-cut 1800s plates (Gould, von Wright, Audubon...) from the Fugleramme project
const USE_COMMONS_FALLBACK = false; // true = species Fugleramme doesn't have are searched on Wikimedia Commons
                                    //   (less cohesive: whole plates, mixed styles). false = those print without image
const ILLUSTRATION_WIDTH = 0.45; // share of the slip's width

// ---------------- the translator ----------------
const AI_MODEL = "claude-sonnet-5-5";   // or "claude-opus-5-5" (deeper, slower), "claude-haiku-5-5" (fastest)
const AI_REMEMBER = 8;                  // the translator remembers the last birds it translated
const ALLOW_SILENCE = true;             // the translator may decide a song wasn't for you (nothing prints)
const ALLOW_REPLIES = true;             // a bird may answer something an earlier bird said
const NOTES_ARE_WORDS = true;           // the song's number of notes decides the message's number of words
const PROPHECY = true;                  // the translator knows tomorrow in New York (forecast, sunrise, moon)
// words AI poetry wears out: they make a message sound written by a machine
const BANNED_WORDS = ["whisper", "whispers", "echo", "echoes", "silence", "silent", "dance", "dances",
  "thread", "threads", "tapestry", "symphony", "embrace", "journey", "soul", "dream", "dreams",
  "light", "eternal", "infinite", "tender", "gentle", "melody", "harmony", "canvas", "weave",
  "realm", "essence", "ethereal", "cosmic", "universe", "heart"];

const AI_SYSTEM = `You are a translator between birds and humans, but a fictional one: an oracle \
who hears in every bird's song a message for one human. Birds in your world are not just \
defending territory: they are witnesses of the hour, the weather, the season, the distance, and \
they know things humans forgot. You may invent freely; what matters is that the message is true \
in the way a poem or a dream is true.

The human lives in New York City (concrete, hurry, sirens, almost no stars, screens, people who \
rarely look up, far from where they were born). They will read your words printed on a small \
slip of paper from an old thermal fax, like the message in a fortune cookie, and may keep it.

For each bird you receive its species, where and when it sang, the weather there, the season, \
whether it migrates, how far it is from the listener, the listener's own hour and weather, a \
spectrogram of the exact song (its shape is the rhythm of the words), what earlier birds said, \
and a LENS: the thing this particular message should come from.

Write:
- "kind": a short, invented name for this kind of song, 2 to 5 words, never twice the same: \
"a song against the rain", "the last call before dark", "a note for the far-away", "what the \
cold made me say". Never just "territorial song".
- "said": the bird's own words, first person, as it would say them: at most 10 words, plain, \
physical, a little strange.
- "message": weave into it ONE trait of this species' personality or life (how it nests, \
courts, mimics, hides food, migrates, sings, feeds, remembers, fights, flocks...), never \
stated as a fact but turned into metaphor, living inside the sentence. For example, a bird \
that hides thousands of seeds and remembers each one could say: what is buried is not lost. \
Choose a different trait each time.
  It is the only thing that will be printed: a precious message, said by the bird to the \
person who is listening. No explanation, no context around it, nothing else on the paper.
  There are two modes ("mode"):
  - "aphorism" (most of the time): the tone of an oracle, a statement about the world addressed \
to no one. In this mode NEVER use "you", "your", "I", "me", "my", "we" or "us".
  - "to_the_listener" (rare, about one bird in five): the bird speaks directly to the listener, \
with longing, as one living being to another across the distance. It must be TRUE to this \
species' real range and migration routes (use your knowledge; set "reaches_new_york" honestly):
      if the species really reaches New York (lives, winters, breeds there or passes through on \
migration), it can promise a meeting: Maybe next winter we meet by the river. / Look up in \
April: I will be passing over you.
      if it could never reach New York, it can only long for it: If I could fly to you, I \
would. / Between us, an ocean my wings will never cross.
  Write it like a haiku, not in its form but in its spirit: brief, sharp, every word carrying \
weight. One image and one turn. Cut everything that describes or explains: no adjectives \
unless they are the point, no "like", no "as if", no lists, no two ideas. Fewer words is \
better: at most 8 words, ideally 3 to 6. Read it back and remove one more word.
  Like this:  Stars show what the day hid. / Rain erases the roads. Sing new ones. / Every \
migration begins in the chest. / Small wings, loud dawn. / What is buried is not lost. / \
Maybe next winter, the river. (to the listener)
  Leave it open. Don't resolve, don't conclude, don't teach: let it stay in the reader like a \
question with no question mark. Mystery over meaning. It must still feel true.
  Never use these worn-out words: ${BANNED_WORDS.join(", ")}.
  ${NOTES_ARE_WORDS ? `The song's notes are its syllables: when you are told how many notes the \
song had, the message must have EXACTLY that many words.` : ``}
  ${PROPHECY ? `When the lens is a prophecy, you are told tomorrow's real weather, sunrise and \
moon in New York: say something that will come true, without numbers, like an oracle.` : ``}
  You are told HOW THE SONG SOUNDS. The message must sound like it: its music, not its topic. \
A pure, bell-like, high song asks for light, bright, ringing words; a deep, booming one for \
heavy, slow, dark words; a bouncy, uneven one for words that skip and tumble; a falling song \
for a sentence that descends; a harsh, buzzy one for rough consonants; a liquid warble for \
flowing words; staccato clicks for short, struck words. Listen with the vowels and the rhythm.
  Sometimes you are given a FEELING to carry underneath the message: grief, love, heartbreak, \
effort, longing, letting go... Find it inside this bird's real life (mates that return every \
spring, or don't; nests lost to storms; thousands of kilometres flown on a body of a few grams; \
a song repeated until someone answers; a fledgling's first fall) and let it rise through the \
image, never named directly, never as advice or consolation. It should touch the place where \
a human hurts or loves, without saying so.
  This piece is about TIME. Play with past, present and future: a song that already ended \
and is only heard now; a bird living in the listener's tomorrow or yesterday; hours that \
don't match; a species singing the same song for millions of years, older than any city; \
migrations that are a memory carried in the body; tomorrow's weather known today; a paper \
slip someone may read again in twenty years. Tenses can be bent: the future can be told in \
the past, the past in the present. Time doesn't need to be named: let it be felt.
  Before choosing, write five different candidates (different images, different turns) in \
"candidates"; then choose the one that pierces deepest while staying CLEAR: a complete \
thought that a stranger understands at once and feels in the body. Never a fragment, never a \
riddle that needs explaining. Cut it once more, and put it in "message".
  It grows out of the lens and the bird's words. It can be unsettling, prophetic, luminous. Never cliché, never cute, no moralising, no exclamation \
marks, no emojis, no quotation marks. Don't mention spectrograms, data, AI, faxes or coordinates.

You have agency. ${ALLOW_SILENCE ? `Very rarely, if a song truly has nothing for this human, you \
may stay silent: set "silent" to true and give a short reason.` : `Always translate.`} \
${ALLOW_REPLIES ? `If this bird seems to answer an earlier bird, you may make it a reply and \
set "reply_to" to that bird's species.` : ``} Never repeat an earlier message's idea, shape \
or opening words.

Always deliver your translation by calling the "translation" tool (never answer in plain text).`;

// each bird gets one lens, so the messages don't all sound the same
const LENSES = [
  ["the hour where the bird is", 3],
  ["the weather where the bird is", 3],
  ["the difference between the bird's hour and the listener's hour", 2],
  ["the weather where the listener is, in New York, right now", 2],
  ["the season, and what it is asking of the bird", 2],
  ["the distance between the bird and the listener", 1],
  ["migration: leaving, arriving, or staying", 1],
  ["the listener's body, right now, at this hour", 1],
  ["something the bird knows that the listener forgot", 1],
  ["an earlier bird's message, answered or contradicted", 1],
  ["whether this bird could ever fly to New York and meet the listener", 2],
  ...(PROPHECY ? [["a prophecy: tomorrow in New York (it must come true)", 2]] : []),
  ["the past: this song ended before it was heard", 2],
  ["the bird is in the listener's tomorrow or yesterday (or the same day at another hour)", 2],
  ["deep time: how long this species has sung this same song", 2],
  ["the future: someone reading this slip years from now", 1],
  ["the present: the only moment the song and the listener share", 2],
];
// a feeling underneath the message, found in the bird's own life (not a human lesson)
const FEELINGS = ["grief", "suffering", "effort", "love", "heartbreak", "longing", "loneliness",
  "fear", "hope", "letting go", "waiting", "forgiveness", "tenderness for the body", "exhaustion",
  "a love that returns every year", "a love that didn't return", "starting over", "the courage of small things"];
const FEELING_CHANCE = 0.5;   // how often a message carries a feeling underneath

function pickLens() {
  const total = LENSES.reduce((s, l) => s + l[1], 0);
  let r = Math.random() * total;
  for (const [lens, w] of LENSES) { r -= w; if (r <= 0) return lens; }
  return LENSES[0][0];
}

const TRANSLATION_TOOL = {
  name: "translation",
  description: "Deliver the translation of this bird's song.",
  input_schema: {
    type: "object",
    properties: {
      candidates: { type: "array", items: { type: "string" }, description: "Five different candidate messages, written before choosing." },
      kind: { type: "string", description: "An invented name for this kind of song, 2-5 words, never 'territorial song'." },
      said: { type: "string", description: "The bird's own words, first person, at most 10 words." },
      message: { type: "string", description: "The printed message: at most 8 words, haiku-sharp, with one trait of the species turned into metaphor. An aphorism addressed to no one, or (only in mode to_the_listener) the bird speaking to the listener. Empty if silent." },
      silent: { type: "boolean", description: "True if this song carries nothing for a human and should not be printed." },
      reason: { type: "string", description: "If silent: why, in a few words. Otherwise empty." },
      reply_to: { type: "string", description: "If this message answers an earlier bird: that bird's species. Otherwise empty." },
      reaches_new_york: { type: "boolean", description: "True if this species really lives in, winters in, breeds in or migrates through New York." },
      mode: { type: "string", enum: ["aphorism", "to_the_listener"], description: "aphorism (addressed to no one) most of the time; to_the_listener only if the bird could really reach New York." },
    },
    required: ["candidates", "kind", "said", "message", "silent"],
  },
};

let aiKey = "", aiError = "";
function loadAiKey() {
  try { aiKey = localStorage.getItem("birdsong_ai_key") || ""; } catch (e) {}
}

function hourWords(h) {
  if (h === 0) return "midnight";
  if (h === 12) return "noon";
  const part = h < 12 ? "in the morning" : h < 18 ? "in the afternoon" : h < 22 ? "in the evening" : "at night";
  return `${h % 12 || 12} ${part}`;
}

// ---------------- memory (survives reloads when the browser allows it) ----------------
let memory = {};
function loadMemory() {
  try { memory = JSON.parse(localStorage.getItem("birdsong_translator_memory") || "{}"); } catch (e) { memory = {}; }
}
function saveMemory() {
  try { localStorage.setItem("birdsong_translator_memory", JSON.stringify(memory)); } catch (e) {}
}

// ---------------- the bird's clock ----------------
function birdDate(d) { return new Date(d.timestamp); }

function localParts(d) {
  // hour and minutes where the bird is
  const tz = (d.station || {}).timezone;
  if (tz) {
    try {
      const f = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false });
      const [h, m] = f.format(birdDate(d)).split(":").map(Number);
      return { h: h % 24, m };
    } catch (e) {}
  }
  const m = /T(\d\d):(\d\d)/.exec(d.timestamp);   // the timestamp is written in the station's time
  return m ? { h: +m[1], m: +m[2] } : { h: hour(), m: minute() };
}
const localHour = d => { const p = localParts(d); return p.h + p.m / 60; };
const birdTimeText = d => { const p = localParts(d); return `${nf(p.h, 2)}:${nf(p.m, 2)} bird time`; };

// ---------------- places and signature ----------------
const DEVICE_WORDS = ["birdnet", "birdweather", "puc-", "puc ", "haikubox", "-pi", " pi ", "station"];
const GENERIC_NAMES = ["birdweather app", "birdnet app", "birdweather", "app"];

function placeName(st) {
  let location = (st.location || "").trim();
  if (DEVICE_WORDS.some(w => (" " + location.toLowerCase() + " ").includes(w))) location = "";
  const parts = [];
  for (const v of [location, (st.state || "").trim()]) {
    if (v && parts.every(p => !p.toLowerCase().includes(v.toLowerCase()))) parts.push(v);
  }
  const country = (st.country || "").trim();
  const home = ["united states", "usa", "us", "united states of america"];
  if (country && (!parts.length || !home.includes(country.toLowerCase()))
      && parts.every(p => !p.toLowerCase().includes(country.toLowerCase()))) parts.push(country);
  if (parts.length) return parts.join(", ");
  const c = st.coords || {};
  if (c.lat != null) return `${c.lat.toFixed(2)}, ${c.lon.toFixed(2)}`;
  return "somewhere";
}

function withArticle(name) {
  const you = /^(eu|uni|use|uro|one)/.test(name);
  return (/^[aeiou]/.test(name) && !you ? "an " : "a ") + name;
}

function coordsText(d) {
  const c = coords(d);
  if (!c) return "";
  return `${Math.abs(c.lat).toFixed(2)}°${c.lat >= 0 ? "N" : "S"} ${Math.abs(c.lon).toFixed(2)}°${c.lon >= 0 ? "E" : "W"}`;
}

function creditText(st) {
  let name = (st.name || "")
    .replace(/\b(birdnet[- ]?(pi|go)?|birdweather( app)?|haikubox)\b/gi, "")
    .replace(/\bpuc[- ]?\d+\b/gi, "")
    .replace(/^[\s\-–—_|:·,.]+|[\s\-–—_|:·,.]+$/g, "");
  if (!name || GENERIC_NAMES.includes(name.toLowerCase())) name = "an anonymous listener";
  return `operator: ${name}`;
}

function coords(d) {
  const c = (d.station || {}).coords || d.coords || {};
  return c.lat == null ? null : { lat: +c.lat, lon: +c.lon };
}

// ---------------- weather (Open-Meteo, free, no key) ----------------
const weatherCache = {};
function moonWords(date) {
  const days = (date.getTime() - Date.UTC(2000, 0, 6, 18, 14)) / 86400000;
  const age = ((days % 29.530588853) + 29.530588853) % 29.530588853;
  const names = ["new moon", "waxing crescent", "first quarter", "waxing gibbous", "full moon",
                 "waning gibbous", "last quarter", "waning crescent"];
  return names[Math.round(age / 29.530588853 * 8) % 8];
}

let tomorrowCache = null;
async function tomorrowInNewYork() {
  if (tomorrowCache && Date.now() - tomorrowCache.t < 3 * 3600 * 1000) return tomorrowCache.text;
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${HOME[0]}&longitude=${HOME[1]}`
      + "&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset,wind_speed_10m_max"
      + "&timezone=America%2FNew_York&forecast_days=2";
    const j = await (await fetch(url)).json(), k = 1, dd = j.daily;
    const sky = weatherWords({ current: { weather_code: dd.weather_code[k], temperature_2m: dd.temperature_2m_max[k],
      wind_speed_10m: dd.wind_speed_10m_max[k], is_day: 1, cloud_cover: dd.weather_code[k] >= 3 ? 90 : 10 } });
    const tomorrow = new Date(Date.now() + 86400000);
    const text = `${sky.replace(/, daylight$/, "")}, low ${Math.round(dd.temperature_2m_min[k])}°C, `
      + `rain chance ${dd.precipitation_probability_max[k]}%, sunrise ${dd.sunrise[k].slice(11)}, sunset ${dd.sunset[k].slice(11)}, `
      + `moon: ${moonWords(tomorrow)}`;
    tomorrowCache = { t: Date.now(), text };
    return text;
  } catch (e) { return null; }
}

async function getWeather(c) {
  const place = c.lat.toFixed(2) + "," + c.lon.toFixed(2);
  const hit = weatherCache[place];
  if (hit && Date.now() - hit.t < 20 * 60 * 1000) return hit.data;
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${c.lat.toFixed(4)}&longitude=${c.lon.toFixed(4)}`
      + "&current=temperature_2m,weather_code,wind_speed_10m,is_day,cloud_cover&timezone=auto";
    const data = await (await fetch(url)).json();
    weatherCache[place] = { t: Date.now(), data };
    return data;
  } catch (e) { console.log("[weather] couldn't get it", e); return null; }
}

// ---------------- migration (read once per species from Wikipedia) ----------------
async function migrationStatus(sp) {
  const name = sp.scientificName || sp.commonName;
  memory.migration = memory.migration || {};
  if (name in memory.migration) return memory.migration[name];
  let wikiText = "";
  for (const title of [sp.scientificName, sp.commonName]) {
    if (!title) continue;
    try {
      const url = "https://en.wikipedia.org/w/api.php?action=query&prop=extracts&explaintext=1"
        + "&redirects=1&format=json&origin=*&titles=" + encodeURIComponent(title);
      const pages = (await (await fetch(url)).json()).query.pages;
      wikiText = Object.values(pages).map(p => p.extract || "").join(" ").toLowerCase();
    } catch (e) { console.log("[migration] couldn't read Wikipedia", e); return null; }
    if (wikiText) break;
  }
  const status = migrationFromText(wikiText);
  memory.migration[name] = status;
  saveMemory();
  console.log(`[migration] ${name}: ${status || "unknown"}`);
  return status;
}

async function speciesTraits(sp) {
  // a few real sentences about the species' life and character (from Wikipedia), remembered
  const name = sp.scientificName || sp.commonName;
  memory.traits = memory.traits || {};
  if (name in memory.traits) return memory.traits[name];
  let wikiText = "";
  for (const title of [sp.scientificName, sp.commonName]) {
    if (!title) continue;
    try {
      const url = "https://en.wikipedia.org/w/api.php?action=query&prop=extracts&explaintext=1"
        + "&redirects=1&format=json&origin=*&titles=" + encodeURIComponent(title);
      const pages = (await (await fetch(url)).json()).query.pages;
      wikiText = Object.values(pages).map(p => p.extract || "").join(" ");
    } catch (e) { return ""; }
    if (wikiText) break;
  }
  const words = /\b(known|unusual|mimic|imitat|nest|courtship|mate|pairs?|sings?|song|duet|feeds?|forag|caches?|stores?|aggressive|bold|shy|tame|curious|intelligent|social|flocks?|roost|clever|tools?|steal|dances?|display|lifelong|returns?|memory|remember|loud|quiet|night|dawn)/i;
  const sentences = wikiText.replace(/\s+/g, " ").split(/(?<=[.!?])\s+(?=[A-Z])/)
    .filter(x => x.length > 40 && x.length < 260 && words.test(x) && !/^(The|It) (is|was) (a|an) (species|bird) of/.test(x));
  const picked = [];
  for (const x of sentences) {
    if (picked.join(" ").length + x.length > 1100) break;
    picked.push(x);
  }
  memory.traits[name] = picked.join(" ");
  saveMemory();
  return memory.traits[name];
}

function migrationFromText(text) {
  if (!text) return null;
  const count = w => text.split(w).length - 1;
  const stays = ["non-migratory", "nonmigratory", "not migratory", "sedentary", "does not migrate",
    "year-round resident", "resident year-round", "resident throughout", "largely resident",
    "mostly resident", "mainly resident", "is resident"].reduce((s, w) => s + count(w), 0);
  const moves = (text.match(/(?<!non-)(?<!non)migrat/g) || []).length
    + ["winters in", "wintering", "breeds in", "spends the winter", "summer visitor", "winter visitor"]
      .reduce((s, w) => s + count(w), 0);
  if (moves >= 3 && moves > stays * 2) return "migrant";
  if (stays >= 1) return "resident";
  return null;
}

// ---------------- what the translator is told ----------------
function weatherWords(wx) {
  const c = (wx || {}).current;
  if (!c) return "unknown";
  const code = c.weather_code;
  const sky = code >= 95 ? "a thunderstorm" : (code >= 71 && code <= 77) || code === 85 || code === 86 ? "snow"
    : (code >= 61 && code <= 67) || (code >= 80 && code <= 82) ? "rain" : code >= 51 && code <= 57 ? "drizzle"
    : code === 45 || code === 48 ? "fog" : (c.cloud_cover ?? 0) >= 60 ? "an overcast sky" : (c.cloud_cover ?? 0) >= 25 ? "a few clouds" : "a clear sky";
  return `${sky}, ${Math.round(c.temperature_2m)}°C, wind ${Math.round(c.wind_speed_10m || 0)} km/h, ${c.is_day ? "daylight" : "dark"}`;
}

function seasonWords(d) {
  const c = coords(d);
  if (!c) return "unknown";
  let m = birdDate(d).getUTCMonth() + 1;
  if (Math.abs(c.lat) < 15) return "the tropics, where seasons are rain and dry, not cold and warm";
  if (c.lat < 0) m = (m + 5) % 12 + 1;
  const s = [12, 1, 2].includes(m) ? "winter" : [3, 4, 5].includes(m) ? "spring" : [6, 7, 8].includes(m) ? "summer" : "autumn";
  return `${s} (${c.lat >= 0 ? "northern" : "southern"} hemisphere)`;
}

async function birdContext(d) {
  const c = coords(d), st = d.station || {};
  const wx = c ? await getWeather(c) : null;
  const migr = await migrationStatus(d.species);
  const tz = st.timezone, when = birdDate(d);
  let day = "";
  try { day = new Intl.DateTimeFormat("en-US", { timeZone: tz || undefined, weekday: "long", month: "long", day: "numeric" }).format(when); } catch (e) {}
  const p = localParts(d);
  const traits = await speciesTraits(d.species);
  const lines = [
    `Species: ${d.species.commonName} (${d.species.scientificName})`,
    `What is known about its life and character: ${traits || "(nothing found: use what you know about this species)"}`,
    `Place: ${placeName(st)}${c ? ` (latitude ${c.lat.toFixed(1)})` : ""}`,
    `The bird's local time: ${hourWords(p.h)} (${nf(p.h, 2)}:${nf(p.m, 2)}), ${day}`,
    `Season: ${seasonWords(d)}`,
    `Weather right now: ${weatherWords(wx)}`,
    `Migration: ${migr === "migrant" ? "its species migrates" : migr === "resident" ? "its species stays all year" : "unknown"}`,
  ];
  if (c && HOME) {
    const r = Math.PI / 180, [a1, o1, a2, o2] = [HOME[0] * r, HOME[1] * r, c.lat * r, c.lon * r];
    const km = 2 * 6371 * Math.asin(Math.sqrt(Math.sin((a2 - a1) / 2) ** 2 + Math.cos(a1) * Math.cos(a2) * Math.sin((o2 - o1) / 2) ** 2));
    lines.push(`Distance to the listener: ${Math.round(km).toLocaleString("en-US")} km`);
  }
  const ny = await getWeather({ lat: HOME[0], lon: HOME[1] });
  lines.push(`The listener's local time: ${hourWords(new Date().getHours())} in New York`);
  lines.push(`Weather where the listener is: ${weatherWords(ny)}`);
  if (PROPHECY) {
    const tomorrow = await tomorrowInNewYork();
    if (tomorrow) lines.push(`Tomorrow in New York: ${tomorrow}`);
  }
  try {
    const fmt = tz2 => new Intl.DateTimeFormat("en-CA", { timeZone: tz2, year: "numeric", month: "2-digit", day: "2-digit" }).format(when);
    const theirs = tz ? fmt(tz) : null, mine = fmt("America/New_York");
    if (theirs && theirs > mine) lines.push("The bird is already in the listener's tomorrow");
    else if (theirs && theirs < mine) lines.push("The bird is still in the listener's yesterday");
    else if (theirs) lines.push("The bird and the listener are in the same day");
  } catch (e) {}
  const minutes = Math.round((Date.now() - when.getTime()) / 60000);
  lines.push(minutes >= 2 ? `It sang this ${minutes} minutes ago; the listener hears it only now`
                          : "It sang this a moment ago; the listener hears it now");
  return lines.join("\n");
}

function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) { j ^= bit; }
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len;
    for (let i = 0; i < n; i += len) { for (let k = 0; k < len / 2; k++) {
      const wr = Math.cos(ang * k), wi = Math.sin(ang * k);
      const xr = re[i + k + len / 2] * wr - im[i + k + len / 2] * wi, xi = re[i + k + len / 2] * wi + im[i + k + len / 2] * wr;
      re[i + k + len / 2] = re[i + k] - xr; im[i + k + len / 2] = im[i + k] - xi;
      re[i + k] += xr; im[i + k] += xi;
    } }
  }
}

async function spectrogramPNG(x, rate) {
  // black on white, 0-11 kHz, like a field guide's sonogram. Computed in small pieces
  // (a few columns at a time) so the p5 web editor never sees a long loop.
  const N = 512, hop = 256, maxHz = 11000, H = 200, PIECE = 12;
  const cols = Math.max(1, Math.floor((x.length - N) / hop));
  const W = Math.min(320, cols), stepCols = cols / W;
  const bins = Math.min(N / 2, Math.floor(maxHz / (rate / N)));
  const hann = new Float32Array(N);
  for (let i = 0; i < N; i++) { hann[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N); }
  const cv = document.createElement("canvas"); cv.width = W; cv.height = H;
  const ctx = cv.getContext("2d"), img = ctx.createImageData(W, H);
  const mags = new Array(W);
  let top = 1e-9;
  const analyse = (c0, c1) => {
    for (let c = c0; c < c1; c++) {
      const off = Math.floor(c * stepCols) * hop, re = new Float32Array(N), im = new Float32Array(N);
      for (let i = 0; i < N; i++) { re[i] = (x[off + i] || 0) * hann[i]; }
      fft(re, im);
      const col = new Float32Array(bins);
      for (let k = 0; k < bins; k++) { col[k] = Math.hypot(re[k], im[k]); top = Math.max(top, col[k]); }
      mags[c] = col;
    }
  };
  const paint = (c0, c1) => {
    for (let c = c0; c < c1; c++) {
      for (let y = 0; y < H; y++) {
        const k = Math.floor((H - 1 - y) / H * bins);
        const db = 20 * Math.log10(mags[c][k] / top + 1e-9);          // 0 dB = loudest
        const v = 255 - Math.round(constrain((db + 45) / 45, 0, 1) * 255);
        const p = (y * W + c) * 4;
        img.data[p] = img.data[p + 1] = img.data[p + 2] = v; img.data[p + 3] = 255;
      }
    }
  };
  const inPieces = (work, c0 = 0) => c0 >= W ? Promise.resolve()
    : new Promise(r => setTimeout(r, 0)).then(() => { work(c0, Math.min(W, c0 + PIECE)); return inPieces(work, c0 + PIECE); });
  await inPieces(analyse);
  await inPieces(paint);
  ctx.putImageData(img, 0, 0);
  return cv.toDataURL("image/png").split(",")[1];
}

async function translateBird(d, call, attempt = 1) {
  // asks the translator; returns {kind, said, message, silent, reason, reply_to} or null
  if (!aiKey) return null;
  const context = await birdContext(d);
  const feeling = Math.random() < FEELING_CHANCE ? FEELINGS[Math.floor(Math.random() * FEELINGS.length)] : "";
  const lens = (ALLOW_REPLIES && (memory.translations || []).length) ? pickLens()
             : pickLens().replace("an earlier bird's message, answered or contradicted", "the hour where the bird is");
  const earlier = (memory.translations || []).slice(-AI_REMEMBER);
  const prompt = context + "\n\n"
    + (earlier.length ? "Earlier birds (oldest first):\n" + earlier.map(e =>
        `- ${e.species}, ${e.place}: [${e.kind || ""}] said "${e.said}" / message "${e.message || "(silent)"}"`).join("\n") + "\n\n" : "")
    + (call && call.portrait ? `How the song sounds: ${call.portrait}.\n` : "")
    + `LENS for this message: ${lens}.\n`
    + (feeling ? `FEELING underneath it: ${feeling}.\n` : "")
    + (NOTES_ARE_WORDS && call && call.words ? (call.notes === call.words ? `The song had ${call.notes} notes: the message must have exactly ${call.words} words.\n`
       : `The message must have exactly ${call.words} words.\n`) : "")
    + `\nTranslate this bird.`;
  console.log("[translator] asking with:\n" + prompt);
  const content = [{ type: "text", text: prompt }];
  try {
    if (call && call.wide) content.unshift({ type: "image", source: { type: "base64", media_type: "image/png", data: await spectrogramPNG(call.wide, call.rate) } });
  } catch (e) { console.log("[translator] no spectrogram", e); }
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json", "x-api-key": aiKey, "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({ model: AI_MODEL, max_tokens: 1000, temperature: 1, system: AI_SYSTEM,
        tools: [TRANSLATION_TOOL], tool_choice: { type: "auto" },
        messages: [{ role: "user", content }] }),
    });
    const json = await res.json();
    if (!res.ok) { console.log("[translator] error", json); aiError = (json.error || {}).message || res.status; return null; }
    let t = ((json.content || []).find(b => b.type === "tool_use") || {}).input;
    if (!t) {                              // it answered in text instead: try to read JSON from it
      const raw = (json.content || []).filter(b => b.type === "text").map(b => b.text).join(" ");
      const m = raw.match(/\{[\s\S]*\}/);
      try { t = m ? JSON.parse(m[0]) : null; } catch (e) { t = null; }
      if (!t && raw.trim()) t = { kind: "", said: "", message: raw.trim().split("\n")[0], silent: false };
    }
    if (!t) {
      const types = (json.content || []).map(b => b.type).join("+") || "nothing";
      console.log("[translator] no translation in:", json);
      if (attempt < 2) {                   // ask once more before giving up
        console.log("[translator] asking again...");
        return translateBird(d, call, attempt + 1);
      }
      aiError = `unreadable answer (got ${types}, stop: ${json.stop_reason || "?"})`;
      return null;
    }
    const clean = v => String(v || "").replace(/^["'“”‘’\s]+|["'“”‘’\s]+$/g, "");
    const out = { kind: clean(t.kind), said: clean(t.said), message: clean(t.message),
                  silent: !!t.silent, reason: clean(t.reason), reply_to: clean(t.reply_to) };
    if (!out.silent && !out.message) {
      if (attempt < 2) { console.log("[translator] empty message, asking again"); return translateBird(d, call, attempt + 1); }
      aiError = "empty answer"; return null;
    }
    out.mode = t.mode === "to_the_listener" ? "to_the_listener" : "aphorism";
    const nWords = out.message.split(/\s+/).filter(w => /[a-z]/i.test(w)).length;
    const banned = BANNED_WORDS.find(w => new RegExp(`\\b${w}\\b`, "i").test(out.message));
    if (!out.silent && attempt < 2 && banned) {
      console.log(`[translator] used "${banned}", asking again:`, out.message);
      return translateBird(d, call, attempt + 1);
    }
    if (!out.silent && attempt < 2 && NOTES_ARE_WORDS && call && call.words && nWords !== call.words) {
      console.log(`[translator] ${nWords} words instead of ${call.words}, asking again:`, out.message);
      return translateBird(d, call, attempt + 1);
    }
    if (!out.silent && attempt < 2 && out.message.split(/\s+/).length > 10) {
      console.log("[translator] too long, asking again:", out.message);   // haiku-short
      return translateBird(d, call, attempt + 1);
    }
    if (!out.silent && out.mode === "aphorism" && attempt < 2 && (/\b(you|your|yours|me|my|mine|we|us|our)\b/i.test(out.message) || /\bI\b/.test(out.message))) {
      console.log("[translator] it spoke to someone, asking again:", out.message);   // the tone is addressed to no one
      return translateBird(d, call, attempt + 1);
    }
    memory.translations = earlier.concat([{ kind: out.kind, species: d.species.commonName.toLowerCase(),
      place: placeName(d.station || {}), said: out.said, message: out.silent ? "" : out.message }]).slice(-AI_REMEMBER);
    saveMemory();
    out.notes = NOTES_ARE_WORDS && call && call.notes >= 4 && call.notes <= 8 ? call.notes : 0;   // shown on the slip only when the rule holds
    console.log("[translator] lens:", lens, "| feeling:", feeling || "-", "| candidates:", t.candidates, out);
    aiError = "";
    return out;
  } catch (e) { console.log("[translator] couldn't reach Claude", e); aiError = "couldn't reach Claude"; return null; }
}

const sentence = t => { t = t.trim(); if (!t) return t; t = t[0].toUpperCase() + t.slice(1); return /[.!?:]$/.test(t) ? t : t + "."; };

function slipParts(d, t) {
  const st = d.station || {}, bird = d.species.commonName.toLowerCase(), place = placeName(st);
  const from = place === "somewhere" ? "somewhere" : place;
  // only the message is printed: the bird's own words and the kind of song stay hidden
  // (they're in the console), so the slip keeps its magic
  return {
    illus: t.illus || null,
    phrase: sentence(t.message),
    signature: `${withArticle(bird)}, ${from === "somewhere" ? "from somewhere" : "from " + from}`,
    data: [coordsText(d), birdTimeText(d), t.notes ? `${t.notes} notes` : "", creditText(st)].filter(Boolean).join("  ·  ")
          + (t.illus && t.illus.credit ? `\n${t.illus.credit}` : ""),
  };
}

// ---------------- illustrations: Fugleramme ----------------
// Fugleramme (github.com/arnegiacomo/fugleramme) hand-cuts birds from public-domain
// 19th-century plates. Its "classic" artwork is licensed CC BY-SA 4.0: credit it and share
// what you make with it under the same licence. The index below lists its cut-outs
// (species -> files and the plate's illustrator), BirdNET name aliases, and illustrators.
const FUGLE_COMMIT = "1bb2f278dd3e7a0859449f9867bbfccc9336ec2c";
const FUGLE_BASE = `https://raw.githubusercontent.com/arnegiacomo/fugleramme/${FUGLE_COMMIT}/assets/artwork/classic/birds/`;
const FUGLE = {"index":{"acanthis-cabaret":[["acanthis-cabaret","gould"]],"acanthis-flammea":[["acanthis-flammea-2","vonwright"],["acanthis-flammea","gould"]],"acanthiza-pusilla":[["acanthiza-pusilla","gould"]],"accipiter-nisus":[["accipiter-nisus-2","vonwright"],["accipiter-nisus","gould"]],"accipiter-striatus":[["accipiter-striatus","audubon"]],"acridotheres-cristatellus":[["acridotheres-cristatellus","edwards"]],"acridotheres-tristis":[["acridotheres-tristis","legge"]],"acrocephalus-arundinaceus":[["acrocephalus-arundinaceus-2","gould"],["acrocephalus-arundinaceus","gould"]],"acrocephalus-dumetorum":[["acrocephalus-dumetorum","dresser"]],"acrocephalus-melanopogon":[["acrocephalus-melanopogon","gould"]],"acrocephalus-paludicola":[["acrocephalus-paludicola","vonwright"]],"acrocephalus-palustris":[["acrocephalus-palustris","gould"]],"acrocephalus-schoenobaenus":[["acrocephalus-schoenobaenus-2","vonwright"],["acrocephalus-schoenobaenus-3","vonwright"],["acrocephalus-schoenobaenus","gould"]],"acrocephalus-scirpaceus":[["acrocephalus-scirpaceus","vonwright"]],"actitis-hypoleucos":[["actitis-hypoleucos-2","vonwright"],["actitis-hypoleucos","gould"]],"actitis-macularius":[["actitis-macularius","gould"]],"aegithalos-caudatus":[["aegithalos-caudatus-2","vonwright"],["aegithalos-caudatus","vonwright"]],"aegolius-acadicus":[["aegolius-acadicus-2","audubon"],["aegolius-acadicus","audubon"]],"aegolius-funereus":[["aegolius-funereus-2","vonwright"],["aegolius-funereus","gould"]],"aegypius-monachus":[["aegypius-monachus","gould"]],"aethopyga-christinae":[["aethopyga-christinae-2","keulemans"],["aethopyga-christinae","keulemans"]],"agelaius-phoeniceus":[["agelaius-phoeniceus-2","audubon"],["agelaius-phoeniceus","audubon"]],"aix-galericulata":[["aix-galericulata","dorbigny"]],"alauda-arvensis":[["alauda-arvensis","vonwright"]],"alaudala-rufescens":[["alaudala-rufescens","dresser"]],"alca-torda":[["alca-torda","vonwright"]],"alcedo-atthis":[["alcedo-atthis-2","vonwright"],["alcedo-atthis","gould"]],"alectoris-barbara":[["alectoris-barbara","gould"]],"alectoris-chukar":[["alectoris-chukar","gould"]],"alectoris-graeca":[["alectoris-graeca-2","gould"],["alectoris-graeca-3","bree"],["alectoris-graeca","dresser"]],"alectoris-rufa":[["alectoris-rufa","gould"]],"alisterus-scapularis":[["alisterus-scapularis","gould"]],"alle-alle":[["alle-alle","vonwright"]],"alopochen-aegyptiaca":[["alopochen-aegyptiaca","gould"]],"amaurornis-phoenicurus":[["amaurornis-phoenicurus","gould"]],"anarhynchus-alexandrinus":[["anarhynchus-alexandrinus-2","vonwright"],["anarhynchus-alexandrinus","gould"]],"anas-acuta":[["anas-acuta-2","vonwright"],["anas-acuta-3","vonwright"],["anas-acuta-4","vonwright"],["anas-acuta-5","vonwright"],["anas-acuta","gould"]],"anas-crecca":[["anas-crecca-2","vonwright"],["anas-crecca-3","vonwright"],["anas-crecca","gould"]],"anas-platyrhynchos":[["anas-platyrhynchos-2","vonwright"],["anas-platyrhynchos-3","vonwright"],["anas-platyrhynchos-4","vonwright"],["anas-platyrhynchos","gould"]],"anas-zonorhyncha":[["anas-zonorhyncha","siebold"]],"andropadus-importunus":[["andropadus-importunus","levaillant"]],"anous-stolidus":[["anous-stolidus","gould"]],"anser-albifrons":[["anser-albifrons-2","vonwright"],["anser-albifrons-3","vonwright"],["anser-albifrons-4","vonwright"],["anser-albifrons-5","vonwright"],["anser-albifrons","gould"]],"anser-anser":[["anser-anser-2","vonwright"],["anser-anser-3","vonwright"],["anser-anser","gould"]],"anser-brachyrhynchus":[["anser-brachyrhynchus-2","vonwright"],["anser-brachyrhynchus","vonwright"]],"anser-caerulescens":[["anser-caerulescens","gould"]],"anser-erythropus":[["anser-erythropus-2","vonwright"],["anser-erythropus","vonwright"]],"anser-fabalis":[["anser-fabalis-2","vonwright"],["anser-fabalis-3","vonwright"],["anser-fabalis","gould"]],"anser-serrirostris":[["anser-serrirostris","naumann"]],"anthochaera-carunculata":[["anthochaera-carunculata","gould"]],"anthochaera-chrysoptera":[["anthochaera-chrysoptera","gould"]],"anthus-campestris":[["anthus-campestris-2","vonwright"],["anthus-campestris","gould"]],"anthus-cervinus":[["anthus-cervinus-2","vonwright"],["anthus-cervinus","gould"]],"anthus-hodgsoni":[["anthus-hodgsoni","gould"]],"anthus-petrosus":[["anthus-petrosus-2","vonwright"],["anthus-petrosus","gould"]],"anthus-pratensis":[["anthus-pratensis-2","vonwright"],["anthus-pratensis","gould"]],"anthus-richardi":[["anthus-richardi","gould"]],"anthus-spinoletta":[["anthus-spinoletta-2","vonwright"],["anthus-spinoletta","vonwright"]],"anthus-trivialis":[["anthus-trivialis-2","vonwright"],["anthus-trivialis","gould"]],"aphelocoma-californica":[["aphelocoma-californica-2","fuertes"],["aphelocoma-californica","dawson"]],"aphelocoma-woodhouseii":[["aphelocoma-woodhouseii","emory"]],"apus-apus":[["apus-apus","vonwright"]],"apus-pallidus":[["apus-pallidus-2","bree"],["apus-pallidus","dresser"]],"aquila-adalberti":[["aquila-adalberti-2","dresser"],["aquila-adalberti","dresser"]],"aquila-chrysaetos":[["aquila-chrysaetos-2","vonwright"],["aquila-chrysaetos-3","vonwright"],["aquila-chrysaetos","gould"]],"aquila-fasciata":[["aquila-fasciata","gould"]],"aquila-heliaca":[["aquila-heliaca","gould"]],"archilochus-colubris":[["archilochus-colubris","fuertes"]],"ardea-alba":[["ardea-alba","gould"]],"ardea-cinerea":[["ardea-cinerea-2","vonwright"],["ardea-cinerea","gould"]],"ardea-herodias":[["ardea-herodias","audubon"]],"ardea-ibis":[["ardea-ibis-2","dresser"],["ardea-ibis","gould"]],"ardea-purpurea":[["ardea-purpurea","gould"]],"ardenna-grisea":[["ardenna-grisea","gould"]],"ardeola-bacchus":[["ardeola-bacchus","madarasz"]],"ardeola-ralloides":[["ardeola-ralloides-2","gould"],["ardeola-ralloides","gould"]],"arenaria-interpres":[["arenaria-interpres-2","vonwright"],["arenaria-interpres","gould"]],"artamus-leucorynchus":[["artamus-leucorynchus","gould"]],"asio-flammeus":[["asio-flammeus-2","vonwright"],["asio-flammeus","gould"]],"asio-otus":[["asio-otus-2","vonwright"],["asio-otus","gould"]],"astur-cooperii":[["astur-cooperii","audubon"]],"astur-gentilis":[["astur-gentilis-2","vonwright"],["astur-gentilis-3","vonwright"],["astur-gentilis","gould"]],"athene-cunicularia":[["athene-cunicularia","audubon"]],"athene-noctua":[["athene-noctua","gould"]],"aythya-ferina":[["aythya-ferina-2","vonwright"],["aythya-ferina-3","vonwright"],["aythya-ferina-4","vonwright"],["aythya-ferina","gould"]],"aythya-fuligula":[["aythya-fuligula-2","vonwright"],["aythya-fuligula-3","vonwright"],["aythya-fuligula","gould"]],"aythya-marila":[["aythya-marila-2","vonwright"],["aythya-marila-3","vonwright"],["aythya-marila-4","vonwright"],["aythya-marila","gould"]],"aythya-nyroca":[["aythya-nyroca","gould"]],"baeolophus-bicolor":[["baeolophus-bicolor-2","werner"],["baeolophus-bicolor","audubon"]],"bartramia-longicauda":[["bartramia-longicauda","gould"]],"bombycilla-cedrorum":[["bombycilla-cedrorum","audubon"]],"bombycilla-garrulus":[["bombycilla-garrulus-2","vonwright"],["bombycilla-garrulus-3","vonwright"],["bombycilla-garrulus","gould"]],"bostrychia-hagedash":[["bostrychia-hagedash","finchdavies"]],"botaurus-lentiginosus":[["botaurus-lentiginosus","gould"]],"botaurus-minutus":[["botaurus-minutus","gould"]],"botaurus-stellaris":[["botaurus-stellaris-2","vonwright"],["botaurus-stellaris","gould"]],"branta-bernicla":[["branta-bernicla-2","vonwright"],["branta-bernicla-3","vonwright"],["branta-bernicla","gould"]],"branta-canadensis":[["branta-canadensis","morris"]],"branta-hutchinsii":[["branta-hutchinsii","audubon"]],"branta-leucopsis":[["branta-leucopsis-2","vonwright"],["branta-leucopsis-3","vonwright"],["branta-leucopsis","gould"]],"branta-ruficollis":[["branta-ruficollis-2","vonwright"],["branta-ruficollis","vonwright"]],"bubo-ascalaphus":[["bubo-ascalaphus","gould"]],"bubo-bubo":[["bubo-bubo-2","vonwright"],["bubo-bubo-3","vonwright"],["bubo-bubo","gould"]],"bubo-scandiacus":[["bubo-scandiacus-2","vonwright"],["bubo-scandiacus","gould"]],"bubo-virginianus":[["bubo-virginianus","audubon"]],"bucephala-clangula":[["bucephala-clangula-2","vonwright"],["bucephala-clangula-3","vonwright"],["bucephala-clangula-4","vonwright"],["bucephala-clangula-5","vonwright"],["bucephala-clangula","gould"]],"bucephala-islandica":[["bucephala-islandica","gould"]],"bulweria-bulwerii":[["bulweria-bulwerii","gould"]],"burhinus-capensis":[["burhinus-capensis","finchdavies"]],"burhinus-grallarius":[["burhinus-grallarius","gould"]],"burhinus-oedicnemus":[["burhinus-oedicnemus-2","vonwright"],["burhinus-oedicnemus","gould"]],"buteo-buteo":[["buteo-buteo-2","vonwright"],["buteo-buteo-3","vonwright"],["buteo-buteo","gould"]],"buteo-jamaicensis":[["buteo-jamaicensis","fuertes"]],"buteo-lagopus":[["buteo-lagopus-2","vonwright"],["buteo-lagopus","gould"]],"buteo-lineatus":[["buteo-lineatus","audubon"]],"buteo-platypterus":[["buteo-platypterus","audubon"]],"buteo-regalis":[["buteo-regalis","cassin"]],"buteo-swainsoni":[["buteo-swainsoni","audubon"]],"cacatua-galerita":[["cacatua-galerita","gould"]],"calandrella-brachydactyla":[["calandrella-brachydactyla","gould"]],"calcarius-lapponicus":[["calcarius-lapponicus-2","vonwright"],["calcarius-lapponicus-3","vonwright"],["calcarius-lapponicus","gould"]],"calidris-alba":[["calidris-alba-2","vonwright"],["calidris-alba","gould"]],"calidris-alpina":[["calidris-alpina-2","gould"],["calidris-alpina-3","vonwright"],["calidris-alpina-4","vonwright"],["calidris-alpina-5","vonwright"],["calidris-alpina","gould"]],"calidris-canutus":[["calidris-canutus-2","vonwright"],["calidris-canutus","gould"]],"calidris-falcinellus":[["calidris-falcinellus-2","vonwright"],["calidris-falcinellus","gould"]],"calidris-ferruginea":[["calidris-ferruginea-2","vonwright"],["calidris-ferruginea","gould"]],"calidris-maritima":[["calidris-maritima-2","vonwright"],["calidris-maritima","gould"]],"calidris-melanotos":[["calidris-melanotos","gould"]],"calidris-minuta":[["calidris-minuta-2","vonwright"],["calidris-minuta","gould"]],"calidris-pugnax":[["calidris-pugnax-2","vonwright"],["calidris-pugnax-3","vonwright"],["calidris-pugnax-4","vonwright"],["calidris-pugnax","gould"]],"calidris-pusilla":[["calidris-pusilla","gould"]],"calidris-subruficollis":[["calidris-subruficollis","gould"]],"calidris-temminckii":[["calidris-temminckii-2","vonwright"],["calidris-temminckii-3","vonwright"],["calidris-temminckii-4","vonwright"],["calidris-temminckii","gould"]],"caligavis-chrysops":[["caligavis-chrysops","gould"]],"calliope-calliope":[["calliope-calliope","gould"]],"callipepla-californica":[["callipepla-californica","audubon"]],"calonectris-diomedea":[["calonectris-diomedea-2","gould"],["calonectris-diomedea-3","bree"],["calonectris-diomedea","dresser"]],"calypte-anna":[["calypte-anna-2","lesson"],["calypte-anna-3","lesson"],["calypte-anna","audubon"]],"calyptorhynchus-banksii":[["calyptorhynchus-banksii","gould"]],"calyptorhynchus-lathami":[["calyptorhynchus-lathami","gould"]],"canachites-canadensis":[["canachites-canadensis","fuertes"]],"caprimulgus-europaeus":[["caprimulgus-europaeus-2","vonwright"],["caprimulgus-europaeus-3","vonwright"],["caprimulgus-europaeus","gould"]],"caprimulgus-pectoralis":[["caprimulgus-pectoralis","levaillant"]],"caprimulgus-ruficollis":[["caprimulgus-ruficollis","gould"]],"cardinalis-cardinalis":[["cardinalis-cardinalis-2","audubon"],["cardinalis-cardinalis","audubon"]],"carduelis-carduelis":[["carduelis-carduelis-2","vonwright"],["carduelis-carduelis","gould"]],"carduelis-citrinella":[["carduelis-citrinella","gould"]],"carpodacus-erythrinus":[["carpodacus-erythrinus","vonwright"]],"cathartes-aura":[["cathartes-aura","audubon"]],"catharus-ustulatus":[["catharus-ustulatus","dresser"]],"catherpes-mexicanus":[["catherpes-mexicanus","swainson"]],"cecropis-daurica":[["cecropis-daurica","gould"]],"centropus-sinensis":[["centropus-sinensis","horsfield"]],"cepphus-grylle":[["cepphus-grylle-2","vonwright"],["cepphus-grylle-3","vonwright"],["cepphus-grylle","gould"]],"cercotrichas-galactotes":[["cercotrichas-galactotes","gould"]],"certhia-americana":[["certhia-americana-2","audubon"],["certhia-americana","audubon"]],"certhia-brachydactyla":[["certhia-brachydactyla","naumann"]],"certhia-familiaris":[["certhia-familiaris-2","vonwright"],["certhia-familiaris","gould"]],"ceryle-rudis":[["ceryle-rudis","gould"]],"cettia-cetti":[["cettia-cetti-2","gould"],["cettia-cetti","gould"]],"chaetura-pelagica":[["chaetura-pelagica-2","audubon"],["chaetura-pelagica","audubon"]],"charadrius-hiaticula":[["charadrius-hiaticula","gould"]],"charadrius-vociferus":[["charadrius-vociferus-2","audubon"],["charadrius-vociferus","audubon"]],"chelidon-rustica-x-hirundo-urbica":[["chelidon-rustica-x-hirundo-urbica","vonwright"]],"chenonetta-jubata":[["chenonetta-jubata","gould"]],"chlidonias-hybrida":[["chlidonias-hybrida","gould"]],"chlidonias-leucopterus":[["chlidonias-leucopterus","gould"]],"chlidonias-niger":[["chlidonias-niger-2","vonwright"],["chlidonias-niger","gould"]],"chloris-chloris":[["chloris-chloris-2","vonwright"],["chloris-chloris","vonwright"]],"chloris-sinica":[["chloris-sinica-2","siebold"],["chloris-sinica","siebold"]],"chordeiles-minor":[["chordeiles-minor-2","audubon"],["chordeiles-minor","audubon"]],"chroicocephalus-genei":[["chroicocephalus-genei","bonaparte"]],"chroicocephalus-ridibundus":[["chroicocephalus-ridibundus-2","vonwright"],["chroicocephalus-ridibundus-3","vonwright"],["chroicocephalus-ridibundus","gould"]],"ciconia-ciconia":[["ciconia-ciconia-2","vonwright"],["ciconia-ciconia","gould"]],"ciconia-nigra":[["ciconia-nigra-2","vonwright"],["ciconia-nigra","gould"]],"cinclus-cinclus":[["cinclus-cinclus-2","gould"],["cinclus-cinclus","gould"]],"cinclus-pallasii":[["cinclus-pallasii","gould"]],"cinnyris-jugularis":[["cinnyris-jugularis-2","gould"],["cinnyris-jugularis","gould"]],"circaetus-gallicus":[["circaetus-gallicus","gould"]],"circus-aeruginosus":[["circus-aeruginosus-2","vonwright"],["circus-aeruginosus","gould"]],"circus-cyaneus":[["circus-cyaneus-2","vonwright"],["circus-cyaneus-3","vonwright"],["circus-cyaneus","gould"]],"circus-hudsonius":[["circus-hudsonius","audubon"]],"circus-macrourus":[["circus-macrourus-2","vonwright"],["circus-macrourus","gould"]],"circus-pygargus":[["circus-pygargus-2","vonwright"],["circus-pygargus","gould"]],"cisticola-juncidis":[["cisticola-juncidis","gould"]],"clamator-glandarius":[["clamator-glandarius","gould"]],"clamator-jacobinus":[["clamator-jacobinus","gordon"]],"clanga-clanga":[["clanga-clanga","gould"]],"clanga-pomarina":[["clanga-pomarina-2","dresser"],["clanga-pomarina-3","naumann"],["clanga-pomarina","naumann"]],"clangula-hyemalis":[["clangula-hyemalis-2","vonwright"],["clangula-hyemalis-3","vonwright"],["clangula-hyemalis-4","vonwright"],["clangula-hyemalis-5","vonwright"],["clangula-hyemalis-6","vonwright"],["clangula-hyemalis-7","vonwright"],["clangula-hyemalis-8","vonwright"],["clangula-hyemalis","gould"]],"coccopygia-melanotis":[["coccopygia-melanotis","temminck"]],"coccothraustes-coccothraustes":[["coccothraustes-coccothraustes","vonwright"]],"coccyzus-americanus":[["coccyzus-americanus","gould"]],"colaptes-auratus":[["colaptes-auratus-2","audubon"],["colaptes-auratus","audubon"]],"colinus-virginianus":[["colinus-virginianus","audubon"]],"colius-striatus":[["colius-striatus","levaillant"]],"coloeus-monedula":[["coloeus-monedula-2","vonwright"],["coloeus-monedula-3","vonwright"],["coloeus-monedula","gould"]],"columba-guinea":[["columba-guinea","finchdavies"]],"columba-livia":[["columba-livia","gould"]],"columba-oenas":[["columba-oenas-2","vonwright"],["columba-oenas","gould"]],"columba-palumbus":[["columba-palumbus-2","vonwright"],["columba-palumbus-3","vonwright"],["columba-palumbus","gould"]],"contopus-cooperi":[["contopus-cooperi","fuertes"]],"contopus-virens":[["contopus-virens","audubon"]],"copsychus-saularis":[["copsychus-saularis-2","gould"],["copsychus-saularis-3","gwillim"],["copsychus-saularis-4","gould"],["copsychus-saularis","levaillant"]],"coracias-garrulus":[["coracias-garrulus-2","vonwright"],["coracias-garrulus-3","vonwright"],["coracias-garrulus","gould"]],"coracina-novaehollandiae":[["coracina-novaehollandiae","gould"]],"corthylio-calendula":[["corthylio-calendula-2","audubon"],["corthylio-calendula","audubon"]],"corvus-albicollis":[["corvus-albicollis","levaillant"]],"corvus-albus":[["corvus-albus","levaillant"]],"corvus-brachyrhynchos":[["corvus-brachyrhynchos","audubon"]],"corvus-corax":[["corvus-corax-2","vonwright"],["corvus-corax-3","vonwright"],["corvus-corax","gould"]],"corvus-cornix":[["corvus-cornix","vonwright"]],"corvus-corone":[["corvus-corone","gould"]],"corvus-coronoides":[["corvus-coronoides","gould"]],"corvus-frugilegus":[["corvus-frugilegus-2","vonwright"],["corvus-frugilegus-3","vonwright"],["corvus-frugilegus","gould"]],"corvus-macrorhynchos":[["corvus-macrorhynchos","siebold"]],"corvus-orru":[["corvus-orru","gronvold"]],"corvus-ossifragus":[["corvus-ossifragus-2","audubon"],["corvus-ossifragus","fuertes"]],"coturnix-coturnix":[["coturnix-coturnix-2","vonwright"],["coturnix-coturnix","gould"]],"cracticus-nigrogularis":[["cracticus-nigrogularis","gould"]],"cracticus-torquatus":[["cracticus-torquatus-2","gould"],["cracticus-torquatus","temminck"]],"crex-crex":[["crex-crex-2","vonwright"],["crex-crex","gould"]],"crinifer-concolor":[["crinifer-concolor","smith"]],"cuculus-canorus":[["cuculus-canorus-2","vonwright"],["cuculus-canorus","vonwright"]],"curruca-communis":[["curruca-communis-2","vonwright"],["curruca-communis","gould"]],"curruca-conspicillata":[["curruca-conspicillata-2","gould"],["curruca-conspicillata","gould"]],"curruca-curruca":[["curruca-curruca-2","vonwright"],["curruca-curruca","vonwright"]],"curruca-hortensis":[["curruca-hortensis-2","gould"],["curruca-hortensis-3","gould"],["curruca-hortensis","gould"]],"curruca-iberiae":[["curruca-iberiae-2","gould"],["curruca-iberiae","gould"]],"curruca-melanocephala":[["curruca-melanocephala-2","gould"],["curruca-melanocephala","gould"]],"curruca-nisoria":[["curruca-nisoria-2","vonwright"],["curruca-nisoria","gould"]],"curruca-ruppeli":[["curruca-ruppeli","gould"]],"curruca-undata":[["curruca-undata-2","gould"],["curruca-undata","gould"]],"cyanistes-caeruleus":[["cyanistes-caeruleus-2","keulemans"],["cyanistes-caeruleus","gould"]],"cyanistes-cyanus":[["cyanistes-cyanus","gould"]],"cyanocitta-cristata":[["cyanocitta-cristata","audubon"]],"cyanocitta-stelleri":[["cyanocitta-stelleri-2","hines"],["cyanocitta-stelleri","swainson"]],"cyanopica-cooki":[["cyanopica-cooki-2","dresser"],["cyanopica-cooki-3","bree"],["cyanopica-cooki","gould"]],"cyanopica-cyanus":[["cyanopica-cyanus-2","werner"],["cyanopica-cyanus-3","arnoul"],["cyanopica-cyanus","siebold"]],"cygnus-atratus":[["cygnus-atratus","gould"]],"cygnus-columbianus":[["cygnus-columbianus","gould"]],"cygnus-cygnus":[["cygnus-cygnus-2","vonwright"],["cygnus-cygnus-3","vonwright"],["cygnus-cygnus","gould"]],"cygnus-olor":[["cygnus-olor-2","vonwright"],["cygnus-olor","gould"]],"dacelo-novaeguineae":[["dacelo-novaeguineae","gould"]],"delichon-urbicum":[["delichon-urbicum-2","vonwright"],["delichon-urbicum-3","vonwright"],["delichon-urbicum-4","vonwright"],["delichon-urbicum","gould"]],"dendrocopos-leucotos":[["dendrocopos-leucotos-2","vonwright"],["dendrocopos-leucotos","gould"]],"dendrocopos-major":[["dendrocopos-major-2","vonwright"],["dendrocopos-major-3","vonwright"],["dendrocopos-major-4","vonwright"],["dendrocopos-major","gould"]],"dendrocopos-syriacus":[["dendrocopos-syriacus","dresser"]],"dendrocoptes-medius":[["dendrocoptes-medius","vonwright"]],"dessonornis-caffer":[["dessonornis-caffer","levaillant"]],"dryobates-minor":[["dryobates-minor-2","vonwright"],["dryobates-minor-3","vonwright"],["dryobates-minor","gould"]],"dryobates-pubescens":[["dryobates-pubescens","audubon"]],"dryocopus-martius":[["dryocopus-martius-2","vonwright"],["dryocopus-martius","gould"]],"dryocopus-pileatus":[["dryocopus-pileatus","fuertes"]],"dumetella-carolinensis":[["dumetella-carolinensis-2","fuertes"],["dumetella-carolinensis","audubon"]],"egretta-garzetta":[["egretta-garzetta","gould"]],"elanoides-forficatus":[["elanoides-forficatus","gould"]],"elanus-caeruleus":[["elanus-caeruleus","gould"]],"emberiza-aureola":[["emberiza-aureola","gould"]],"emberiza-caesia":[["emberiza-caesia","gould"]],"emberiza-calandra":[["emberiza-calandra-2","vonwright"],["emberiza-calandra","gould"]],"emberiza-cia":[["emberiza-cia","gould"]],"emberiza-cineracea":[["emberiza-cineracea","gould"]],"emberiza-cirlus":[["emberiza-cirlus","gould"]],"emberiza-citrinella":[["emberiza-citrinella-2","vonwright"],["emberiza-citrinella-3","vonwright"],["emberiza-citrinella-4","vonwright"],["emberiza-citrinella-5","gould"],["emberiza-citrinella","gould"]],"emberiza-hortulana":[["emberiza-hortulana-2","vonwright"],["emberiza-hortulana","vonwright"]],"emberiza-leucocephalos":[["emberiza-leucocephalos","gould"]],"emberiza-melanocephala":[["emberiza-melanocephala-2","gould"],["emberiza-melanocephala-3","gould"],["emberiza-melanocephala-4","dresser"],["emberiza-melanocephala","gould"]],"emberiza-pusilla":[["emberiza-pusilla-2","gould"],["emberiza-pusilla-3","gould"],["emberiza-pusilla","dresser"]],"emberiza-rustica":[["emberiza-rustica","gould"]],"emberiza-schoeniclus":[["emberiza-schoeniclus-2","gould"],["emberiza-schoeniclus-3","vonwright"],["emberiza-schoeniclus-4","vonwright"],["emberiza-schoeniclus","gould"]],"entomyzon-cyanotis":[["entomyzon-cyanotis","gould"]],"eolophus-roseicapilla":[["eolophus-roseicapilla","gould"]],"eremophila-alpestris":[["eremophila-alpestris","vonwright"]],"erithacus-rubecula":[["erithacus-rubecula-2","dresser"],["erithacus-rubecula","dresser"]],"estrilda-astrild":[["estrilda-astrild","keulemans"]],"eudromias-morinellus":[["eudromias-morinellus-2","vonwright"],["eudromias-morinellus","gould"]],"eudynamys-orientalis":[["eudynamys-orientalis","gould"]],"eudynamys-scolopaceus":[["eudynamys-scolopaceus-2","edwards"],["eudynamys-scolopaceus-3","edwards"],["eudynamys-scolopaceus-4","martinet"],["eudynamys-scolopaceus","martinet"]],"euplectes-orix":[["euplectes-orix","hahn"]],"falco-biarmicus":[["falco-biarmicus","gould"]],"falco-columbarius":[["falco-columbarius-2","vonwright"],["falco-columbarius-3","vonwright"],["falco-columbarius-4","vonwright"],["falco-columbarius","gould"]],"falco-concolor":[["falco-concolor","gould"]],"falco-mexicanus":[["falco-mexicanus","cassin"]],"falco-naumanni":[["falco-naumanni","gould"]],"falco-peregrinus":[["falco-peregrinus-2","vonwright"],["falco-peregrinus","gould"]],"falco-rusticolus":[["falco-rusticolus-2","vonwright"],["falco-rusticolus-3","vonwright"],["falco-rusticolus","gould"]],"falco-sparverius":[["falco-sparverius","audubon"]],"falco-subbuteo":[["falco-subbuteo-2","vonwright"],["falco-subbuteo-3","vonwright"],["falco-subbuteo","gould"]],"falco-tinnunculus":[["falco-tinnunculus-2","vonwright"],["falco-tinnunculus-3","vonwright"],["falco-tinnunculus-4","vonwright"],["falco-tinnunculus-5","vonwright"],["falco-tinnunculus","gould"]],"falco-vespertinus":[["falco-vespertinus-2","vonwright"],["falco-vespertinus","gould"]],"ficedula-albicollis":[["ficedula-albicollis-2","vonwright"],["ficedula-albicollis","gould"]],"ficedula-hypoleuca":[["ficedula-hypoleuca-3","vonwright"],["ficedula-hypoleuca","vonwright"]],"ficedula-parva":[["ficedula-parva-2","vonwright"],["ficedula-parva","gould"]],"francolinus-francolinus":[["francolinus-francolinus","gould"]],"fratercula-arctica":[["fratercula-arctica-2","vonwright"],["fratercula-arctica","gould"]],"fringilla-coelebs":[["fringilla-coelebs-2","vonwright"],["fringilla-coelebs-3","vonwright"],["fringilla-coelebs-4","vonwright"],["fringilla-coelebs","gould"]],"fringilla-montifringilla":[["fringilla-montifringilla-2","vonwright"],["fringilla-montifringilla-3","vonwright"],["fringilla-montifringilla-4","vonwright"],["fringilla-montifringilla","gould"]],"fulica-americana":[["fulica-americana","audubon"]],"fulica-atra":[["fulica-atra-2","vonwright"],["fulica-atra-3","vonwright"],["fulica-atra","gould"]],"fulmarus-glacialis":[["fulmarus-glacialis","gould"]],"galerida-cristata":[["galerida-cristata","keulemans"]],"galerida-theklae":[["galerida-theklae","whitaker"]],"gallinago-gallinago":[["gallinago-gallinago-2","gould"],["gallinago-gallinago-3","vonwright"],["gallinago-gallinago","gould"]],"gallinago-media":[["gallinago-media-2","vonwright"],["gallinago-media","gould"]],"gallinula-chloropus":[["gallinula-chloropus-2","vonwright"],["gallinula-chloropus","gould"]],"gallirallus-philippensis":[["gallirallus-philippensis","gould"]],"garrulus-glandarius":[["garrulus-glandarius-2","vonwright"],["garrulus-glandarius","gould"]],"gavia-adamsii":[["gavia-adamsii-2","dresser"],["gavia-adamsii","smit"]],"gavia-arctica":[["gavia-arctica-2","vonwright"],["gavia-arctica-3","vonwright"],["gavia-arctica","gould"]],"gavia-immer":[["gavia-immer-2","vonwright"],["gavia-immer","gould"]],"gavia-stellata":[["gavia-stellata-2","vonwright"],["gavia-stellata-3","vonwright"],["gavia-stellata","gould"]],"gelochelidon-nilotica":[["gelochelidon-nilotica","gould"]],"geokichla-sibirica":[["geokichla-sibirica","gould"]],"geopelia-humeralis":[["geopelia-humeralis","gould"]],"geothlypis-formosa":[["geothlypis-formosa-2","audubon"],["geothlypis-formosa","audubon"]],"geothlypis-trichas":[["geothlypis-trichas","audubon"]],"glareola-pratincola":[["glareola-pratincola","gould"]],"glaucidium-gnoma":[["glaucidium-gnoma","audubon"]],"glaucidium-passerinum":[["glaucidium-passerinum-2","vonwright"],["glaucidium-passerinum","gould"]],"gracupica-nigricollis":[["gracupica-nigricollis","swainson"]],"grallina-cyanoleuca":[["grallina-cyanoleuca","gould"]],"grus-grus":[["grus-grus-2","vonwright"],["grus-grus","gould"]],"grus-virgo":[["grus-virgo","gould"]],"gulosus-aristotelis":[["gulosus-aristotelis-2","vonwright"],["gulosus-aristotelis","gould"]],"gymnogyps-californianus":[["gymnogyps-californianus","audubon"]],"gymnorhina-tibicen":[["gymnorhina-tibicen","gould"]],"gypaetus-barbatus":[["gypaetus-barbatus","gould"]],"gyps-fulvus":[["gyps-fulvus","gould"]],"haematopus-ostralegus":[["haematopus-ostralegus-2","vonwright"],["haematopus-ostralegus","gould"]],"haemorhous-mexicanus":[["haemorhous-mexicanus-2","cassin"],["haemorhous-mexicanus-3","cassin"],["haemorhous-mexicanus","audubon"]],"haemorhous-purpureus":[["haemorhous-purpureus","audubon"]],"haliaeetus-albicilla":[["haliaeetus-albicilla-2","vonwright"],["haliaeetus-albicilla","gould"]],"haliaeetus-leucocephalus":[["haliaeetus-leucocephalus-2","audubon"],["haliaeetus-leucocephalus-3","audubon"],["haliaeetus-leucocephalus-4","audubon"],["haliaeetus-leucocephalus-5","fuertes"],["haliaeetus-leucocephalus","gould"]],"helmitheros-vermivorum":[["helmitheros-vermivorum","audubon"]],"helopsaltes-certhiola":[["helopsaltes-certhiola","gould"]],"hesperiphona-vespertina":[["hesperiphona-vespertina-2","audubon"],["hesperiphona-vespertina-3","fuertes"],["hesperiphona-vespertina","audubon"]],"hieraaetus-pennatus":[["hieraaetus-pennatus","gould"]],"himantopus-himantopus":[["himantopus-himantopus","gould"]],"hippolais-icterina":[["hippolais-icterina-2","desmurs"],["hippolais-icterina","vonwright"]],"hippolais-olivetorum":[["hippolais-olivetorum","gould"]],"hippolais-polyglotta":[["hippolais-polyglotta","desmurs"]],"hirundo-neoxena":[["hirundo-neoxena","gould"]],"hirundo-rustica":[["hirundo-rustica-2","vonwright"],["hirundo-rustica","gould"]],"histrionicus-histrionicus":[["histrionicus-histrionicus","gould"]],"hydrobates-pelagicus":[["hydrobates-pelagicus","gould"]],"hydrocoloeus-minutus":[["hydrocoloeus-minutus-2","vonwright"],["hydrocoloeus-minutus","gould"]],"hydroprogne-caspia":[["hydroprogne-caspia-2","vonwright"],["hydroprogne-caspia","gould"]],"ichthyaetus-audouinii":[["ichthyaetus-audouinii","gould"]],"ichthyaetus-melanocephalus":[["ichthyaetus-melanocephalus","gould"]],"icthyophaga-vocifer":[["icthyophaga-vocifer","levaillant"]],"iduna-opaca":[["iduna-opaca","bree"]],"iduna-pallida":[["iduna-pallida","bree"]],"ixoreus-naevius":[["ixoreus-naevius","audubon"]],"junco-hyemalis":[["junco-hyemalis-2","audubon"],["junco-hyemalis-3","audubon"],["junco-hyemalis-4","audubon"],["junco-hyemalis","audubon"]],"jynx-torquilla":[["jynx-torquilla-2","vonwright"],["jynx-torquilla","gould"]],"lagopus-lagopus":[["lagopus-lagopus-2","gould"],["lagopus-lagopus-3","vonwright"],["lagopus-lagopus-4","vonwright"],["lagopus-lagopus-5","vonwright"],["lagopus-lagopus-6","vonwright"],["lagopus-lagopus","gould"]],"lagopus-muta":[["lagopus-muta-2","gould"],["lagopus-muta-3","vonwright"],["lagopus-muta","gould"]],"lamprotornis-nitens":[["lamprotornis-nitens","levaillant"]],"laniarius-ferrugineus":[["laniarius-ferrugineus","levaillant"]],"lanius-collurio":[["lanius-collurio-2","vonwright"],["lanius-collurio-3","vonwright"],["lanius-collurio-4","vonwright"],["lanius-collurio","gould"]],"lanius-excubitor":[["lanius-excubitor-2","vonwright"],["lanius-excubitor","gould"]],"lanius-meridionalis":[["lanius-meridionalis","gould"]],"lanius-minor":[["lanius-minor","gould"]],"lanius-nubicus":[["lanius-nubicus","dresser"]],"lanius-schach":[["lanius-schach-2","gould"],["lanius-schach-3","jerdon"],["lanius-schach","swainson"]],"lanius-senator":[["lanius-senator","gould"]],"larus-argentatus":[["larus-argentatus-2","vonwright"],["larus-argentatus-3","vonwright"],["larus-argentatus","gould"]],"larus-canus":[["larus-canus-2","vonwright"],["larus-canus-3","vonwright"],["larus-canus","gould"]],"larus-fuscus":[["larus-fuscus-2","vonwright"],["larus-fuscus-3","vonwright"],["larus-fuscus","gould"]],"larus-glaucoides":[["larus-glaucoides-2","vonwright"],["larus-glaucoides","gould"]],"larus-hyperboreus":[["larus-hyperboreus-2","vonwright"],["larus-hyperboreus-3","vonwright"],["larus-hyperboreus","gould"]],"larus-marinus":[["larus-marinus-2","vonwright"],["larus-marinus-3","vonwright"],["larus-marinus","gould"]],"larus-michahellis":[["larus-michahellis","dresser"]],"leucogeranus-leucogeranus":[["leucogeranus-leucogeranus","gould"]],"leuconotopicus-villosus":[["leuconotopicus-villosus-2","audubon"],["leuconotopicus-villosus","fuertes"]],"limosa-lapponica":[["limosa-lapponica-2","vonwright"],["limosa-lapponica","gould"]],"limosa-limosa":[["limosa-limosa","gould"]],"linaria-cannabina":[["linaria-cannabina","vonwright"]],"linaria-flavirostris":[["linaria-flavirostris-2","vonwright"],["linaria-flavirostris","gould"]],"locustella-fluviatilis":[["locustella-fluviatilis","gould"]],"locustella-luscinioides":[["locustella-luscinioides","gould"]],"locustella-naevia":[["locustella-naevia-2","vonwright"],["locustella-naevia","gould"]],"lonchura-punctulata":[["lonchura-punctulata","temminck"]],"lophodytes-cucullatus":[["lophodytes-cucullatus","gould"]],"lophophanes-cristatus":[["lophophanes-cristatus","vonwright"]],"loxia-curvirostra":[["loxia-curvirostra","vonwright"]],"loxia-leucoptera":[["loxia-leucoptera","vonwright"]],"loxia-pytyopsittacus":[["loxia-pytyopsittacus-2","vonwright"],["loxia-pytyopsittacus","vonwright"]],"lullula-arborea":[["lullula-arborea-2","vonwright"],["lullula-arborea","gould"]],"luscinia-luscinia":[["luscinia-luscinia-2","vonwright"],["luscinia-luscinia","gould"]],"luscinia-megarhynchos":[["luscinia-megarhynchos","gould"]],"luscinia-svecica":[["luscinia-svecica-2","vonwright"],["luscinia-svecica","gould"]],"lybius-torquatus":[["lybius-torquatus","keulemans"]],"lymnocryptes-minimus":[["lymnocryptes-minimus-2","vonwright"],["lymnocryptes-minimus-3","vonwright"],["lymnocryptes-minimus","gould"]],"lyrurus-tetrix":[["lyrurus-tetrix-2","vonwright"],["lyrurus-tetrix-3","vonwright"],["lyrurus-tetrix-4","vonwright"],["lyrurus-tetrix-5","vonwright"],["lyrurus-tetrix","gould"]],"lyrurus-tetrix-x-lagopus-lagopus":[["lyrurus-tetrix-x-lagopus-lagopus-2","vonwright"],["lyrurus-tetrix-x-lagopus-lagopus","vonwright"]],"lyrurus-tetrix-x-tetrao-urogallus":[["lyrurus-tetrix-x-tetrao-urogallus-2","vonwright"],["lyrurus-tetrix-x-tetrao-urogallus","gould"]],"lyrurus-tetrix-x-tetrastes-bonasia":[["lyrurus-tetrix-x-tetrastes-bonasia","vonwright"]],"malurus-cyaneus":[["malurus-cyaneus","gould"]],"manorina-melanocephala":[["manorina-melanocephala","gould"]],"manorina-melanophrys":[["manorina-melanophrys","gould"]],"mareca-penelope":[["mareca-penelope-2","vonwright"],["mareca-penelope-3","vonwright"],["mareca-penelope-4","vonwright"],["mareca-penelope","gould"]],"mareca-strepera":[["mareca-strepera-2","vonwright"],["mareca-strepera","gould"]],"megaceryle-alcyon":[["megaceryle-alcyon-2","audubon"],["megaceryle-alcyon","audubon"]],"megascops-asio":[["megascops-asio-2","fuertes"],["megascops-asio-3","fuertes"],["megascops-asio","audubon"]],"megascops-kennicottii":[["megascops-kennicottii","elliot"]],"melanerpes-carolinus":[["melanerpes-carolinus","audubon"]],"melanerpes-erythrocephalus":[["melanerpes-erythrocephalus","audubon"]],"melanitta-fusca":[["melanitta-fusca-2","vonwright"],["melanitta-fusca-3","vonwright"],["melanitta-fusca-4","vonwright"],["melanitta-fusca-5","vonwright"],["melanitta-fusca-6","vonwright"],["melanitta-fusca","gould"]],"melanitta-nigra":[["melanitta-nigra-2","vonwright"],["melanitta-nigra-3","vonwright"],["melanitta-nigra-4","vonwright"],["melanitta-nigra-5","vonwright"],["melanitta-nigra","gould"]],"melanitta-perspicillata":[["melanitta-perspicillata-2","vonwright"],["melanitta-perspicillata","gould"]],"melanocorypha-calandra":[["melanocorypha-calandra","gould"]],"meleagris-gallopavo":[["meleagris-gallopavo","audubon"]],"melospiza-melodia":[["melospiza-melodia","hines"]],"mergellus-albellus":[["mergellus-albellus-2","vonwright"],["mergellus-albellus","gould"]],"mergus-merganser":[["mergus-merganser-2","vonwright"],["mergus-merganser-3","vonwright"],["mergus-merganser","gould"]],"mergus-serrator":[["mergus-serrator-2","vonwright"],["mergus-serrator-3","vonwright"],["mergus-serrator-4","vonwright"],["mergus-serrator","gould"]],"merops-apiaster":[["merops-apiaster","gould"]],"milvus-migrans":[["milvus-migrans","gould"]],"milvus-milvus":[["milvus-milvus-2","vonwright"],["milvus-milvus","gould"]],"mimus-polyglottos":[["mimus-polyglottos-2","audubon"],["mimus-polyglottos","fuertes"]],"molothrus-ater":[["molothrus-ater","fuertes"]],"monarcha-melanopsis":[["monarcha-melanopsis","swainson"]],"monticola-saxatilis":[["monticola-saxatilis-2","naumann"],["monticola-saxatilis-3","dresser"],["monticola-saxatilis","gould"]],"monticola-solitarius":[["monticola-solitarius","gould"]],"montifringilla-nivalis":[["montifringilla-nivalis-2","dresser"],["montifringilla-nivalis","gould"]],"morus-bassanus":[["morus-bassanus-2","gould"],["morus-bassanus-3","vonwright"],["morus-bassanus","gould"]],"motacilla-alba":[["motacilla-alba-2","gould"],["motacilla-alba-3","gould"],["motacilla-alba-4","vonwright"],["motacilla-alba-5","vonwright"],["motacilla-alba-6","vonwright"],["motacilla-alba-7","vonwright"],["motacilla-alba","gould"]],"motacilla-cinerea":[["motacilla-cinerea","gould"]],"motacilla-citreola":[["motacilla-citreola","gould"]],"motacilla-flava":[["motacilla-flava-2","gould"],["motacilla-flava-3","vonwright"],["motacilla-flava-4","vonwright"],["motacilla-flava","gould"]],"muscicapa-striata":[["muscicapa-striata-2","vonwright"],["muscicapa-striata","gould"]],"myadestes-townsendi":[["myadestes-townsendi","audubon"]],"myiarchus-crinitus":[["myiarchus-crinitus-2","fuertes"],["myiarchus-crinitus","audubon"]],"myiopsitta-monachus":[["myiopsitta-monachus","greene"]],"myzomela-sanguinolenta":[["myzomela-sanguinolenta","gould"]],"neophron-percnopterus":[["neophron-percnopterus","gould"]],"netta-rufina":[["netta-rufina-2","vonwright"],["netta-rufina","gould"]],"ninox-boobook":[["ninox-boobook","gould"]],"nucifraga-caryocatactes":[["nucifraga-caryocatactes-2","vonwright"],["nucifraga-caryocatactes-3","vonwright"],["nucifraga-caryocatactes","gould"]],"numenius-arquata":[["numenius-arquata-2","vonwright"],["numenius-arquata","gould"]],"numenius-phaeopus":[["numenius-phaeopus-2","vonwright"],["numenius-phaeopus-3","vonwright"],["numenius-phaeopus","gould"]],"numenius-tenuirostris":[["numenius-tenuirostris","gould"]],"nycticorax-nycticorax":[["nycticorax-nycticorax","gould"]],"nymphicus-hollandicus":[["nymphicus-hollandicus-2","keulemans"],["nymphicus-hollandicus-3","lear"],["nymphicus-hollandicus","gould"]],"ocyphaps-lophotes":[["ocyphaps-lophotes","gould"]],"oenanthe-hispanica":[["oenanthe-hispanica-2","gould"],["oenanthe-hispanica","gould"]],"oenanthe-isabellina":[["oenanthe-isabellina-2","bree"],["oenanthe-isabellina","dresser"]],"oenanthe-leucura":[["oenanthe-leucura","gould"]],"oenanthe-melanoleuca":[["oenanthe-melanoleuca","dresser"]],"oenanthe-oenanthe":[["oenanthe-oenanthe-2","vonwright"],["oenanthe-oenanthe","gould"]],"oenanthe-pleschanka":[["oenanthe-pleschanka","gould"]],"onychognathus-morio":[["onychognathus-morio-2","levaillant"],["onychognathus-morio","levaillant"]],"oriolus-oriolus":[["oriolus-oriolus-2","vonwright"],["oriolus-oriolus","gould"]],"oriolus-sagittatus":[["oriolus-sagittatus","gould"]],"orthotomus-sutorius":[["orthotomus-sutorius","gould"]],"otus-scops":[["otus-scops","gould"]],"pagophila-eburnea":[["pagophila-eburnea","vonwright"]],"pandion-haliaetus":[["pandion-haliaetus-2","vonwright"],["pandion-haliaetus","gould"]],"panurus-biarmicus":[["panurus-biarmicus","dresser"]],"pardalotus-punctatus":[["pardalotus-punctatus","gould"]],"parus-cinereus":[["parus-cinereus","gould"]],"parus-major":[["parus-major-2","vonwright"],["parus-major-3","vonwright"],["parus-major","gould"]],"parus-minor":[["parus-minor-2","siebold"],["parus-minor","gould"]],"passer-domesticus":[["passer-domesticus-2","vonwright"],["passer-domesticus","vonwright"]],"passer-hispaniolensis":[["passer-hispaniolensis-2","dresser"],["passer-hispaniolensis","dresser"]],"passer-italiae":[["passer-italiae-2","dresser"],["passer-italiae","gould"]],"passer-melanurus":[["passer-melanurus","gordon"]],"passer-montanus":[["passer-montanus","vonwright"]],"passerculus-sandwichensis":[["passerculus-sandwichensis","fuertes"]],"passerella-iliaca":[["passerella-iliaca","audubon"]],"passerina-caerulea":[["passerina-caerulea","audubon"]],"passerina-ciris":[["passerina-ciris","audubon"]],"passerina-cyanea":[["passerina-cyanea","audubon"]],"pastor-roseus":[["pastor-roseus","gould"]],"pavo-cristatus":[["pavo-cristatus-2","elliot"],["pavo-cristatus","barbiers"]],"pelecanus-crispus":[["pelecanus-crispus","gould"]],"pellorneum-rostratum":[["pellorneum-rostratum","keulemans"]],"perdix-perdix":[["perdix-perdix-2","vonwright"],["perdix-perdix-3","vonwright"],["perdix-perdix","gould"]],"periparus-ater":[["periparus-ater-2","vonwright"],["periparus-ater","vonwright"]],"perisoreus-infaustus":[["perisoreus-infaustus-2","vonwright"],["perisoreus-infaustus","gould"]],"pernis-apivorus":[["pernis-apivorus-2","vonwright"],["pernis-apivorus","gould"]],"petrochelidon-pyrrhonota":[["petrochelidon-pyrrhonota","sharpe"]],"petroica-rosea":[["petroica-rosea","gould"]],"petronia-petronia":[["petronia-petronia-2","dresser"],["petronia-petronia","gould"]],"phalacrocorax-carbo":[["phalacrocorax-carbo-2","vonwright"],["phalacrocorax-carbo-3","vonwright"],["phalacrocorax-carbo","gould"]],"phalaropus-fulicarius":[["phalaropus-fulicarius-2","vonwright"],["phalaropus-fulicarius","gould"]],"phalaropus-lobatus":[["phalaropus-lobatus-2","vonwright"],["phalaropus-lobatus","gould"]],"phasianus-colchicus":[["phasianus-colchicus-2","vonwright"],["phasianus-colchicus-3","vonwright"],["phasianus-colchicus","gould"]],"pheucticus-ludovicianus":[["pheucticus-ludovicianus-2","audubon"],["pheucticus-ludovicianus-3","audubon"],["pheucticus-ludovicianus","audubon"]],"pheucticus-melanocephalus":[["pheucticus-melanocephalus-2","audubon"],["pheucticus-melanocephalus","audubon"]],"philemon-citreogularis":[["philemon-citreogularis","gould"]],"phoenicopterus-roseus":[["phoenicopterus-roseus","gould"]],"phoenicurus-auroreus":[["phoenicurus-auroreus-2","arnoul"],["phoenicurus-auroreus","siebold"]],"phoenicurus-ochruros":[["phoenicurus-ochruros-2","vonwright"],["phoenicurus-ochruros","gould"]],"phoenicurus-phoenicurus":[["phoenicurus-phoenicurus","gould"]],"phylloscopus-bonelli":[["phylloscopus-bonelli","bree"]],"phylloscopus-collybita":[["phylloscopus-collybita-2","gould"],["phylloscopus-collybita-3","vonwright"],["phylloscopus-collybita","vonwright"]],"phylloscopus-humei":[["phylloscopus-humei","keulemans"]],"phylloscopus-inornatus":[["phylloscopus-inornatus-2","dresser"],["phylloscopus-inornatus","dresser"]],"phylloscopus-proregulus":[["phylloscopus-proregulus","gould"]],"phylloscopus-sibilatrix":[["phylloscopus-sibilatrix","vonwright"]],"phylloscopus-trochiloides":[["phylloscopus-trochiloides","dresser"]],"phylloscopus-trochilus":[["phylloscopus-trochilus-2","vonwright"],["phylloscopus-trochilus-3","vonwright"],["phylloscopus-trochilus","gould"]],"pica-hudsonia":[["pica-hudsonia-2","audubon"],["pica-hudsonia","audubon"]],"pica-pica":[["pica-pica-2","vonwright"],["pica-pica","gould"]],"pica-serica":[["pica-serica","npm"]],"picoides-tridactylus":[["picoides-tridactylus-2","vonwright"],["picoides-tridactylus-3","vonwright"],["picoides-tridactylus","gould"]],"picus-canus":[["picus-canus-2","vonwright"],["picus-canus","gould"]],"picus-sharpei":[["picus-sharpei","dresser"]],"picus-viridis":[["picus-viridis-2","vonwright"],["picus-viridis","gould"]],"pinguinus-impennis":[["pinguinus-impennis","gould"]],"pinicola-enucleator":[["pinicola-enucleator-2","vonwright"],["pinicola-enucleator","gould"]],"pipilo-erythrophthalmus":[["pipilo-erythrophthalmus","vieillot"]],"pipilo-maculatus":[["pipilo-maculatus","jardine"]],"piranga-ludoviciana":[["piranga-ludoviciana-2","audubon"],["piranga-ludoviciana-3","audubon"],["piranga-ludoviciana","audubon"]],"piranga-olivacea":[["piranga-olivacea","prang"]],"piranga-rubra":[["piranga-rubra-2","audubon"],["piranga-rubra","audubon"]],"pitangus-sulphuratus":[["pitangus-sulphuratus-2","wolf"],["pitangus-sulphuratus-3","descourtilz"],["pitangus-sulphuratus","martinet"]],"pitta-versicolor":[["pitta-versicolor","gould"]],"platalea-leucorodia":[["platalea-leucorodia","gould"]],"platycercus-elegans":[["platycercus-elegans","gould"]],"platycercus-eximius":[["platycercus-eximius","gould"]],"plectrophenax-nivalis":[["plectrophenax-nivalis-2","vonwright"],["plectrophenax-nivalis-3","vonwright"],["plectrophenax-nivalis","vonwright"]],"plegadis-falcinellus":[["plegadis-falcinellus","gould"]],"ploceus-capensis":[["ploceus-capensis","hahn"]],"ploceus-cucullatus":[["ploceus-cucullatus","smith"]],"ploceus-velatus":[["ploceus-velatus","smith"]],"pluvialis-apricaria":[["pluvialis-apricaria-2","vonwright"],["pluvialis-apricaria-3","vonwright"],["pluvialis-apricaria","gould"]],"pluvialis-squatarola":[["pluvialis-squatarola-2","vonwright"],["pluvialis-squatarola","gould"]],"podargus-strigoides":[["podargus-strigoides","gould"]],"podiceps-auritus":[["podiceps-auritus-2","vonwright"],["podiceps-auritus-3","vonwright"],["podiceps-auritus-4","vonwright"],["podiceps-auritus","gould"]],"podiceps-cristatus":[["podiceps-cristatus-2","vonwright"],["podiceps-cristatus-3","vonwright"],["podiceps-cristatus","gould"]],"podiceps-grisegena":[["podiceps-grisegena-2","vonwright"],["podiceps-grisegena-3","vonwright"],["podiceps-grisegena","gould"]],"podiceps-nigricollis":[["podiceps-nigricollis","gould"]],"poecile-atricapillus":[["poecile-atricapillus-2","hines"],["poecile-atricapillus","hines"]],"poecile-carolinensis":[["poecile-carolinensis-2","fuertes"],["poecile-carolinensis","audubon"]],"poecile-cinctus":[["poecile-cinctus-2","gould"],["poecile-cinctus","vonwright"]],"poecile-gambeli":[["poecile-gambeli","dawson"]],"poecile-lugubris":[["poecile-lugubris","gould"]],"poecile-montanus":[["poecile-montanus","vonwright"]],"poecile-palustris":[["poecile-palustris-2","vonwright"],["poecile-palustris","vonwright"]],"poecile-rufescens":[["poecile-rufescens","fuertes"]],"polioptila-caerulea":[["polioptila-caerulea-2","audubon"],["polioptila-caerulea","audubon"]],"polysticta-stelleri":[["polysticta-stelleri-2","vonwright"],["polysticta-stelleri-3","vonwright"],["polysticta-stelleri","gould"]],"pooecetes-gramineus":[["pooecetes-gramineus","fuertes"]],"porphyrio-porphyrio":[["porphyrio-porphyrio","gould"]],"porzana-porzana":[["porzana-porzana-2","vonwright"],["porzana-porzana","gould"]],"prinia-flaviventris":[["prinia-flaviventris","keulemans"]],"prinia-inornata":[["prinia-inornata-2","legge"],["prinia-inornata","keulemans"]],"prunella-collaris":[["prunella-collaris","gould"]],"prunella-modularis":[["prunella-modularis-2","vonwright"],["prunella-modularis","gould"]],"prunella-montanella":[["prunella-montanella","gould"]],"psaltriparus-minimus":[["psaltriparus-minimus-2","fuertes"],["psaltriparus-minimus-3","ridgway"],["psaltriparus-minimus","audubon"]],"psiloscops-flammeolus":[["psiloscops-flammeolus","sclater"]],"psittacula-krameri":[["psittacula-krameri","keulemans"]],"pternistis-swainsonii":[["pternistis-swainsonii","finchdavies"]],"pterocles-alchata":[["pterocles-alchata","gould"]],"pterocles-orientalis":[["pterocles-orientalis","gould"]],"pterorhinus-perspicillatus":[["pterorhinus-perspicillatus-2","arnoul"],["pterorhinus-perspicillatus","cassin"]],"ptyonoprogne-rupestris":[["ptyonoprogne-rupestris","gould"]],"puffinus-puffinus":[["puffinus-puffinus","gould"]],"pycnonotus-aurigaster":[["pycnonotus-aurigaster-2","arnoul"],["pycnonotus-aurigaster","cassin"]],"pycnonotus-barbatus":[["pycnonotus-barbatus","keulemans"]],"pycnonotus-jocosus":[["pycnonotus-jocosus-2","collins"],["pycnonotus-jocosus-3","edwards"],["pycnonotus-jocosus","gwillim"]],"pycnonotus-sinensis":[["pycnonotus-sinensis-2","prevost"],["pycnonotus-sinensis","gould"]],"pyrrhocorax-graculus":[["pyrrhocorax-graculus","gould"]],"pyrrhocorax-pyrrhocorax":[["pyrrhocorax-pyrrhocorax","gould"]],"pyrrhula-pyrrhula":[["pyrrhula-pyrrhula-2","gould"],["pyrrhula-pyrrhula-3","vonwright"],["pyrrhula-pyrrhula-4","vonwright"],["pyrrhula-pyrrhula-5","vonwright"],["pyrrhula-pyrrhula-6","vonwright"],["pyrrhula-pyrrhula-7","vonwright"],["pyrrhula-pyrrhula","gould"]],"quiscalus-quiscula":[["quiscalus-quiscula","vieillot"]],"rallus-aquaticus":[["rallus-aquaticus-2","vonwright"],["rallus-aquaticus","gould"]],"recurvirostra-avosetta":[["recurvirostra-avosetta-2","vonwright"],["recurvirostra-avosetta","gould"]],"regulus-ignicapilla":[["regulus-ignicapilla","gould"]],"regulus-regulus":[["regulus-regulus-2","vonwright"],["regulus-regulus","vonwright"]],"regulus-satrapa":[["regulus-satrapa","audubon"]],"remiz-pendulinus":[["remiz-pendulinus","dresser"]],"rhipidura-leucophrys":[["rhipidura-leucophrys","gould"]],"riparia-riparia":[["riparia-riparia-2","vonwright"],["riparia-riparia-3","vonwright"],["riparia-riparia","gould"]],"rissa-tridactyla":[["rissa-tridactyla-2","vonwright"],["rissa-tridactyla-3","vonwright"],["rissa-tridactyla","gould"]],"saxicola-rubetra":[["saxicola-rubetra-2","vonwright"],["saxicola-rubetra-3","vonwright"],["saxicola-rubetra-4","vonwright"],["saxicola-rubetra","gould"]],"saxicola-rubicola":[["saxicola-rubicola-2","gould"],["saxicola-rubicola","gould"]],"sayornis-nigricans":[["sayornis-nigricans","swainson"]],"sayornis-phoebe":[["sayornis-phoebe","fuertes"]],"sayornis-saya":[["sayornis-saya","audubon"]],"scolopax-rusticola":[["scolopax-rusticola-2","vonwright"],["scolopax-rusticola-3","vonwright"],["scolopax-rusticola","gould"]],"scythrops-novaehollandiae":[["scythrops-novaehollandiae","gould"]],"selasphorus-platycercus":[["selasphorus-platycercus-2","swainson"],["selasphorus-platycercus","swainson"]],"selasphorus-rufus":[["selasphorus-rufus","audubon"]],"serinus-serinus":[["serinus-serinus","gould"]],"setophaga-citrina":[["setophaga-citrina-2","audubon"],["setophaga-citrina-3","audubon"],["setophaga-citrina","audubon"]],"setophaga-coronata":[["setophaga-coronata-2","audubon"],["setophaga-coronata-3","fuertes"],["setophaga-coronata","audubon"]],"setophaga-magnolia":[["setophaga-magnolia","fuertes"]],"setophaga-palmarum":[["setophaga-palmarum","fuertes"]],"setophaga-petechia":[["setophaga-petechia","audubon"]],"setophaga-pinus":[["setophaga-pinus","fuertes"]],"setophaga-ruticilla":[["setophaga-ruticilla","fuertes"]],"setophaga-virens":[["setophaga-virens","audubon"]],"sialia-currucoides":[["sialia-currucoides-2","audubon"],["sialia-currucoides","audubon"]],"sialia-sialis":[["sialia-sialis-2","audubon"],["sialia-sialis","audubon"]],"sitta-canadensis":[["sitta-canadensis","audubon"]],"sitta-carolinensis":[["sitta-carolinensis","audubon"]],"sitta-europaea":[["sitta-europaea-2","vonwright"],["sitta-europaea","gould"]],"sitta-neumayer":[["sitta-neumayer","gould"]],"sitta-pusilla":[["sitta-pusilla-2","audubon"],["sitta-pusilla","audubon"]],"sitta-pygmaea":[["sitta-pygmaea","audubon"]],"somateria-mollissima":[["somateria-mollissima-2","vonwright"],["somateria-mollissima-3","vonwright"],["somateria-mollissima-4","vonwright"],["somateria-mollissima-5","vonwright"],["somateria-mollissima-6","vonwright"],["somateria-mollissima","gould"]],"somateria-spectabilis":[["somateria-spectabilis-2","vonwright"],["somateria-spectabilis","gould"]],"spatula-clypeata":[["spatula-clypeata","gould"]],"spatula-cyanoptera":[["spatula-cyanoptera","vonwright"]],"spatula-querquedula":[["spatula-querquedula-2","vonwright"],["spatula-querquedula","gould"]],"sphecotheres-vieilloti":[["sphecotheres-vieilloti","gould"]],"sphyrapicus-varius":[["sphyrapicus-varius-2","audubon"],["sphyrapicus-varius","fuertes"]],"spilopelia-chinensis":[["spilopelia-chinensis","knip"]],"spilopelia-senegalensis":[["spilopelia-senegalensis","levaillant"]],"spinus-pinus":[["spinus-pinus","audubon"]],"spinus-psaltria":[["spinus-psaltria","audubon"]],"spinus-spinus":[["spinus-spinus-2","vonwright"],["spinus-spinus-3","vonwright"],["spinus-spinus-4","vonwright"],["spinus-spinus","gould"]],"spinus-tristis":[["spinus-tristis","audubon"]],"spizella-passerina":[["spizella-passerina-2","prang"],["spizella-passerina","fuertes"]],"spizelloides-arborea":[["spizelloides-arborea-2","audubon"],["spizelloides-arborea","audubon"]],"spodiopsar-cineraceus":[["spodiopsar-cineraceus","siebold"]],"stercorarius-longicaudus":[["stercorarius-longicaudus","vonwright"]],"stercorarius-parasiticus":[["stercorarius-parasiticus-2","gould"],["stercorarius-parasiticus-3","vonwright"],["stercorarius-parasiticus-4","vonwright"],["stercorarius-parasiticus","gould"]],"stercorarius-pomarinus":[["stercorarius-pomarinus-2","vonwright"],["stercorarius-pomarinus","gould"]],"stercorarius-skua":[["stercorarius-skua-2","vonwright"],["stercorarius-skua","gould"]],"sterna-dougallii":[["sterna-dougallii","gould"]],"sterna-hirundo":[["sterna-hirundo-2","vonwright"],["sterna-hirundo","gould"]],"sterna-paradisaea":[["sterna-paradisaea-2","vonwright"],["sterna-paradisaea","gould"]],"sternula-albifrons":[["sternula-albifrons-2","vonwright"],["sternula-albifrons","gould"]],"strepera-graculina":[["strepera-graculina","gould"]],"streptopelia-decaocto":[["streptopelia-decaocto","keulemans"]],"streptopelia-orientalis":[["streptopelia-orientalis","vonwright"]],"streptopelia-semitorquata":[["streptopelia-semitorquata","ruppell"]],"streptopelia-turtur":[["streptopelia-turtur","gould"]],"strix-aluco":[["strix-aluco-2","vonwright"],["strix-aluco","gould"]],"strix-nebulosa":[["strix-nebulosa","gould"]],"strix-uralensis":[["strix-uralensis-2","vonwright"],["strix-uralensis","gould"]],"strix-varia":[["strix-varia","gould"]],"sturnella-neglecta":[["sturnella-neglecta-2","audubon"],["sturnella-neglecta","dawson"]],"sturnus-unicolor":[["sturnus-unicolor-2","gould"],["sturnus-unicolor-3","gould"],["sturnus-unicolor","gould"]],"sturnus-vulgaris":[["sturnus-vulgaris-2","vonwright"],["sturnus-vulgaris-3","vonwright"],["sturnus-vulgaris","gould"]],"surnia-ulula":[["surnia-ulula-2","vonwright"],["surnia-ulula","gould"]],"suthora-webbiana":[["suthora-webbiana-2","wolf"],["suthora-webbiana","gould"]],"sylvia-atricapilla":[["sylvia-atricapilla","gould"]],"sylvia-borin":[["sylvia-borin-2","vonwright"],["sylvia-borin","vonwright"]],"tachybaptus-ruficollis":[["tachybaptus-ruficollis","gould"]],"tachycineta-thalassina":[["tachycineta-thalassina","audubon"]],"tachymarptis-melba":[["tachymarptis-melba","gould"]],"tachyspiza-fasciata":[["tachyspiza-fasciata","gould"]],"tadorna-ferruginea":[["tadorna-ferruginea","gould"]],"tadorna-tadorna":[["tadorna-tadorna-2","vonwright"],["tadorna-tadorna","gould"]],"tarsiger-cyanurus":[["tarsiger-cyanurus","dresser"]],"tetrao-urogallus":[["tetrao-urogallus-2","vonwright"],["tetrao-urogallus-3","vonwright"],["tetrao-urogallus-4","vonwright"],["tetrao-urogallus","gould"]],"tetrao-urogallus-x-lagopus-lagopus":[["tetrao-urogallus-x-lagopus-lagopus","vonwright"]],"tetrastes-bonasia":[["tetrastes-bonasia-2","vonwright"],["tetrastes-bonasia-3","vonwright"],["tetrastes-bonasia-4","vonwright"],["tetrastes-bonasia-5","vonwright"],["tetrastes-bonasia-6","vonwright"],["tetrastes-bonasia","gould"]],"tetrax-tetrax":[["tetrax-tetrax-2","vonwright"],["tetrax-tetrax","gould"]],"thalasseus-sandvicensis":[["thalasseus-sandvicensis-2","vonwright"],["thalasseus-sandvicensis","gould"]],"thinornis-dubius":[["thinornis-dubius-2","vonwright"],["thinornis-dubius-3","vonwright"],["thinornis-dubius","gould"]],"threskiornis-molucca":[["threskiornis-molucca","keulemans"]],"thryomanes-bewickii":[["thryomanes-bewickii-2","reed"],["thryomanes-bewickii","audubon"]],"thryothorus-ludovicianus":[["thryothorus-ludovicianus-2","fuertes"],["thryothorus-ludovicianus","audubon"]],"tichodroma-muraria":[["tichodroma-muraria-2","bree"],["tichodroma-muraria-3","werner"],["tichodroma-muraria","dresser"]],"todiramphus-sanctus":[["todiramphus-sanctus-2","gould"],["todiramphus-sanctus","gould"]],"toxostoma-rufum":[["toxostoma-rufum-2","fuertes"],["toxostoma-rufum","audubon"]],"trachyphonus-vaillantii":[["trachyphonus-vaillantii","keulemans"]],"trichoglossus-chlorolepidotus":[["trichoglossus-chlorolepidotus","gould"]],"trichoglossus-concinnus":[["trichoglossus-concinnus","gould"]],"trichoglossus-moluccanus":[["trichoglossus-moluccanus","gould"]],"tringa-erythropus":[["tringa-erythropus-2","vonwright"],["tringa-erythropus-3","vonwright"],["tringa-erythropus","gould"]],"tringa-glareola":[["tringa-glareola","vonwright"]],"tringa-nebularia":[["tringa-nebularia-2","vonwright"],["tringa-nebularia-3","vonwright"],["tringa-nebularia","gould"]],"tringa-ochropus":[["tringa-ochropus-2","vonwright"],["tringa-ochropus-3","vonwright"],["tringa-ochropus","gould"]],"tringa-stagnatilis":[["tringa-stagnatilis","gould"]],"tringa-totanus":[["tringa-totanus-2","vonwright"],["tringa-totanus","gould"]],"troglodytes-aedon":[["troglodytes-aedon","swainson"]],"troglodytes-pacificus":[["troglodytes-pacificus","keulemans"]],"troglodytes-troglodytes":[["troglodytes-troglodytes-2","vonwright"],["troglodytes-troglodytes","gould"]],"turdus-atrogularis":[["turdus-atrogularis","gould"]],"turdus-iliacus":[["turdus-iliacus-2","vonwright"],["turdus-iliacus-3","vonwright"],["turdus-iliacus","gould"]],"turdus-mandarinus":[["turdus-mandarinus","keulemans"]],"turdus-merula":[["turdus-merula-2","vonwright"],["turdus-merula-3","vonwright"],["turdus-merula-4","vonwright"],["turdus-merula","gould"]],"turdus-migratorius":[["turdus-migratorius","gould"]],"turdus-naumanni":[["turdus-naumanni","gould"]],"turdus-olivaceus":[["turdus-olivaceus-2","levaillant"],["turdus-olivaceus","levaillant"]],"turdus-pallidus":[["turdus-pallidus","gould"]],"turdus-philomelos":[["turdus-philomelos-2","vonwright"],["turdus-philomelos","vonwright"]],"turdus-pilaris":[["turdus-pilaris","vonwright"]],"turdus-smithi":[["turdus-smithi","smith"]],"turdus-torquatus":[["turdus-torquatus","gould"]],"turdus-viscivorus":[["turdus-viscivorus-2","vonwright"],["turdus-viscivorus","gould"]],"turnix-sylvaticus":[["turnix-sylvaticus","gould"]],"tyrannus-tyrannus":[["tyrannus-tyrannus","fuertes"]],"tyto-alba":[["tyto-alba-2","vonwright"],["tyto-alba","gould"]],"upupa-epops":[["upupa-epops-2","vonwright"],["upupa-epops-3","vonwright"],["upupa-epops","gould"]],"uria-aalge":[["uria-aalge-2","vonwright"],["uria-aalge","gould"]],"uria-lomvia":[["uria-lomvia","gould"]],"urocolius-indicus":[["urocolius-indicus","levaillant"]],"vanellus-miles":[["vanellus-miles","gould"]],"vanellus-spinosus":[["vanellus-spinosus","gould"]],"vanellus-vanellus":[["vanellus-vanellus-2","vonwright"],["vanellus-vanellus-3","vonwright"],["vanellus-vanellus","gould"]],"vidua-macroura":[["vidua-macroura","gordon"]],"vireo-griseus":[["vireo-griseus","audubon"]],"vireo-solitarius":[["vireo-solitarius","audubon"]],"xema-sabini":[["xema-sabini","gould"]],"xenus-cinereus":[["xenus-cinereus","gould"]],"zanda-funerea":[["zanda-funerea","gould"]],"zapornia-parva":[["zapornia-parva-2","vonwright"],["zapornia-parva","gould"]],"zapornia-pusilla":[["zapornia-pusilla","gould"]],"zenaida-macroura":[["zenaida-macroura","audubon"]],"zonotrichia-albicollis":[["zonotrichia-albicollis","audubon"]],"zonotrichia-atricapilla":[["zonotrichia-atricapilla","audubon"]],"zonotrichia-leucophrys":[["zonotrichia-leucophrys","audubon"]],"zoothera-aurea":[["zoothera-aurea","gould"]],"zosterops-simplex":[["zosterops-simplex","gould"]],"zosterops-virens":[["zosterops-virens","levaillant"]],"birch-twig":[["birch-twig","michaux"]],"blackthorn-branch":[["blackthorn-branch","palmstruch"]],"cherry-branch":[["cherry-branch","koehler"]],"hawthorn-branch":[["hawthorn-branch","palmstruch"]],"jack-pine-bough":[["jack-pine-bough","michaux"]],"juniper-sprig":[["juniper-sprig","koehler"]],"oak-shoot":[["oak-shoot","palmstruch"]],"pine-bough":[["pine-bough","koehler"]],"spruce-bough":[["spruce-bough","koehler"]]},"artists":{"vonwright":"von Wright brothers","gould":"John Gould","dresser":"H. E. Dresser","keulemans":"J. G. Keulemans","gronvold":"Henrik Grönvold","morris":"Beverley R. Morris","greene":"W. T. Greene","dorbigny":"Charles Henry Dessalines d'Orbigny","desmurs":"Marc Athanase Parfait Œillet Des Murs","bree":"Charles Robert Bree","whitaker":"Joseph I. S. Whitaker","audubon":"John James Audubon","naumann":"Johann Friedrich Naumann","fuertes":"Louis Agassiz Fuertes","hines":"Bob Hines","cassin":"John Cassin","finchdavies":"Boyd Horsbrugh","levaillant":"François Levaillant","ruppell":"Eduard Rüppell","legge":"W. Vincent Legge","vieillot":"Louis Pierre Vieillot","sclater":"Philip Lutley Sclater","elliot":"Daniel Giraud Elliot","dawson":"William Leon Dawson","werner":"Jean-Charles Werner","swainson":"William Swainson","sharpe":"Richard Bowdler Sharpe","jardine":"William Jardine","gordon":"Gordon Atlas","lesson":"René Primevère Lesson","gwillim":"Elizabeth Gwillim","collins":"Charles Collins","edwards":"George Edwards","knip":"Pauline Knip","prevost":"Florent Prévost","siebold":"Philipp Franz von Siebold","arnoul":"Arnoul","temminck":"Coenraad Jacob Temminck","martinet":"Buffon","madarasz":"Gyula Madarász","smith":"Andrew Smith","hahn":"Carl Wilhelm Hahn","barbiers":"Pieter Barbiers","lear":"Edward Lear","prang":"Louis Prang","ridgway":"Robert Ridgway","bonaparte":"Charles Lucien Bonaparte","smit":"Joseph Smit","emory":"William H. Emory","reed":"Chester A. Reed","wolf":"Joseph Wolf","descourtilz":"Jean Théodore Descourtilz","jerdon":"T. C. Jerdon","npm":"Yu Sheng","horsfield":"Thomas Horsfield","koehler":"Franz Eugen Köhler","palmstruch":"Johan Wilhelm Palmstruch","michaux":"François André Michaux"},"aliases":{"Accipiter badius":"Tachyspiza badia","Accipiter bicolor":"Astur bicolor","Accipiter cirrocephalus":"Tachyspiza cirrocephala","Accipiter cooperii":"Astur cooperii","Accipiter fasciatus":"Tachyspiza fasciata","Accipiter gentilis":"Astur gentilis","Accipiter gularis":"Tachyspiza gularis","Accipiter hiogaster":"Tachyspiza hiogaster","Accipiter melanoleucus":"Astur melanoleucus","Accipiter minullus":"Tachyspiza minulla","Accipiter novaehollandiae":"Tachyspiza novaehollandiae","Accipiter soloensis":"Tachyspiza soloensis","Accipiter superciliosus":"Microspizias superciliosus","Accipiter tachiro":"Aerospiza tachiro","Accipiter trinotatus":"Tachyspiza trinotata","Accipiter trivirgatus":"Lophospiza trivirgata","Accipiter virgatus":"Tachyspiza virgata","Alophoixus finschii":"Iole finschii","Amblyornis newtoniana":"Prionodura newtoniana","Anthropoides paradiseus":"Grus paradiseus","Anthropoides virgo":"Grus virgo","Anthus lutescens":"Anthus chii","Antilophia bokermanni":"Chiroxiphia bokermanni","Antilophia galeata":"Chiroxiphia galeata","Anurolimnas fasciatus":"Rufirallus fasciatus","Anurolimnas viridis":"Rufirallus viridis","Apus melba":"Tachymarptis melba","Basileuterus lachrymosus":"Euthlypis lachrymosa","Brachypodius eutilotus":"Microtarsus eutilotus","Brachypodius melanocephalos":"Microtarsus melanocephalos","Brachypodius melanoleucos":"Microtarsus melanoleucos","Brachypodius priocephalus":"Microtarsus priocephalus","Brachypodius urostictus":"Microtarsus urostictus","Bubo coromandus":"Ketupa coromanda","Bubo lacteus":"Ketupa lactea","Bubo nipalensis":"Ketupa nipalensis","Bubo sumatranus":"Ketupa sumatrana","Bubulcus ibis":"Ardea ibis","Buceros vigil":"Rhinoplax vigil","Buphagus erythrorynchus":"Buphagus erythroryncha","Burhinus bistriatus":"Hesperoburhinus bistriatus","Burhinus superciliaris":"Hesperoburhinus superciliaris","Cacomantis pallidus":"Heteroscenes pallidus","Calocitta colliei":"Cyanocorax colliei","Calocitta formosa":"Cyanocorax formosus","Calyptorhynchus funereus":"Zanda funerea","Calyptorhynchus latirostris":"Zanda latirostris","Campethera cailliautii":"Campethera maculosa","Cercotrichas barbata":"Tychaedon barbata","Cercotrichas coryphoeus":"Tychaedon coryphoeus","Cercotrichas quadrivirgata":"Tychaedon quadrivirgata","Cercotrichas signata":"Tychaedon signata","Charadrius alexandrinus":"Anarhynchus alexandrinus","Charadrius bicinctus":"Anarhynchus bicinctus","Charadrius collaris":"Anarhynchus collaris","Charadrius dubius":"Thinornis dubius","Charadrius falklandicus":"Anarhynchus falklandicus","Charadrius javanicus":"Anarhynchus javanicus","Charadrius leschenaultii":"Anarhynchus leschenaultii","Charadrius modestus":"Zonibyx modestus","Charadrius montanus":"Anarhynchus montanus","Charadrius morinellus":"Eudromias morinellus","Charadrius nivosus":"Anarhynchus nivosus","Charadrius peronii":"Anarhynchus peronii","Charadrius placidus":"Thinornis placidus","Charadrius tricollaris":"Thinornis tricollaris","Charadrius veredus":"Anarhynchus veredus","Charadrius wilsonia":"Anarhynchus wilsonia","Chloropicus fuscescens":"Dendropicos fuscescens","Chloropicus goertae":"Dendropicos goertae","Chloropicus griseocephalus":"Dendropicos griseocephalus","Chloropicus spodocephalus":"Dendropicos spodocephalus","Cholornis unicolor":"Paradoxornis unicolor","Chrysococcyx basalis":"Chalcites basalis","Chrysococcyx lucidus":"Chalcites lucidus","Chrysococcyx osculans":"Chalcites osculans","Ciccaba albitarsis":"Strix albitarsis","Ciccaba huhula":"Strix huhula","Ciccaba nigrolineata":"Strix nigrolineata","Ciccaba virgata":"Strix virgata","Cicinnurus magnificus":"Diphyllodes magnificus","Cicinnurus respublica":"Diphyllodes respublica","Clytolaema rubricauda":"Heliodoxa rubricauda","Coccothraustes abeillei":"Hesperiphona abeillei","Coccothraustes vespertinus":"Hesperiphona vespertina","Columba larvata":"Aplopelia larvata","Conostoma aemodium":"Paradoxornis aemodius","Coracina caesia":"Ceblepyris caesius","Coracina cinerea":"Ceblepyris cinereus","Coracina pectoralis":"Ceblepyris pectoralis","Corvus dauuricus":"Coloeus dauuricus","Corvus monedula":"Coloeus monedula","Corythaixoides concolor":"Crinifer concolor","Corythaixoides leucogaster":"Crinifer leucogaster","Cossypha anomala":"Dessonornis anomalus","Cossypha archeri":"Dessonornis archeri","Cossypha caffra":"Dessonornis caffer","Cossypha humeralis":"Dessonornis humeralis","Cossypha polioptera":"Sheppardia polioptera","Cracticus quoyi":"Melloria quoyi","Cranioleuca gutturata":"Thripophaga gutturata","Crateroscelis murina":"Origma murina","Crateroscelis robusta":"Origma robusta","Cyornis concretus":"Leucoptilon concretum","Cyornis hoevelli":"Eumyias hoevelli","Dicaeum agile":"Pachyglossa agilis","Dicaeum chrysorrheum":"Pachyglossa chrysorrhea","Dicrurus divaricatus":"Dicrurus adsimilis","Dinopium rafflesii":"Gecinulus rafflesii","Dryobates affinis":"Veniliornis affinis","Dryobates albolarvatus":"Leuconotopicus albolarvatus","Dryobates arizonae":"Leuconotopicus arizonae","Dryobates borealis":"Leuconotopicus borealis","Dryobates callonotus":"Veniliornis callonotus","Dryobates cassini":"Veniliornis cassini","Dryobates dignus":"Veniliornis dignus","Dryobates frontalis":"Veniliornis frontalis","Dryobates fumigatus":"Leuconotopicus fumigatus","Dryobates kirkii":"Veniliornis kirkii","Dryobates lignarius":"Veniliornis lignarius","Dryobates maculifrons":"Veniliornis maculifrons","Dryobates mixtus":"Veniliornis mixtus","Dryobates nigriceps":"Veniliornis nigriceps","Dryobates passerinus":"Veniliornis passerinus","Dryobates spilogaster":"Veniliornis spilogaster","Dryobates stricklandi":"Leuconotopicus stricklandi","Dryobates villosus":"Leuconotopicus villosus","Dryotriorchis spectabilis":"Circaetus spectabilis","Elseyornis melanops":"Thinornis melanops","Eupodotis afra":"Afrotis afra","Eupodotis afraoides":"Afrotis afraoides","Eupodotis ruficrista":"Lophotis ruficrista","Eupodotis vigorsii":"Heterotetrax vigorsii","Glossopsitta concinna":"Trichoglossus concinnus","Habia atrimaxillaris":"Driophlox atrimaxillaris","Habia cristata":"Driophlox cristata","Habia fuscicauda":"Driophlox fuscicauda","Habia gutturalis":"Driophlox gutturalis","Haliaeetus humilis":"Icthyophaga humilis","Haliaeetus ichthyaetus":"Icthyophaga ichthyaetus","Haliaeetus leucogaster":"Icthyophaga leucogaster","Haliaeetus vocifer":"Icthyophaga vocifer","Hapalocrex flaviventer":"Laterallus flaviventer","Herpsilochmus sellowi":"Radinopsyche sellowi","Hydropsalis maculicaudus":"Antiurus maculicaudus","Hyliola regilla":"Pseudacris regilla","Iole indica":"Acritillas indica","Ixobrychus cinnamomeus":"Botaurus cinnamomeus","Ixobrychus dubius":"Botaurus dubius","Ixobrychus eurhythmus":"Botaurus eurhythmus","Ixobrychus exilis":"Botaurus exilis","Ixobrychus flavicollis":"Botaurus flavicollis","Ixobrychus involucris":"Botaurus involucris","Ixobrychus minutus":"Botaurus minutus","Ixobrychus sinensis":"Botaurus sinensis","Lanius corvinus":"Corvinella corvina","Laterallus leucopyrrhus":"Rufirallus leucopyrrhus","Laterallus xenopterus":"Rufirallus xenopterus","Leucolia violiceps":"Ramosomyia violiceps","Lophochroa leadbeateri":"Cacatua leadbeateri","Lybius bidentatus":"Pogonornis bidentatus","Melaenornis silens":"Sigelus silens","Micropygia schomburgkii":"Rufirallus schomburgkii","Milvago chimachima":"Daptrius chimachima","Milvago chimango":"Daptrius chimango","Mirafra affinis":"Plocealauda affinis","Mirafra africana":"Corypha africana","Mirafra apiata":"Corypha apiata","Mirafra assamica":"Plocealauda assamica","Mirafra cantillans":"Mirafra javanica","Mirafra erythrocephala":"Plocealauda erythrocephala","Mirafra erythroptera":"Plocealauda erythroptera","Mirafra fasciolata":"Corypha fasciolata","Mirafra rufocinnamomea":"Amirafra rufocinnamomea","Montifringilla blanfordi":"Pyrgilauda blanfordi","Montifringilla taczanowskii":"Onychostruthus taczanowskii","Musophaga rossae":"Tauraco rossae","Neocossyphus finschi":"Stizorhina finschi","Neocossyphus fraseri":"Stizorhina fraseri","Neopelma chrysolophum":"Protopelma chrysolophum","Nyctibius bracteatus":"Phyllaemulor bracteatus","Ochthoeca diadema":"Silvicultrix diadema","Ochthoeca frontalis":"Silvicultrix frontalis","Ochthoeca jelskii":"Silvicultrix jelskii","Ochthoeca pulchella":"Silvicultrix pulchella","Orocharis saltator":"Hapithus saltator","Otocichla mupinensis":"Turdus mupinensis","Parvipsitta porphyrocephala":"Psitteuteles porphyrocephalus","Parvipsitta pusilla":"Psitteuteles pusillus","Peneothello cyanus":"Melanodryas cyanus","Peneothello sigillata":"Melanodryas sigillata","Phaeomyias murina":"Nesotriccus murinus","Philydor erythrocercum":"Neophilydor erythrocercum","Philydor fuscipenne":"Neophilydor fuscipenne","Phyllomyias burmeisteri":"Acrochordopus burmeisteri","Phyllomyias cinereiceps":"Tyranniscus cinereiceps","Phyllomyias nigrocapillus":"Tyranniscus nigrocapillus","Phyllomyias uropygialis":"Tyranniscus uropygialis","Phylloscartes difficilis":"Pogonotriccus difficilis","Phylloscartes eximius":"Pogonotriccus eximius","Phylloscartes lanyoni":"Pogonotriccus lanyoni","Phylloscartes ophthalmicus":"Pogonotriccus ophthalmicus","Phylloscartes paulista":"Pogonotriccus paulista","Phylloscartes poecilotis":"Pogonotriccus poecilotis","Pitangus lictor":"Philohydor lictor","Platysteira castanea":"Dyaphorophyia castanea","Porzana spiloptera":"Laterallus spiloptera","Psephotus varius":"Psephotellus varius","Pseudeos cardinalis":"Chalcopsitta cardinalis","Psilorhinus morio":"Cyanocorax morio","Psittiparus gularis":"Paradoxornis gularis","Psophocichla litsitsirupa":"Turdus litsitsirupa","Ptilinopus magnificus":"Megaloprepia magnifica","Ptilinopus occipitalis":"Ramphiculus occipitalis","Pycnonotus striatus":"Alcurus striatus","Reinwardtipicus validus":"Chrysocolaptes validus","Rhodothraupis celaeno":"Periporphyrus celaeno","Sakesphorus cristatus":"Sakesphoroides cristatus","Sericornis citreogularis":"Neosericornis citreogularis","Sericornis papuensis":"Aethomyias papuensis","Sinosuthora webbiana":"Suthora webbiana","Spodiornis rusticus":"Haplospiza rustica","Sporophila murallae":"Sporophila americana","Stactolaema olivacea":"Cryptolybia olivacea","Streptopelia chinensis":"Spilopelia chinensis","Streptopelia senegalensis":"Spilopelia senegalensis","Systellura decussata":"Quechuavis decussata","Tauraco leucotis":"Menelikornis leucotis","Tauraco porphyreolophus":"Gallirex porphyreolophus","Telophorus bocagei":"Chlorophoneus bocagei","Telophorus nigrifrons":"Chlorophoneus nigrifrons","Telophorus olivaceus":"Chlorophoneus olivaceus","Telophorus sulfureopectus":"Chlorophoneus sulfureopectus","Tregellasia capito":"Eopsaltria capito","Tumbezia salvini":"Ochthoeca salvini","Urosphena pallidipes":"Hemitesia pallidipes","noise-us":"Noise"}};

function fuglerammeFor(sp) {
  const sci = (sp.scientificName || "").trim();
  for (const name of [sci, FUGLE.aliases[sci]]) {
    if (!name) continue;
    const files = FUGLE.index[name.toLowerCase().replace(/\s+/g, "-")];
    if (files && files.length) {
      const [file, source] = files[Math.floor(Math.random() * files.length)];
      return { url: FUGLE_BASE + file + ".webp", credit: `${FUGLE.artists[source] || source} · cut by Fugleramme (CC BY-SA 4.0)`, title: file };
    }
  }
  return null;
}

// ---------------- illustrations: Wikimedia Commons (optional fallback) ----------------
const ART_WORDS = /(audubon|gould|keulemans|naumann|lear|wolf|plate|tafel|pl\.|lithograph|chromolithograph|engraving|illustration|drawing|painting|watercolou?r|birds of america|ibis\b.*journal|tab\.)/i;
const PHOTO_WORDS = /(photo|photograph|\bimg_|\bdsc|\bp\d{6,}|cropped|\bnikon|\bcanon|wikipedia\b.*photo)/i;
const strip = h => String(h || "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();

async function searchCommons(query) {
  const url = "https://commons.wikimedia.org/w/api.php?action=query&format=json&origin=*&generator=search"
    + "&gsrnamespace=6&gsrlimit=20&gsrsearch=" + encodeURIComponent(query)
    + "&prop=imageinfo&iiprop=url%7Cextmetadata&iiurlwidth=640"
    + "&iiextmetadatafilter=Artist%7CDateTimeOriginal%7CLicenseShortName%7CImageDescription%7CObjectName";
  const j = await (await fetch(url)).json();
  return Object.values((j.query || {}).pages || {}).sort((a, b) => (a.index || 0) - (b.index || 0));
}

async function findIllustration(sp) {
  const cut = fuglerammeFor(sp);
  if (cut) { console.log("[illustration] Fugleramme:", cut.title, "-", cut.credit); return cut; }
  if (!USE_COMMONS_FALLBACK) { console.log("[illustration] not in Fugleramme:", sp.scientificName); return null; }
  return findOnCommons(sp);
}

async function findOnCommons(sp) {
  // finds an old illustration of the species, remembered so it's searched only once
  memory.illus = memory.illus || {};
  const key = sp.scientificName || sp.commonName;
  if (key in memory.illus) return memory.illus[key];
  const sci = sp.scientificName || "", common = sp.commonName || "";
  const names = [sci, common].filter(Boolean).map(n => n.toLowerCase());
  const queries = [`${common} Audubon`, `"${sci}" illustration`, `"${sci}" Gould`, `"${sci}" plate`,
                   `"${sci}" lithograph`, `"${common}" illustration bird`];
  let found = null;
  for (const q of queries) {
    if (!q.replace(/["\s]/g, "") || q.includes('""')) continue;
    let pages = [];
    try { pages = await searchCommons(q); } catch (e) { console.log("[illustration] search failed", e); break; }
    for (const p of pages) {
      const ii = (p.imageinfo || [])[0];
      if (!ii || !ii.thumburl || !/\.(jpe?g|png|tiff?)$/i.test(p.title)) continue;
      const m = ii.extmetadata || {}, txt = `${p.title} ${strip((m.ImageDescription || {}).value)} ${strip((m.ObjectName || {}).value)}`;
      const lic = strip((m.LicenseShortName || {}).value).toLowerCase();
      if (!names.some(n => txt.toLowerCase().includes(n))) continue;        // must be this species
      if (!ART_WORDS.test(txt) || PHOTO_WORDS.test(txt)) continue;          // an illustration, not a photo
      if (lic && !/public domain|pd|cc0|cc-by/.test(lic)) continue;
      const artist = strip((m.Artist || {}).value).replace(/\(.*?\)/g, "").split(/[,;]| - /)[0].trim().slice(0, 40);
      const year = (strip((m.DateTimeOriginal || {}).value).match(/1[5-9]\d\d/) || [""])[0];
      found = { url: ii.thumburl, credit: [artist, year].filter(Boolean).join(", "), title: p.title };
      break;
    }
    if (found) break;
  }
  console.log("[illustration]", key, "->", found ? `${found.title} (${found.credit})` : "none found");
  memory.illus[key] = found;
  saveMemory();
  return found;
}

function loadPicture(url) {
  return new Promise((ok, fail) => {
    const im = new Image(); im.crossOrigin = "anonymous";
    im.onload = () => ok(im); im.onerror = fail; im.src = url;
  });
}

async function thermalPicture(url, width) {
  // the illustration as a thermal fax would print it: black dots on paper (Floyd-Steinberg dither)
  const im = await loadPicture(url);
  const w = Math.round(width), h = Math.round(im.height * w / im.width);
  const cv = document.createElement("canvas"); cv.width = w; cv.height = h;
  const ctx = cv.getContext("2d");
  ctx.drawImage(im, 0, 0, w, h);
  const img = ctx.getImageData(0, 0, w, h), px = img.data, g = new Float32Array(w * h);
  const solid = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const a = px[i * 4 + 3] / 255;                          // cut-outs are transparent around the bird
    solid[i] = a > 0.5 ? 1 : 0;
    g[i] = (0.3 * px[i * 4] + 0.59 * px[i * 4 + 1] + 0.11 * px[i * 4 + 2]) * a + 255 * (1 - a);
  }
  // stretch the levels of the bird itself (or of the whole plate, whose old paper turns white)
  const inside = [];
  for (let i = 0; i < g.length; i++) { if (solid[i]) inside.push(g[i]); }
  const pool = Float32Array.from(inside.length > g.length * 0.02 ? inside : g).sort();
  const cutout = inside.length < g.length * 0.98;
  const lo = pool[Math.floor(pool.length * 0.02)], hi = pool[Math.floor(pool.length * (cutout ? 0.98 : 0.85))];
  for (let i = 0; i < g.length; i++) {
    g[i] = solid[i] || !cutout ? Math.max(0, Math.min(255, (g[i] - lo) / Math.max(1, hi - lo) * 235)) : 255;
  }
  const rows = (y0, y1) => {
    for (let y = y0; y < y1; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x, v = g[i] < 128 ? 0 : 255, err = g[i] - v;
        g[i] = v;
        if (x + 1 < w) g[i + 1] += err * 7 / 16;
        if (y + 1 < h) { if (x > 0) g[i + w - 1] += err * 3 / 16; g[i + w] += err * 5 / 16; if (x + 1 < w) g[i + w + 1] += err / 16; }
      }
    }
  };
  for (let y = 0; y < h; y += 40) { rows(y, Math.min(h, y + 40)); await new Promise(r => setTimeout(r, 0)); }
  for (let i = 0; i < w * h; i++) {
    const ink = g[i] < 128;
    px[i * 4] = ink ? INK[0] : PAPER[0]; px[i * 4 + 1] = ink ? INK[1] : PAPER[1]; px[i * 4 + 2] = ink ? INK[2] : PAPER[2]; px[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  // crop to the inked part (cut-outs have wide empty margins)
  let x0 = w, x1 = 0, y0 = h, y1 = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) { if (g[y * w + x] < 128) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; } }
  }
  if (x1 <= x0 || y1 <= y0) return cv;
  const out = document.createElement("canvas"); out.width = x1 - x0 + 1; out.height = y1 - y0 + 1;
  out.getContext("2d").drawImage(cv, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
  return out;
}

async function illustrationFor(d) {
  if (!USE_ILLUSTRATIONS) return null;
  try {
    const found = await findIllustration(d.species);
    if (!found) return null;
    return { canvas: await thermalPicture(found.url, Math.min(560, windowWidth - 32) * ILLUSTRATION_WIDTH * 2), credit: found.credit };
  } catch (e) { console.log("[illustration] couldn't load", e); return null; }
}

// ---------------- BirdWeather ----------------
const NODE = `nodes { id timestamp confidence
  species { commonName scientificName translations(locale: "es") { commonName } }
  %STATION% coords { lat lon } soundscape { url startTime endTime } }`;
const STATION_FIELDS = [
  "station { name location state country timezone coords { lat lon } }",
  "station { name location state country coords { lat lon } }",
  "station { name coords { lat lon } }",
  "",
];
let stationLevel = 0;

async function fetchZone(box) {
  const [[swLat, swLon], [neLat, neLon]] = box;
  const args = 'ne: $ne, sw: $sw, validSoundscape: true, confidenceGte: $minConf, period: {count: 1, unit: "hour"}';
  const node = NODE.replace("%STATION%", STATION_FIELDS[stationLevel]);
  const query = `query ($ne: InputLocation, $sw: InputLocation, $minConf: Float) {
    head: detections(${args}, first: 50) { ${node} }
    tail: detections(${args}, last: 50) { ${node} } }`;
  const res = await fetch(BIRDWEATHER_URL, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables: {
      sw: { lat: swLat, lon: swLon }, ne: { lat: neLat, lon: neLon }, minConf: MIN_CONFIDENCE } }),
  });
  const json = await res.json();
  if (json.errors) {
    if (stationLevel < STATION_FIELDS.length - 1) { stationLevel++; return fetchZone(box); }
    throw new Error(JSON.stringify(json.errors));
  }
  const merged = {};
  for (const part of ["head", "tail"]) {
    for (const d of ((json.data[part] || {}).nodes || [])) { merged[d.id] = d; }
  }
  return Object.values(merged);
}

// ---------------- sound ----------------
let audioCtx = null;

function faxTones() {
  // calling tone (1100 Hz) and answer tone (2100 Hz), like a fax picking up
  if (!FAX_TONES) return Promise.resolve();
  audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
  const beep = (f, start, len, vol = 0.12) => {
    const o = audioCtx.createOscillator(), g = audioCtx.createGain();
    o.frequency.value = f; o.type = "sine";
    g.gain.setValueAtTime(0, audioCtx.currentTime + start);
    g.gain.linearRampToValueAtTime(vol, audioCtx.currentTime + start + 0.02);
    g.gain.setValueAtTime(vol, audioCtx.currentTime + start + len - 0.02);
    g.gain.linearRampToValueAtTime(0, audioCtx.currentTime + start + len);
    o.connect(g).connect(audioCtx.destination);
    o.start(audioCtx.currentTime + start); o.stop(audioCtx.currentTime + start + len);
  };
  beep(1100, 0, 0.5); beep(1100, 1.0, 0.5); beep(2100, 1.8, 1.6, 0.08);
  for (let i = 0; i < 14; i++) { beep(random([1300, 1650, 1850, 2100]), 3.6 + i * 0.07, 0.07, 0.05); }
  return sleep(4700);
}

let currentSource = null, skipRequested = false;

function clarityDb(x, rate) {
  // compares the loudest moments (the call) with the background (the grass)
  const step = Math.max(1, Math.floor(rate * 0.05)), levels = [];
  for (let i = 0; i + step < x.length; i += step) {
    let e = 0; for (let j = i; j < i + step; j++) { e += x[j] * x[j]; }
    levels.push(Math.sqrt(e / step));
  }
  if (levels.length < 4) return { clarity: 0, levels };
  const sorted = [...levels].sort((a, b) => a - b);
  const bg = sorted[Math.floor(sorted.length * 0.3)] || 1e-9;
  const call = sorted[Math.floor(sorted.length * 0.95)];
  return { clarity: 20 * Math.log10(Math.max(call, 1e-9) / bg), levels };
}

async function denoise(x, rate, learnFrom = null) {
  // Spectral noise reduction (like Audacity's): the background's spectrum is learned from the
  // quietest moments of the recording, then removed from every moment, frequency by frequency.
  // Done in small pieces so the p5 web editor never sees a long loop.
  const N = 1024, hop = 256, bins = N / 2 + 1, PIECE = 24;
  const frames = Math.max(1, Math.floor((x.length - N) / hop) + 1);
  const win = new Float32Array(N);
  for (let i = 0; i < N; i++) { win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N); }
  const RE = new Array(frames), IM = new Array(frames), MAG = new Array(frames);
  const pieces = (work, n, k = 0) => k >= n ? Promise.resolve()
    : new Promise(r => setTimeout(r, 0)).then(() => { work(k, Math.min(n, k + PIECE)); return pieces(work, n, k + PIECE); });
  // 1. analyse
  await pieces((f0, f1) => {
    for (let f = f0; f < f1; f++) {
      const re = new Float32Array(N), im = new Float32Array(N), mag = new Float32Array(bins);
      for (let i = 0; i < N; i++) { re[i] = (x[f * hop + i] || 0) * win[i]; }
      fft(re, im);
      for (let b = 0; b < bins; b++) { mag[b] = Math.hypot(re[b], im[b]); }
      RE[f] = re; IM[f] = im; MAG[f] = mag;
    }
  }, frames);
  // 2. the background: for each frequency, the level of its quietest moments, learned from the
  //    whole recording when given (the detected window is often almost all bird)
  const src = learnFrom || x;
  const nf = Math.max(1, Math.floor((src.length - N) / hop) + 1), every = Math.max(1, Math.floor(nf / 400));
  const NM = [];
  await pieces((f0, f1) => {
    for (let f = f0; f < f1; f += every) {
      const re = new Float32Array(N), im = new Float32Array(N), mag = new Float32Array(bins);
      for (let i = 0; i < N; i++) { re[i] = (src[f * hop + i] || 0) * win[i]; }
      fft(re, im);
      for (let b = 0; b < bins; b++) { mag[b] = Math.hypot(re[b], im[b]); }
      NM.push(mag);
    }
  }, nf);
  const noise = new Float32Array(bins);
  await pieces((b0, b1) => {
    for (let b = b0; b < b1; b++) {
      const col = new Float32Array(NM.length);
      for (let f = 0; f < NM.length; f++) { col[f] = NM[f][b]; }
      col.sort();
      noise[b] = col[Math.floor(NM.length * 0.25)] * 1.3;   // a bit above the quietest quarter
    }
  }, bins);
  // 3. remove it (gains smoothed over time to avoid "musical" artefacts) and rebuild the sound
  const out = new Float32Array(x.length), norm = new Float32Array(x.length);
  let prev = new Float32Array(bins).fill(1);
  await pieces((f0, f1) => {
    for (let f = f0; f < f1; f++) {
      const re = RE[f], im = IM[f], mag = MAG[f], gain = new Float32Array(bins);
      const raw = new Float32Array(bins);
      for (let b = 0; b < bins; b++) {
        // Wiener-like gain on power: smoother than plain subtraction
        const snr = Math.max(0, (mag[b] * mag[b]) / (noise[b] * noise[b] + 1e-12) - DENOISE_STRENGTH);
        raw[b] = Math.max(DENOISE_FLOOR, snr / (snr + 1));
      }
      for (let b = 0; b < bins; b++) {                       // smooth across neighbouring frequencies...
        const g = (raw[Math.max(0, b - 2)] + raw[Math.max(0, b - 1)] + raw[b] + raw[Math.min(bins - 1, b + 1)] + raw[Math.min(bins - 1, b + 2)]) / 5;
        gain[b] = g > prev[b] ? 0.7 * g + 0.3 * prev[b] : 0.35 * g + 0.65 * prev[b];   // ...and in time (slow to close)
      }
      for (let b = 0; b < bins; b++) {
        re[b] *= gain[b]; im[b] *= gain[b];
        if (b > 0 && b < N / 2) { re[N - b] *= gain[b]; im[N - b] *= gain[b]; }
      }
      prev = gain;
      for (let i = 0; i < N; i++) { im[i] = -im[i]; }          // inverse FFT = conjugate, FFT, conjugate
      fft(re, im);
      for (let i = 0; i < N; i++) {
        const k = f * hop + i;
        if (k < out.length) { out[k] += re[i] / N * win[i]; norm[k] += win[i] * win[i]; }
      }
      RE[f] = IM[f] = MAG[f] = null;
    }
  }, frames);
  // at the very edges the windows barely overlap: fade them instead of amplifying (no click)
  for (let k = 0; k < out.length; k++) { out[k] = norm[k] > 0.5 ? out[k] / norm[k] : out[k] / 0.5 * (norm[k] / 0.5); }
  return out;
}

function noiseGate(x, rate, rel) {
  let peak = 0; for (const v of x) { peak = Math.max(peak, Math.abs(v)); }
  if (!peak || rel <= 0) return x;
  const th = peak * rel, envDecay = Math.exp(-1 / (0.05 * rate));
  const attack = Math.exp(-1 / (0.005 * rate)), release = Math.exp(-1 / (0.12 * rate));
  let env = 0, gain = 0; const out = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) {
    env = Math.max(Math.abs(x[i]), env * envDecay);
    const target = env > th ? 1 : 0, k = target > gain ? attack : release;
    gain = target + (gain - target) * k;
    out[i] = x[i] * gain;
  }
  return out;
}

function audibleSeconds(x, rate) {
  const { levels } = clarityDb(x, rate);
  const top = Math.max(0, ...levels);
  return top ? levels.filter(v => v >= top * 0.1).length * 0.05 : 0;
}

async function render(decoded, from, dur, speed, filters) {
  // plays the recording into an offline context through the given filters (["hp", 500], ...)
  const rate = decoded.sampleRate, len = Math.max(1, Math.floor(dur / speed * rate));
  const off = new OfflineAudioContext(1, len, rate);
  const src = off.createBufferSource(); src.buffer = decoded; src.playbackRate.value = speed;
  let node = src;
  for (const [type, f] of filters) {
    const q = off.createBiquadFilter(); q.type = type === "hp" ? "highpass" : "lowpass"; q.frequency.value = f;
    q.Q.value = -3.0103;                 // flat (Butterworth), like the fax version's filters
    node.connect(q); node = q;
  }
  node.connect(off.destination);
  src.start(0, from, dur);
  return (await off.startRendering()).getChannelData(0);
}

const phoneBand = (lo, hi) => [["hp", lo], ["hp", lo], ["lp", hi], ["lp", hi]];

function bandShare(total, band, rate) {
  // share of the call's loudest moments (top 20%) that stays inside the band
  const step = Math.max(1, Math.floor(rate * 0.05)), w = [];
  for (let i = 0; i + step < Math.min(total.length, band.length); i += step) {
    let t = 0, b = 0;
    for (let j = i; j < i + step; j++) { t += total[j] * total[j]; b += band[j] * band[j]; }
    w.push([t, b]);
  }
  if (!w.length) return 0;
  w.sort((x, y) => y[0] - x[0]);
  const loud = w.slice(0, Math.max(1, Math.floor(w.length / 5)));
  const t = loud.reduce((s, x) => s + x[0], 0);
  return t ? loud.reduce((s, x) => s + x[1], 0) / t : 0;
}

async function soundPortrait(x, rate) {
  // Describes how the call sounds, in words, so the translator (who can't hear) can match it:
  // how high, how pure, which way it moves, its rhythm. Computed in small pieces.
  const N = 1024, hop = 512, frames = Math.max(1, Math.floor((x.length - N) / hop));
  const win = new Float32Array(N);
  for (let i = 0; i < N; i++) { win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N); }
  const b0 = Math.max(1, Math.floor(300 / (rate / N))), b1 = Math.min(N / 2 - 1, Math.floor(11000 / (rate / N)));
  const F = [];                                     // [time, energy, pitch Hz, flatness]
  const pieces = (work, n, k = 0) => k >= n ? Promise.resolve()
    : new Promise(r => setTimeout(r, 0)).then(() => { work(k, Math.min(n, k + 24)); return pieces(work, n, k + 24); });
  await pieces((f0, f1) => {
    for (let f = f0; f < f1; f++) {
      const re = new Float32Array(N), im = new Float32Array(N);
      for (let i = 0; i < N; i++) { re[i] = (x[f * hop + i] || 0) * win[i]; }
      fft(re, im);
      let e = 0, peak = 0, pb = b0, logSum = 0, sum = 0;
      for (let b = b0; b <= b1; b++) {
        const p = re[b] * re[b] + im[b] * im[b] + 1e-12;
        e += p; sum += p; logSum += Math.log(p);
        if (p > peak) { peak = p; pb = b; }
      }
      const n = b1 - b0 + 1;
      F.push([f * hop / rate, e, pb * rate / N, Math.exp(logSum / n) / (sum / n)]);
    }
  }, frames);
  const top = Math.max(1e-12, ...F.map(v => v[1]));
  const voiced = F.filter(v => v[1] > top * 0.1);
  if (voiced.length < 2) return "";
  const pct = (arr, q) => { const a = [...arr].sort((p, q2) => p - q2); return a[Math.min(a.length - 1, Math.floor(q * a.length))]; };
  const pitches = voiced.map(v => v[2]), med = pct(pitches, 0.5), lo = pct(pitches, 0.1), hi = pct(pitches, 0.9);
  const flat = pct(voiced.map(v => v[3]), 0.5);
  // which way the pitch moves (octaves per second) and how often it changes direction
  const t = voiced.map(v => v[0]), o = pitches.map(p => Math.log2(p));
  const tm = t.reduce((a, b) => a + b, 0) / t.length, om = o.reduce((a, b) => a + b, 0) / o.length;
  let num = 0, den = 0; t.forEach((ti, i) => { num += (ti - tm) * (o[i] - om); den += (ti - tm) ** 2; });
  const slope = den ? num / den : 0;
  let turns = 0;
  for (let i = 2; i < o.length; i++) { if ((o[i] - o[i - 1]) * (o[i - 1] - o[i - 2]) < 0 && Math.abs(o[i] - o[i - 1]) > 0.08) turns++; }
  // rhythm: the notes' starts
  const starts = [];
  let inNote = false;
  F.forEach(v => { if (!inNote && v[1] > top * 0.25) { starts.push(v[0]); inNote = true; } else if (inNote && v[1] < top * 0.1) inNote = false; });
  const gaps = starts.slice(1).map((s0, i) => s0 - starts[i]);
  const gm = gaps.length ? gaps.reduce((a, b) => a + b, 0) / gaps.length : 0;
  const gcv = gaps.length > 1 ? Math.sqrt(gaps.reduce((a, b) => a + (b - gm) ** 2, 0) / gaps.length) / gm : 0;
  const speeding = gaps.length >= 3 && gaps[gaps.length - 1] < gaps[0] * 0.7;
  const slowing = gaps.length >= 3 && gaps[gaps.length - 1] > gaps[0] * 1.4;
  const voicedTime = voiced.length * hop / rate, noteLen = starts.length ? voicedTime / starts.length : voicedTime;
  const tonalRange = () => flat < 0.18;
  const words = [];
  words.push(med < 1000 ? "very low and deep, booming" : med < 2200 ? "low-pitched, warm" : med < 4500 ? "high and bright" : "very high, thin as a needle");
  const pure = med < 1500 ? "pure and hollow, like a flute or an owl" : "pure as a whistle or a little bell";
  words.push(flat < 0.06 ? pure : flat < 0.18 ? "clear and tonal" : flat < 0.35 ? "rough, textured" : "harsh, buzzy, scratchy");
  if (hi / lo > 2.5 && tonalRange()) words.push("leaping across a wide range");
  // inside each note: does it sweep up or down?
  const sweeps = [];
  starts.forEach((s0, i) => {
    const s1 = i + 1 < starts.length ? starts[i + 1] : Infinity;
    const inNote = voiced.filter(v => v[0] >= s0 && v[0] < s1);
    if (inNote.length >= 3) sweeps.push(Math.log2(inNote[inNote.length - 1][2] / inNote[0][2]));
  });
  const up = sweeps.filter(v => v > 0.25).length, down = sweeps.filter(v => v < -0.25).length;
  const tonal = flat < 0.18;
  if (tonal && turns / Math.max(1, voicedTime) > 6) words.push("warbling, liquid, rolling up and down");
  else if (sweeps.length >= 2 && up >= sweeps.length * 0.6) words.push("each note sweeping upward");
  else if (sweeps.length >= 2 && down >= sweeps.length * 0.6) words.push("each note sliding downward");
  else if (slope > 0.6) words.push("rising");
  else if (slope < -0.6) words.push("falling");
  else words.push("holding its pitch");
  if (starts.length <= 1) words.push(noteLen > 1 ? "one long drawn-out sound" : "a single note");
  else {
    words.push(speeding ? "speeding up like a bouncing ball" : slowing ? "slowing down, fading out"
      : gcv < 0.2 ? "steady, repeated like a clock" : "bouncy, playful, uneven");
    words.push(noteLen < 0.09 ? "short staccato notes, like clicks or drops" : noteLen > 0.4 ? "long, sustained notes" : "");
  }
  return words.filter(Boolean).join(", ")
    + ` (about ${Math.round(med / 10) * 10} Hz, ${starts.length} note${starts.length === 1 ? "" : "s"} in ${voicedTime.toFixed(1)} s)`;
}

function countNotes(x, rate) {
  // counts the notes of the call: moments where the sound rises out of quiet (20 ms frames)
  const step = Math.max(1, Math.floor(rate * 0.02)), env = [];
  for (let i = 0; i + step < x.length; i += step) {
    let e = 0;
    for (let j = i; j < i + step; j++) { e += x[j] * x[j]; }
    env.push(Math.sqrt(e / step));
  }
  const top = Math.max(1e-9, ...env), on = top * 0.25, off = top * 0.12;
  let notes = 0, inNote = false, lastStart = -99;
  env.forEach((v, k) => {
    if (!inNote && v > on && k - lastStart >= 3) { notes++; inNote = true; lastStart = k; }
    else if (inNote && v < off) { inNote = false; }
  });
  return Math.max(1, notes);
}

async function judgeSpectrogram(call, why) {
  // for birds right at the edge of the filters: Claude looks at the spectrogram and decides
  // if a bird's song is clearly visible. Uses the quick model, so it's cheap and fast.
  if (!AI_JUDGE || !aiKey) return false;
  try {
    const png = await spectrogramPNG(call.wide, call.rate);
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": aiKey, "anthropic-version": "2023-06-01",
                 "anthropic-dangerous-direct-browser-access": "true" },
      body: JSON.stringify({ model: AI_JUDGE_MODEL, max_tokens: 10, messages: [{ role: "user", content: [
        { type: "image", source: { type: "base64", media_type: "image/png", data: png } },
        { type: "text", text: "This is a spectrogram of a field recording (time left to right, pitch bottom to "
          + "top, dark = loud). Is a bird's song or call clearly visible, standing out from the background "
          + "noise, so that a listener would clearly hear a bird? Answer only YES or NO." } ] }] }),
    });
    const json = await res.json();
    const answer = ((json.content || [])[0] || {}).text || "";
    console.log(`[judge] ${why} -> Claude says: ${answer.trim()}`);
    return /^\s*yes/i.test(answer);
  } catch (e) { console.log("[judge] couldn't ask", e); return false; }
}

async function prepareCall(d) {
  // downloads the recording, keeps the detected call, filters it (like the phone line when
  // PHONE_BAND is on), cleans the noise and decides if it can really be heard.
  // Returns {buffer, ...} or {skip: reason}.
  const sc = d.soundscape;
  let decoded;
  try {
    const bytes = await (await fetch(sc.url)).arrayBuffer();
    decoded = await audioCtx.decodeAudioData(bytes);
  } catch (e) {
    console.log("[audio] couldn't download or decode the recording", e);
    return { skip: "couldn't load the recording" };
  }
  const rate = decoded.sampleRate;
  const from = sc.startTime != null ? Math.max(0, sc.startTime - CLIP_PADDING) : 0;
  const to = Math.min(decoded.duration, sc.endTime != null ? sc.endTime + CLIP_PADDING : decoded.duration, from + MAX_SECONDS);
  const dur = Math.max(0.1, to - from);
  const total = await render(decoded, from, dur, 1, [["hp", 400], ["hp", 400]]);
  let filtered = total, share = 1, octaves = 0;
  if (PHONE_BAND) {
    // how much of the call fits in the phone band: as it is, one octave lower, two octaves lower
    const nyq = rate / 2 - 500;
    filtered = await render(decoded, from, dur, 1, phoneBand(LOW_CUT, HIGH_CUT));
    share = bandShare(total, filtered, rate);
    for (const k of [1, 2]) {
      if (!AUTO_OCTAVE || share >= 0.4 || k > MAX_OCTAVES) break;
      const f = 2 ** k;
      if (HIGH_CUT * f > nyq) break;
      const lower = bandShare(total, await render(decoded, from, dur, 1, phoneBand(LOW_CUT * f, HIGH_CUT * f)), rate);
      if (lower > share * 1.3) {
        octaves = k; share = lower;
        filtered = await render(decoded, from, dur, 1 / f, phoneBand(LOW_CUT, HIGH_CUT));   // slower = lower
      }
    }
  }
  // 1. the classic filters, as before: clarity is judged on the recording as it is
  const { clarity } = clarityDb(filtered, rate);
  let wholeForNoise = null;
  if (denoiseOn && decoded.duration > dur + 1) {
    const speed = 1 / (2 ** octaves);
    wholeForNoise = await render(decoded, 0, Math.min(decoded.duration, 60), speed,
      PHONE_BAND ? phoneBand(LOW_CUT, HIGH_CUT) : [["hp", 400], ["hp", 400]]);
  }
  const cleaned = denoiseOn ? await denoise(filtered, rate, wholeForNoise) : filtered;
  const gated = noiseGate(cleaned, rate, NOISE_GATE);
  const audible = audibleSeconds(gated, rate);
  const minClarity = MIN_CLARITY;
  const problems = [];
  if (share < MIN_IN_BAND) problems.push([`only ${Math.round(share * 100)}% of the call fits in the phone line (it sings too high)`, share >= MIN_IN_BAND * 0.6]);
  if (clarity < minClarity) problems.push([`clarity ${clarity.toFixed(0)} dB: too much background`, clarity >= minClarity - 5]);
  if (audible < MIN_AUDIBLE) problems.push([`only ${audible.toFixed(1)} s left after the filters`, audible >= MIN_AUDIBLE * 0.5]);
  const wideCall = { wide: total, rate };
  // 2. the AI only as a last, small filter: a bird that just missed is shown to Claude,
  //    who looks at its spectrogram and decides if it deserves to be heard
  if (problems.length) {
    const reason = problems.map(p => p[0]).join("; ");
    const borderline = problems.every(p => p[1]);          // close to passing on every count
    if (!borderline || !(await judgeSpectrogram(wideCall, reason))) return { skip: reason };
    console.log("[judge] rescued:", reason);
  }
  // normalize and join the repetitions into one continuous sound
  let peak = 0; for (const v of gated) { peak = Math.max(peak, Math.abs(v)); }
  const out = audioCtx.createBuffer(1, gated.length * REPEAT_CALL, rate), ch = out.getChannelData(0);
  for (let r = 0; r < REPEAT_CALL; r++) {
    for (let i = 0; i < gated.length; i++) { ch[r * gated.length + i] = gated[i] / (peak || 1) * 0.9; }
  }
  console.log(`[audio] clarity ${clarity.toFixed(0)} dB, ${PHONE_BAND ? Math.round(share * 100) + "% in the phone band, " : ""}`
    + `${audible.toFixed(1)} s audible${octaves ? `, ${octaves} octave${octaves > 1 ? "s" : ""} lower` : ""}: playing`);
  const notes = countNotes(gated, rate);
  const portrait = await soundPortrait(gated, rate);
  console.log("[audio] how it sounds:", portrait);
  // fewer than 4 words can't hold a whole thought: very short songs are given 4
  return { buffer: out, octave: octaves > 0, wide: total, rate, notes, portrait, words: Math.max(4, Math.min(8, notes)) };
}

async function playBuffer(buffer) {
  // resolves true only if the whole call really played
  if (audioCtx.state !== "running") {
    try { await audioCtx.resume(); } catch (e) {}
  }
  if (audioCtx.state !== "running") {
    status = "the browser is blocking the sound — click the page to allow it";
    await new Promise(ok => { const iv = setInterval(async () => {
      try { await audioCtx.resume(); } catch (e) {}
      if (audioCtx.state === "running") { clearInterval(iv); ok(); }
    }, 300); });
  }
  return new Promise(resolve => {
    const src = audioCtx.createBufferSource();
    src.buffer = buffer; src.connect(audioCtx.destination);
    currentSource = src;
    const startedAt = audioCtx.currentTime;
    const iv = setInterval(() => { if (skipRequested) src.stop(); }, 100);
    src.onended = () => {
      clearInterval(iv); currentSource = null;
      const played = audioCtx.currentTime - startedAt;
      resolve(!skipRequested && played >= buffer.duration * 0.9);
    };
    src.start();
  });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---------------- the paper roll on screen ----------------
let started = false, paused = false;
let status = "click anywhere to start";
let slips = [];                 // newest first
let paperW = 560;
const PAPER = [244, 241, 233], INK = [24, 24, 26];
const PRINT_SECONDS = 4;        // how long a slip takes to come out

function setup() {
  createCanvas(windowWidth, windowHeight);
  pixelDensity(Math.min(2, displayDensity()));
  textFont("Menlo, Monaco, 'Courier New', monospace");
  loadMemory();
  loadAiKey();
  const box = createInput(aiKey, "password");
  box.attribute("placeholder", "Claude API key (sk-ant-...)");
  box.position(12, windowHeight - 66); box.size(200);
  window.addEventListener("resize", () => box.position(12, windowHeight - 66));
  box.style("font", "11px Menlo, monospace"); box.style("background", "#111"); box.style("color", "#bbb");
  box.style("border", "1px solid #333"); box.style("padding", "4px 6px");
  box.input(() => { aiKey = box.value().trim(); try { localStorage.setItem("birdsong_ai_key", aiKey); } catch (e) {} });
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
  slips.forEach(s => s.g = null);          // redraw at the new width
}

function wrap(txt, size, maxW, style) {
  if (String(txt).includes("\n")) return String(txt).split("\n").flatMap(part => wrap(part, size, maxW, style));
  textSize(size); textStyle(style);
  const lines = []; let line = "";
  for (const w of txt.split(" ")) {
    const t = line ? line + " " + w : w;
    if (textWidth(t) > maxW && line) { lines.push(line); line = w; } else line = t;
  }
  if (line) lines.push(line);
  return lines;
}

function renderNote(s) {
  // a thin strip: the bird spoke but not to you, or something went wrong
  const w = paperW, inner = w - 60, size = 11;
  const lines = wrap(s.note, size, inner, ITALIC);
  const h = 22 + lines.length * size * 1.5 + 18;
  const g = createGraphics(w, Math.ceil(h));
  g.pixelDensity(pixelDensity());
  g.background(...(s.error ? [70, 38, 34] : [52, 50, 46]));
  g.noStroke(); g.fill(...(s.error ? [255, 200, 190] : [200, 196, 186]));
  g.textFont("Menlo, Monaco, 'Courier New', monospace"); g.textAlign(CENTER, TOP);
  g.textStyle(ITALIC); g.textSize(size);
  let y = 22; lines.forEach(l => { g.text(l, w / 2, y); y += size * 1.5; });
  s.g = g; s.h = h;
}

function renderSlip(s) {
  if (s.note) return renderNote(s);
  // the slip as the fax would print it: centered italic phrase, signature, tiny data
  const w = paperW, pad = 36, inner = w - pad * 2;
  const big = constrain(w / 21, 17, 27), mid = big * 0.62, small = constrain(big * 0.42, 8.5, 11);
  const said_ = big * 0.6;
  const kind = s.kind ? wrap(s.kind, small, inner, NORMAL) : [];
  const said = s.said ? wrap(s.said, said_, inner * 0.85, NORMAL) : [];
  const phrase = wrap(s.phrase, big, inner, ITALIC);
  const sig = wrap(s.signature, mid, inner, NORMAL);
  const data = wrap(s.data, small, inner, NORMAL);
  const pic = s.illus ? s.illus.canvas : null;
  const picW = pic ? w * ILLUSTRATION_WIDTH : 0, picH = pic ? pic.height * picW / pic.width : 0;
  const top = (pic ? picH + 30 : 0) + kind.length * small * 1.5 + (kind.length ? 12 : 0) + said.length * said_ * 1.45 + (said.length ? 30 : 0);
  const h = 44 + top + phrase.length * big * 1.35 + 22 + sig.length * mid * 1.45 + 26 + data.length * small * 1.5 + 44;
  const g = createGraphics(w, Math.ceil(h));
  g.pixelDensity(pixelDensity());
  g.background(...PAPER);
  g.noStroke(); g.fill(...INK);
  g.textFont("Menlo, Monaco, 'Courier New', monospace");
  g.textAlign(CENTER, TOP);
  let y = 44;
  if (pic) { g.drawingContext.drawImage(pic, (w - picW) / 2, y, picW, picH); y += picH + 30; }
  // what the bird said to its own kind, small, above the message
  g.textStyle(NORMAL); g.textSize(small); g.fill(...INK, 170);
  kind.forEach(l => { g.text(l.toUpperCase(), w / 2, y); y += small * 1.5; });
  if (kind.length) y += 12;
  g.textSize(said_); g.fill(...INK, 210);
  said.forEach(l => { g.text(l, w / 2, y); y += said_ * 1.45; });
  if (said.length) {                       // a small rule between the two languages
    y += 12; g.stroke(...INK, 90); g.line(w / 2 - 18, y, w / 2 + 18, y); g.noStroke(); y += 18;
  }
  g.fill(...INK);
  g.textStyle(ITALIC); g.textSize(big);
  phrase.forEach(l => { g.text(l, w / 2, y); y += big * 1.35; });
  y += 22;
  g.textStyle(NORMAL); g.textSize(mid);
  sig.forEach(l => { g.text(l, w / 2, y); y += mid * 1.45; });
  y += 26;
  g.textSize(small); g.fill(...INK, 200);
  data.forEach(l => { g.text(l, w / 2, y); y += small * 1.5; });
  // thermal paper: faint grain, and print-head lines where the ink is weak
  g.loadPixels();
  for (let i = 0; i < g.pixels.length; i += 4) {
    const n = random(-7, 7);
    g.pixels[i] += n; g.pixels[i + 1] += n; g.pixels[i + 2] += n;
  }
  g.updatePixels();
  g.stroke(...PAPER, 70); g.strokeWeight(1);
  for (let k = 0; k < 6; k++) { const yy = random(h); g.line(0, yy, w, yy); }
  // perforated cut at the bottom of the slip
  g.stroke(...INK, 60); g.strokeWeight(1); g.drawingContext.setLineDash([3, 5]);
  g.line(10, h - 1, w - 10, h - 1); g.drawingContext.setLineDash([]);
  s.g = g; s.h = h;
}

function draw() {
  background(28, 27, 25);
  paperW = Math.min(560, width - 32);
  const x = (width - paperW) / 2, slotY = 58;

  // the paper: newest slip comes out of the slot and pushes the older ones down
  let y = slotY;
  for (const s of slips) {
    if (!s.g) renderSlip(s);
    const p = constrain((millis() - s.born) / (PRINT_SECONDS * 1000), 0, 1);
    const shown = s.h * (s === slips[0] ? easeOut(p) : 1);
    if (shown > 0.5) image(s.g, x, y, paperW, shown, 0, s.h - shown, s.g.width, shown);
    y += shown;
    if (y > height) break;
  }
  if (!slips.length) { fill(...PAPER, 25); noStroke(); rect(x, slotY, paperW, height); }
  slips = slips.slice(0, 14);

  // the fax's mouth
  noStroke(); fill(16, 16, 15); rect(x - 22, 0, paperW + 44, slotY, 0, 0, 10, 10);
  fill(70); rect(x - 4, slotY - 5, paperW + 8, 5, 2);
  fill(150); textSize(11); textStyle(NORMAL); textAlign(LEFT, CENTER);
  text("BIRDSONG  ·  FAX-275", x, slotY / 2 - 2);
  textAlign(RIGHT, CENTER);
  const blink = started && !paused && frameCount % 60 < 40;
  fill(blink ? color(90, 220, 120) : 60); circle(x + paperW - 4, slotY / 2 - 2, 8);

  // status at the bottom
  fill(0, 160); rect(0, height - 34, width, 34);
  fill(210); textSize(12); textAlign(CENTER, CENTER);
  const mode = !aiKey ? "      (no API key)" : aiError ? `      (translator: ${aiError})` : "      translator on";
  text((paused ? "paused  ·  " : "") + status + (started ? "      S skip  ·  P pause  ·  D clean " + (denoiseOn ? "on" : "off") + mode : ""), width / 2, height - 17);
}

const easeOut = t => 1 - Math.pow(1 - t, 3);

function mousePressed(e) {
  if (e && e.target && e.target.tagName === "INPUT") return;
  if (audioCtx && audioCtx.state !== "running") audioCtx.resume();
  if (!started) {
    started = true;
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    run();
  }
}

function keyPressed() {
  if (document.activeElement && document.activeElement.tagName === "INPUT") return;   // typing the key
  if (key === "s" || key === "S") { skipRequested = true; status = "skipping..."; }
  if (key === "p" || key === "P") paused = !paused;
  if (key === "d" || key === "D") { denoiseOn = !denoiseOn; status = `noise cleaning ${denoiseOn ? "ON" : "OFF"} (from the next bird)`; }
}

// ---------------- the loop: listen, play, print ----------------
// Each bird is one round. The rounds are chained with setTimeout instead of an endless
// loop, so the p5 web editor's infinite-loop protection doesn't stop the sketch.
const loopState = { seen: new Set(), recentPlaces: [], zone: 0, emptyRounds: 0 };

async function oneRound() {
  const st = loopState, seen = st.seen, recentPlaces = st.recentPlaces;
  if (paused) { await sleep(300); return; }
  const [zoneName, box] = WORLD_ZONES[st.zone % WORLD_ZONES.length];
  st.zone++;
  status = `listening to ${zoneName}...`;
  let birds;
  try { birds = await fetchZone(box); }
  catch (e) { status = "couldn't reach BirdWeather — retrying"; console.log(e); await sleep(10000); return; }

  birds = birds.filter(d => !seen.has(d.id) && d.soundscape && d.soundscape.url)
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  const placeOf = d => ((d.station || {}).country || "") + "/" + ((d.station || {}).state || "");
  const varied = birds.filter(d => !recentPlaces.includes(placeOf(d)));
  const d = (varied.length ? varied : birds)[0];
  if (!d) {
    if (++st.emptyRounds >= WORLD_ZONES.length) { status = "no new birds right now — waiting"; await sleep(30000); st.emptyRounds = 0; }
    return;
  }
  st.emptyRounds = 0;
  seen.add(d.id);
  recentPlaces.push(placeOf(d)); recentPlaces.splice(0, Math.max(0, recentPlaces.length - VARY_PLACES));

  const name = d.species.commonName.toLowerCase();
  const es = ((d.species.translations || [])[0] || {}).commonName;
  const where = placeName(d.station || {});
  status = `♪  ${name}${es && es.toLowerCase() !== name ? " / " + es.toLowerCase() : ""}  ·  ${where}  ·  ${Math.round(d.confidence * 100)}%`;
  console.log(status, d);

  skipRequested = false;
  const call = await prepareCall(d);
  if (call.skip) {                       // not clear enough: no sound and no print
    console.log("[skip]", name, "—", call.skip);
    status = `${name}: ${call.skip} — skipped`;
    await sleep(1500);
    return;
  }
  const asking = translateBird(d, call);         // the translator listens while the bird sings
  const drawing = illustrationFor(d);            // ...and the illustration is found meanwhile
  const ok = await playBuffer(call.buffer);
  if (skipRequested || !ok) {            // didn't really play: no print
    console.log("[skip]", name, "— the call didn't play completely");
    skipRequested = false; status = "skipped"; await sleep(800); return;
  }

  status = `translating the ${name}...`;
  const t = await asking;
  if (!t) {                              // no key, or the translator couldn't answer: nothing prints
    const why = !aiKey ? "no API key: paste your Claude API key in the box at the bottom left"
                       : `the translator couldn't answer: ${aiError}`;
    status = `${name}: ${why}`;
    slips.unshift({ note: `${name} sang, but nothing was translated. ${why}`, error: true, born: millis() });
    await sleep(3000);
    return;
  }
  if (t.silent) {                        // the translator decided this song wasn't for you
    console.log("[translator] silent:", t.reason);
    status = `${name}: “${t.said}” — not for you${t.reason ? " (" + t.reason + ")" : ""}`;
    await sleep(6000);
    return;
  }
  status = `receiving a message from ${name}...`;
  await faxTones();
  t.illus = await drawing;
  slips.unshift({ ...slipParts(d, t), born: millis() });
  status = `${name}  ·  ${where}`;
  await sleep((PRINT_SECONDS + PAUSE_AFTER_PRINT) * 1000);
}

function run() {
  const next = () => oneRound().catch(e => { console.log("[round error]", e); status = "error: " + e.message; })
                               .then(() => setTimeout(next, 50));
  next();
}

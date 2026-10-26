"""
birdsong_dawn.py — sends sounds over the phone line to the speaker of a Brother FAX-275.

Before using it:
  - Quit screen (Ctrl + A, K, Y): the modem can't be open in two places at once.
  - On the fax, press Hook (display: "Telephone") and turn the volume up.

Modes:
  python3 birdsong_dawn.py test          -> a synthetic bird call (for testing)
  python3 birdsong_dawn.py sound.mp3     -> any audio file (mp3, wav, m4a, aiff...)
  python3 birdsong_dawn.py birds         -> live: each new bird from one BirdWeather station
  python3 birdsong_dawn.py region dawn   -> live: only birds singing at their own sunrise,
                                               printed with their illustration, name and country
  python3 birdsong_dawn.py dawn-preview  -> no modem: saves dawn_preview.png (what the fax would print)
  python3 birdsong_dawn.py region usa    -> live: the newest birds from a whole region
                                        (regions: usa, chile, nyc — add your own in REGIONS)
  python3 birdsong_dawn.py print-test    -> prints a test card on the fax (to check printing)

Printing (PRINT_BIRDS = True): after each call plays, the Mac calls the fax.
The modem dials *51 (the fax's Fax Receive Code) so it starts receiving by itself.
After printing the fax hangs up, so press HOOK again for the next bird.

To stop it: Ctrl + C
"""

import array
import glob
import io
import json
import math
import os
import random
import re
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.request

try:
    import serial
except ImportError:
    sys.exit("pyserial is missing. Install it with:  python3 -m pip install pyserial")


# ---------------- SETTINGS ----------------
STATION_ID = "10546"   # <- BirdWeather station number
TRANSLATION_LOCALE = "es"   # language for the second bird name ("es" = Spanish, "" = off)
POLL_INTERVAL = 30    # how often (seconds) to check for new birds
MAX_SECONDS = 15       # maximum length of each sound sent to the fax
OCTAVE_DOWN = False    # True = every call plays slower and one octave lower
AUTO_OCTAVE = True     # True = only birds that sing too high for the phone line play an octave lower
ONLY_THE_CALL = True   # True = play only the seconds where BirdNET heard the bird (not the whole recording)
CLIP_PADDING = 0.5     # seconds of sound kept before and after the call
SKIP_WITH_KEYPAD = True  # press any number, * or # on the fax (in Hook) to skip to the next bird
REPEAT_CALL = 3        # how many times each call plays (2 = it repeats once)
VOLUME = 0.9           # 0.1 to 1.0 (audio is normalized to full scale, then scaled by this)

# --- Filters to clean up the call ---
LOW_CUT = 500          # Hz: removes everything below (wind, traffic, hum). 0 = off
HIGH_CUT = 3400        # Hz: removes everything above (hiss). 0 = off
MIN_CLARITY = 8        # dB: how far the call must stand out from the noise, or it's skipped
MIN_IN_BAND = 0.3      # 0-1: share of the call (its loud moments) that fits in the phone band;
                       #   birds that sing mostly outside it (too high even an octave lower) are skipped
MIN_AUDIBLE = 0.6      # seconds: after the filters, at least this much call must be left to hear,
                       #   or the bird is skipped (no sound AND no print)
                       #     (raise to 15-20 to be pickier, lower to 6-8 to let more through)
MIN_CONFIDENCE = 0.6   # 0 to 1: skips detections BirdNET isn't sure about
ONLY_SPECIES = []      # e.g. ["Blue Jay", "Northern Cardinal"]  (empty = all)
EXCLUDE_SPECIES = []   # e.g. ["House Sparrow"]                  (species that never play)
NOISE_GATE = 0.3       # 0 to 1: silences the moments with no bird (raise it if noise remains between calls)
# ------------------------------------------

# --- Region mode (python3 birdsong_dawn.py region <name>) ---
# Each region is a rectangle on the map: (south-west corner), (north-east corner),
# as (latitude, longitude).
REGIONS = {
    "usa":   ((24.4, -125.0), (49.5, -66.9)),    # continental United States
    "chile": ((-56.0, -76.0), (-17.4, -66.4)),
    "nyc":   ((40.45, -74.30), (40.95, -73.65)),
    "world": ((-90.0, -180.0), (90.0, 180.0)),   # the whole Earth, visited zone by zone (see WORLD_ZONES)
    "dawn":  ((-90.0, -180.0), (90.0, 180.0)),   # only birds singing at their own sunrise, following the sunrise
                                                 #   around the Earth (see DAWN_BEFORE / DAWN_AFTER)
}

# "region world" takes turns between these zones, one per bird, so the USA (which has most of
# the stations) doesn't take over. Zones with no birds right now (it's night there) are skipped.
WORLD_ZONES = [
    ("North America",   ((15.0, -170.0), (72.0, -50.0))),
    ("Europe",          ((35.0, -25.0), (72.0, 45.0))),
    ("Oceania",         ((-50.0, 110.0), (0.0, 180.0))),
    ("South America",   ((-56.0, -120.0), (15.0, -30.0))),
    ("Asia",            ((0.0, 45.0), (75.0, 180.0))),
    ("Africa",          ((-35.0, -20.0), (37.0, 52.0))),
]
DEFAULT_REGION = "dawn"
PICK = "newest"            # "newest" = most recent bird first, "random" = any new bird
VARY_PLACES = 3            # try not to repeat the country (or US state) of the last 3 birds (0 = off)
TRIES_PER_ROUND = 3        # how many birds to try per round if the first ones are too noisy
PAUSE_BETWEEN_BIRDS = 2    # seconds of silence between calls
# ------------------------------------------

# --- dawn: only birds singing around their own sunrise ---
DAWN_BEFORE = 45           # minutes before sunrise that still count as dawn
DAWN_AFTER = 90            # minutes after sunrise that still count as dawn
# --- illustrations: hand-cut 1800s plates from the Fugleramme project (CC BY-SA 4.0) ---
ILLUSTRATION_WIDTH_CM = 6  # the frame every bird fits into: width...
ILLUSTRATION_HEIGHT_CM = 4.5   # ...and height. Each bird is scaled to fit inside it, centred and
                               # standing on its floor, so all the slips share the same framing
ONLY_ILLUSTRATED = True    # True = only birds that have a Fugleramme illustration are played
FUGLE_INDEX_FILE = "fugleramme_index.json"   # the list of cut-outs (comes with this script)
FUGLE_CACHE_FOLDER = "illustrations"         # downloaded cut-outs are kept here (and reused)
FUGLE_COMMIT = "1bb2f278dd3e7a0859449f9867bbfccc9336ec2c"
FUGLE_BASE = ("https://raw.githubusercontent.com/arnegiacomo/fugleramme/"
              f"{FUGLE_COMMIT}/assets/artwork/classic/birds/")
DAWN_NAME_SIZE = 26        # size of the species' name under the bird
DAWN_SCI_SIZE = 18         # size of the scientific name (italic)
DAWN_DATA_SIZE = 17        # size of the data lines under the bird
DAWN_CREDIT_SIZE = 13      # size of the illustrator's credit (required by the licence)

# --- Printing: the call plays first, then the fax prints for the bird ---
PRINT_BIRDS = True         # True = after each call, the fax prints; False = sound only
DECIDE_SECONDS = 0         # after each call you have this many seconds to press ENTER and skip printing
                           #   (0 = always print, no question)
PAUSE_AFTER_PRINT = 6      # seconds of silence after printing, so the fax finishes before the next call
PRINT_STYLE = "dawn"       # "dawn" = the bird's illustration + coordinates, bird time, operator (no phrase)
                           # "message" = what time it is where the bird sings,
                           # "illustration" = only the bird drawing, "card" = text + spectrogram
USE_STATION_NAME = False   # True = the message may use the station's own name (e.g. "Back yard")
                           # False = only real geography: place, state, country or coordinates
MESSAGE_STYLE = "fortune"  # "fortune"  = like the slip in a fortune cookie: one centered phrase, no title
                           # "poem"     = the phrase as stepped verses, signed small at the bottom right
                           # "letter"   = the phrase first, then signed: "-- american crow, from Australia"
                           # "sentence" = one line: "american crow whispers ..., from Australia"
# --- live weather and climate where the bird is (Open-Meteo, free, no key) ---
USE_WEATHER = True         # sometimes the bird talks about the weather it's in right now (rain, clouds...)
USE_CLIMATE = False        # the bird compares today with the same day decades ago, in the same place
USE_REAL_SUN = False       # "sunset time" etc. follow the real sunrise and sunset of that place
TEMP_UNIT = "C"            # "C" or "F"
BASELINE_YEARS = (1961, 1990)   # "how it used to be": the average of these years
CLIMATE_MIN_DIFF = 1.5     # degrees C: smaller differences count as "like it used to be"
WEATHER_CHANCE = 0.45      # chance of talking about rain, snow, storms, fog, wind, heat or frost
CALM_WEATHER_CHANCE = 0.2  # chance of talking about ordinary weather (clear / cloudy)
# --- migration: knowing the species and the place, the bird sometimes talks about leaving or arriving ---
USE_MIGRATION = True
MIGRATION_CHANCE = 0.2     # how often (0 to 1)
MIGRATION_CACHE_FILE = "migration_cache.json"   # remembers which species migrate (read from Wikipedia)
CLIMATE_CACHE_FILE = "climate_cache.json"   # remembers each place's old climate (it never changes)

WEATHER_PHRASES = {
    # "_night" versions are used when it's dark there, the others when it's light
    "thunder": ["the sky is shouting louder than me",
                "the thunder is shaking my branch",
                "I wait for the storm to forget me",
                "lightning is drawing the trees for a second"],
    "snow":    ["the snow is erasing every path",
                "my song sounds different on the snow",
                "everything here is white and listening",
                "I'm the only dark thing in all this white"],
    "rain":    ["I'm sheltering from the rain under a leaf",
                "the rain is writing on my feathers",
                "I sing between the raindrops",
                "the ground is drinking and so am I",
                "I'm waiting for the rain to finish its sentence"],
    "rain_night": ["I'm sheltering from the rain in the dark",
                   "the rain is the only voice awake with me",
                   "I can hear every drop and none of the stars",
                   "the night is wet and I am hiding inside it"],
    "drizzle": ["a thin rain is hanging in the air",
                "the air is made of tiny water",
                "the rain is so light it only whispers"],
    "fog":     ["the fog has hidden the other trees from me",
                "I'm calling to the ones I can't see",
                "the world ends a few wings away",
                "I sing so the others find me in the fog"],
    "wind":    ["the wind is pushing me sideways",
                "the wind is carrying my song further than I can fly",
                "I'm holding on to the branch with all my claws",
                "the wind is trying to take my words away"],
    "hot":     ["the air is trembling with heat",
                "even the shade is warm today",
                "I'm keeping my song short in this heat",
                "the heat is making the leaves quiet"],
    "cold":    ["my feet are cold on the branch",
                "my breath is a small cloud",
                "I'm puffing up my feathers against the frost",
                "the cold is making my song sharper"],
    "clear_day":   ["there isn't a single cloud above me",
                    "the sky is completely open today",
                    "the sky is so clear I can see where I'm going"],
    "clear_night": ["all the stars are out above me",
                    "there's nothing between me and the stars",
                    "the stars are clear enough to follow tonight"],
    "cloudy":  ["the clouds are low today",
                "the sky is wearing grey",
                "I sing to a sky that doesn't answer",
                "the clouds are keeping the sun to themselves"],
    "cloudy_night": ["the clouds won't let me follow the stars",
                     "tonight the clouds are hiding my map",
                     "no stars tonight, only my own voice",
                     "I can't see the moon, but I know it's there"],
}

CLIMATE_PHRASES = {
    "warmer": ["it's {diff} warmer than when my grandparents sang here",
               "this {month} is {diff} warmer than it used to be",
               "the old {month}s here were {diff} cooler",
               "my song is {diff} warmer than my ancestors' songs",
               "the trees remember this day {diff} cooler"],
    "cooler": ["it's {diff} colder than it used to be on this day",
               "this {month} is {diff} cooler than the old ones",
               "today is {diff} colder than my grandparents' {month}s"],
    "same":   ["today the air remembers how it used to be",
               "for once, this day feels like the old days",
               "this {month} feels like my grandparents' {month}s"],
}

# --- Markov chain: new time-of-day sentences made by remixing the phrases ---
#     (weather sentences and climate facts are never remixed, so they always stay true)
MARKOV = True              # True = sometimes the bird invents a new sentence instead of using a listed one
MARKOV_CHANCE = 0.4        # how often (0 to 1)
MARKOV_ORDER = 2           # how many previous words decide the next one (2 = more sense, 1 = wilder)
CORPUS_FOLDER = "corpus"   # optional: put .txt files here (poems, field notes, nature writing...) and
                           #   their words join the mix, flavored by the phrases of each time of day
CORPUS_MAX = 400           # at most this many sentences from the corpus (so the phrases still lead)
# public-domain books downloaded into CORPUS_FOLDER the first time (if they aren't there yet)
CORPUS_BOOKS = {
    "thoreau_walden.txt": "https://www.gutenberg.org/cache/epub/205/pg205.txt",
    "dickinson_poems.txt": "https://www.gutenberg.org/cache/epub/12242/pg12242.txt",
    "whitman_leaves.txt": "https://www.gutenberg.org/cache/epub/1322/pg1322.txt",
}

# --- the time between you and the bird: tomorrow / yesterday, distance, delay ---
USE_TIME_BETWEEN = True
TIME_BETWEEN_CHANCE = 0.25 # how often (0 to 1)
HOME = (40.6935, -73.9866) # where the fax is (ITP, Brooklyn): for the distance to the bird
TIME_BETWEEN_PHRASES = {
    "tomorrow": ["I'm singing to you from your tomorrow",
                 "here it is already tomorrow, and it's alright",
                 "I'm one day ahead of you, nothing terrible happens here",
                 "tomorrow sounds like this",
                 "I've already lived the day you're about to begin"],
    "yesterday": ["here it is still yesterday, nothing has happened yet",
                  "I'm singing from your yesterday, it isn't over here",
                  "for me it's still the day you already left behind",
                  "your yesterday is still warm where I am"],
    "distance": ["this song crossed {km} km to be heard once",
                 "{km} km away, the same air is moving",
                 "I am {km} km from you, and this close",
                 "between us there are {km} km and one song",
                 "{km} km of wire, and still you hear my breath"],
    "delay": ["you are hearing a song that ended {ago}",
              "I sang this {ago}, I may already be somewhere else",
              "this song is {age} old, like the light of a star",
              "{ago}, I was here. Now I'm only this paper"],
    "hours": ["it's {theirs} where I am and {yours} where you are, and still we meet",
              "my {theirs} is your {yours}, the same moment wearing two names",
              "I live in a different hour, and it's touching yours"],
}

# --- fortune style ---
FORTUNE_SIZE = 30          # size of the phrase (italic)
FORTUNE_MAX_WIDTH_CM = 13  # longer phrases are split into two centered lines
FORTUNE_SENTENCE = True    # True = "The trees are drinking the light." (capital letter and period)
# How the bird signs its message (one is picked at random, without repeating the last ones).
# {a_bird} = "an australian magpie"   {the_bird} = "the australian magpie"
# {in_place} = "in Queensland, Australia"   {from_place} = "from Queensland, Australia"
FORTUNE_SIGNATURES = [
    "whispered by {a_bird} {in_place}",
    "said {a_bird}, {from_place}",
    "{a_bird} sends this {from_place}",
    "{a_bird} wanted you to know, {from_place}",
    "{a_bird} left this for you {in_place}",
    "sung by {a_bird} {in_place}",
    "carried {from_place} by {a_bird}",
    "{a_bird} murmured this {in_place}",
    "{a_bird} sends word {from_place}",
    "{a_bird} is calling {from_place}",
    "overheard from {a_bird} {in_place}",
    "{a_bird} wrote this in the air {in_place}",
    "{a_bird} sent this across the wires {from_place}",
    "{a_bird} hummed this {in_place}",
    "{the_bird} insists, {from_place}",
    "a secret from {a_bird}, {in_place}",
    "{a_bird} asked me to tell you, {from_place}",
    "{a_bird} sings this {in_place}, for you",
    "with love, {a_bird}, {from_place}",
    "{a_bird} remembered you {in_place}",
]
FORTUNE_SIGNATURE_SIZE = 19
FORTUNE_DATA_SIZE = 15     # the tiny line with coordinates, bird time and operator (0 = no line)

# --- poem style ---
POEM_SIZE = 34             # size of the verses (italic)
POEM_INDENT_CM = 2.2       # where the first verse starts, from the left margin
POEM_STEP_CM = 0.75        # how much each next verse moves to the right
POEM_SIGNATURE = "-- {bird}, {place}"
POEM_SIGNATURE_SIZE = 22
POEM_DATA_SIZE = 17        # the small line with coordinates, bird time and operator
POEM_TITLE_SIZE = 22
SIGNATURE_SIZE = 23        # text size of the signature (the message is MESSAGE_SIZE)
SIGNATURE = "-- {bird}, from {place}"  # how the bird signs the letter ("-- " is how e-mail signatures start)
TITLE = "you've got bird message:"   # printed at the top of every message ("" = no title)
TOP_MARGIN_MM = 0          # blank paper above the title, in mm
TITLE_SIZE = 29            # text size of the title (bold)
MESSAGE_SIZE = 29          # text size of the message (29 ≈ 3.6 mm tall letters)
MESSAGE_RIGHT_EDGE_CM = 9.3   # where the message's lines end, in cm from the paper's left edge
MESSAGE_ALIGN = "right"    # "right" = lines end at the same point, "left" = lines start at the same point
COORDS_SIZE = 21           # text size of the top-right corner: coordinates, bird time, human bridge
# Tiny line in the bottom-right corner crediting the person whose microphone heard the bird.
# {name} is replaced by the station's name (the name its owner chose). "" = don't print it.
CREDIT_TEMPLATE = "operator: {name}"
#   the bird is the caller; the person whose microphone heard it is the operator who connects the call.
#   other ideas: "connected by {name}"  ·  "patched through by {name}"  ·  "switchboard: {name}"
NO_REPEAT = 9              # in each time of day, a phrase can't come back until this many
                           #   different ones of that same time of day have been printed (same for verbs)

# How the bird says it (one is picked at random for each print)
VERBS = [
    "says",
    "sings",
    "whispers",
    "murmurs",
    "hums",
    "insists",
    "swears",
    "promises",
    "confesses",
    "admits",
    "remembers",
    "believes",
    "dreams",
    "announces",
    "keeps repeating",
    "tells the wind",
    "tells the river",
    "tells the leaves",
    "tells the light",
    "is calling to say",
    "is on the line to say",
    "leaves a message:",
    "writes in the air that",
    "carves into the silence:",
    "is shouting across the sky that",
    "argues with the clouds that",
    "sings to no one that",
    "warns the other birds that",
    "reports from the treetops:",
    "asks if you noticed",
]

# Which clock decides the phrase:
#   "bird" = the local time where the bird was recorded (California birds use California time)
#   "here" = your own clock, where the fax is (New York)
TIME_FROM = "bird"

# What each bird says, by the hour (from, to, [phrases]).
# Hours are 0-24; "to" is not included (10-13 means 10:00 to 12:59).
# One phrase is picked at random from each list.
TIME_PHRASES = [
    (5, 10, [
        "the light is still deciding, and so are you",
        "morning doesn't ask if you are ready",
        "the dew was here before you woke, and it will leave without a word",
        "I sing the first song as if it were the only one",
        "the sun is only rehearsing, you can rehearse too",
        "everything is beginning again, even you",
        "the river woke up before anyone and never needed a reason",
        "today hasn't happened yet, it is still yours",
        "the fog is lifting, nothing was ever hidden",
        "morning is opening one eye, you may open yours slowly",
        "I don't remember yesterday, that's how I begin",
        "the first light touches everything without choosing",
    ]),
    (10, 13, [
        "at noon even the shadows rest under the trees",
        "the day is halfway, and nothing is missing",
        "the trees are drinking the light without hurry",
        "I sing at midday so you remember you are here",
        "the heat makes everything slower, and slower is true",
        "you are exactly in the middle of something",
        "the bees don't know what time it is, and they arrive",
        "the sky is so open it has no edges",
        "nothing grows faster because you watch it",
        "the hour is full, you don't have to fill it",
        "the sun is not going anywhere, and neither am I",
        "the light falls straight down and leaves nothing out",
    ]),
    (13, 15, [
        "the afternoon is long enough to forget what you were waiting for",
        "even the wind took a nap",
        "the day is resting on its side, rest with it",
        "nothing is urgent to a tree",
        "I sing between two silences, that is all a song is",
        "the clouds are moving at the speed of thinking",
        "you are allowed to do nothing for a while",
        "the warm air holds every sound a little longer",
        "the afternoon doesn't explain itself",
        "the bees are humming the note they hummed a thousand years ago",
        "half of today is already a memory",
        "the light is getting heavy and the branches let it",
    ]),
    (15, 17, [
        "the shadows are growing, they only want to touch you",
        "the light is leaning, it knows it has to go",
        "the day is getting older, and kinder",
        "the honey hour has begun, slow down to taste it",
        "everything that happened today is already becoming soft",
        "I sing to the long shadows as if they could answer",
        "the afternoon is folding its edges",
        "there is still time, there is always a little time",
        "what you didn't finish today can stay unfinished",
        "the trees are remembering the morning",
        "the warm stones keep the day for later",
        "the light is turning slow, like a thought you almost had",
    ]),
    (17, 19, [
        "the light is leaving, you don't have to hold it",
        "the sun goes down without goodbyes and returns without asking",
        "the sky turns orange to make the ending gentle",
        "every sunset is the first one for someone",
        "the horizon is swallowing the sun, and the sun lets it",
        "the day is saying goodbye in pink, say goodbye too",
        "the windows are on fire and nobody is afraid",
        "I sing the day closed, like a door you can open tomorrow",
        "the golden hour is short because it is golden",
        "everything is glowing for a moment, including you",
        "the light is pouring into the valleys, it leaves nothing out",
        "the sky is blushing, it has seen everything today",
    ]),
    (19, 22, [
        "the dark is arriving softly, it doesn't want to scare you",
        "the first stars were always there, you just couldn't see them",
        "the evening forgives the day",
        "the lanterns are on, someone is waiting for someone",
        "the night is putting the world away, one tree at a time",
        "I sing the last song so the night knows where I am",
        "the air is cooling, it is time to be gentle",
        "the street is quiet, listen to what stayed",
        "the moon is rising slowly, as if it had all the time",
        "the day is over, nothing more is asked of you",
        "the dark is settling in the leaves, settle with it",
        "tonight you don't need to know what comes next",
    ]),
    (22, 24, [
        "it's late, and late is also a place",
        "the stars are older than every word you know",
        "you should be sleeping, but I'm glad you're listening",
        "the night is deep enough to hold everything you carry",
        "everyone is dreaming, and the dreams are touching",
        "the moon is listening, it has always listened",
        "tomorrow is coming, it doesn't need your help",
        "the dark doesn't hide things, it rests them",
        "the night is the same night everywhere",
        "I'm singing in the dark because the dark needs songs too",
        "the owls are awake, keeping watch for you",
        "the silence is growing roots",
    ]),
    (0, 5, [
        "the dark is at its deepest, and still the world goes on turning",
        "morning is still far away, and that's alright",
        "this is the hour when nothing needs to be decided",
        "the stars don't know your name, and they shine anyway",
        "you are awake in the deepest part of the night, like me",
        "the earth is turning slowly toward the light",
        "even the wind is asleep, you may sleep too",
        "the night is singing to itself, I'm only repeating it",
        "nothing is lost in the dark, only waiting",
        "the dreams are flying low tonight",
        "someone, somewhere, is listening to the same silence",
        "the night will end, it always has",
    ]),
]

BIRD_IMAGE = "bird.png"    # the drawing to print (put it in the same folder as this script)
BIRD_SIZE_CM = 5           # the drawing fits inside a square of this size
BIRD_ALIGN = "center"      # "left", "center" or "right" on the paper
BIRD_THRESHOLD = 170       # 0-255: higher = darker, thicker lines; lower = lighter
FINE_RESOLUTION = True     # print the drawing at fine resolution (sharper) if the fax supports it
PRINT_SPECTROGRAM = True   # include the picture of the call (needs numpy)
SPECTROGRAM_BLUR = 8       # how blurry the spectrogram is (0 = sharp, 4 = soft, 12+ = very blurry)
FAX_ANSWER_WAIT = 20       # seconds to wait for the fax to start receiving
                           #   (press STOP on the fax to say no: after this time the program moves on)
FAX_DIAL = "*51"           # tones dialed before sending: *51 = the fax's "Fax Receive Code",
                           #   which makes it start receiving by itself (no START needed).
                           #   Use "1" to go back to pressing START by hand.
REVERSE_BITS = True        # if the print comes out as random stripes, try False
FAX_DEBUG = True           # shows every message exchanged with the fax (for troubleshooting)
# ------------------------------------------

SAMPLE_RATE = 8000     # samples per second the phone line understands
DLE, ETX = b"\x10", b"\x03"
BIRDWEATHER_URL = "https://app.birdweather.com/graphql"


# ================= MODEM =================

def find_port():
    ports = sorted(glob.glob("/dev/cu.usbmodem*"))
    if not ports:
        sys.exit("Can't find the modem. Is it plugged in? Did you quit screen?")
    return ports[0]


LAST_GOOD_RATE = None      # the fax speed that worked last time (tried first)


class Modem:
    def __init__(self, port):
        try:
            self.s = serial.Serial(port, 115200, timeout=0.2, rtscts=True)
        except serial.SerialException as e:
            sys.exit(f"Couldn't open the modem ({e}).\n"
                     "If screen is still open, quit it. Otherwise, unplug the "
                     "modem and plug it back in.")
        time.sleep(0.5)
        self.s.reset_input_buffer()
        self.encoding = None
        self.rx = bytearray()

    def cmd(self, command, timeout=5, show=False):
        """Sends an AT command and waits for OK / ERROR / CONNECT."""
        self.s.reset_input_buffer()
        self.s.write((command + "\r").encode())
        deadline = time.time() + timeout
        text = ""
        while time.time() < deadline:
            data = self.s.read(self.s.in_waiting or 1)
            if data:
                text += data.decode("latin-1")
                lines = [l.strip() for l in text.splitlines()]
                if any(l in ("OK", "ERROR", "CONNECT", "NO CARRIER") for l in lines):
                    break
        if show:
            print(f"> {command}\n{text.strip()}\n")
        return text

    def setup_voice(self, quiet=False):
        if "OK" not in self.cmd("AT"):
            sys.exit("The modem doesn't answer AT. Unplug it, plug it back in, "
                     "and quit screen if it's open.")
        self.cmd("ATE0")
        self.cmd("ATH")
        self.cmd("AT+FCLASS=8")
        listing = self.cmd("AT+VSM=?")

        # Look for an 8-bit format we know how to generate.
        # µ-law first: it's what real telephony uses and it sounds cleaner.
        preferences = [("G.711U", "ulaw"), ("G711U", "ulaw"), ("ULAW", "ulaw"),
                       ("U-LAW", "ulaw"), ("MU-LAW", "ulaw"),
                       ("UNSIGNED PCM", "u8"), ("SIGNED PCM", "s8")]
        candidates = []
        for line in listing.splitlines():
            m = re.search(r'(\d+)\s*,\s*"([^"]+)"\s*,\s*(\d+)', line)
            if not m:
                continue
            code, name, bits = int(m.group(1)), m.group(2).upper(), int(m.group(3))
            if bits != 8:
                continue
            for i, (key, enc) in enumerate(preferences):
                if name.startswith(key) and not (key == "SIGNED PCM" and "UNSIGNED" in name):
                    candidates.append((i, code, enc, name))
        candidates.sort()

        for _, code, enc, name in candidates:
            for attempt in (f"AT+VSM={code},{SAMPLE_RATE}", f"AT+VSM={code}"):
                if "OK" in self.cmd(attempt):
                    self.encoding = enc
                    if not quiet:
                        print(f"Audio format: {name} (code {code}), {SAMPLE_RATE} Hz")
                    return

        print("Modem response to AT+VSM=?:\n", listing)
        sys.exit("Couldn't find an audio format I know how to use. "
                 "Send this response to Claude.")

    def play(self, samples16):
        """Sends a list of 16-bit samples (8000 per second) down the line."""
        data = to_8bit(samples16, self.encoding)

        if "OK" not in self.cmd("AT+VLS=1"):
            print("The modem couldn't take the line (AT+VLS=1).")
            return "FAILED"
        r = self.cmd("AT+VTX", timeout=5)
        if "CONNECT" not in r:
            print("The modem didn't accept audio (AT+VTX):", r.strip())
            self.cmd("AT+VLS=0")
            return "FAILED"

        chunk = 400                   # 50 ms of audio
        lead = 0.25                   # keeps the modem's buffer filled
        start = time.time()
        events = bytearray()
        skipped = None
        for i in range(0, len(data), chunk):
            piece = data[i:i + chunk].replace(DLE, DLE + DLE)
            self.s.write(piece)
            # the modem reports keypad tones it hears as DLE + the key
            if self.s.in_waiting:
                events += self.s.read(self.s.in_waiting)
                key = keypad_key(events)
                if key and SKIP_WITH_KEYPAD:
                    skipped = key
                    break
            wait = start + (i + chunk) / SAMPLE_RATE - lead - time.time()
            if wait > 0:
                time.sleep(wait)
        if skipped:
            self.s.write(DLE + b"\x18")   # DLE CAN: drop the audio still in the modem
        self.s.write(DLE + ETX)       # "end of audio"
        self.s.flush()

        # wait for playback to finish and for the OK
        deadline = time.time() + lead + 3
        text = ""
        while time.time() < deadline and "OK" not in text:
            text += self.s.read(self.s.in_waiting or 1).decode("latin-1")
        self.cmd("AT+VLS=0")
        if FAX_DEBUG and events:
            print(f"      [modem events] {bytes(events)!r}")
        return skipped

    # ---------- Fax: sending one page (ITU T.30, Class 1 modem) ----------

    def _write_cmd(self, command):
        self.rx = bytearray()
        self.s.reset_input_buffer()
        self.s.write((command + "\r").encode())

    def _result(self, timeout, wanted=("OK", "CONNECT", "ERROR", "NO CARRIER", "+FCERROR",
                                       "BUSY", "NO DIALTONE", "NO ANSWER")):
        """Waits for one of the modem's result lines; keeps any data that follows it."""
        deadline = time.time() + timeout
        while True:
            while b"\n" in self.rx:
                i = self.rx.index(b"\n")
                line = bytes(self.rx[:i]).strip().decode("latin-1")
                del self.rx[:i + 1]
                if line in wanted:
                    return line
                if line and FAX_DEBUG:
                    print(f"      [modem said] {line!r}")
            if time.time() > deadline:
                return None
            self.rx += self.s.read(self.s.in_waiting or 1)

    def _at(self, command, timeout=5):
        self._write_cmd(command)
        r = self._result(timeout)
        if FAX_DEBUG:
            print(f"      [mac] {command} -> {r}")
        return r

    def _read_frame(self, timeout=10):
        frame, ok = self._read_frame_raw(timeout)
        if FAX_DEBUG:
            print(f"      [fax -> mac] {frame.hex(' ')}  ({'OK' if ok else 'not OK'})")
        return frame, ok

    def _read_frame_raw(self, timeout=10):
        """Reads one HDLC frame from the fax (it ends with DLE ETX), then OK/ERROR."""
        deadline = time.time() + timeout
        frame = bytearray()
        i = 0
        while True:
            while i < len(self.rx):
                b = self.rx[i]
                if b == 0x10:
                    if i + 1 >= len(self.rx):
                        break                       # wait for the byte after DLE
                    nxt = self.rx[i + 1]
                    i += 2
                    if nxt == 0x03:                 # DLE ETX = end of frame
                        del self.rx[:i]
                        ok = self._result(5, ("OK", "ERROR")) == "OK"
                        return bytes(frame), ok
                    if nxt == 0x10:
                        frame.append(0x10)
                    continue
                frame.append(b)
                i += 1
            if time.time() > deadline:
                return bytes(frame), False
            self.rx += self.s.read(self.s.in_waiting or 1)

    def _listen(self, timeout=10):
        """AT+FRH=3 (listen for the fax's reply), retrying if the modem says +FCERROR."""
        for _ in range(4):
            r = self._at("AT+FRH=3", timeout)
            if r != "+FCERROR":
                return r
        return r

    def _send_frame(self, fcf, fif=b""):
        """Sends one final HDLC frame (V.21, 300 bps)."""
        self._at("AT+FTS=8")
        if self._at("AT+FTH=3", 10) != "CONNECT":
            return False
        frame = bytes([0xFF, 0x13, fcf]) + fif
        self.s.write(frame.replace(DLE, DLE + DLE) + DLE + ETX)
        return self._result(10) == "OK"

    def _send_data(self, rate, data):
        """Sends high-speed data (training or the page). rate 96 = 9600 bps."""
        if self._at(f"AT+FTM={rate}", 10) != "CONNECT":
            return False
        bps = rate * 100
        start = time.time()
        chunk = 256
        for i in range(0, len(data), chunk):
            self.s.write(data[i:i + chunk].replace(DLE, DLE + DLE))
            wait = start + (i + chunk) * 8 / bps - 0.5 - time.time()
            if wait > 0:
                time.sleep(wait)
        self.s.write(DLE + ETX)
        return self._result(len(data) * 8 / bps + 15) == "OK"

    def send_fax(self, make_page, can_fine=False):
        """Calls the fax and sends one page.
        make_page(bps, min_ms, fine) returns the page bytes."""
        self._at("ATH")
        self._at("AT+FCLASS=1")
        self._at(f"ATS7={FAX_ANSWER_WAIT}")
        self._at("ATX3")
        if FAX_DIAL.endswith("51"):
            print("   calling the fax (it should start receiving by itself;"
                  " if not, press START)")
        else:
            print("   >>> press START on the fax to print")
        self._write_cmd(f"ATDT{FAX_DIAL}")
        r = self._result(FAX_ANSWER_WAIT + 5)
        if FAX_DEBUG:
            print(f"      [mac] ATDT{FAX_DIAL} -> {r}")
        if r != "CONNECT":
            print("   the fax said no (it didn't answer) — no print this time")
            self._at("ATH")
            return False

        # 1. The fax introduces itself: NSF / CSI / DIS frames
        dis = None
        for _ in range(12):
            frame, ok = self._read_frame(10)
            if ok and len(frame) >= 3 and (frame[2] & 0xFE) == 0x80:     # DIS
                dis = frame[3:]
                break
            # not DIS yet (NSF/CSI, or a damaged frame): listen for the next one
            if self._listen(10) != "CONNECT":
                if FAX_DEBUG and self.rx:
                    print(f"      [leftover] {bytes(self.rx)[:80]!r}")
                break
        if dis is None or len(dis) < 3:
            print("   didn't receive the fax's introduction (DIS)")
            self._at("ATH")
            return False

        # 2. Pick a speed the fax supports and test it (DCS + training)
        caps = dis[1]
        rates = []
        if caps & 0x04:
            rates += [(96, 0x04), (72, 0x0C)]       # V.29: 9600, 7200
        if caps & 0x08:
            rates += [(48, 0x08)]                   # V.27ter: 4800
        rates += [(24, 0x00)]                       # V.27ter: 2400
        min_ms = 40 if (dis[2] & 0x70) == 0x40 else 20
        scan_bits = 0x40 if min_ms == 40 else 0x00
        fine = bool(can_fine and FINE_RESOLUTION and (caps & 0x40))
        res_bits = 0x40 if fine else 0x00
        global LAST_GOOD_RATE
        if LAST_GOOD_RATE in [r for r, _ in rates]:          # start with the speed that worked last time
            rates.sort(key=lambda rb: rb[0] != LAST_GOOD_RATE)
        chosen = None
        for rate, rate_bits in rates:
            dcs = bytes([0x00, 0x02 | rate_bits | res_bits, scan_bits])
            if not self._send_frame(0x83, dcs):     # DCS
                continue
            self._at("AT+FTS=8")
            self._send_data(rate, bytes(rate * 100 * 3 // 16))   # TCF: 1.5 s of zeros
            if self._listen(10) != "CONNECT":
                continue
            frame, ok = self._read_frame(10)
            if ok and len(frame) >= 3 and (frame[2] & 0xFE) == 0x84:     # CFR = ready
                chosen = rate
                LAST_GOOD_RATE = rate
                break
            print(f"   {rate * 100} bps didn't work, trying slower...")
        if not chosen:
            print("   couldn't agree on a speed with the fax")
            self._send_frame(0xFB)
            self._at("ATH")
            return False

        # 3. The page
        print(f"   connected at {chosen * 100} bps"
              f"{', fine resolution' if fine else ''}, sending the page...")
        page = make_page(chosen * 100, min_ms, fine)
        if not self._send_data(chosen, page):
            print("   problem while sending the page")

        # 4. End of page (EOP), confirmation (MCF), goodbye (DCN)
        self._send_frame(0x2F)
        confirmed = False
        if self._listen(10) == "CONNECT":
            frame, ok = self._read_frame(10)
            confirmed = ok and len(frame) >= 3 and (frame[2] & 0xFE) == 0x8C
        print("   the fax confirmed the page" if confirmed
              else "   the fax didn't confirm the page clearly")
        self._send_frame(0xFB)
        self._at("ATH")
        return True

    def close(self):
        try:
            self.cmd("AT+VLS=0")
            self.cmd("ATH")
            self.cmd("AT+FCLASS=0")
        finally:
            self.s.close()


# ================= AUDIO =================

KEYPAD = b"0123456789*#ABCD"


def keypad_key(events):
    """Finds a keypad tone in the modem's voice-mode events (DLE followed by the key)."""
    i = 0
    while i < len(events) - 1:
        if events[i] == 0x10:
            nxt = events[i + 1]
            if nxt in KEYPAD:
                return chr(nxt)
            i += 2
            continue
        i += 1
    return None

def to_ulaw(s):
    sign = 0x80 if s < 0 else 0
    s = min(abs(s), 32635) + 0x84
    exp, mask = 7, 0x4000
    while exp > 0 and not (s & mask):
        exp -= 1
        mask >>= 1
    mantissa = (s >> (exp + 3)) & 0x0F
    return (~(sign | (exp << 4) | mantissa)) & 0xFF


def to_8bit(samples, encoding):
    if encoding == "u8":
        return bytes(((s >> 8) + 128) & 0xFF for s in samples)
    if encoding == "s8":
        return bytes((s >> 8) & 0xFF for s in samples)
    return bytes(to_ulaw(s) for s in samples)


def normalize(samples):
    peak = max((abs(s) for s in samples), default=0)
    if peak == 0:
        return samples
    f = 32000 * VOLUME / peak
    return array.array("h", (int(s * f) for s in samples))


LAST_OCTAVE = False


def trim(samples, rate, start=None, end=None):
    """Keeps only start..end seconds (plus CLIP_PADDING on each side)."""
    if start is None or end is None or not ONLY_THE_CALL:
        return samples
    a = max(0, int((start - CLIP_PADDING) * rate))
    b = min(len(samples), int((end + CLIP_PADDING) * rate))
    return samples[a:b] if b - a > rate // 4 else samples


def mostly_too_high(samples, rate):
    """True if most of the call's energy is above what the phone line lets through."""
    x = [float(s) for s in samples]
    if len(x) < rate // 4:
        return False
    high = biquad(biquad(x, rate, 3600, "highpass"), rate, 3600, "highpass")
    band = biquad(x, rate, 1000, "highpass")
    band = biquad(biquad(band, rate, 3200, "lowpass"), rate, 3200, "lowpass")
    energy = lambda m: sum(v * v for v in m)
    return energy(high) > energy(band)


LAST_IN_BAND = 1.0


def band_share(x, rate, lo, hi):
    """Share of the call's loud moments that falls between lo and hi Hz."""
    total = biquad(biquad(x, rate, 400, "highpass"), rate, 400, "highpass")
    band = biquad(biquad(x, rate, lo, "highpass"), rate, lo, "highpass")
    band = biquad(biquad(band, rate, hi, "lowpass"), rate, hi, "lowpass")
    step = max(1, int(rate * 0.05))
    windows = [(sum(v * v for v in total[i:i + step]), sum(v * v for v in band[i:i + step]))
               for i in range(0, len(x) - step, step)]
    if not windows:
        return 0.0
    windows.sort(reverse=True)
    loud = windows[:max(1, len(windows) // 5)]          # the loudest 20% = the call
    t = sum(a for a, _ in loud)
    return sum(b for _, b in loud) / t if t else 0.0


def load_audio(path, start=None, end=None):
    """Any audio -> cleaned samples ready for the phone line (8000 per second).
    start/end (seconds) = where the bird is in the recording."""
    global LAST_OCTAVE, LAST_IN_BAND
    octave = OCTAVE_DOWN
    # look at the whole recording (up to 16 kHz) to see how much of the call the phone can carry
    wide_rate = 32000
    wide = [float(s) for s in trim(convert_audio(path, wide_rate), wide_rate, start, end)
            [:wide_rate * MAX_SECONDS]]
    normal = band_share(wide, wide_rate, LOW_CUT, HIGH_CUT)
    lower = band_share(wide, wide_rate, LOW_CUT * 2, min(HIGH_CUT * 2, wide_rate / 2 - 500))
    if not octave and AUTO_OCTAVE:
        octave = normal < 0.4 and lower > normal * 1.3   # too high as it is, fits an octave lower
    LAST_IN_BAND = lower if octave else normal
    LAST_OCTAVE = octave
    if octave:
        # recorded at 16000/s but played at 8000/s: half speed, one octave lower
        rate = SAMPLE_RATE * 2
        samples = trim(convert_audio(path, rate), rate, start, end)
        samples = samples[:SAMPLE_RATE * MAX_SECONDS]
        return clean(samples, rate, scale=2)
    samples = trim(convert_audio(path, SAMPLE_RATE), SAMPLE_RATE, start, end)
    return clean(samples[:SAMPLE_RATE * MAX_SECONDS], SAMPLE_RATE)


def convert_audio(path, rate):
    """Any audio file -> mono 16-bit samples at the given rate."""
    with tempfile.TemporaryDirectory() as folder:
        out = os.path.join(folder, "line.wav")
        done = False
        if shutil.which("afconvert"):
            r = subprocess.run(["afconvert", path, "-o", out, "-f", "WAVE",
                                "-d", f"LEI16@{rate}", "-c", "1"],
                               capture_output=True)
            done = r.returncode == 0
        if not done and shutil.which("ffmpeg"):
            r = subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", path,
                                "-ac", "1", "-ar", str(rate), "-sample_fmt", "s16",
                                out], capture_output=True)
            done = r.returncode == 0
        if not done:
            raise RuntimeError("couldn't convert the audio (try installing ffmpeg: "
                               "brew install ffmpeg)")
        return read_wav_16(out)


# ---------- Cleaning up the call ----------

def biquad(samples, rate, frequency, kind):
    """2nd-order filter (high-pass or low-pass)."""
    w = 2 * math.pi * frequency / rate
    alpha = math.sin(w) / (2 * 0.7071)
    c = math.cos(w)
    if kind == "highpass":
        b0, b1, b2 = (1 + c) / 2, -(1 + c), (1 + c) / 2
    else:
        b0, b1, b2 = (1 - c) / 2, 1 - c, (1 - c) / 2
    a0, a1, a2 = 1 + alpha, -2 * c, 1 - alpha
    b0, b1, b2, a1, a2 = b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0
    x1 = x2 = y1 = y2 = 0.0
    out = []
    for x in samples:
        y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2
        x2, x1, y2, y1 = x1, x, y1, y
        out.append(y)
    return out


def noise_gate(samples, rate, relative_threshold):
    """Smoothly silences the stretches where there's no call."""
    peak = max((abs(s) for s in samples), default=0)
    if peak == 0 or relative_threshold <= 0:
        return samples
    threshold = peak * relative_threshold
    env_decay = math.exp(-1 / (0.05 * rate))     # follows the level (50 ms)
    attack = math.exp(-1 / (0.005 * rate))       # opens fast (5 ms)
    release = math.exp(-1 / (0.12 * rate))       # closes gently (120 ms)
    env = gain = 0.0
    out = []
    for s in samples:
        env = max(abs(s), env * env_decay)
        target = 1.0 if env > threshold else 0.0
        k = attack if target > gain else release
        gain = target + (gain - target) * k
        out.append(s * gain)
    return out


def clarity_db(samples, rate):
    """Compares the loudest moments (the call) with the background (the grass)."""
    step = max(1, int(rate * 0.05))               # 50 ms windows
    levels = []
    for i in range(0, len(samples) - step, step):
        piece = samples[i:i + step]
        levels.append((sum(s * s for s in piece) / step) ** 0.5)
    if len(levels) < 4:
        return 0.0
    levels.sort()
    background = levels[int(len(levels) * 0.3)] or 1e-9
    call = levels[int(len(levels) * 0.95)]
    return 20 * math.log10(max(call, 1e-9) / background)


LAST_CLARITY = 0.0
LAST_AUDIBLE = 0.0


def audible_seconds(samples, rate, scale=1):
    """How many seconds of the cleaned call can really be heard (not silenced by the gate)."""
    step = max(1, int(rate * 0.05))
    levels = [(sum(s * s for s in samples[i:i + step]) / step) ** 0.5
              for i in range(0, len(samples) - step, step)]
    if not levels or max(levels) == 0:
        return 0.0
    loud = max(levels) * 0.1                      # within 20 dB of the loudest moment
    return sum(1 for v in levels if v >= loud) * 0.05 * scale


def clean(samples, rate, scale=1):
    """scale=2 when the sound will be played an octave lower (its pitches halve)."""
    global LAST_CLARITY, LAST_AUDIBLE
    m = [float(s) for s in samples]
    for _ in range(2):                            # two passes = steeper cut
        if LOW_CUT:
            m = biquad(m, rate, LOW_CUT * scale, "highpass")
        if HIGH_CUT and HIGH_CUT * scale < rate / 2:
            m = biquad(m, rate, HIGH_CUT * scale, "lowpass")
    LAST_CLARITY = clarity_db(m, rate)
    m = noise_gate(m, rate, NOISE_GATE)
    LAST_AUDIBLE = audible_seconds(m, rate, scale)
    m = array.array("h", (max(-32767, min(32767, int(s))) for s in m))
    return normalize(m)


def read_wav_16(path):
    """Reads the samples of a 16-bit mono WAV (any header variant)."""
    with open(path, "rb") as f:
        data = f.read()
    if data[:4] != b"RIFF" or data[8:12] != b"WAVE":
        raise RuntimeError("the converted audio isn't a valid WAV")
    i = 12
    while i + 8 <= len(data):
        name = data[i:i + 4]
        size = int.from_bytes(data[i + 4:i + 8], "little")
        if name == b"data":
            raw = data[i + 8:i + 8 + size]
            raw = raw[:len(raw) // 2 * 2]
            m = array.array("h")
            m.frombytes(raw)
            if sys.byteorder == "big":
                m.byteswap()
            return m
        i += 8 + size + (size % 2)
    raise RuntimeError("couldn't find audio inside the WAV")


def test_call():
    """A synthetic bird: rising chirps, within the telephone range."""
    m = array.array("h")
    phase = 0.0
    for note in range(5):
        dur = 0.12
        f0, f1 = 1400 + note * 150, 2900 - note * 100
        n = int(SAMPLE_RATE * dur)
        for i in range(n):
            t = i / n
            f = f0 + (f1 - f0) * t
            phase += 2 * math.pi * f / SAMPLE_RATE
            envelope = math.sin(math.pi * t)
            m.append(int(20000 * envelope * math.sin(phase)))
        m.extend([0] * int(SAMPLE_RATE * 0.08))
    return m


# ================= PRINTING =================

# Monospaced, terminal-style fonts (the first one found is used)
FONTS = ("/System/Library/Fonts/Menlo.ttc",
         "/System/Library/Fonts/Monaco.ttf",
         "/System/Library/Fonts/SFNSMono.ttf",
         "/System/Library/Fonts/Courier.ttc",
         "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf")

# Fonts for writing systems the terminal font doesn't have (Korean, Japanese, Chinese,
# Arabic, Hebrew, Thai...). The first one found on the computer is used.
FALLBACK_FONTS = ("/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
                  "/Library/Fonts/Arial Unicode.ttf",
                  "/System/Library/Fonts/AppleSDGothicNeo.ttc",
                  "/System/Library/Fonts/Hiragino Sans GB.ttc",
                  "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc")

EOL = "000000000001"          # fax "end of line" code
REVERSE_TABLE = bytes(int(f"{i:08b}"[::-1], 2) for i in range(256))
FAX_WIDTH = 1728              # dots per line on a standard fax


def pillow():
    try:
        from PIL import Image, ImageDraw, ImageFont, ImageOps
    except ImportError:
        raise RuntimeError("printing needs Pillow. Install it with: "
                           "python3 -m pip install pillow numpy")
    return Image, ImageDraw, ImageFont, ImageOps


def load_font(size):
    _, _, ImageFont, _ = pillow()
    for path in FONTS:
        try:
            return ImageFont.truetype(path, size)
        except OSError:
            pass
    try:
        return ImageFont.load_default(size)
    except TypeError:
        return ImageFont.load_default()


def load_bold_font(size):
    """Bold version of the terminal font. Returns (font, needs_fake_bold)."""
    _, _, ImageFont, _ = pillow()
    candidates = [("/System/Library/Fonts/Menlo.ttc", 1),          # Menlo Bold
                  ("/System/Library/Fonts/SFNSMono.ttf", 0),
                  ("/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf", 0)]
    for path, index in candidates:
        try:
            f = ImageFont.truetype(path, size, index=index)
            if "bold" in " ".join(f.getname()).lower():
                return f, False
        except OSError:
            pass
    return load_font(size), True                    # no bold file: thicken the strokes


def spectrogram_image(samples, rate, width, height):
    """Picture of the sound: time left to right, pitch bottom to top, darker = louder."""
    try:
        import numpy as np
    except ImportError:
        print("   (no spectrogram: install numpy with  python3 -m pip install numpy)")
        return None
    Image, _, _, _ = pillow()
    x = np.asarray(samples, dtype=np.float32)
    n, hop = 512, 128
    if len(x) < n * 2:
        return None
    frames = 1 + (len(x) - n) // hop
    idx = np.arange(n)[None, :] + hop * np.arange(frames)[:, None]
    spec = np.abs(np.fft.rfft(x[idx] * np.hanning(n).astype(np.float32), axis=1))
    db = 20 * np.log10(spec + 1e-6)
    lo, hi = np.percentile(db, 60), np.percentile(db, 99.7)
    v = np.clip((db - lo) / (hi - lo + 1e-9), 0, 1) ** 0.8
    pixels = (255 * (1 - v)).astype(np.uint8).T[::-1]
    img = Image.fromarray(np.ascontiguousarray(pixels), "L").resize(
        (width, height), Image.BILINEAR)
    if SPECTROGRAM_BLUR:
        from PIL import ImageFilter
        img = img.filter(ImageFilter.GaussianBlur(SPECTROGRAM_BLUR))
    return img


def make_card(lines, samples=None, rate=16000):
    """Builds the printed card. lines = [(text, size), ...].
    Drawn with square pixels, then squashed to the fax's standard resolution."""
    Image, ImageDraw, _, ImageOps = pillow()
    margin, gap = 70, 18
    fonts = [(text, load_font(size)) for text, size in lines]
    text_h = sum(f.getbbox(t or " ")[3] + gap for t, f in fonts)
    spec_h = 620
    spec = None
    if samples is not None and PRINT_SPECTROGRAM:
        spec = spectrogram_image(samples, rate, FAX_WIDTH - 2 * margin, spec_h)
    height = margin + text_h + (spec_h + 140 if spec else 0) + margin
    card = Image.new("L", (FAX_WIDTH, height), 255)
    d = ImageDraw.Draw(card)
    y = margin
    for t, f in fonts:
        d.text((margin, y), t, font=f, fill=0)
        y += f.getbbox(t or " ")[3] + gap
    if spec:
        y += 40
        card.paste(spec, (margin, y))
        x0, x1, y0, y1 = margin, FAX_WIDTH - margin, y, y + spec_h
        d.rectangle([x0, y0, x1, y1], outline=0, width=3)
        top_hz = rate / 2
        small = load_font(30)
        for hz in range(0, int(top_hz) + 1, 2000):
            yy = y1 - (y1 - y0) * hz / top_hz
            d.line([x0 - 15, yy, x0, yy], fill=0, width=3)
            label_y = yy - 44 if hz else yy - 46
            box = d.textbbox((x0 + 10, label_y), f"{hz // 1000}k", font=small)
            d.rectangle([box[0] - 6, box[1] - 4, box[2] + 6, box[3] + 4], fill=255)
            d.text((x0 + 10, label_y), f"{hz // 1000}k", font=small, fill=0)
        if 3400 < top_hz:                           # what the phone line lets through
            yy = y1 - (y1 - y0) * 3400 / top_hz
            for xx in range(x0, x1, 40):
                d.line([xx, yy, min(xx + 20, x1), yy], fill=0, width=3)
            label = "3.4 kHz phone line limit"
            box = d.textbbox((x1 - 600, yy - 48), label, font=small)
            d.rectangle([box[0] - 8, box[1] - 4, box[2] + 8, box[3] + 4], fill=255)
            d.text((x1 - 600, yy - 48), label, font=small, fill=0)
    # standard fax resolution: lines are twice as tall as dots are wide
    std = card.resize((FAX_WIDTH, max(1, min(1100, height // 2))), Image.LANCZOS)
    return std


DOTS_PER_MM = FAX_WIDTH / 215     # ≈ 8 dots per mm across the paper
LINES_PER_MM = 3.85               # standard fax resolution, down the paper


def illustration_card(lines_per_mm=LINES_PER_MM):
    """Only the bird drawing, at most BIRD_SIZE_CM x BIRD_SIZE_CM.
    lines_per_mm: 3.85 = standard fax resolution, 7.7 = fine."""
    Image, _, _, ImageOps = pillow()
    path = BIRD_IMAGE
    if not os.path.isabs(path):
        path = os.path.join(os.path.dirname(os.path.abspath(__file__)), path)
    if not os.path.exists(path):
        raise RuntimeError(f"can't find the drawing {path}")
    art = Image.open(path).convert("L")
    box = ImageOps.invert(art.point(lambda v: 255 if v > 245 else 0)).getbbox()
    if box:                                         # trim the white border
        art = art.crop(box)
    side_mm = BIRD_SIZE_CM * 10
    scale = min(side_mm / art.width, side_mm / art.height)   # mm per source pixel
    w = max(1, round(art.width * scale * DOTS_PER_MM))
    h = max(1, round(art.height * scale * lines_per_mm))
    art = art.resize((w, h), Image.LANCZOS)
    art = art.point(lambda v: 255 if v > BIRD_THRESHOLD else 0)
    margin = round(4 * lines_per_mm)                # 4 mm of paper above and below
    page = Image.new("L", (FAX_WIDTH, h + 2 * margin), 255)
    x = {"left": 80, "right": FAX_WIDTH - w - 80}.get(BIRD_ALIGN, (FAX_WIDTH - w) // 2)
    page.paste(art, (x, margin))
    return page


def local_hour(d):
    """Hour of the day that decides the phrase (see TIME_FROM)."""
    from datetime import datetime
    if TIME_FROM == "here":
        now = datetime.now()
        return now.hour + now.minute / 60
    try:
        t = datetime.fromisoformat(d["timestamp"].replace("Z", "+00:00"))
    except (ValueError, KeyError):
        return None
    tz_name = (d.get("station") or {}).get("timezone")
    if tz_name:
        try:
            from zoneinfo import ZoneInfo
            t = t.astimezone(ZoneInfo(tz_name))
        except Exception:
            pass
    return t.hour + t.minute / 60


HISTORY_FILE = "phrase_history.json"   # remembers recent phrases, even after restarting
_recent = None


def _history_path():
    return os.path.join(os.path.dirname(os.path.abspath(__file__)), HISTORY_FILE)


def _load_history():
    global _recent
    if _recent is None:
        try:
            with open(_history_path()) as f:
                _recent = json.load(f)
        except (OSError, ValueError):
            _recent = {}
    return _recent


def pick(options, kind):
    """Random choice that avoids the last NO_REPEAT picks of the same kind
    (each time of day has its own kind, so its own memory)."""
    if isinstance(options, str):
        return options
    history = _load_history()
    recent = history.setdefault(kind, [])
    keep = max(0, min(NO_REPEAT, len(options) - 1))  # always leave at least one choice
    recent[:] = recent[-keep:] if keep else []
    fresh = [o for o in options if o not in recent] or list(options)
    choice = random.choice(fresh)
    recent.append(choice)
    recent[:] = recent[-keep:] if keep else []
    try:
        with open(_history_path(), "w") as f:
            json.dump(history, f, indent=1)
    except OSError:
        pass
    return choice


# ---------- live weather and climate ----------

_weather_cache = {}
_climate = None


def http_json(url, timeout=20):
    req = urllib.request.Request(url, headers={"User-Agent": "fax-birdsong/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.load(r)


def station_coords(d):
    c = (d.get("station") or {}).get("coords") or d.get("coords") or {}
    if c.get("lat") is None or c.get("lon") is None:
        return None
    return float(c["lat"]), float(c["lon"])


def get_weather(lat, lon):
    """Weather right now where the bird is (cached for 20 minutes)."""
    key = (round(lat, 2), round(lon, 2))
    hit = _weather_cache.get(key)
    if hit and time.time() - hit[0] < 1200:
        return hit[1]
    url = ("https://api.open-meteo.com/v1/forecast?"
           f"latitude={lat:.4f}&longitude={lon:.4f}"
           "&current=temperature_2m,weather_code,wind_speed_10m,is_day,cloud_cover"
           "&daily=temperature_2m_max,sunrise,sunset&timezone=auto&forecast_days=1")
    try:
        data = http_json(url)
    except Exception as e:
        if FAX_DEBUG:
            print(f"      [weather] couldn't get it: {e}")
        return None
    _weather_cache[key] = (time.time(), data)
    return data


def _climate_store():
    global _climate
    if _climate is None:
        try:
            with open(os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                   CLIMATE_CACHE_FILE)) as f:
                _climate = json.load(f)
        except (OSError, ValueError):
            _climate = {}
    return _climate


def old_normal_max(lat, lon, month_day):
    """Average daily maximum for this calendar day (± 7 days) in BASELINE_YEARS, in °C."""
    store = _climate_store()
    key = f"{lat:.1f},{lon:.1f},{BASELINE_YEARS[0]}-{BASELINE_YEARS[1]}"
    if key not in store:
        url = ("https://archive-api.open-meteo.com/v1/archive?"
               f"latitude={lat:.2f}&longitude={lon:.2f}"
               f"&start_date={BASELINE_YEARS[0]}-01-01&end_date={BASELINE_YEARS[1]}-12-31"
               "&daily=temperature_2m_max&timezone=auto")
        try:
            data = http_json(url, timeout=60)
        except Exception as e:
            if FAX_DEBUG:
                print(f"      [climate] couldn't get the old climate: {e}")
            return None
        by_day = {}
        for day, t in zip(data["daily"]["time"], data["daily"]["temperature_2m_max"]):
            if t is not None:
                by_day.setdefault(day[5:], []).append(t)
        store[key] = {md: sum(v) / len(v) for md, v in by_day.items()}
        try:
            with open(os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                   CLIMATE_CACHE_FILE), "w") as f:
                json.dump(store, f)
        except OSError:
            pass
    normals = store[key]
    from datetime import date, timedelta
    base = date(2001, int(month_day[:2]), int(month_day[3:]))   # a year without Feb 29
    values = []
    for k in range(-7, 8):
        md = (base + timedelta(days=k)).strftime("%m-%d")
        if md in normals:
            values.append(normals[md])
    return sum(values) / len(values) if values else None


def temp_text(celsius):
    if TEMP_UNIT.upper() == "F":
        return f"{round(celsius * 9 / 5 + 32)} degrees"
    return f"{round(celsius)} degrees"


def diff_text(delta_c):
    value = abs(delta_c) * (9 / 5 if TEMP_UNIT.upper() == "F" else 1)
    n = round(value, 1)
    n = int(n) if n == int(n) else n
    return f"{n} degree{'s' if n != 1 else ''}"


def local_clock(d, wx):
    """The detection's wall-clock time at the station (naive datetime)."""
    from datetime import datetime, timezone, timedelta
    try:
        t = datetime.fromisoformat(d["timestamp"].replace("Z", "+00:00"))
    except (ValueError, KeyError):
        return None
    if wx and "utc_offset_seconds" in wx and t.tzinfo:
        t = t.astimezone(timezone(timedelta(seconds=wx["utc_offset_seconds"])))
    return t.replace(tzinfo=None)


def solar_hour(d, wx):
    """The hour on a 'standard' day where sunrise is 6:30 and sunset 18:00, so the phrases
    follow the real sun: 'sunset time' is printed when the sun is really setting there."""
    from datetime import datetime, timedelta
    t = local_clock(d, wx)
    try:
        rise = datetime.fromisoformat(wx["daily"]["sunrise"][0])
        sset = datetime.fromisoformat(wx["daily"]["sunset"][0])
    except (KeyError, IndexError, TypeError, ValueError):
        return None
    if t is None or sset <= rise:
        return None
    rise = rise.replace(year=t.year, month=t.month, day=t.day)
    sset = sset.replace(year=t.year, month=t.month, day=t.day)
    day_len = (sset - rise).total_seconds()
    if rise <= t < sset:
        return 6.5 + (t - rise).total_seconds() / day_len * 11.5
    night_len = 86400 - day_len
    since_sunset = ((t - sset).total_seconds()) % 86400
    return (18 + since_sunset / night_len * 12.5) % 24


def weather_phrase(wx):
    """Sometimes a sentence about the real weather there; otherwise None (talk about the hour)."""
    cur = (wx or {}).get("current") or {}
    code, temp = cur.get("weather_code"), cur.get("temperature_2m")
    wind, night = cur.get("wind_speed_10m") or 0, not cur.get("is_day", 1)
    kind = None
    if code is not None:
        if code >= 95:
            kind = "thunder"
        elif 71 <= code <= 77 or code in (85, 86):
            kind = "snow"
        elif 61 <= code <= 67 or 80 <= code <= 82:
            kind = "rain"
        elif 51 <= code <= 57:
            kind = "drizzle"
        elif code in (45, 48):
            kind = "fog"
    if kind is None and wind >= 30:
        kind = "wind"
    if kind is None and temp is not None and temp >= 32 and not night:
        kind = "hot"
    if kind is None and temp is not None and temp <= 0:
        kind = "cold"
    if kind is None:
        if random.random() > CALM_WEATHER_CHANCE:
            return None
        clouds = cur.get("cloud_cover")
        cloudy = clouds >= 60 if clouds is not None else (code or 0) >= 2
        kind = ("cloudy" if cloudy else "clear") + ("_night" if night else "_day")
    elif random.random() > WEATHER_CHANCE:
        return None
    if kind + "_night" in WEATHER_PHRASES and night:
        kind += "_night"
    elif kind not in WEATHER_PHRASES:
        kind = kind.replace("_day", "")
    # weather sentences are never remixed, so they always match the real weather
    if FAX_DEBUG:
        print(f"      [weather] {kind} (code {code}, {temp}°C, wind {wind} km/h)")
    return pick(WEATHER_PHRASES[kind], f"weather {kind}")


def climate_phrase(d, wx):
    """Compares today's maximum with the same day in BASELINE_YEARS, in that same place."""
    where = station_coords(d)
    try:
        today_max = wx["daily"]["temperature_2m_max"][0]
        month_day = wx["daily"]["time"][0][5:]
    except (KeyError, IndexError, TypeError):
        return None, None
    if where is None or today_max is None:
        return None, None
    normal = old_normal_max(*where, month_day)
    if normal is None:
        return None, None
    delta = today_max - normal
    kind = "same" if abs(delta) < CLIMATE_MIN_DIFF else ("warmer" if delta > 0 else "cooler")
    import calendar
    month = calendar.month_name[int(month_day[:2])]
    phrase = pick(CLIMATE_PHRASES[kind], f"climate {kind}")
    return phrase.format(diff=diff_text(delta), month=month), delta


def sentence(text):
    text = text.strip()
    if not text:
        return ""
    text = text[0].upper() + text[1:]
    return text if text[-1] in ".!?:" else text + "."


# {warm} = the side of the world where the warm winters are ("south" in the north, "north" in the south)
# {cold} = the other side
MIGRATION_PHRASES = {
    "autumn":   ["soon it will be time to leave",
                 "my wings already know the way {warm}",
                 "the days are shorter and my heart is packing",
                 "I'm eating for a journey you can't imagine",
                 "tonight I might follow the others {warm}",
                 "I'm saying goodbye to this place without words",
                 "something in me is already flying {warm}"],
    "spring":   ["I just came back from very far away",
                 "I crossed the whole night to sing this",
                 "I brought the warmth back with me from the {warm}",
                 "I'm home again, and I'm tired, and I'm singing",
                 "I remembered the way here without a map"],
    "breeding": ["I came a long way to raise my young here",
                 "this place is only mine for one summer",
                 "in a few weeks this nest will be empty",
                 "I sing so the ones born here remember the way"],
    "winter":   ["I came from the {cold} to wait out the winter here",
                 "I'm only a guest here until spring",
                 "my summer home is far to the {cold}",
                 "I'll leave as soon as the {cold} wakes up"],
    "tropics":  ["I'm only a traveler, this is one of my stops",
                 "my body is a map of two places",
                 "I live between two seasons, never in one"],
    "resident": ["I never leave this place",
                 "while the others leave, I stay and keep the songs",
                 "I was born here and I'll grow old here",
                 "I'll still be here when the travelers come back"],
    "resident_autumn": ["the others are leaving, but I stay",
                        "the sky is full of goodbyes, and I stay",
                        "I'll keep this place warm until they return"],
}

_migration = None


def migration_status(sp):
    """'migrant', 'resident' or None (don't know), read once from the species' Wikipedia
    article and remembered in MIGRATION_CACHE_FILE."""
    global _migration
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), MIGRATION_CACHE_FILE)
    if _migration is None:
        try:
            with open(path) as f:
                _migration = json.load(f)
        except (OSError, ValueError):
            _migration = {}
    name = sp.get("scientificName") or sp.get("commonName")
    if not name:
        return None
    if name in _migration:
        return _migration[name]
    import urllib.parse
    text = ""
    for title in (sp.get("scientificName"), sp.get("commonName")):
        if not title:
            continue
        url = ("https://en.wikipedia.org/w/api.php?action=query&prop=extracts&explaintext=1"
               "&redirects=1&format=json&titles=" + urllib.parse.quote(title))
        try:
            pages = http_json(url)["query"]["pages"]
            text = " ".join(p.get("extract", "") for p in pages.values()).lower()
        except Exception as e:
            if FAX_DEBUG:
                print(f"      [migration] couldn't read Wikipedia: {e}")
            return None                      # not remembered, so it tries again next time
        if text:
            break
    status = migration_from_text(text)
    _migration[name] = status
    try:
        with open(path, "w") as f:
            json.dump(_migration, f, indent=1)
    except OSError:
        pass
    if FAX_DEBUG:
        print(f"      [migration] {name}: {status or 'unknown'}")
    return status


def migration_from_text(text):
    if not text:
        return None
    stays = sum(text.count(w) for w in (
        "non-migratory", "nonmigratory", "not migratory", "sedentary", "does not migrate",
        "year-round resident", "resident year-round", "resident throughout", "largely resident",
        "mostly resident", "mainly resident", "is resident"))
    moves = len(re.findall(r"(?<!non-)(?<!non)migrat", text)) + sum(text.count(w) for w in (
        "winters in", "wintering", "breeds in", "spends the winter", "summer visitor", "winter visitor"))
    if moves >= 3 and moves > stays * 2:
        return "migrant"
    if stays >= 1:
        return "resident"
    return None


def migration_phrase(d):
    """A sentence about migrating, chosen from the species, the hemisphere and the month."""
    sp = d.get("species") or {}
    where = station_coords(d)
    status = migration_status(sp)
    if where is None or status is None:
        return None
    lat = where[0]
    from datetime import datetime
    try:
        month = datetime.fromisoformat(d["timestamp"].replace("Z", "+00:00")).month
    except (KeyError, ValueError):
        month = datetime.now().month
    if lat < 0:
        month = (month + 5) % 12 + 1               # the south's seasons, read as the north's
    season = ("winter" if month in (12, 1, 2) else "spring" if month in (3, 4, 5)
              else "breeding" if month in (6, 7) else "autumn")
    if status == "resident":
        kind = "resident_autumn" if season == "autumn" and random.random() < 0.6 else "resident"
    elif abs(lat) < 15:
        kind = "tropics"                           # near the equator the seasons don't tell enough
    else:
        kind = season
    warm, cold = ("south", "north") if lat >= 0 else ("north", "south")
    return pick(MIGRATION_PHRASES[kind], f"migration {kind}").format(warm=warm, cold=cold)


def hour_words(h):
    """'3 in the morning', 'noon', '6 in the evening', 'midnight'."""
    if h == 0:
        return "midnight"
    if h == 12:
        return "noon"
    part = ("in the morning" if h < 12 else "in the afternoon" if h < 18
            else "in the evening" if h < 22 else "at night")
    return f"{h % 12 or 12} {part}"


def time_between_phrase(d):
    """The bird talks about the time and space between it and you: its tomorrow or yesterday,
    the kilometers, how long ago it sang, or its hour next to yours."""
    from datetime import datetime, timezone
    try:
        t = datetime.fromisoformat(d["timestamp"].replace("Z", "+00:00"))
    except (KeyError, ValueError):
        return None
    tz_name = (d.get("station") or {}).get("timezone")
    if tz_name:
        try:
            from zoneinfo import ZoneInfo
            t = t.astimezone(ZoneInfo(tz_name))
        except Exception:
            pass
    now = datetime.now().astimezone()
    here = t.astimezone(now.tzinfo)
    kinds = {}
    if t.date() > here.date():
        kinds["tomorrow"] = {}
    elif t.date() < here.date():
        kinds["yesterday"] = {}
    where = station_coords(d)
    if where and HOME:
        la1, lo1, la2, lo2 = map(math.radians, (*HOME, *where))
        km = 2 * 6371 * math.asin(math.sqrt(math.sin((la2 - la1) / 2) ** 2 + math.cos(la1)
                                            * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2))
        if km >= 300:
            kinds["distance"] = {"km": f"{round(km, -1):,.0f}"}
    minutes = (now - t).total_seconds() / 60
    if minutes >= 2:
        ago = (f"{round(minutes)} minutes ago" if minutes < 60
               else "an hour ago" if minutes < 120 else f"{round(minutes / 60)} hours ago")
        kinds["delay"] = {"ago": ago, "age": ago.replace(" ago", "")}
    if t.hour != here.hour and abs((t.utcoffset() - here.utcoffset()).total_seconds()) >= 3 * 3600:
        kinds["hours"] = {"theirs": hour_words(t.hour), "yours": hour_words(here.hour)}
    if not kinds:
        return None
    # a different day is the most striking: it wins half of the time when it happens
    kind = next((k for k in ("tomorrow", "yesterday") if k in kinds and random.random() < 0.5), None)
    kind = kind or random.choice(list(kinds))
    phrase = pick(TIME_BETWEEN_PHRASES[kind], f"between {kind}").format(**kinds[kind])
    if FAX_DEBUG:
        print(f"      [time between] {kind}")
    return phrase


def sky_hidden_words(wx):
    """Words the hour phrases can't use because the real sky is covered."""
    cur = (wx or {}).get("current") or {}
    code, clouds = cur.get("weather_code") or 0, cur.get("cloud_cover")
    covered = (clouds is not None and clouds >= 60) or code >= 45
    if not covered:
        return set()
    return {"stars", "star", "moon", "moonlight", "sun", "sunlight", "sunshine",
            "blue", "cloudless", "constellations"}


def live_message(d):
    """The bird's message: what the sky is like there now (weather or real hour),
    and how today compares with the old days. Returns (message, weather data line)."""
    where = station_coords(d)
    wx = get_weather(*where) if (where and (USE_WEATHER or USE_CLIMATE or USE_REAL_SUN)) else None
    parts, data = [], []
    sky = None
    if USE_MIGRATION and random.random() < MIGRATION_CHANCE:
        sky = migration_phrase(d)
    if sky is None and USE_TIME_BETWEEN and random.random() < TIME_BETWEEN_CHANCE:
        sky = time_between_phrase(d)
    if sky is None and wx and USE_WEATHER:
        sky = weather_phrase(wx)
    if sky is None:
        hour = solar_hour(d, wx) if (wx and USE_REAL_SUN) else None
        h = hour if hour is not None else local_hour(d)
        hidden = sky_hidden_words(wx) if (wx and USE_WEATHER) else set()
        for _ in range(12):                    # no stars on a cloudy night, no sun in the rain
            sky = time_phrase(h)
            if not hidden & set(sky.lower().replace(",", "").split()):
                break
    parts.append(sky)
    if wx and USE_CLIMATE:
        old, delta = climate_phrase(d, wx)
        if old:
            parts.append(old)
            sign = "+" if delta >= 0 else "-"
            data.append(f"{sign}{diff_text(delta).split()[0]}° vs {BASELINE_YEARS[0]}-{BASELINE_YEARS[1]}")
    cur = (wx or {}).get("current") or {}
    if USE_CLIMATE and cur.get("temperature_2m") is not None:
        t = cur["temperature_2m"]
        data.insert(0, f"{round(t * 9 / 5 + 32)}°F" if TEMP_UNIT.upper() == "F" else f"{round(t)}°C")
    return " ".join(sentence(p) for p in parts), "  ·  ".join(data)


# ---------- Markov chain ----------

_chains = {}
_corpus = None


ARCHAIC = {"thee", "thou", "thy", "thine", "hath", "doth", "ye", "o", "art", "shalt", "wilt",
           "tis", "'tis", "ere", "nay", "unto", "whence", "thence", "hither", "oft", "dost", "hast",
           "thyself", "yea", "lo", "upon", "chapter", "gutenberg", "ebook", "project", "copyright",
           "henceforward", "twain", "thereof", "wherein", "whereof", "amid", "betwixt", "anon"}
CORPUS_SPICE = 3           # an invented sentence may borrow at most this many words in a row
                           #   from the books; the rest must come from the piece's own phrases
NATURE_WORDS = {"light", "dark", "night", "morning", "sun", "moon", "stars", "star", "wind", "rain",
                "river", "sea", "grass", "leaves", "trees", "tree", "bird", "birds", "sky", "earth",
                "air", "water", "evening", "day", "time", "song", "silence", "dawn", "shadow",
                "shadows", "clouds", "summer", "winter", "spring", "woods", "pond", "world", "breath"}


def download_corpus(folder):
    """Downloads CORPUS_BOOKS that aren't in the folder yet (public domain, Project Gutenberg)."""
    for name, url in CORPUS_BOOKS.items():
        path = os.path.join(folder, name)
        if os.path.exists(path):
            continue
        try:
            os.makedirs(folder, exist_ok=True)
            req = urllib.request.Request(url, headers={"User-Agent": "fax-birdsong/1.0"})
            with urllib.request.urlopen(req, timeout=30) as r, open(path, "wb") as f:
                f.write(r.read())
            print(f"      [markov] downloaded {name} into {CORPUS_FOLDER}/")
        except Exception as e:
            if FAX_DEBUG:
                print(f"      [markov] couldn't download {name}: {e}")


def corpus_sentences():
    """Short, plain, nature-and-time sentences from the .txt files in CORPUS_FOLDER."""
    global _corpus
    if _corpus is None:
        _corpus = []
        folder = os.path.join(os.path.dirname(os.path.abspath(__file__)), CORPUS_FOLDER)
        if CORPUS_BOOKS:
            download_corpus(folder)
        for path in sorted(glob.glob(os.path.join(folder, "*.txt"))):
            try:
                with open(path, encoding="utf-8", errors="ignore") as f:
                    text = f.read().lower()
            except OSError:
                continue
            for s in re.split(r"[.!?;:\n()\[\]\"]+|--", text):
                words = re.findall(r"[a-z']+", s)
                if (5 <= len(words) <= 12 and not ARCHAIC & set(words)
                        and NATURE_WORDS & set(words)):
                    _corpus.append(["I" if w == "i" else "I'm" if w == "i'm" else w for w in words])
        if len(_corpus) > CORPUS_MAX:
            _corpus = random.Random(7).sample(_corpus, CORPUS_MAX)
        if _corpus and FAX_DEBUG:
            print(f"      [markov] {len(_corpus)} sentences from {CORPUS_FOLDER}/")
    return _corpus


def markov_chain(options):
    key = tuple(options)
    if key not in _chains:
        n = max(1, MARKOV_ORDER)
        chain = {}
        everything = [p for _, _, ps in TIME_PHRASES for p in ps]
        sentences = ([o.split() for o in options] * 4          # this time of day weighs most
                     + [p.split() for p in everything]         # the rest of the piece's phrases
                     + corpus_sentences())
        for words in sentences:
            seq = ["<s>"] * n + words + ["</s>"]
            for i in range(len(seq) - n):
                chain.setdefault(tuple(seq[i:i + n]), []).append(seq[i + n])
        _chains[key] = chain
    return _chains[key]


# Words that belong to a moment of the day. An invented sentence can only use them
# if they appear in the phrases of ITS moment (so midnight never gets an "orange" sky).
TIME_WORDS = {
    "orange", "pink", "golden", "gold", "blushing", "sunset", "horizon", "fire",
    "sun", "sunlight", "noon", "midday", "bright", "heat", "shade", "shadows",
    "morning", "dawn", "dew", "fog", "woke", "awake", "early", "first", "rehearsing", "pencil",
    "lunch", "afternoon", "nap", "honey", "bees", "warm",
    "night", "dark", "moon", "stars", "owls", "dreams", "dreaming", "sleep", "sleeping",
    "asleep", "lanterns", "ink", "deepest", "tomorrow", "late", "street",
    # weather words: invented sentences can't make up rain or snow that isn't there
    "rain", "raindrops", "drops", "snow", "storm", "thunder", "lightning", "wet", "frost",
}


def time_words_ok(words, options):
    allowed = {w.lower().strip(",.'") for o in options for w in o.split()}
    return all(w.lower().strip(",.'") not in TIME_WORDS or w.lower().strip(",.'") in allowed
               for w in words)


_bigrams = None


def phrase_bigrams():
    global _bigrams
    if _bigrams is None:
        _bigrams = set()
        for p in everything_phrases():
            w = ["<s>"] + p.lower().split()
            _bigrams.update(zip(w, w[1:]))
    return _bigrams


def phrase_endings():
    return {p.lower().split()[-1] for p in everything_phrases()}


def everything_phrases():
    return ([p for _, _, ps in TIME_PHRASES for p in ps])


def markov_sentence(options, tries=200):
    """A new sentence in the style of `options`, or None if nothing good comes out."""
    n = max(1, MARKOV_ORDER)
    chain = markov_chain(options)
    originals = {o.lower() for o in options}
    starts = [o.split()[:n] for o in options if len(o.split()) > n]
    if not starts:
        return None
    for _ in range(tries):
        words = list(random.choice(starts))          # begin like one of this time's phrases
        while len(words) < 14:
            nxt = random.choice(chain.get(tuple((["<s>"] * n + words)[-n:]), ["</s>"]))
            if nxt == "</s>":
                break
            words.append(nxt)
        text = " ".join(words)
        low = [w.lower() for w in words]
        verbs = sum(w in ("is", "are", "has", "have", "was", "were", "smells", "sounds",
                          "ends", "left", "feels", "remember", "remembers", "changed",
                          "forgot", "folded", "sing", "know", "knows", "want", "wants",
                          "need", "needs", "ask", "asks", "hold", "rest", "rests", "lets",
                          "let", "keep", "keeps", "shine", "touches", "leaves", "grows",
                          "goes", "returns", "turns", "forgives", "hide", "hides", "took",
                          "saying", "goes", "waiting")
                    for w in low)
        own = phrase_bigrams()
        spice = run = 0
        for prev, w in zip(["<s>"] + low, low):
            run = 0 if (prev, w) in own else run + 1
            spice = max(spice, run)
        placeholders_ok = all("{" not in w for w in words) or any("{" in o for o in options)
        if (5 <= len(words) <= 12 and text.lower() not in originals
                and low[1] not in ("because", "as", "that")
                and spice <= CORPUS_SPICE                        # the books are only a spice
                and low[-1] in phrase_endings()                  # ends like one of the piece's phrases
                and not any(w.endswith("'d") for w in low)       # no old "press'd", "unreach'd"
                and not (" and the " in text and ", and" not in text)  # no "... and the sea and the"
                and (verbs == 1 or (verbs == 2 and "," in text)) # one clause, or two split by a comma
                and "and" not in low[-3:]                        # no dangling "... and the leaves"
                and low[-1] not in ("back", "out", "over", "away") # no "the light back"
                and time_words_ok(words, options)                # no sunset words at midnight
                and placeholders_ok
                and text.lower() not in {p.lower() for p in everything_phrases()}
                and words[-1].strip(",").lower() not in WEAK_ENDINGS
                and len(set(words)) > len(words) * 0.6):
            return text
    return None


WEATHER_WORDS = {   # an invented weather sentence must keep one of these, so rain stays rain
    "thunder": ("thunder", "lightning", "shouting", "storm"),
    "snow": ("snow", "white", "frost"),
    "rain": ("rain", "raindrops", "dripping", "drinking", "water", "wet"),
    "drizzle": ("rain", "water", "tiny", "whispers"),
    "fog": ("fog", "see", "swallowed", "ends"),
    "wind": ("wind", "branches", "branch", "sideways", "dancing"),
}


def maybe_markov(options, chosen, must_have=(), kind="markov"):
    """Sometimes swaps the chosen phrase for a newly invented one
    (invented phrases also have a memory, so they don't repeat either)."""
    if MARKOV and isinstance(options, list) and len(options) > 2 and random.random() < MARKOV_CHANCE:
        history = _load_history()
        recent = history.setdefault(f"{kind} invented", [])
        invented = None
        for _ in range(25):
            candidate = markov_sentence(options)
            if (candidate and candidate not in recent
                    and (not must_have or any(w in candidate.split() for w in must_have))):
                invented = candidate
                break
        if invented:
            recent.append(invented)
            del recent[:-20]                       # remembers the last 20 inventions
            try:
                with open(_history_path(), "w") as f:
                    json.dump(history, f, indent=1)
            except OSError:
                pass
        if invented:
            if FAX_DEBUG:
                print(f"      [markov] invented: {invented}")
            return invented
    return chosen


def time_phrase(hour):
    if hour is None:
        return "it's some time somewhere"
    for start, end, phrases in TIME_PHRASES:
        if start <= hour < end:
            return maybe_markov(phrases, pick(phrases, f"phrases {start}-{end}"),
                                kind=f"phrases {start}-{end}")
    return "it's some time somewhere"


GENERIC_NAMES = ("birdweather app", "birdnet app", "birdweather", "app")


DEVICE_WORDS = ("birdnet", "birdweather", "puc-", "puc ", "haikubox", "-pi", " pi ", "station")


def looks_like_device(text, station):
    """True if a 'location' is really a device or station name, not a place."""
    t = text.lower()
    if not t:
        return False
    if t == (station.get("name") or "").strip().lower():
        return True
    return any(w in f" {t} " for w in DEVICE_WORDS)


def place_name(station):
    """A short place name for the message (no coordinates unless there's nothing else)."""
    name = (station.get("name") or "").strip() if USE_STATION_NAME else ""
    if name.lower() in GENERIC_NAMES:
        name = ""                                   # phone app: the name says nothing about the place
    location = (station.get("location") or "").strip()
    if looks_like_device(location, station):
        location = ""                               # e.g. "BirdNET-Pi - aaragonavians" isn't a place
    parts = []
    first = (location or name).strip()
    for value in (first, (station.get("state") or "").strip()):
        if value and all(value.lower() not in p.lower() for p in parts):
            parts.append(value)
    country = (station.get("country") or "").strip()
    home = ("united states", "usa", "us", "united states of america")
    if country and (not parts or country.lower() not in home) \
            and all(country.lower() not in p.lower() for p in parts):
        parts.append(country)                       # e.g. "Bavaria, Germany" (but not "..., United States")
    if parts:
        return ", ".join(parts)
    c = station.get("coords") or {}
    if c.get("lat") is not None and c.get("lon") is not None:
        return f"{c['lat']:.2f}, {c['lon']:.2f}"
    return "somewhere"


def bird_letter(d):
    """('the night is deep enough to swim in', '— american crow, from Australia')"""
    body = time_phrase(local_hour(d))
    signature = SIGNATURE.format(bird=d["species"]["commonName"].lower(),
                                 place=place_name(d.get("station") or {}))
    return body, signature


def bird_message(d):
    """e.g. 'blue jay says it's too early, from Ithaca, New York'"""
    name = d["species"]["commonName"].lower()
    verb = pick(VERBS, "verb") if VERBS else "says"
    return f"{name} {verb} {time_phrase(local_hour(d))}, from {place_name(d.get('station') or {})}"


def credit_text(station):
    """'human bridge: aaragonavians' — the station owner's chosen name, without device words."""
    if not CREDIT_TEMPLATE:
        return ""
    name = (station.get("name") or "").strip()
    name = re.sub(r"(?i)\b(birdnet[- ]?(pi|go)?|birdweather( app)?|haikubox)\b", "", name)
    name = re.sub(r"(?i)\bpuc[- ]?\d+\b", "", name)
    name = name.strip(" -–—_|:·,.")
    if not name or name.lower() in GENERIC_NAMES:
        name = "an anonymous listener"
    return CREDIT_TEMPLATE.format(name=name)


def coords_text(station):
    """e.g. '39.17°N 86.53°W', or '' if the station doesn't share coordinates."""
    c = station.get("coords") or {}
    lat, lon = c.get("lat"), c.get("lon")
    if lat is None or lon is None:
        return ""
    return (f"{abs(lat):.2f}°{'N' if lat >= 0 else 'S'} "
            f"{abs(lon):.2f}°{'E' if lon >= 0 else 'W'}")


_fallback_cache = {}


def fallback_font(size):
    if size not in _fallback_cache:
        _, _, ImageFont, _ = pillow()
        found = None
        for path in FALLBACK_FONTS:
            try:
                found = ImageFont.truetype(path, size)
                break
            except OSError:
                pass
        _fallback_cache[size] = found
    return _fallback_cache[size]


def needs_fallback(ch):
    """Letters beyond Latin, Greek and Cyrillic (which the terminal font has)."""
    return ord(ch) >= 0x0590


def runs(text):
    """Splits text into pieces that use the terminal font or the fallback font."""
    out = []
    for ch in text:
        fb = needs_fallback(ch)
        if out and out[-1][1] == fb:
            out[-1][0] += ch
        else:
            out.append([ch, fb])
    return out


def text_width(text, font, size):
    fb = fallback_font(size)
    return sum((fb if (is_fb and fb) else font).getlength(part) for part, is_fb in runs(text))


def draw_text(d, x, y, text, font, size):
    """Draws text, switching to the fallback font for letters the terminal font lacks."""
    fb = fallback_font(size)
    for part, is_fb in runs(text):
        f = fb if (is_fb and fb) else font
        d.text((x, y), part, font=f, fill=0)
        x += f.getlength(part)


def bird_time_text(d):
    """The local time where the bird was recorded, e.g. 'bird time 17:54'."""
    from datetime import datetime
    try:
        t = datetime.fromisoformat(d["timestamp"].replace("Z", "+00:00"))
    except (ValueError, KeyError):
        return ""
    tz_name = (d.get("station") or {}).get("timezone")
    if tz_name:
        try:
            from zoneinfo import ZoneInfo
            t = t.astimezone(ZoneInfo(tz_name))
        except Exception:
            pass
    return f"bird time {t:%H:%M}"


def message_card(text, lines_per_mm=LINES_PER_MM, corner_lines=(), signature=""):
    """The bird's sentence on the left (ending at MESSAGE_RIGHT_EDGE_CM, aligned per
    MESSAGE_ALIGN), and a small block of lines in the top-right corner."""
    Image, ImageDraw, _, _ = pillow()
    font = load_font(MESSAGE_SIZE)
    margin = 80
    right_edge = int(MESSAGE_RIGHT_EDGE_CM * 10 * DOTS_PER_MM)
    usable = max(200, right_edge - margin)
    def wrap(t, f=font, size=MESSAGE_SIZE):
        out, current = [], ""
        for w in t.split():
            trial = (current + " " + w).strip()
            if text_width(trial, f, size) <= usable or not current:
                current = trial
            else:
                out.append(current)
                current = w
        if current:
            out.append(current)
        return out

    # each line: (text, font, size, height)
    line_h = int(MESSAGE_SIZE * 1.35)
    lines = [(t, font, MESSAGE_SIZE, line_h) for t in wrap(text)]
    if signature:
        sig_font = load_font(SIGNATURE_SIZE)
        lines.append(("", font, MESSAGE_SIZE, line_h))          # a blank line, then the signature
        lines += [(t, sig_font, SIGNATURE_SIZE, int(SIGNATURE_SIZE * 1.4))
                  for t in wrap(signature, sig_font, SIGNATURE_SIZE)]
    text_h = sum(h for _, _, _, h in lines)
    corner_lines = [c for c in corner_lines if c] if COORDS_SIZE else []
    small = load_font(COORDS_SIZE) if corner_lines else None
    small_h = int(COORDS_SIZE * 1.45)
    pad = 40                                         # ≈ 5 mm below
    top_pad = round(TOP_MARGIN_MM * DOTS_PER_MM)
    title_h = int(TITLE_SIZE * 2.6) if TITLE else 0  # title + a blank line under it
    height = top_pad + pad + title_h + max(text_h, small_h * len(corner_lines))
    card = Image.new("L", (FAX_WIDTH, height), 255)
    d = ImageDraw.Draw(card)
    if TITLE:
        title_font, fake = load_bold_font(TITLE_SIZE)
        lift = title_font.getbbox(TITLE)[1]         # font's built-in space above the letters
        d.text((margin, top_pad - lift), TITLE, font=title_font, fill=0,
               stroke_width=1 if fake else 0, stroke_fill=0)
    top = top_pad + title_h
    y = top
    for line, f, size, h in lines:
        w = text_width(line, f, size)
        x = right_edge - w if MESSAGE_ALIGN == "right" else margin
        draw_text(d, x, y, line, f, size)
        y += h
    for i, line in enumerate(corner_lines):
        w = text_width(line, small, COORDS_SIZE)
        draw_text(d, FAX_WIDTH - margin - w, top + i * small_h, line, small, COORDS_SIZE)
    rows = max(1, round(height / DOTS_PER_MM * lines_per_mm))
    card = card.resize((FAX_WIDTH, rows), Image.LANCZOS)
    return card.point(lambda v: 255 if v > 150 else 0)


def load_italic_font(size):
    """Italic version of the terminal font (Menlo Italic on the Mac)."""
    _, _, ImageFont, _ = pillow()
    for path, index in (("/System/Library/Fonts/Menlo.ttc", 2),
                        ("/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Oblique.ttf", 0)):
        try:
            f = ImageFont.truetype(path, size, index=index)
            if any(w in " ".join(f.getname()).lower() for w in ("italic", "oblique")):
                return f
        except OSError:
            pass
    return load_font(size)


WEAK_ENDINGS = {"the", "a", "an", "to", "of", "in", "on", "at", "is", "are", "and", "but",
                "with", "for", "its", "it's", "has", "have", "be", "than", "into", "under",
                "above", "like", "as", "every", "no", "not", "nothing", "everyone", "still"}


def verses(phrase):
    """Breaks a phrase into stepped verses, choosing breaks that read naturally:
    'the trees / are drinking / the light' (never ending a verse on 'the', 'to', 'is'...)."""
    from itertools import combinations
    words = phrase.split()
    if len(phrase) <= 16 or len(words) <= 2:
        return [phrase]
    best, best_cost = [phrase], None
    for n in (2, 3, 4):
        if n > len(words):
            break
        for cuts in combinations(range(1, len(words)), n - 1):
            parts = [words[a:b] for a, b in zip((0,) + cuts, cuts + (len(words),))]
            lines = [" ".join(p) for p in parts]
            lengths = [len(l) for l in lines]
            mean = sum(lengths) / n
            cost = sum((x - mean) ** 2 for x in lengths) / n          # balanced lines
            cost += 120 * sum(p[-1].strip(",").lower() in WEAK_ENDINGS for p in parts[:-1])
            cost += 60 * sum(len(p) == 1 and len(p[0]) <= 4 for p in parts)  # no tiny orphans
            cost += 45 * sum(len(p) == 1 for p in parts[1:])                 # no lonely words mid-poem
            cost += {2: 0, 3: 10, 4: 40}[n] - (25 if n == 3 and len(phrase) > 24 else 0)
            if best_cost is None or cost < best_cost:
                best, best_cost = lines, cost
    return best


def poem_card(phrase, signature, data_line, lines_per_mm=LINES_PER_MM):
    """Stepped italic verses, then a small signature and data line at the bottom right."""
    Image, ImageDraw, _, _ = pillow()
    margin = 80
    verse_font = load_italic_font(POEM_SIZE)
    sig_font = load_font(POEM_SIGNATURE_SIZE)
    data_font = load_font(POEM_DATA_SIZE)
    title_font, fake = load_bold_font(POEM_TITLE_SIZE)
    lines = verses(phrase)
    verse_h = int(POEM_SIZE * 1.6)
    title_h = int(POEM_TITLE_SIZE * 3.0) if TITLE else 0
    top_pad = round(TOP_MARGIN_MM * DOTS_PER_MM)
    gap = int(POEM_SIZE * 1.8)
    height = (top_pad + title_h + verse_h * len(lines) + gap
              + int(POEM_SIGNATURE_SIZE * 1.6) + int(POEM_DATA_SIZE * 1.6) + 40)
    card = Image.new("L", (FAX_WIDTH, height), 255)
    d = ImageDraw.Draw(card)
    if TITLE:
        lift = title_font.getbbox(TITLE)[1]
        d.text((margin, top_pad - lift), TITLE, font=title_font, fill=0,
               stroke_width=1 if fake else 0, stroke_fill=0)
    x0 = margin + POEM_INDENT_CM * 10 * DOTS_PER_MM
    step = POEM_STEP_CM * 10 * DOTS_PER_MM
    y = top_pad + title_h
    for i, line in enumerate(lines):
        draw_text(d, x0 + i * step, y, line, verse_font, POEM_SIZE)
        y += verse_h
    y += gap
    right = FAX_WIDTH - margin
    draw_text(d, right - text_width(signature, sig_font, POEM_SIGNATURE_SIZE), y,
              signature, sig_font, POEM_SIGNATURE_SIZE)
    y += int(POEM_SIGNATURE_SIZE * 1.6)
    if data_line:
        draw_text(d, right - text_width(data_line, data_font, POEM_DATA_SIZE), y,
                  data_line, data_font, POEM_DATA_SIZE)
    rows = max(1, round(height / DOTS_PER_MM * lines_per_mm))
    card = card.resize((FAX_WIDTH, rows), Image.LANCZOS)
    return card.point(lambda v: 255 if v > 150 else 0)


def fortune_card(phrase, signature, data_line, lines_per_mm=LINES_PER_MM):
    """A small centered slip: the phrase, and under it the bird's name and the tiny data."""
    Image, ImageDraw, _, _ = pillow()
    if FORTUNE_SENTENCE and phrase:
        phrase = phrase[0].upper() + phrase[1:]
        if phrase[-1] not in ".!?":
            phrase += "."
    phrase_font = load_italic_font(FORTUNE_SIZE)
    sig_font = load_font(FORTUNE_SIGNATURE_SIZE)
    data_font = load_font(FORTUNE_DATA_SIZE) if FORTUNE_DATA_SIZE else None
    max_w = FORTUNE_MAX_WIDTH_CM * 10 * DOTS_PER_MM
    lines = []
    for part in re.split(r"(?<=[.!?])\s+", phrase):     # each sentence starts a new line
        if text_width(part, phrase_font, FORTUNE_SIZE) <= max_w:
            lines.append(part)
            continue
        words, best = part.split(), None                 # too long: two balanced lines
        for i in range(1, len(words)):
            a, b = " ".join(words[:i]), " ".join(words[i:])
            cost = abs(len(a) - len(b)) + (40 if words[i - 1].lower() in WEAK_ENDINGS else 0)
            if best is None or cost < best[0]:
                best = (cost, [a, b])
        lines += best[1] if best else [part]
    phrase_h = int(FORTUNE_SIZE * 1.5)
    sig_h = int(FORTUNE_SIGNATURE_SIZE * 1.5)
    data_lines = [l for l in (data_line or "").split("\n") if l] if data_font else []
    data_h = int(FORTUNE_DATA_SIZE * 1.5) * len(data_lines)
    top = round(max(TOP_MARGIN_MM, 2) * DOTS_PER_MM)
    gap = int(FORTUNE_SIZE * 0.9)
    height = top + phrase_h * len(lines) + gap + sig_h + data_h + 40
    card = Image.new("L", (FAX_WIDTH, height), 255)
    d = ImageDraw.Draw(card)
    cx = FAX_WIDTH / 2
    y = top
    for line in lines:
        draw_text(d, cx - text_width(line, phrase_font, FORTUNE_SIZE) / 2, y, line,
                  phrase_font, FORTUNE_SIZE)
        y += phrase_h
    y += gap
    draw_text(d, cx - text_width(signature, sig_font, FORTUNE_SIGNATURE_SIZE) / 2, y,
              signature, sig_font, FORTUNE_SIGNATURE_SIZE)
    y += sig_h
    for line in data_lines:
        draw_text(d, cx - text_width(line, data_font, FORTUNE_DATA_SIZE) / 2, y,
                  line, data_font, FORTUNE_DATA_SIZE)
        y += int(FORTUNE_DATA_SIZE * 1.5)
    rows = max(1, round(height / DOTS_PER_MM * lines_per_mm))
    card = card.resize((FAX_WIDTH, rows), Image.LANCZOS)
    return card.point(lambda v: 255 if v > 150 else 0)


def with_article(name):
    """'an australian magpie', 'a european robin', 'a hairy woodpecker'."""
    sounds_like_you = name.startswith(("eu", "uni", "use", "uro", "one"))
    return ("an " if name[:1] in "aeiou" and not sounds_like_you else "a ") + name


def fortune_parts(d):
    """(phrase, signature, data lines) for one detection, fortune-cookie style."""
    data = data_line(d)
    phrase, weather_line = live_message(d)
    if weather_line:
        data = data + "\n" + weather_line
    station = d.get("station") or {}
    bird = d["species"]["commonName"].lower()
    place = place_name(station)
    nowhere = place == "somewhere"
    template = pick(FORTUNE_SIGNATURES, "signature")
    signature = template.format(a_bird=with_article(bird), the_bird="the " + bird,
                                in_place="somewhere" if nowhere else f"in {place}",
                                from_place="from somewhere" if nowhere else f"from {place}")
    return phrase, signature, data


def data_line(d):
    """'38.49°N 122.70°W  ·  15:26 bird time  ·  operator: Horizon View'"""
    station = d.get("station") or {}
    t = bird_time_text(d).replace("bird time ", "")
    data = [coords_text(station), f"{t} bird time" if t else "", credit_text(station)]
    return "  ·  ".join(p for p in data if p)


def poem_parts(d):
    """(phrase, signature, data line) for one detection."""
    station = d.get("station") or {}
    phrase = time_phrase(local_hour(d))
    signature = POEM_SIGNATURE.format(bird=d["species"]["commonName"].lower(),
                                      place=place_name(station))
    return phrase, signature, data_line(d)


def card_rows(card):
    """Encodes the card as fax lines (Modified Huffman / T.4), one bit string per row."""
    Image, _, _, ImageOps = pillow()
    # Pillow/libtiff write white pixels as fax "black", so the picture is inverted first
    img = ImageOps.invert(card.convert("L")).convert("1")
    buf = io.BytesIO()
    img.save(buf, format="TIFF", compression="group3")
    data = buf.getvalue()
    t = Image.open(io.BytesIO(data))
    raw = b"".join(data[o:o + c] for o, c in zip(t.tag_v2[273], t.tag_v2[279]))
    bits = "".join(f"{b:08b}" for b in raw)
    rows, last = [], None
    for m in re.finditer(r"0{11,}1", bits):
        eol_start = m.end() - 12        # the EOL is the last 12 bits; extra zeros belong to the row
        if last is not None:
            rows.append(bits[last:eol_start])
        last = m.end()
    if last is not None and bits[last:].strip("0"):
        rows.append(bits[last:])
    return rows


def page_bytes(rows, bps, min_ms):
    """Rows -> the bytes sent to the fax: fill + EOL + row, then RTC (6 x EOL)."""
    min_bits = int(bps * min_ms / 1000)
    out = []
    for r in rows:
        out.append("0" * max(0, min_bits - 12 - len(r)) + EOL + r)
    out.append(EOL * 6)
    s = "".join(out)
    s += "0" * (-len(s) % 8)
    data = bytes(int(s[i:i + 8], 2) for i in range(0, len(s), 8))
    return data.translate(REVERSE_TABLE) if REVERSE_BITS else data


def print_card(modem, card, fine_card=None):
    """Sends a page. fine_card (optional) is the same page drawn at fine resolution."""
    rows = card_rows(card)
    fine_rows = card_rows(fine_card) if fine_card is not None else None
    ok = modem.send_fax(
        lambda bps, min_ms, fine: page_bytes(fine_rows if fine else rows, bps, min_ms),
        can_fine=fine_rows is not None)
    modem.setup_voice(quiet=True)
    return ok


def bird_lines(d, clarity=None):
    """The card's text, written like a terminal log."""
    sp = d["species"]
    when = d["timestamp"].replace("T", " ")[:19]
    lines = [(f'> {sp["commonName"].lower()}', 60)]
    translated = translated_name(sp)
    if translated and translated != sp["commonName"]:
        lines.append((f"  {translated.lower()}", 44))
    lines.append((f'  {sp["scientificName"].lower()}', 44))
    lines.append(("", 10))
    lines.append((f"  time      {when}", 36))
    station = (d.get("station") or {}).get("name")
    if station:
        lines.append((f"  station   {station.lower()}", 36))
    lines.append((f'  conf      {round(float(d["confidence"]) * 100)}%', 36))
    if clarity is not None:
        lines.append((f"  clarity   {clarity:.0f} dB", 36))
    return lines


# ================= BIRDWEATHER =================

# Fields we want for each detection. %TRANSLATION% and %STATION% are filled in
# (or left empty) depending on what BirdWeather accepts.
NODE_FIELDS = """
    nodes {
      id
      timestamp
      confidence
      species {
        commonName
        scientificName
        %TRANSLATION%
      }
      %STATION%
      coords { lat lon }
      soundscape { url startTime endTime }
    }
"""


def both_ends_query(params, args):
    """Asks for both ends of the last hour's list (oldest 50 and newest 50),
    so the newest birds always come in, whatever order BirdWeather uses."""
    return ("query (" + params + ") {\n"
            "  head: detections(" + args + ', period: {count: 1, unit: "hour"}, first: 50) {'
            + NODE_FIELDS + "  }\n"
            "  tail: detections(" + args + ', period: {count: 1, unit: "hour"}, last: 50) {'
            + NODE_FIELDS + "  }\n}\n")


STATION_QUERY = both_ends_query("$stationIds: [ID!]", "stationIds: $stationIds")
REGION_QUERY = both_ends_query(
    "$ne: InputLocation, $sw: InputLocation, $minConf: Float",
    "ne: $ne, sw: $sw, validSoundscape: true, confidenceGte: $minConf")

TRANSLATION_FIELD = 'translations(locale: "%s") { commonName }' % TRANSLATION_LOCALE
# station details, from the most complete to the simplest (the first one BirdWeather accepts is used)
STATION_FIELDS = [
    "station { name location state country timezone coords { lat lon } }",
    "station { name location state country coords { lat lon } }",
    "station { name coords { lat lon } }",
    "station { name }",
    "",
]
use_translation = bool(TRANSLATION_LOCALE)
station_level = 0


def run_query(template, variables):
    """Sends a GraphQL query. If BirdWeather rejects an optional field,
    drops it and tries again."""
    global use_translation, station_level
    query = (template
             .replace("%TRANSLATION%", TRANSLATION_FIELD if use_translation else "")
             .replace("%STATION%", STATION_FIELDS[station_level]))
    body = json.dumps({"query": query, "variables": variables}).encode()
    req = urllib.request.Request(BIRDWEATHER_URL, data=body,
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as r:
        resp = json.load(r)
    if "errors" in resp:
        if station_level < len(STATION_FIELDS) - 1:
            station_level += 1
            return run_query(template, variables)
        if use_translation:
            print("(BirdWeather didn't accept the translation request; "
                  "showing English names only)")
            use_translation = False
            return run_query(template, variables)
        raise RuntimeError(resp["errors"])
    merged = {}
    for part in ("head", "tail"):
        for d in (resp["data"].get(part) or {}).get("nodes") or []:
            merged[d["id"]] = d
    return list(merged.values())


def fetch_station():
    return run_query(STATION_QUERY, {"stationIds": [STATION_ID]})


def fetch_region(region):
    (sw_lat, sw_lon), (ne_lat, ne_lon) = region
    return run_query(REGION_QUERY, {
        "sw": {"lat": sw_lat, "lon": sw_lon},
        "ne": {"lat": ne_lat, "lon": ne_lon},
        "minConf": MIN_CONFIDENCE,
    })


def when(d):
    """The detection's real moment in time (stations use different time zones)."""
    try:
        from datetime import datetime
        return datetime.fromisoformat(d["timestamp"].replace("Z", "+00:00")).timestamp()
    except (ValueError, KeyError):
        return 0.0


def translated_name(species):
    """Spanish (or other locale) common name, if BirdWeather has one."""
    for t in species.get("translations") or []:
        if t.get("commonName"):
            return t["commonName"]
    return None


def describe(d):
    sp = d["species"]
    name = sp["commonName"]
    translated = translated_name(sp)
    if translated and translated != name:
        name = f"{name} / {translated}"
    line = (f'{d["timestamp"]}  {name} ({sp["scientificName"]})  '
            f'{round(float(d["confidence"]) * 100)}%')
    station = d.get("station") or {}
    if station.get("name"):
        line += f"  @ {station['name']}"
    place = where(station)
    if place:
        line += f"\n   location: {place}"
    return line


def where(station):
    """'Ithaca, New York, United States  (42.44, -76.50)' — whatever the station shares."""
    parts = []
    for key in ("location", "state", "country"):
        value = (station.get(key) or "").strip()
        if value and all(value.lower() not in p.lower() for p in parts):
            parts.append(value)
    text = ", ".join(parts)
    c = station.get("coords") or {}
    if c.get("lat") is not None and c.get("lon") is not None:
        text += f"  ({c['lat']:.2f}, {c['lon']:.2f})"
    return text.strip()


def wants_to_print():
    """Gives you DECIDE_SECONDS to press ENTER and say no to this print."""
    if DECIDE_SECONDS <= 0:
        return True
    import select
    try:
        while select.select([sys.stdin], [], [], 0)[0]:   # forget keys pressed earlier
            sys.stdin.readline()
        print(f"   printing in {DECIDE_SECONDS} s... press ENTER to skip it")
        ready, _, _ = select.select([sys.stdin], [], [], DECIDE_SECONDS)
    except (OSError, ValueError):
        return True
    if ready:
        sys.stdin.readline()
        print("   (print skipped)\n")
        return False
    return True


def play_url(modem, d):
    """Plays the detection's call; then, if PRINT_BIRDS, prints its card.
    Returns True if the call was actually played."""
    url = d["soundscape"]["url"]
    with tempfile.TemporaryDirectory() as folder:
        path = os.path.join(folder, "call")
        urllib.request.urlretrieve(url, path)
        sc = d.get("soundscape") or {}
        samples = load_audio(path, sc.get("startTime"), sc.get("endTime"))
        clarity = LAST_CLARITY
        if clarity < MIN_CLARITY:
            print(f"   clarity {clarity:.0f} dB: too much grass, skipping (no sound, no print)")
            return False
        if LAST_IN_BAND < MIN_IN_BAND:
            print(f"   only {LAST_IN_BAND:.0%} of the call fits in the phone line "
                  "(it sings too high or too low): skipping (no sound, no print)")
            return False
        if LAST_AUDIBLE < MIN_AUDIBLE:
            print(f"   only {LAST_AUDIBLE:.1f} s left after the filters: skipping (no sound, no print)")
            return False
        ready = None
        if PRINT_BIRDS and PRINT_STYLE == "dawn":
            try:
                ready = dawn_cards(d)              # the slip is ready before the bird sings
            except Exception as e:
                print("   couldn't prepare the slip:", e)
        low = " (one octave lower: it sings too high for the phone)" if LAST_OCTAVE else ""
        print(f"   clarity {clarity:.0f} dB, {LAST_IN_BAND:.0%} in the phone band: playing on the fax...{low}")
        # the repetitions are joined into one continuous sound (no gap between them)
        key = modem.play(samples * max(1, REPEAT_CALL))
        if key == "FAILED":
            print("   the call didn't play, so nothing is printed for this bird\n")
            return False
        if key:
            print(f"   (you pressed {key} on the fax: skipping to the next bird)\n")
            return True
        if PRINT_BIRDS and wants_to_print():
            try:
                if PRINT_STYLE == "dawn":
                    if ready:
                        print(f"   printing: [{data_line(d)}]")
                        print_card(modem, *ready)
                elif PRINT_STYLE == "message":
                    if MESSAGE_STYLE == "fortune":
                        phrase, signature, data = fortune_parts(d)
                        print(f'   printing: "{phrase}"  {signature}  [{data}]')
                        print_card(modem, fortune_card(phrase, signature, data),
                                   fortune_card(phrase, signature, data, LINES_PER_MM * 2))
                        text = None
                    elif MESSAGE_STYLE == "poem":
                        phrase, signature, data = poem_parts(d)
                        print(f'   printing: "{phrase}"  {signature}  [{data}]')
                        print_card(modem, poem_card(phrase, signature, data),
                                   poem_card(phrase, signature, data, LINES_PER_MM * 2))
                        text = None
                    elif MESSAGE_STYLE == "letter":
                        text, signature = bird_letter(d)
                    else:
                        text, signature = bird_message(d), ""
                    if text is not None:
                        station = d.get("station") or {}
                        corner = [coords_text(station), bird_time_text(d), credit_text(station)]
                        print(f'   printing: "{text}"  {signature}  {[c for c in corner if c]}')
                        print_card(modem, message_card(text, corner_lines=corner, signature=signature),
                                   message_card(text, LINES_PER_MM * 2, corner, signature))
                elif PRINT_STYLE == "illustration":
                    print_card(modem, illustration_card(), illustration_card(LINES_PER_MM * 2))
                else:
                    raw = convert_audio(path, 16000)[:16000 * MAX_SECONDS]
                    print_card(modem, make_card(bird_lines(d, clarity), raw, 16000))
            except Exception as e:
                print("   couldn't print:", e)
                modem.setup_voice(quiet=True)
            if PAUSE_AFTER_PRINT:
                print(f"   (letting the fax finish: {PAUSE_AFTER_PRINT} s of silence)")
                time.sleep(PAUSE_AFTER_PRINT)
            print("   >>> press HOOK on the fax for the next bird\n")
    return True


def skip_reason(d):
    name = d["species"]["commonName"]
    if ONLY_SPECIES and name not in ONLY_SPECIES:
        return "not in ONLY_SPECIES"
    if name in EXCLUDE_SPECIES:
        return "in EXCLUDE_SPECIES"
    if float(d["confidence"]) < MIN_CONFIDENCE:
        return "low confidence"
    return None


def birds_mode(modem):
    """One station: plays every new bird, in order."""
    print(f"Listening to station {STATION_ID}... (Ctrl + C to quit)\n")
    seen, first = set(), True
    played = set()   # several detections can share the same audio
    while True:
        try:
            new = [d for d in fetch_station() if d["id"] not in seen]
            new.sort(key=when)
            for d in new:
                seen.add(d["id"])
                if first:
                    continue
                print(describe(d))
                sc = d.get("soundscape") or {}
                reason = skip_reason(d)
                if reason:
                    print(f"   (skipped: {reason})")
                elif sc.get("url") in played:
                    print("   (same audio as the previous one, not repeating)")
                elif sc.get("url"):
                    played.add(sc["url"])
                    try:
                        play_url(modem, d)
                    except Exception as e:
                        print("   couldn't play it:", e)
                else:
                    print("   (no audio)")
            if first:
                print(f"({len(new)} earlier detections ignored)\n")
                first = False
        except Exception as e:
            print("Error querying BirdWeather:", e)
        time.sleep(POLL_INTERVAL)


def place_key(d):
    """(country, state) of the station, lowercase; '' when unknown."""
    st = d.get("station") or {}
    return ((st.get("country") or "").strip().lower(),
            (st.get("state") or "").strip().lower())


def variety_rank(d, recent_places):
    """0 = a country not heard lately; 1 = same country but another state;
    2 = a place heard lately (or unknown)."""
    country, state = place_key(d)
    if not country and not state:
        return 1
    recent_countries = {c for c, _ in recent_places}
    if country and country not in recent_countries:
        return 0
    if state and (country, state) not in recent_places:
        return 1
    return 2


# ================= DAWN =================

def sun_position(t):
    """Low-precision solar position for a UTC datetime: (right ascension, declination,
    Greenwich sidereal time), degrees."""
    r = math.pi / 180
    dd = t.timestamp() / 86400 - 10957.5                      # days since J2000
    g = (357.529 + 0.98560028 * dd) * r
    q = 280.459 + 0.98564736 * dd
    L = (q + 1.915 * math.sin(g) + 0.020 * math.sin(2 * g)) * r
    e = (23.439 - 0.00000036 * dd) * r
    ra = math.atan2(math.cos(e) * math.sin(L), math.cos(L)) / r
    dec = math.asin(math.sin(e) * math.sin(L)) / r
    gmst = ((18.697374558 + 24.06570982441908 * dd) % 24) * 15
    return ra, dec, gmst


def sun_elevation(t, lat, lon):
    """(degrees above the horizon, is it morning)"""
    r = math.pi / 180
    ra, dec, gmst = sun_position(t)
    H = ((gmst + lon - ra) % 360 + 540) % 360 - 180
    el = math.asin(math.sin(lat * r) * math.sin(dec * r)
                   + math.cos(lat * r) * math.cos(dec * r) * math.cos(H * r)) / r
    return el, H < 0


def minutes_from_sunrise(t, lat, lon):
    """Minutes since (+) or until (-) sunrise at that place; None if no sunrise within 4 h."""
    from datetime import timedelta
    up = lambda x: sun_elevation(x, lat, lon)[0] > -0.833
    for m in range(0, 241):
        for sign in (1, -1):
            x = t - timedelta(minutes=m) if sign == 1 else t + timedelta(minutes=m)
            if up(x) and not up(x - timedelta(minutes=1)) and sun_elevation(x, lat, lon)[1]:
                return m if sign == 1 else -m
    return None


def dawn_of(d):
    """Minutes from sunrise if the bird sang at its dawn, else None."""
    from datetime import datetime
    where = station_coords(d)
    if not where:
        return None
    try:
        t = datetime.fromisoformat(d["timestamp"].replace("Z", "+00:00"))
    except (KeyError, ValueError):
        return None
    m = minutes_from_sunrise(t, *where)
    return m if m is not None and -DAWN_BEFORE <= m <= DAWN_AFTER else None


def dawn_boxes():
    """The band of longitudes where the sun is rising now (split at the 180° meridian)."""
    from datetime import datetime, timezone
    ra, _, gmst = sun_position(datetime.now(timezone.utc))
    lon = ((ra - gmst - 90) % 360 + 540) % 360 - 180          # sunrise at the equator
    west, east = lon - 40, lon + 45
    wrap = lambda x: ((x % 360) + 540) % 360 - 180
    if west < -180 or east > 180:
        boxes = [((-58, wrap(west)), (72, 180)), ((-58, -180), (72, wrap(east)))]
    else:
        boxes = [((-58, west), (72, east))]
    return boxes, lon


# ================= FUGLERAMME ILLUSTRATIONS =================
# Fugleramme (github.com/arnegiacomo/fugleramme) hand-cuts birds from public-domain
# 19th-century plates. Its "classic" artwork is CC BY-SA 4.0: credit it (printed on every
# slip) and share what you make with it under the same licence.

_fugle = None


def fugle_index():
    global _fugle
    if _fugle is None:
        try:
            with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), FUGLE_INDEX_FILE),
                      encoding="utf-8") as f:
                _fugle = json.load(f)
        except (OSError, ValueError):
            print(f"(can't read {FUGLE_INDEX_FILE}: printing without illustrations)")
            _fugle = {"index": {}, "artists": {}, "aliases": {}}
    return _fugle


def fugle_for(species):
    """(file name, illustrator) of a cut-out of this species, or None."""
    data = fugle_index()
    sci = (species.get("scientificName") or "").strip()
    for name in (sci, data["aliases"].get(sci)):
        if not name:
            continue
        files = data["index"].get(re.sub(r"\s+", "-", name.lower()))
        if files:
            file, source = random.choice(files)
            return file, data["artists"].get(source, source)
    return None


def fugle_picture(file):
    """The cut-out as a Pillow image (RGBA), downloaded once and kept in FUGLE_CACHE_FOLDER."""
    Image, _, _, _ = pillow()
    folder = os.path.join(os.path.dirname(os.path.abspath(__file__)), FUGLE_CACHE_FOLDER)
    path = os.path.join(folder, file + ".webp")
    if not os.path.exists(path):
        os.makedirs(folder, exist_ok=True)
        req = urllib.request.Request(FUGLE_BASE + file + ".webp", headers={"User-Agent": "fax-birdsong/1.0"})
        with urllib.request.urlopen(req, timeout=30) as r, open(path + ".part", "wb") as f:
            f.write(r.read())
        os.replace(path + ".part", path)
    return Image.open(path).convert("RGBA")


def thermal_picture(art, width_dots, lines_per_mm, height_mm=None):
    """The cut-out as black dots (Floyd-Steinberg), at the fax's resolution."""
    Image, _, _, ImageOps = pillow()
    target = max(1, round(width_dots))
    if art.width > target * 1.5:                       # work at the final size: much faster
        art = art.resize((round(target * 1.5), max(1, round(art.height * target * 1.5 / art.width))), Image.LANCZOS)
    white = Image.new("RGBA", art.size, (255, 255, 255, 255))
    gray = Image.alpha_composite(white, art).convert("L")
    alpha = art.split()[3]
    box = alpha.point(lambda a: 255 if a > 128 else 0).getbbox()
    if box:
        gray, alpha = gray.crop(box), alpha.crop(box)
    # stretch the bird's own levels so its darks and lights use the whole range
    inside = [v for v, a in zip(gray.getdata(), alpha.getdata()) if a > 128]
    if inside:
        inside.sort()
        lo, hi = inside[int(len(inside) * 0.02)], inside[int(len(inside) * 0.98)]
        lut = [max(0, min(255, round((v - lo) / max(1, hi - lo) * 235))) for v in range(256)]
        gray = gray.point(lut)
        gray.paste(255, mask=alpha.point(lambda a: 255 if a <= 235 else 0))   # no grey halo
    w = max(1, round(width_dots))
    if height_mm:                                      # fit inside the frame: whichever side touches first
        w = min(w, max(1, round(gray.width * height_mm * DOTS_PER_MM / gray.height)))
    h = max(1, round(gray.height * (w / gray.width) / DOTS_PER_MM * lines_per_mm))
    bird = gray.resize((w, h), Image.LANCZOS).convert("1").convert("L")   # dithered
    if not height_mm:
        return bird
    frame = Image.new("L", (round(width_dots), max(h, round(height_mm * lines_per_mm))), 255)
    frame.paste(bird, ((frame.width - w) // 2, frame.height - h))           # centred, on the floor
    return frame


def dawn_card(d, art=None, credit="", lines_per_mm=LINES_PER_MM):
    """The illustration, and under it: the species' name, coordinates · bird time · operator,
    and the illustrator's credit."""
    Image, ImageDraw, _, _ = pillow()
    data = data_line(d)
    data_font, credit_font = load_font(DAWN_DATA_SIZE), load_font(DAWN_CREDIT_SIZE)
    sp = d.get("species") or {}
    # text, drawn with square dots, then squeezed to the fax's line spacing
    lines = []
    if sp.get("commonName"):
        lines.append((sp["commonName"], load_font(DAWN_NAME_SIZE), DAWN_NAME_SIZE))
    if sp.get("scientificName"):
        lines.append((sp["scientificName"], load_italic_font(DAWN_SCI_SIZE), DAWN_SCI_SIZE))
    station = d.get("station") or {}
    country = (station.get("country") or "").strip()
    place = place_name(station)
    if place == "somewhere" or re.match(r"^-?\d", place):
        place = country                                       # no coordinates as a place name
    elif country and country.lower() not in place.lower():
        place += ", " + country                               # always the country
    if place:
        lines.append(("", data_font, 6))
        lines.append((place, load_font(DAWN_SCI_SIZE), DAWN_SCI_SIZE))
    if lines:
        lines.append(("", data_font, 10))                       # a little space
    lines += [(data, data_font, DAWN_DATA_SIZE)] + ([(credit, credit_font, DAWN_CREDIT_SIZE)] if credit else [])
    text_h = sum(int(size * 1.6) for _, _, size in lines) + 30
    text = Image.new("L", (FAX_WIDTH, text_h), 255)
    td = ImageDraw.Draw(text)
    y = 10
    for line, font, size in lines:
        if line:
            draw_text(td, FAX_WIDTH / 2 - text_width(line, font, size) / 2, y, line, font, size)
        y += int(size * 1.6)
    text = text.resize((FAX_WIDTH, max(1, round(text_h / DOTS_PER_MM * lines_per_mm))), Image.LANCZOS)
    text = text.point(lambda v: 255 if v > 150 else 0)
    pic = thermal_picture(art, ILLUSTRATION_WIDTH_CM * 10 * DOTS_PER_MM, lines_per_mm,
                          ILLUSTRATION_HEIGHT_CM * 10) if art else None
    top, gap = round(6 * lines_per_mm), round(4 * lines_per_mm)       # 6 mm above, 4 mm between
    height = top + (pic.height + gap if pic else 0) + text.height + round(4 * lines_per_mm)
    card = Image.new("L", (FAX_WIDTH, height), 255)
    y = top
    if pic:
        card.paste(pic, ((FAX_WIDTH - pic.width) // 2, y))
        y += pic.height + gap
    card.paste(text, (0, y))
    return card


def dawn_cards(d):
    """Prepares the slip (standard and fine resolution) BEFORE the bird sings, so the fax
    can be called the moment the song ends (Easy Receive doesn't wait long)."""
    found = fugle_for(d["species"])
    art, credit = None, ""
    if found:
        file, artist = found
        try:
            art = fugle_picture(file)
            credit = f"{artist} · cut by Fugleramme (CC BY-SA 4.0)"
            print(f"   illustration: {file} ({artist})")
        except Exception as e:
            print("   couldn't get the illustration:", e)
    return dawn_card(d, art, credit), dawn_card(d, art, credit, LINES_PER_MM * 2)


def region_mode(modem, region_name):
    """A whole region: too many birds to play them all, so each round it
    picks the newest one(s) that pass the filters, plays one, and goes again."""
    region = REGIONS[region_name]
    zones = WORLD_ZONES if region_name == "world" else [(region_name, region)]
    if region_name == "dawn":
        zones = [("dawn", region)]
    zone_index = 0
    print(f"Listening to the region '{region_name}'... (Ctrl + C to quit)\n")
    seen, played = set(), set()
    recent_places = []          # (country, state) of the last birds played
    while True:
        played_one = False
        zone_name, region = zones[zone_index % len(zones)]
        zone_index += 1
        if region_name == "dawn":
            boxes, lon = dawn_boxes()
            print(f"   ~ following the sunrise, now near {abs(round(lon))}°{'E' if lon >= 0 else 'W'} ~")
        elif len(zones) > 1:
            print(f"   ~ listening to {zone_name} ~")
        try:
            if region_name == "dawn":
                found = []
                for box in boxes:
                    found += fetch_region(box)
            else:
                found = fetch_region(region)
            new = [d for d in found if d["id"] not in seen]
            for d in new:
                seen.add(d["id"])
            candidates = [d for d in new
                          if not skip_reason(d)
                          and (d.get("soundscape") or {}).get("url")
                          and d["soundscape"]["url"] not in played]
            if region_name == "dawn":
                for d in candidates:
                    d["dawn"] = dawn_of(d)
                candidates = [d for d in candidates if d["dawn"] is not None]      # at its own sunrise
                if ONLY_ILLUSTRATED:
                    candidates = [d for d in candidates if fugle_for(d["species"])]   # has a drawing
            if PICK == "random":
                random.shuffle(candidates)
            else:
                candidates.sort(key=when, reverse=True)
            if VARY_PLACES:
                # prefer other countries, then other states; keeps newest/random order within each group
                candidates.sort(key=lambda c: variety_rank(c, recent_places))
            if new:
                print(f"({len(new)} new detections in the region, "
                      f"{len(candidates)} pass the filters)")
            for d in candidates[:TRIES_PER_ROUND]:
                print(describe(d))
                played.add(d["soundscape"]["url"])
                try:
                    if play_url(modem, d):
                        played_one = True
                        recent_places.append(place_key(d))
                        del recent_places[:-max(1, VARY_PLACES)]
                        break
                except Exception as e:
                    print("   couldn't play it:", e)
        except Exception as e:
            print("Error querying BirdWeather:", e)
        if not played_one:
            if len(zones) > 1 and zone_index % len(zones):
                continue                      # nothing here right now: try the next zone at once
            time.sleep(POLL_INTERVAL)
        elif PAUSE_BETWEEN_BIRDS:
            time.sleep(PAUSE_BETWEEN_BIRDS)


# ================= START =================

def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    mode = sys.argv[1]
    if mode == "dawn-preview":
        # no modem: saves what the fax would print for one bird, as dawn_preview.png
        sp = {"commonName": "Australian Magpie", "scientificName": sys.argv[2] if len(sys.argv) > 2 else "Gymnorhina tibicen"}
        d = {"timestamp": time.strftime("%Y-%m-%dT%H:%M:%S+00:00", time.gmtime()), "species": sp,
             "station": {"name": "BirdNET-Pi - test station", "coords": {"lat": -33.87, "lon": 151.21},
                         "timezone": "Australia/Sydney"}}
        found = fugle_for(sp)
        art = fugle_picture(found[0]) if found else None
        credit = f"{found[1]} · cut by Fugleramme (CC BY-SA 4.0)" if found else ""
        out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "dawn_preview.png")
        dawn_card(d, art, credit, LINES_PER_MM * 2).resize((FAX_WIDTH, round(dawn_card(d, art, credit, LINES_PER_MM * 2).height * DOTS_PER_MM / (LINES_PER_MM * 2)))).save(out)
        print(f"Saved {out} ({'with' if art else 'without'} illustration)")
        return

    modem = Modem(find_port())
    try:
        modem.setup_voice()
        if mode == "test":
            print("Playing test call...")
            modem.play(test_call())
        elif mode == "print-test":
            lines = [("> fax-275 print test", 60), ("  prueba de impresión", 44),
                     ("", 10), (f'  time      {time.strftime("%Y-%m-%d %H:%M:%S")}', 36)]
            print("Sending a test print to the fax...")
            if PRINT_STYLE == "message":
                test_bird = {"timestamp": time.strftime("%Y-%m-%dT%H:%M:%S+00:00", time.gmtime()),
                             "species": {"commonName": "Blue Jay"},
                             "station": {"state": "New York"}}
                if MESSAGE_STYLE in ("poem", "fortune"):
                    test_bird["station"].update({"coords": {"lat": 40.73, "lon": -73.99},
                                                 "name": "BirdNET-Pi - test station"})
                if MESSAGE_STYLE == "fortune":
                    phrase, signature, data = fortune_parts(test_bird)
                    print(f'   printing: "{phrase}"  {signature}  [{data}]')
                    print_card(modem, fortune_card(phrase, signature, data),
                               fortune_card(phrase, signature, data, LINES_PER_MM * 2))
                    return
                if MESSAGE_STYLE == "poem":
                    phrase, signature, data = poem_parts(test_bird)
                    print(f'   printing: "{phrase}"  {signature}  [{data}]')
                    print_card(modem, poem_card(phrase, signature, data),
                               poem_card(phrase, signature, data, LINES_PER_MM * 2))
                    return
                if MESSAGE_STYLE == "letter":
                    text, signature = bird_letter(test_bird)
                else:
                    text, signature = bird_message(test_bird), ""
                print(f'   printing: "{text}"  {signature}')
                corner = ["40.73°N 73.99°W", time.strftime("bird time %H:%M"),
                          credit_text({"name": "BirdNET-Pi - test station"})]
                print_card(modem, message_card(text, corner_lines=corner, signature=signature),
                           message_card(text, LINES_PER_MM * 2, corner, signature))
            elif PRINT_STYLE == "illustration":
                print_card(modem, illustration_card(), illustration_card(LINES_PER_MM * 2))
            else:
                print_card(modem, make_card(lines, test_call(), SAMPLE_RATE))
        elif mode == "birds":
            birds_mode(modem)
        elif mode == "region":
            name = sys.argv[2] if len(sys.argv) > 2 else DEFAULT_REGION
            if name not in REGIONS:
                sys.exit(f"Unknown region '{name}'. Options: {', '.join(REGIONS)}")
            region_mode(modem, name)
        else:
            if not os.path.exists(mode):
                sys.exit(f"Can't find the file {mode}")
            print(f"Playing {mode}...")
            modem.play(load_audio(mode))
        print("Done.")
    except KeyboardInterrupt:
        print("\nStopped.")
    finally:
        modem.close()


if __name__ == "__main__":
    main()

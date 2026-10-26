"""
slic_test.py — tests the SLIC (Ag1171) with the fax, step by step.

  cd ~/Downloads/birdsong/slic
  python3 slic_test.py

Before: the Arduino has slic_ring.ino uploaded, the SLIC replaces the 9 V battery and the
resistor, the fax's receive mode is "Fax" (FAX ONLY) with a ring delay of 1 or 2,
and the bird fax program is NOT running (it would be using the modem).

  Test 1 — does the fax ring and answer by itself?
  Test 2 — once it has answered, does the fax's speaker play what the modem sends? (the bird)
  Test 3 — does the fax print a card sent right after?
"""
import glob, importlib.util, os, sys, time

import serial

HERE = os.path.dirname(os.path.abspath(__file__))
FAX_SCRIPT = os.path.join(HERE, "..", "fax", "birdsong_dawn.py")


def load_fax_program():
    spec = importlib.util.spec_from_file_location("birdsong", FAX_SCRIPT)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def find_arduino_and_modem():
    """The Arduino answers 'SLIC READY' / 'ONHOOK'; the modem answers 'OK' to AT."""
    ports = sorted(set(glob.glob("/dev/cu.usbmodem*") + glob.glob("/dev/cu.usbserial*")
                       + glob.glob("/dev/cu.wchusbserial*")))
    arduino = modem = None
    for p in ports:
        try:
            s = serial.Serial(p, 9600, timeout=0.3)
            time.sleep(2.2)                          # opening the port resets the Arduino
            s.write(b"Q")
            text = s.read(200).decode("latin-1", "ignore")
            s.close()
            if "HOOK" in text or "SLIC" in text:
                arduino = p
                continue
        except serial.SerialException:
            pass
        try:
            s = serial.Serial(p, 115200, timeout=0.5, rtscts=True)
            s.write(b"AT\r"); time.sleep(0.5)
            text = s.read(200).decode("latin-1", "ignore")
            s.close()
            if "OK" in text:
                modem = p
        except serial.SerialException:
            pass
    return arduino, modem


def wait_for(ard, words, timeout):
    end, seen = time.time() + timeout, ""
    while time.time() < end:
        line = ard.readline().decode("latin-1", "ignore").strip()
        if line:
            print(f"   [arduino] {line}")
            if any(w in line for w in words):
                return line
    return None


def ask(question):
    return input(f"\n>>> {question} (y/n) ").strip().lower().startswith("y")


def main():
    print("Looking for the Arduino and the modem...")
    arduino_port, modem_port = find_arduino_and_modem()
    print(f"   Arduino: {arduino_port}\n   modem:   {modem_port}")
    if not arduino_port or not modem_port:
        sys.exit("Couldn't find both. Is the Arduino plugged in with slic_ring.ino? "
                 "Is the bird program stopped?")
    fax = load_fax_program()
    ard = serial.Serial(arduino_port, 9600, timeout=0.5)
    time.sleep(2.2)
    ard.reset_input_buffer()

    print("\nTEST 1 — ringing the fax. It should ring and answer by itself after 1-2 rings.")
    ard.write(b"R")
    result = wait_for(ard, ["ANSWERED", "NO ANSWER", "ALREADY OFFHOOK"], 35)
    if result != "ANSWERED":
        print("\nThe fax didn't answer. Check: receive mode = FAX (FAX ONLY), ring delay 1-2,"
              " the SLIC's 5 V supply (it needs ~0.5 A while ringing), and TIP/RING wiring.")
        if result == "ALREADY OFFHOOK":
            print("(Something was already off-hook: hang up the fax with HOOK and try again.)")
        return
    print("   ✓ the fax answered by itself")

    print("\nTEST 2 — playing a test call through the line, right now...")
    modem = fax.Modem(modem_port)
    try:
        modem.setup_voice(quiet=True)
        modem.play(fax.test_call())
        heard = ask("Did you hear the test call from the FAX's speaker?")
        print("   ✓ full automation is possible" if heard else
              "   ✗ the fax doesn't play the line while answering: we'll combine the SLIC with a HOOK servo")

        print("\nTEST 3 — sending a test card to the fax...")
        d = {"timestamp": time.strftime("%Y-%m-%dT%H:%M:%S+00:00", time.gmtime()),
             "species": {"commonName": "Australian Magpie", "scientificName": "Gymnorhina tibicen"},
             "station": {"name": "SLIC test", "country": "Australia",
                         "coords": {"lat": -33.87, "lon": 151.21}, "timezone": "Australia/Sydney"}}
        try:
            cards = fax.dawn_cards(d)
            fax.print_card(modem, *cards)
        except Exception as e:
            print("   couldn't print:", e)
        printed = ask("Did the fax print the magpie card?")
        print("\nSUMMARY")
        print(f"   rings and answers by itself: yes")
        print(f"   plays the bird after answering: {'yes' if heard else 'no'}")
        print(f"   prints after answering: {'yes' if printed else 'no'}")
        print("\nSend this summary to Claude to build the automatic version.")
    finally:
        modem.close()
        ard.close()


if __name__ == "__main__":
    main()

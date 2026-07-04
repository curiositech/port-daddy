#!/usr/bin/env python3
"""Parse pdftotext -layout output of Pub.102 (International Code of Signals) into JSON."""
import json
import re
import sys

SRC = sys.argv[1]
OUT = sys.argv[2]

lines = open(SRC, encoding="utf-8").read().split("\n")

RUNNING_HEADS = re.compile(
    r"CHAPTER \d\.|GENERAL SIGNAL CODE$|MEDICAL SIGNAL CODE$|^\s*Cross\s*$|^\s*Reference\s*$"
    r"|^\s*Code\s+Meaning|^\s*Code\s*$|^\s*Meaning\s*$|^\s*\d{1,3}\s*$"
)
DOT_LEADER = re.compile(r"(\. ){3,}|\.{4,}")
SECTION = re.compile(r"^\s*SECTION (\d+):\s*(.+?)\s*$")
# primary: code at col 0-1, 2 letters (ch2) or M+2 letters (ch3)
PRIMARY = re.compile(r"^(\*?)([A-Z]{2,3})\s{2,}(\S.*)$")
COMPLEMENT = re.compile(r"^\s{4,}\*?([A-Z]{2,3})\s(\d{1,2})\s{2,}(\S.*)$")


def clean(text):
    text = DOT_LEADER.sub(" ", text)
    text = re.sub(r"\s+", " ", text).strip()
    # strip trailing cross-ref code left after leader removal
    return text


def parse_range(start, end, code_re, chapter):
    """Parse signal entries between line numbers [start, end)."""
    entries = []
    section = None
    topic = None
    current = None  # last primary or complement dict, for continuations
    for raw in lines[start:end]:
        if not raw.strip():
            continue
        if RUNNING_HEADS.search(raw):
            continue
        m = SECTION.match(raw)
        if m:
            section = clean(m.group(2))
            topic = None
            current = None
            continue
        stripped = raw.strip()
        indent = len(raw) - len(raw.lstrip())
        # footnote lines ("*   Procedural signal.") — asterisk followed by space
        if re.match(r"^\s*\*\s+\S", raw):
            current = None
            continue
        # cross-reference lines (dot leaders ending in a code): skip unless the
        # line itself starts with a code, i.e. a real signal defined by
        # equivalence to another (usually single-letter) signal.
        xref = DOT_LEADER.search(raw) and re.search(r"([A-Z]{1,3}(?: \d{1,2})?)\*?\s*$", raw)
        if xref:
            pm = PRIMARY.match(raw.lstrip()) if indent <= 2 else None
            if pm and code_re.fullmatch(pm.group(2)):
                current = {
                    "code": pm.group(2),
                    "meaning": clean(pm.group(3)[: DOT_LEADER.search(pm.group(3)).start()] if DOT_LEADER.search(pm.group(3)) else pm.group(3)) + ".",
                    "see_also": xref.group(1),
                    "section": section,
                    "topic": topic,
                    "kind": "signal",
                    "chapter": chapter,
                }
                entries.append(current)
                current = None
                continue
            current = None
            continue
        m = COMPLEMENT.match(raw)
        if m and code_re.fullmatch(m.group(1)):
            current = {
                "code": f"{m.group(1)} {m.group(2)}",
                "meaning": clean(m.group(3)),
                "section": section,
                "topic": topic,
                "kind": "complement",
                "chapter": chapter,
            }
            entries.append(current)
            continue
        m = PRIMARY.match(raw.lstrip()) if indent <= 2 else None
        if m and code_re.fullmatch(m.group(2)):
            current = {
                "code": m.group(2),
                "meaning": clean(m.group(3)),
                "section": section,
                "topic": topic,
                "kind": "signal",
                "chapter": chapter,
            }
            if m.group(1):
                current["colregs_note"] = True
            entries.append(current)
            continue
        # topic heading: deep-centered short line, TitleCase/CAPS, no sentence punctuation
        if indent >= 35 and len(stripped) <= 60 and not stripped.endswith((".", ",", ";", ")")):
            topic = clean(stripped)
            current = None
            continue
        # continuation of previous meaning (aligned with meaning column)
        if current is not None and indent >= 4:
            if current["meaning"].endswith("-") and stripped[:1].islower():
                current["meaning"] = clean(current["meaning"][:-1] + stripped)
            else:
                current["meaning"] = clean(current["meaning"] + " " + stripped)
            continue
        current = None
    return entries


def find_line(pattern, lo=0):
    rx = re.compile(pattern)
    for i in range(lo, len(lines)):
        if rx.search(lines[i]):
            return i
    return -1


ch2_start = find_line(r"^\s*SECTION 1: DISTRESS—EMERGENCY", 1100)
ch3_start = find_line(r"^MAA\s")
ch3_end = find_line(r"SECTION 4: TABLES OF COMPLEMENTS", 6000)
ch2 = parse_range(ch2_start, 5689, re.compile(r"[A-Z]{2}"), 2)
ch3 = parse_range(ch3_start - 5, ch3_end, re.compile(r"M[A-Z]{2}"), 3)

MORSE = {
    "A": ".-", "B": "-...", "C": "-.-.", "D": "-..", "E": ".", "F": "..-.",
    "G": "--.", "H": "....", "I": "..", "J": ".---", "K": "-.-", "L": ".-..",
    "M": "--", "N": "-.", "O": "---", "P": ".--.", "Q": "--.-", "R": ".-.",
    "S": "...", "T": "-", "U": "..-", "V": "...-", "W": ".--", "X": "-..-",
    "Y": "-.--", "Z": "--..",
    "1": ".----", "2": "..---", "3": "...--", "4": "....-", "5": ".....",
    "6": "-....", "7": "--...", "8": "---..", "9": "----.", "0": "-----",
}

PHONETIC = {
    "A": "Alfa", "B": "Bravo", "C": "Charlie", "D": "Delta", "E": "Echo",
    "F": "Foxtrot", "G": "Golf", "H": "Hotel", "I": "India", "J": "Juliett",
    "K": "Kilo", "L": "Lima", "M": "Mike", "N": "November", "O": "Oscar",
    "P": "Papa", "Q": "Quebec", "R": "Romeo", "S": "Sierra", "T": "Tango",
    "U": "Uniform", "V": "Victor", "W": "Whiskey", "X": "X-ray", "Y": "Yankee",
    "Z": "Zulu",
}

FIGURES = {
    "0": "Nadazero", "1": "Unaone", "2": "Bissotwo", "3": "Terrathree",
    "4": "Kartefour", "5": "Pantafive", "6": "Soxisix", "7": "Setteseven",
    "8": "Oktoeight", "9": "Novenine", "decimal": "Decimal", "full_stop": "Stop",
}

SINGLE_LETTER = {
    "A": {"meaning": "I have a diver down; keep well clear at slow speed."},
    "B": {"meaning": "I am taking in, or discharging, or carrying dangerous goods.", "colregs_note": True},
    "C": {"meaning": "Yes (affirmative or 'The significance of the previous group should be read in the affirmative').", "colregs_note": True},
    "D": {"meaning": "Keep clear of me; I am maneuvering with difficulty.", "colregs_note": True},
    "E": {"meaning": "I am altering my course to starboard.", "colregs_note": True},
    "F": {"meaning": "I am disabled; communicate with me."},
    "G": {"meaning": "I require a pilot. When made by fishing vessels operating in close proximity on the fishing grounds it means: 'I am hauling nets'.", "colregs_note": True},
    "H": {"meaning": "I have a pilot on board.", "colregs_note": True},
    "I": {"meaning": "I am altering my course to port.", "colregs_note": True},
    "J": {"meaning": "I am on fire and have dangerous cargo on board: keep well clear of me, or I am leaking dangerous cargo."},
    "K": {"meaning": "I wish to communicate with you."},
    "L": {"meaning": "You should stop your vessel instantly."},
    "M": {"meaning": "My vessel is stopped and making no way through the water."},
    "N": {"meaning": "No (negative or 'The significance of the previous group should be read in the negative'). Visual or sound only; for voice or radio use 'NO'."},
    "O": {"meaning": "Man overboard."},
    "P": {"meaning": "In harbor: All persons should report on board as the vessel is about to proceed to sea. At sea by fishing vessels: 'My nets have come fast upon an obstruction'. As a sound signal: 'I require a pilot'."},
    "Q": {"meaning": "My vessel is 'healthy' and I request free pratique."},
    "S": {"meaning": "I am operating astern propulsion.", "colregs_note": True},
    "T": {"meaning": "Keep clear of me; I am engaged in pair trawling.", "colregs_note": True},
    "U": {"meaning": "You are running into danger."},
    "V": {"meaning": "I require assistance."},
    "W": {"meaning": "I require medical assistance."},
    "X": {"meaning": "Stop carrying out your intentions and watch for my signals."},
    "Y": {"meaning": "I am dragging my anchor."},
    "Z": {"meaning": "I require a tug. When made by fishing vessels operating in close proximity on the fishing grounds it means: 'I am shooting nets'.", "colregs_note": True},
}

SINGLE_LETTER_COMPLEMENTS = [
    {"code": "A", "complement": "three numerals", "meaning": "AZIMUTH or BEARING."},
    {"code": "C", "complement": "three numerals", "meaning": "COURSE."},
    {"code": "D", "complement": "two, four, or six numerals", "meaning": "DATE."},
    {"code": "G", "complement": "four or five numerals", "meaning": "LONGITUDE (the last two numerals denote minutes and the rest degrees)."},
    {"code": "K", "complement": "one numeral", "meaning": "I wish to COMMUNICATE with you by... (Complements Table 1)."},
    {"code": "L", "complement": "four numerals", "meaning": "LATITUDE (the first two denote degrees and the rest minutes)."},
    {"code": "R", "complement": "one or more numerals", "meaning": "DISTANCE in nautical miles."},
    {"code": "S", "complement": "one or more numerals", "meaning": "SPEED in knots."},
    {"code": "T", "complement": "four numerals", "meaning": "LOCAL TIME (the first two denote hours and the rest minutes)."},
    {"code": "V", "complement": "one or more numerals", "meaning": "SPEED in kilometers per hour."},
    {"code": "Z", "complement": "four numerals", "meaning": "GMT (the first two denote hours and the rest minutes)."},
    {"code": "Z", "complement": "one numeral", "meaning": "To call or address shore visual stations (numeral approved by local port authority)."},
]

PROCEDURE = {
    "AA": "'All after...' (used after RPT): repeat all after...",
    "AB": "'All before...' (used after RPT): repeat all before...",
    "AR": "Ending signal or End of Transmission or signal.",
    "AS": "Waiting signal or period.",
    "BN": "'All between... and...' (used after RPT): repeat all between... and...",
    "C": "Affirmative — YES, or 'the significance of the previous group should be read in the affirmative'.",
    "CS": "'What is the name or identity signal of your vessel (or station)?'",
    "CQ": "Call for unknown station(s) or general call to all stations.",
    "DE": "'From...' (precedes the name or identity signal of the calling station).",
    "K": "'I wish to communicate with you' or 'invitation to transmit'.",
    "NO": "Negative — NO, or 'the significance of the previous group should be read in the negative'. Voice: pronounced 'NO'.",
    "OK": "Acknowledging a correct repetition, or 'it is correct'.",
    "RQ": "Interrogative, or 'the significance of the previous group should be read as a question'.",
    "R": "'Received' or 'I have received your last signal'.",
    "RPT": "Repeat signal: 'I repeat', or 'repeat what you have sent', or 'repeat what you have received'.",
    "WA": "'Word or group after...' (used after RPT).",
    "WB": "'Word or group before...' (used after RPT).",
    "AAA": "Full stop or decimal point (flashing light).",
    "EEEEEE": "Erase signal (flashing light).",
    "AA AA AA": "Call for unknown station or general call (flashing light).",
    "TTTT": "Answering signal (flashing light).",
    "T": "Word or group received (flashing light).",
}

COMPLEMENTS_TABLES = {
    "1": {
        "title": "Means of communication (used with K and signals referencing Table 1)",
        "values": {
            "1": "Morse signaling by hand flags or arms",
            "2": "Loud hailer (megaphone)",
            "3": "Morse signaling lamp",
            "4": "Sound signals",
        },
    },
    "2": {
        "title": "Kind of assistance (used with CB, CD and signals referencing Table 2)",
        "values": {
            "0": "Water", "1": "Provisions", "2": "Fuel", "3": "Pumping equipment",
            "4": "Firefighting appliances", "5": "Medical assistance", "6": "Towing",
            "7": "Survival craft", "8": "Vessel to stand by", "9": "Icebreaker",
        },
    },
    "3": {
        "title": "Direction (used with signals referencing Table 3)",
        "values": {
            "0": "Direction unknown (or calm)", "1": "Northeast", "2": "East",
            "3": "Southeast", "4": "South", "5": "Southwest", "6": "West",
            "7": "Northwest", "8": "North", "9": "All directions (or confused or variable)",
        },
    },
}

ICEBREAKER = [
    {"code": "WM", "meaning": "Icebreaker support is now commencing. Use special icebreaker support signals and keep continuous watch for sound, visual, or radiotelephony signals."},
    {"code": "WO", "meaning": "Icebreaker support is finished. Proceed to your destination."},
    {"code": "A", "icebreaker": "Go ahead (proceed along the ice channel).", "assisted": "I am going ahead (I am proceeding along the ice channel)."},
    {"code": "G", "icebreaker": "I am going ahead; follow me.", "assisted": "I am going ahead; I am following you."},
    {"code": "J", "icebreaker": "Do not follow me (proceed along the ice channel).", "assisted": "I will not follow you (I will proceed along the ice channel)."},
    {"code": "P", "icebreaker": "Slow down.", "assisted": "I am slowing down."},
    {"code": "N", "icebreaker": "Stop your engines.", "assisted": "I am stopping my engines."},
    {"code": "H", "icebreaker": "Reverse your engines.", "assisted": "I am reversing my engines."},
    {"code": "L", "icebreaker": "You should stop your vessel instantly.", "assisted": "I am stopping my vessel."},
    {"code": "4", "icebreaker": "Stop. I am icebound.", "assisted": "Stop. I am icebound."},
    {"code": "Q", "icebreaker": "Shorten the distance between vessels.", "assisted": "I am shortening the distance."},
    {"code": "B", "icebreaker": "Increase the distance between vessels.", "assisted": "I am increasing the distance."},
    {"code": "5", "icebreaker": "Attention.", "assisted": "Attention."},
    {"code": "Y", "icebreaker": "Be ready to take (or cast off) the towline.", "assisted": "I am ready to take (or cast off) the towline."},
]

corpus = {
    "source": "Pub. 102, International Code of Signals, United States Edition, 1969 (Revised 2003), NIMA",
    "morse": MORSE,
    "phonetic_letters": PHONETIC,
    "phonetic_figures": FIGURES,
    "procedure_signals": PROCEDURE,
    "single_letter": SINGLE_LETTER,
    "single_letter_complements": SINGLE_LETTER_COMPLEMENTS,
    "icebreaker_signals": ICEBREAKER,
    "complements_tables": COMPLEMENTS_TABLES,
    "general_code": ch2,
    "medical_code": ch3,
}

with open(OUT, "w", encoding="utf-8") as f:
    json.dump(corpus, f, indent=1, ensure_ascii=False)

print(f"general_code entries: {len(ch2)} ({sum(1 for e in ch2 if e['kind']=='signal')} signals, {sum(1 for e in ch2 if e['kind']=='complement')} complements)")
print(f"medical_code entries: {len(ch3)}")

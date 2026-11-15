// Pure matching logic for the spelling-alphabet trainer. No DOM access —
// everything here is unit-tested in spelling.test.ts.

import type {AlphabetTable} from '../data/spelling-alphabets';

export interface IndexEntry {
    /** Letter(s) the alias stands for, e.g. 'a' or 'sch'. */
    letters: string;
    /** The alias as written in the table, for display. */
    alias: string;
}

export interface AliasIndex {
    exact: Map<string, IndexEntry>;
}

export interface Row {
    letter: string | null;
    said: string | null;
    ok: boolean;
    extra?: boolean;
}

/** Lowercase and strip everything except a–z, ä, ö, ü, ß. Umlauts and ß are NOT folded. */
export function normalize(s: string): string {
    return s.toLowerCase().replace(/[^a-zäöüß]/g, '');
}

/** Split input on whitespace, commas, semicolons and slashes. */
export function tokenize(input: string): string[] {
    return input.split(/[\s,;/]+/).filter((t) => t.length > 0);
}

/** Build a lookup from normalized alias to its letters. Earlier tables win on collisions. */
export function buildIndex(tables: AlphabetTable[]): AliasIndex {
    const exact = new Map<string, IndexEntry>();
    for (const table of tables) {
        for (const [letters, aliases] of Object.entries(table)) {
            for (const alias of aliases) {
                const key = normalize(alias);
                if (!exact.has(key)) {
                    exact.set(key, {letters, alias});
                }
            }
        }
    }
    return {exact};
}

/** Primary alias per single letter, for the "show answer" display. */
export function primaryAliases(tables: AlphabetTable[]): Map<string, string> {
    const primary = new Map<string, string>();
    for (const table of tables) {
        for (const [letters, aliases] of Object.entries(table)) {
            if (Array.from(letters).length === 1 && !primary.has(letters)) {
                primary.set(letters, aliases[0]);
            }
        }
    }
    return primary;
}

export function levenshtein(a: string, b: string): number {
    if (a === b) return 0;
    let prev = Array.from({length: b.length + 1}, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
        const curr = [i];
        for (let j = 1; j <= b.length; j++) {
            const substitution = prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1);
            curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, substitution);
        }
        prev = curr;
    }
    return prev[b.length];
}

// Distance ≤ 1 is accepted, ≤ 2 for aliases of 6+ characters. Ties between
// aliases that stand for different letters are ambiguous and yield no match.
function fuzzyLookup(token: string, index: AliasIndex): IndexEntry | null {
    let best: IndexEntry | null = null;
    let bestDistance = Infinity;
    let ambiguous = false;
    for (const [key, entry] of index.exact) {
        const max = key.length >= 6 ? 2 : 1;
        if (Math.abs(key.length - token.length) > max) continue;
        const distance = levenshtein(token, key);
        if (distance > max) continue;
        if (distance < bestDistance) {
            bestDistance = distance;
            best = entry;
            ambiguous = false;
        } else if (distance === bestDistance && best && entry.letters !== best.letters) {
            ambiguous = true;
        }
    }
    return ambiguous ? null : best;
}

// "Doppel-Samuel", "Doppel Samuel", "doppelt Samuel", "double Sierra" — a
// doubled letter said once with a prefix. Longest first, so "doppelt" isn't
// read as "doppel" + "t".
const DOUBLE_PREFIXES = ['doppelt', 'doppel', 'double'];

/**
 * Splits a doubling prefix off a normalized token: "doppelsamuel" → "samuel",
 * "doppel" → "" (the code word follows as the next token), anything else → null.
 */
function stripDoublePrefix(token: string, index: AliasIndex): string | null {
    if (index.exact.has(token)) return null;
    const prefix = DOUBLE_PREFIXES.find((p) => token.startsWith(p));
    return prefix === undefined ? null : token.slice(prefix.length);
}

// Words people say between code words that carry no letter: fillers and
// joins, including how the transcription tends to write "ähm" ("im").
const FILLERS = new Set([
    'und', 'dann', 'also', 'so', 'ja', 'äh', 'ähm', 'öhm', 'hm', 'hmm', 'mh', 'im', 'em',
    'and', 'then', 'uh', 'um', 'uhm', 'er', 'erm', 'ok', 'okay',
]);

// A spoken correction takes back the code word before it: "Charlie, nein,
// Bravo" is just "Bravo". Two-word forms are matched with the space removed.
const CORRECTIONS = new Set(['nein', 'nee', 'nö', 'falsch', 'korrektur', 'no', 'wrong', 'sorry', 'ichmeine', 'imean']);

/**
 * Decode code-word tokens into letters. Two consecutive tokens are first tried
 * as one alias ("Umlaut Aachen", "scharfes S"); multi-letter aliases (ch, sch)
 * expand into individual letters; "Doppel-…"/"double …" repeats the next code
 * word's letters. Fillers ("und", "ähm") are skipped, and a correction ("nein",
 * "no", "ich meine") takes back the code word before it. Code words always win:
 * a filler or correction that is also an alias counts as the alias.
 * Unrecognized tokens become null.
 */
export function decode(tokens: string[], index: AliasIndex): (string | null)[] {
    // One group per code word, so a correction can take back the whole word
    // ("Schule" is three letters, "Doppel-Samuel" two).
    const groups: (string | null)[][] = [];
    let repeat = 1;
    let corrected = false; // "nein, nein, Bravo" takes back one word, not two
    const emit = (letters: (string | null)[]) => {
        const group: (string | null)[] = [];
        for (let n = 0; n < repeat; n++) group.push(...letters);
        groups.push(group);
        repeat = 1;
        corrected = false;
    };
    const takeBack = () => {
        if (!corrected) groups.pop();
        corrected = true;
        repeat = 1;
    };
    const push = (entry: IndexEntry) => emit(Array.from(entry.letters));
    let i = 0;
    while (i < tokens.length) {
        let token = normalize(tokens[i]);
        if (!token) {
            i++;
            continue;
        }
        const next = i + 1 < tokens.length ? normalize(tokens[i + 1]) : '';
        if (!index.exact.has(token)) {
            if (next && CORRECTIONS.has(token + next) && !index.exact.has(token + next)) {
                takeBack();
                i += 2;
                continue;
            }
            if (CORRECTIONS.has(token)) {
                takeBack();
                i++;
                continue;
            }
            if (FILLERS.has(token)) {
                i++;
                continue;
            }
        }
        const doubled = stripDoublePrefix(token, index);
        if (doubled !== null) {
            repeat = 2;
            if (doubled === '') {
                i++;
                continue;
            }
            token = doubled;
        }
        if (next) {
            const joined = index.exact.get(token + next);
            if (joined) {
                push(joined);
                i += 2;
                continue;
            }
        }
        const hit = index.exact.get(token) ?? fuzzyLookup(token, index);
        if (hit) {
            push(hit);
        } else {
            emit([null]);
        }
        i++;
    }
    return groups.flat();
}

function isAliasPrefix(token: string, index: AliasIndex): boolean {
    for (const key of index.exact.keys()) {
        if (key.length > token.length && key.startsWith(token)) return true;
    }
    return false;
}

/**
 * Decode for live per-keystroke feedback: the token still being typed (no
 * delimiter after it) and a token that can only be the start of a two-token
 * alias ("Umlaut …", "scharfes …") stay pending instead of showing as wrong.
 */
export function liveDecode(input: string, index: AliasIndex): (string | null)[] {
    let tokens = tokenize(input);
    if (tokens.length > 0 && !/[\s,;/]$/.test(input)) {
        const last = normalize(tokens[tokens.length - 1]);
        const prev = tokens.length > 1 ? normalize(tokens[tokens.length - 2]) : '';
        const complete = index.exact.has(last) || (prev !== '' && index.exact.has(prev + last));
        if (!complete) tokens = tokens.slice(0, -1);
    }
    if (tokens.length > 0) {
        const last = normalize(tokens[tokens.length - 1]);
        if (last && !index.exact.has(last) && isAliasPrefix(last, index)) {
            tokens = tokens.slice(0, -1);
        }
    }
    return decode(tokens, index);
}

/** Compare the target word against decoded letters, grapheme by grapheme. */
export function check(word: string, decoded: (string | null)[]): Row[] {
    const target = Array.from(normalize(word));
    const rows: Row[] = target.map((letter, i) => {
        const said = i < decoded.length ? decoded[i] : null;
        return {letter, said, ok: said !== null && said === letter};
    });
    for (let i = target.length; i < decoded.length; i++) {
        rows.push({letter: null, said: decoded[i], ok: false, extra: true});
    }
    return rows;
}

/** Complete iff every target letter is ok and there are no extra rows. */
export function isComplete(rows: Row[]): boolean {
    return rows.length > 0 && rows.every((row) => !row.extra && row.ok);
}

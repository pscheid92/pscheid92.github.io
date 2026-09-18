// Spelling alphabet tables. Key = the letter(s) a code word stands for,
// value = accepted aliases; the first alias is the one shown as the answer.
// Key order is the display order of the reference table.

export type AlphabetTable = Record<string, string[]>;

export type Mode = 'nato' | 'de' | 'bos';

export const nato: AlphabetTable = {
    a: ['Alfa', 'Alpha'],
    b: ['Bravo'],
    c: ['Charlie'],
    d: ['Delta'],
    e: ['Echo'],
    f: ['Foxtrot', 'Foxtrott'],
    g: ['Golf'],
    h: ['Hotel'],
    i: ['India'],
    j: ['Juliett', 'Juliet'],
    k: ['Kilo'],
    l: ['Lima'],
    m: ['Mike'],
    n: ['November'],
    o: ['Oscar'],
    p: ['Papa'],
    q: ['Quebec'],
    r: ['Romeo'],
    s: ['Sierra'],
    t: ['Tango'],
    u: ['Uniform'],
    v: ['Victor'],
    w: ['Whiskey', 'Whisky'],
    x: ['X-ray', 'Xray'],
    y: ['Yankee'],
    z: ['Zulu'],
};

// The ordinary civil table (DIN 5009:2022) — city names; ch/sch have no code
// words and are spelled letter by letter.
export const buchstabiertafel: AlphabetTable = {
    a: ['Aachen'],
    ä: ['Umlaut Aachen'],
    b: ['Berlin'],
    c: ['Chemnitz'],
    d: ['Düsseldorf'],
    e: ['Essen'],
    f: ['Frankfurt'],
    g: ['Goslar'],
    h: ['Hamburg'],
    i: ['Ingelheim'],
    j: ['Jena'],
    k: ['Köln'],
    l: ['Leipzig'],
    m: ['München'],
    n: ['Nürnberg'],
    o: ['Offenbach'],
    ö: ['Umlaut Offenbach'],
    p: ['Potsdam'],
    q: ['Quickborn'],
    r: ['Rostock'],
    s: ['Salzwedel'],
    ß: ['Eszett'],
    t: ['Tübingen'],
    u: ['Unna'],
    ü: ['Umlaut Unna'],
    v: ['Völklingen'],
    w: ['Wuppertal'],
    x: ['Xanten'],
    y: ['Ypsilon'],
    z: ['Zwickau'],
};

// The BOS Inland-Alphabet (DV/PDV 810, Taschenkarte 04-018 of the Bavarian
// fire schools): the classic names table, content-identical to DIN 5009:1996.
// ß is not on the pocket card; Eszett is kept from DIN 5009:1996 so ß words
// stay spellable.
export const bos: AlphabetTable = {
    a: ['Anton'],
    ä: ['Ärger'],
    b: ['Berta'],
    c: ['Cäsar', 'Caesar'],
    ch: ['Charlotte'],
    d: ['Dora'],
    e: ['Emil'],
    f: ['Friedrich'],
    g: ['Gustav'],
    h: ['Heinrich'],
    i: ['Ida'],
    j: ['Julius'],
    k: ['Kaufmann'],
    l: ['Ludwig'],
    m: ['Martha'],
    n: ['Nordpol'],
    o: ['Otto'],
    ö: ['Ökonom'],
    p: ['Paula'],
    q: ['Quelle'],
    r: ['Richard'],
    s: ['Samuel', 'Siegfried'],
    sch: ['Schule'],
    ß: ['Eszett', 'scharfes S'],
    t: ['Theodor'],
    u: ['Ulrich'],
    ü: ['Übermut'],
    v: ['Viktor'],
    w: ['Wilhelm'],
    x: ['Xanthippe'],
    y: ['Ypsilon'],
    z: ['Zacharias'],
};

export const modeTables: Record<Mode, AlphabetTable[]> = {
    nato: [nato],
    de: [buchstabiertafel],
    bos: [bos],
};

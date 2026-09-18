import {describe, expect, it} from 'vitest';
import {buildIndex, check, decode, isComplete, levenshtein, liveDecode, normalize, primaryAliases, tokenize} from './spelling';
import {modeTables} from '../data/spelling-alphabets';
import {englishWords, germanWords} from '../data/spelling-words';

const nato = buildIndex(modeTables.nato);
const de = buildIndex(modeTables.de);
const bos = buildIndex(modeTables.bos);

describe('normalize', () => {
    it('lowercases and strips everything except a-z, ä, ö, ü, ß', () => {
        expect(normalize('X-ray!')).toBe('xray');
        expect(normalize('Grün-Blau 42')).toBe('grünblau');
    });

    it('does not fold umlauts or ß', () => {
        expect(normalize('Straße')).toBe('straße');
        expect(normalize('ÄÖÜß')).toBe('äöüß');
    });
});

describe('tokenize', () => {
    it('splits on whitespace, commas, semicolons and slashes', () => {
        expect(tokenize('Anton, Berta;Cäsar/Dora  Emil')).toEqual(['Anton', 'Berta', 'Cäsar', 'Dora', 'Emil']);
        expect(tokenize('  ')).toEqual([]);
    });
});

describe('decode — exact aliases', () => {
    it('resolves NATO aliases', () => {
        expect(decode(['Alfa', 'Bravo', 'Zulu'], nato)).toEqual(['a', 'b', 'z']);
        expect(decode(['Alpha', 'Whisky', 'Juliet', 'Foxtrott'], nato)).toEqual(['a', 'w', 'j', 'f']);
    });

    it('resolves Buchstabiertafel (city) aliases', () => {
        expect(decode(['Aachen', 'Quickborn', 'Eszett'], de)).toEqual(['a', 'q', 'ß']);
    });

    it('resolves BOS aliases', () => {
        expect(decode(['Anton', 'Siegfried', 'Ärger'], bos)).toEqual(['a', 's', 'ä']);
        expect(decode(['Übermut', 'Ökonom'], bos)).toEqual(['ü', 'ö']);
    });

    it('does not accept BOS names in the city table or vice versa', () => {
        expect(decode(['Berta'], de)).toEqual([null]);
        expect(decode(['Berlin'], bos)).toEqual([null]);
    });
});

describe('decode — fuzzy matching', () => {
    it('resolves close misspellings', () => {
        expect(decode(['Xray'], nato)).toEqual(['x']);
        expect(decode(['Wiskey'], nato)).toEqual(['w']);
        expect(decode(['Ceasar'], bos)).toEqual(['c']);
        expect(decode(['Antom'], bos)).toEqual(['a']);
    });

    it('rejects garbage tokens', () => {
        expect(decode(['qqq'], nato)).toEqual([null]);
        expect(decode(['xyz'], bos)).toEqual([null]);
    });

    it('returns null when the closest match is ambiguous across letters', () => {
        const synthetic = buildIndex([{x: ['abcde'], y: ['abcdf']}]);
        expect(decode(['abcdg'], synthetic)).toEqual([null]);
        const sameLetter = buildIndex([{x: ['abcde', 'abcdf']}]);
        expect(decode(['abcdg'], sameLetter)).toEqual(['x']);
    });
});

describe('decode — two-token aliases', () => {
    it('joins "Umlaut <city>" in the city table', () => {
        expect(decode(['Umlaut', 'Aachen'], de)).toEqual(['ä']);
        expect(decode(['Umlaut', 'Offenbach'], de)).toEqual(['ö']);
        expect(decode(['Umlaut', 'Unna'], de)).toEqual(['ü']);
    });

    it('joins "scharfes S" in BOS', () => {
        expect(decode(['scharfes', 'S'], bos)).toEqual(['ß']);
    });

    it('leaves surrounding tokens intact', () => {
        expect(decode(['Aachen', 'Umlaut', 'Aachen', 'Berlin'], de)).toEqual(['a', 'ä', 'b']);
    });
});

describe('decode — ch/sch expansion', () => {
    it('expands Charlotte and Schule in BOS', () => {
        expect(decode(['Charlotte'], bos)).toEqual(['c', 'h']);
        expect(decode(['Schule'], bos)).toEqual(['s', 'c', 'h']);
    });

    it('does not accept them in the city table', () => {
        expect(decode(['Charlotte'], de)).toEqual([null]);
        expect(decode(['Schule'], de)).toEqual([null]);
    });
});

describe('check', () => {
    const strasse = decode(['Samuel', 'Theodor', 'Richard', 'Anton', 'Eszett', 'Emil'], bos);

    it('treats ß as a single grapheme: "Straße" spelled with Eszett is complete', () => {
        const rows = check('Straße', strasse);
        expect(rows).toHaveLength(6);
        expect(isComplete(rows)).toBe(true);
    });

    it('"Strasse" is not complete with the same spelling', () => {
        expect(isComplete(check('Strasse', strasse))).toBe(false);
    });

    it('marks wrong letters with the said letter', () => {
        const rows = check('Buch', decode(['Berta', 'Ulrich', 'Cäsar', 'Ida'], bos));
        expect(rows[2]).toEqual({letter: 'c', said: 'c', ok: true});
        expect(rows[3]).toEqual({letter: 'h', said: 'i', ok: false});
    });

    it('flags surplus code words as extra rows and incomplete', () => {
        const rows = check('echo', decode(['Echo', 'Charlie', 'Hotel', 'Oscar', 'Zulu'], nato));
        expect(rows).toHaveLength(5);
        expect(rows[4]).toEqual({letter: null, said: 'z', ok: false, extra: true});
        expect(isComplete(rows)).toBe(false);
    });

    it('unanswered positions are not ok', () => {
        const rows = check('echo', decode(['Echo'], nato));
        expect(rows[1]).toEqual({letter: 'c', said: null, ok: false});
        expect(isComplete(rows)).toBe(false);
        expect(isComplete([])).toBe(false);
    });
});

describe('liveDecode', () => {
    it('keeps the token still being typed pending', () => {
        expect(liveDecode('Anto', bos)).toEqual([]);
        expect(liveDecode('Antom', bos)).toEqual([]);
        expect(liveDecode('Antom ', bos)).toEqual(['a']);
    });

    it('includes an exactly matching token immediately', () => {
        expect(liveDecode('Anton', bos)).toEqual(['a']);
        expect(liveDecode('Umlaut Aachen', de)).toEqual(['ä']);
    });

    it('keeps the start of a two-token alias pending', () => {
        expect(liveDecode('Umlaut ', de)).toEqual([]);
        expect(liveDecode('Anton scharfes ', bos)).toEqual(['a']);
    });

    it('still shows completed garbage tokens', () => {
        expect(liveDecode('blorb ', bos)).toEqual([null]);
    });
});

describe('primaryAliases', () => {
    it('uses the first alias of each single letter', () => {
        expect(primaryAliases(modeTables.de).get('a')).toBe('Aachen');
        expect(primaryAliases(modeTables.bos).get('a')).toBe('Anton');
        expect(primaryAliases(modeTables.bos).get('ß')).toBe('Eszett');
        expect(primaryAliases(modeTables.nato).get('x')).toBe('X-ray');
    });
});

describe('levenshtein', () => {
    it('computes edit distance', () => {
        expect(levenshtein('kilo', 'kilo')).toBe(0);
        expect(levenshtein('ceasar', 'caesar')).toBe(2);
        expect(levenshtein('', 'abc')).toBe(3);
    });
});

describe('word lists', () => {
    const lists: [string, string[]][] = [['english', englishWords], ['german', germanWords]];

    it.each(lists)('%s list has unique single-token words of 4-10 letters', (_name, words) => {
        expect(words.length).toBeGreaterThanOrEqual(150);
        const seen = new Set<string>();
        for (const word of words) {
            expect(word).toMatch(/^[A-Za-zÄÖÜäöüß]+$/);
            const graphemes = Array.from(word).length;
            expect(graphemes, word).toBeGreaterThanOrEqual(4);
            expect(graphemes, word).toBeLessThanOrEqual(10);
            expect(seen.has(word.toLowerCase()), `duplicate: ${word}`).toBe(false);
            seen.add(word.toLowerCase());
        }
    });

    it('german list has a good share of umlaut/ß words', () => {
        const special = germanWords.filter((w) => /[äöüßÄÖÜ]/.test(w));
        expect(special.length).toBeGreaterThanOrEqual(40);
    });
});

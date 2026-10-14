import {describe, expect, it} from 'vitest';
import {daysOf, isoWeekOf, mondayOf, parseWeekInput, shiftWeek, todayUtc, weeksInYear} from './isoweek';

const iso = (date: Date) => date.toISOString().slice(0, 10);
const utc = (s: string) => new Date(`${s}T00:00:00Z`);

describe('weeksInYear', () => {
    it('has 53 weeks when the year starts on a Thursday, or on a Wednesday in a leap year', () => {
        expect(weeksInYear(2015)).toBe(53);
        expect(weeksInYear(2020)).toBe(53);
        expect(weeksInYear(2026)).toBe(53);
        expect(weeksInYear(2032)).toBe(53);
    });

    it('has 52 weeks otherwise', () => {
        expect(weeksInYear(2021)).toBe(52);
        expect(weeksInYear(2024)).toBe(52);
        expect(weeksInYear(2025)).toBe(52);
        expect(weeksInYear(2027)).toBe(52);
    });
});

describe('mondayOf and daysOf', () => {
    it('finds the Monday of a week', () => {
        expect(iso(mondayOf(2026, 42))).toBe('2026-10-12');
        expect(iso(mondayOf(2024, 1))).toBe('2024-01-01');
    });

    it('starts week 1 in the previous year when 1 January is a Tuesday to Thursday', () => {
        expect(iso(mondayOf(2026, 1))).toBe('2025-12-29');
        expect(iso(mondayOf(2025, 1))).toBe('2024-12-30');
    });

    it('starts week 1 in January when 1 January is a Friday to Sunday', () => {
        expect(iso(mondayOf(2021, 1))).toBe('2021-01-04');
        expect(iso(mondayOf(2027, 1))).toBe('2027-01-04');
    });

    it('lists Monday to Sunday across a year boundary', () => {
        expect(daysOf(2026, 53).map(iso)).toEqual([
            '2026-12-28', '2026-12-29', '2026-12-30', '2026-12-31',
            '2027-01-01', '2027-01-02', '2027-01-03',
        ]);
    });
});

describe('isoWeekOf', () => {
    it('returns the week of a date', () => {
        expect(isoWeekOf(utc('2026-10-14'))).toEqual({year: 2026, week: 42});
        expect(isoWeekOf(utc('2026-10-12'))).toEqual({year: 2026, week: 42});
        expect(isoWeekOf(utc('2026-10-18'))).toEqual({year: 2026, week: 42});
    });

    it('assigns late December and early January to the year of their Thursday', () => {
        expect(isoWeekOf(utc('2024-12-31'))).toEqual({year: 2025, week: 1});
        expect(isoWeekOf(utc('2027-01-03'))).toEqual({year: 2026, week: 53});
        expect(isoWeekOf(utc('2021-01-03'))).toEqual({year: 2020, week: 53});
    });

    it('round-trips with mondayOf for every week of several years', () => {
        for (const year of [2020, 2021, 2025, 2026, 2027]) {
            for (let week = 1; week <= weeksInYear(year); week++) {
                for (const day of daysOf(year, week)) {
                    expect(isoWeekOf(day)).toEqual({year, week});
                }
            }
        }
    });
});

describe('todayUtc', () => {
    it('keeps the local calendar date', () => {
        expect(iso(todayUtc(new Date(2026, 9, 14, 23, 59)))).toBe('2026-10-14');
        expect(iso(todayUtc(new Date(2026, 9, 14, 0, 1)))).toBe('2026-10-14');
    });
});

describe('shiftWeek', () => {
    it('moves within a year', () => {
        expect(shiftWeek({year: 2026, week: 42}, 1)).toEqual({year: 2026, week: 43});
        expect(shiftWeek({year: 2026, week: 42}, -1)).toEqual({year: 2026, week: 41});
    });

    it('rolls over into the neighbouring year', () => {
        expect(shiftWeek({year: 2026, week: 53}, 1)).toEqual({year: 2027, week: 1});
        expect(shiftWeek({year: 2025, week: 52}, 1)).toEqual({year: 2026, week: 1});
        expect(shiftWeek({year: 2027, week: 1}, -1)).toEqual({year: 2026, week: 53});
    });
});

describe('parseWeekInput', () => {
    it('reads a bare week with the default year', () => {
        expect(parseWeekInput('42', 2026)).toEqual({ok: true, year: 2026, week: 42});
        expect(parseWeekInput('KW 7', 2026)).toEqual({ok: true, year: 2026, week: 7});
        expect(parseWeekInput('W07', 2026)).toEqual({ok: true, year: 2026, week: 7});
    });

    it('reads the year from either side', () => {
        for (const input of ['2027/42', '42/2027', '2027-42', '2027-W42', '2027W42', 'kw42 2027', 'year=2027&week=42', '2027%2F42']) {
            expect(parseWeekInput(input, 2026)).toEqual({ok: true, year: 2027, week: 42});
        }
    });

    it('reads "this" as the default year', () => {
        expect(parseWeekInput('this/42', 2026)).toEqual({ok: true, year: 2026, week: 42});
        expect(parseWeekInput('THIS/53', 2026)).toEqual({ok: true, year: 2026, week: 53});
        expect(parseWeekInput('this/53', 2025)).toEqual({ok: false, error: '2025 has only 52 calendar weeks.'});
        expect(parseWeekInput('this', 2026).ok).toBe(false);
    });

    it('rejects weeks outside the year', () => {
        expect(parseWeekInput('0', 2026).ok).toBe(false);
        expect(parseWeekInput('54', 2026).ok).toBe(false);
        expect(parseWeekInput('2025/53', 2026)).toEqual({ok: false, error: '2025 has only 52 calendar weeks.'});
        expect(parseWeekInput('2026/53', 2025)).toEqual({ok: true, year: 2026, week: 53});
    });

    it('rejects input it cannot read', () => {
        expect(parseWeekInput('', 2026).ok).toBe(false);
        expect(parseWeekInput('abc', 2026).ok).toBe(false);
        expect(parseWeekInput('2026', 2026).ok).toBe(false);
        expect(parseWeekInput('26/42', 2026).ok).toBe(false);
        expect(parseWeekInput('2026/1/2', 2026).ok).toBe(false);
    });
});

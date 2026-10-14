// ISO 8601 calendar weeks: weeks start on Monday, and week 1 is the week
// that contains 4 January (equivalently, the first Thursday of the year).
// All dates are UTC midnights so daylight saving never shifts a day.

export interface IsoWeek {
    year: number;
    week: number;
}

export type ParseResult = ({ok: true} & IsoWeek) | {ok: false; error: string};

const DAY_MS = 86_400_000;

/** ISO weekday of a UTC date: Monday = 1 … Sunday = 7. */
export function isoWeekday(date: Date): number {
    return date.getUTCDay() || 7;
}

export function weeksInYear(year: number): number {
    // 28 December always falls in the last ISO week of its year
    return isoWeekOf(new Date(Date.UTC(year, 11, 28))).week;
}

/** Monday of the given ISO week, as a UTC midnight. */
export function mondayOf(year: number, week: number): Date {
    const jan4 = new Date(Date.UTC(year, 0, 4));
    return new Date(Date.UTC(year, 0, 4 - (isoWeekday(jan4) - 1) + 7 * (week - 1)));
}

/** The seven days (Monday to Sunday) of the given ISO week. */
export function daysOf(year: number, week: number): Date[] {
    const monday = mondayOf(year, week);
    return Array.from({length: 7}, (_, i) => new Date(Date.UTC(
        monday.getUTCFullYear(), monday.getUTCMonth(), monday.getUTCDate() + i,
    )));
}

/** ISO week of a calendar date; only its UTC year, month and day are read. */
export function isoWeekOf(date: Date): IsoWeek {
    const day = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
    // the Thursday of the same week decides which year the week belongs to
    const thursday = new Date(day + (4 - isoWeekday(new Date(day))) * DAY_MS);
    const year = thursday.getUTCFullYear();
    const week = Math.floor((thursday.getTime() - Date.UTC(year, 0, 1)) / DAY_MS / 7) + 1;
    return {year, week};
}

/** Today's local calendar date as a UTC midnight, comparable with the dates above. */
export function todayUtc(now: Date = new Date()): Date {
    return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
}

/** The week before (-1) or after (+1), rolling over the year. */
export function shiftWeek({year, week}: IsoWeek, delta: -1 | 1): IsoWeek {
    if (delta < 0) {
        return week > 1 ? {year, week: week - 1} : {year: year - 1, week: weeksInYear(year - 1)};
    }
    return week < weeksInYear(year) ? {year, week: week + 1} : {year: year + 1, week: 1};
}

/**
 * Reads a week, optionally with a year, from loose input such as "42",
 * "2026/42", "this/42", "42/2026", "2026-W42", "KW 42" or "year=2026&week=42".
 * The year is the four-digit number, and "this" stands for defaultYear;
 * without either, defaultYear is used.
 */
export function parseWeekInput(raw: string, defaultYear: number): ParseResult {
    let text = raw;
    try {
        text = decodeURIComponent(raw);
    } catch {
        // keep the raw text
    }
    text = text.replace(/this/gi, String(defaultYear));

    const numbers = (text.match(/\d+/g) ?? []).map((n) => ({value: Number(n), digits: n.length}));
    if (numbers.length === 0) {
        return {ok: false, error: 'Enter a calendar week, for example 42 or 2026/42.'};
    }
    if (numbers.length > 2) {
        return {ok: false, error: 'Enter a week and at most one year, for example 2026/42.'};
    }

    let week: number;
    let year = defaultYear;
    if (numbers.length === 1) {
        week = numbers[0].value;
    } else {
        const yearIndex = numbers.findIndex((n) => n.digits === 4);
        if (yearIndex === -1) {
            return {ok: false, error: 'Write the year with four digits, for example 2026/42.'};
        }
        year = numbers[yearIndex].value;
        week = numbers[1 - yearIndex].value;
    }

    if (numbers.length === 1 && numbers[0].digits === 4) {
        return {ok: false, error: `${week} looks like a year. Add the week, for example ${week}/42.`};
    }
    if (week < 1) {
        return {ok: false, error: 'Calendar weeks start at 1.'};
    }
    const weeks = weeksInYear(year);
    if (week > weeks) {
        return {ok: false, error: `${year} has only ${weeks} calendar weeks.`};
    }
    return {ok: true, year, week};
}

import {type CollectionEntry, getCollection} from 'astro:content';
import {series} from '../data/series';

type Post = CollectionEntry<'blog'>;

export type WritingEntry =
    | { kind: 'post'; date: Date; post: Post }
    | { kind: 'series'; date: Date; id: string; title: string; description: string; parts: Post[] };

/** Published posts only, newest first — never drafts, not even on the dev server. */
export async function getPublishedPosts(): Promise<Post[]> {
    return sortNewestFirst((await getCollection('blog')).filter((post) => !post.data.draft));
}

/** Published posts, plus drafts while running the dev server so they can be previewed. */
export async function getVisiblePosts(): Promise<Post[]> {
    return sortNewestFirst((await getCollection('blog')).filter((post) => import.meta.env.DEV || !post.data.draft));
}

function sortNewestFirst(posts: Post[]): Post[] {
    return posts.sort((a, b) => (b.data.pubDate?.valueOf() ?? 0) - (a.data.pubDate?.valueOf() ?? 0));
}

/**
 * Posts in reverse chronological order, with every series folded into a single entry
 * (placed at its newest part) once at least two of its parts are published.
 */
export function toEntries(posts: Post[]): WritingEntry[] {
    const entries: WritingEntry[] = [];
    const seen = new Set<string>();

    for (const post of posts) {
        const id = post.data.series;
        const parts = id ? posts.filter((p) => p.data.series === id) : [];

        if (id && parts.length >= 2) {
            if (seen.has(id)) continue;
            seen.add(id);
            entries.push({
                kind: 'series',
                date: post.data.pubDate ?? new Date(0),
                id,
                title: series[id]?.title ?? id,
                description: series[id]?.description ?? '',
                parts: parts.sort((a, b) => (a.data.seriesPart ?? 0) - (b.data.seriesPart ?? 0)),
            });
        } else {
            entries.push({kind: 'post', date: post.data.pubDate ?? new Date(0), post});
        }
    }

    return entries;
}

export function readTime(post: Post): number {
    const words = (post.body || '').trim().split(/\s+/).length;
    return Math.max(1, Math.ceil(words / 230));
}

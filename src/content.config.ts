import {defineCollection, z} from 'astro:content';
import {glob} from 'astro/loaders';

const blog = defineCollection({
    // Load Markdown and MDX files in the `src/content/blog/` directory.
    loader: glob({base: './src/content/blog', pattern: '**/*.{md,mdx}'}),

    // Type-check front matter using a schema
    schema: ({image}) =>
        z.object({
            title: z.string(),
            description: z.string(),
            // Transform string to a Date object
            pubDate: z.coerce.date().optional(),
            updatedDate: z.coerce.date().optional(),
            heroImage: image().optional(),
            tags: z.array(z.string()).default([]),
            draft: z.boolean().default(false),
        }),
});

const projects = defineCollection({
    loader: glob({base: './src/content/projects', pattern: '**/*.{md,mdx}'}),
    schema: () =>
        z.object({
            title: z.string(),
            description: z.string(),
            language: z.string(),
            secondaryLanguage: z.string().optional(),
            github: z.string().url().optional(),
            liveUrl: z.string().optional(),
            kind: z.enum(['Live', 'CLI', 'Library', 'Infrastructure']),
            topics: z.array(z.string()).default([]),
        }),
});

export const collections = {blog, projects};

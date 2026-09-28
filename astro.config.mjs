// @ts-check

import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import {defineConfig} from 'astro/config';

// https://astro.build/config
export default defineConfig({
    site: 'https://patrickscheid.de',
    integrations: [mdx(), sitemap()],
    markdown: {
        shikiConfig: {
            // Both themes are emitted as CSS variables; global.css picks one per data-theme
            themes: {light: 'github-light', dark: 'github-dark'},
            defaultColor: false,
        },
    },
    redirects: {
        // the former CPR metronome page was folded into the trainer
        '/cpr': '/cpr-trainer',
    },
});

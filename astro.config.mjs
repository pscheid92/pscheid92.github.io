// @ts-check

import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import {defineConfig} from 'astro/config';

// https://astro.build/config
export default defineConfig({
    site: 'https://patrickscheid.de',
    integrations: [mdx(), sitemap()],
    redirects: {
        // the former CPR metronome page was folded into the trainer
        '/cpr': '/cpr-trainer',
    },
});

// @ts-check

import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import {defineConfig} from 'astro/config';
import icon from 'astro-icon';

// https://astro.build/config
export default defineConfig({
    site: 'https://patrickscheid.de',
    integrations: [mdx(), sitemap(), icon()],
    redirects: {
        // the former CPR metronome page was folded into the trainer
        '/cpr': '/cpr-trainer',
    },
});

// @ts-check

import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import {defineConfig} from 'astro/config';

// https://astro.build/config
export default defineConfig({
    site: 'https://patrickscheid.de',
    integrations: [
        mdx(),
        // The legal pages carry a private address: no sitemap entry, and noindex in LegalPage.astro
        sitemap({filter: (page) => !/\/(impressum|datenschutz)\/$/.test(page)}),
    ],
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
    vite: {
        server: {
            // In production the gateway sends /api/live-token to the speech-token
            // service (services/speech); here `npm run speech` runs it on 8787.
            proxy: {'/api': 'http://localhost:8787'},
        },
    },
});

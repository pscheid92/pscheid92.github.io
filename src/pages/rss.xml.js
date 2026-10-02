import { getCollection } from 'astro:content';
import rss from '@astrojs/rss';

export async function GET(context) {
	const posts = (await getCollection('blog')).filter((post) => import.meta.env.DEV || !post.data.draft);
	return rss({
		title: 'Patrick Scheid - Engineering Manager',
		description: 'Engineering Manager at STACKIT, leading the Identity and Access Management team. Writing about cryptography, Kubernetes, and engineering leadership.',
		site: context.site,
		items: posts.map((post) => ({
			...post.data,
			link: `/blog/${post.id}/`,
		})),
	});
}

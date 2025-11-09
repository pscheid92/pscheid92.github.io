import { getCollection } from 'astro:content';
import rss from '@astrojs/rss';

export async function GET(context) {
	const posts = await getCollection('blog');
	return rss({
		title: 'Patrick Scheid - Engineering Manager',
		description: 'Engineering Manager at DeepL in Munich. Leading teams at the intersection of AI research and product development with a focus on clarity, empathy, and pragmatic problem-solving.',
		site: context.site,
		items: posts.map((post) => ({
			...post.data,
			link: `/blog/${post.id}/`,
		})),
	});
}

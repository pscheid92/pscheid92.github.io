import { getCollection } from 'astro:content';
import rss from '@astrojs/rss';

export async function GET(context) {
	const posts = await getCollection('blog');
	return rss({
		title: 'Patrick Scheid - Senior Software Engineer',
		description: 'Senior Software Engineer at DeepL in Munich. Combining software engineering, data science, product management, and engineering leadership to build AI-powered products.',
		site: context.site,
		items: posts.map((post) => ({
			...post.data,
			link: `/blog/${post.id}/`,
		})),
	});
}

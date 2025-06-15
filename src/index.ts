/**
 * https://developers.cloudflare.com/workers/get-started/guide/
 */

function checkPermission(request: Request, env: Env, key: string) {
	switch (request.method) {
		case 'POST':
		case 'PUT':
		case 'DELETE':
		case 'PATCH':
			return request.headers.get('TOKEN') === env.AUTH_KEY_SECRET;
		default:
			return true;
	}
}

async function uploadFile(env: Env, key: string, file: ReadableStream | Blob, contentType: string) {
	const meta =  {
		contentType
	}
	await env.BUCKET_APP.put(key, file, {
		httpMetadata: meta
	});
	return { message: `Uploaded!`, key, meta }
}

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const url = new URL(request.url);
		const key = url.pathname.slice(1);

		if (!checkPermission(request, env, key)) {
			return Response.json({ message: 'Unauthorized' }, { status: 401 });
		}

		// Check cache first
		const cache = caches.default;
		const cacheKey = new Request(url.toString(), request);

		let res
		switch (request.method) {
			case 'GET':
			case 'HEAD':
				break
			case 'PUT': {
				const file = request.body;
				if (!file) {
					return Response.json({ message: 'No file provided' }, { status: 400 });
				}
				res = await uploadFile(env, key, file, request.headers.get('content-type') ?? '')
				break
			}
			case 'POST':
				const formData = await request.formData();
				const file = formData.get('file');
				if (!(file  && file instanceof File)) {
					return Response.json({ message: 'No file provided' }, { status: 400 });
				}
				res = await uploadFile(env, key, file.stream(), file.type)
				break
			case 'DELETE':
				await env.BUCKET_APP.delete(key);
				res = { message: `Deleted!`, key }
				break
			case 'PATCH':
				res = { message: `Cache cleared`, key}
				break
			default:
				return Response.json({ message: 'Method not allowed' }, { status: 405 });
		}
		if(res) {
			await cache.delete(cacheKey);
			return Response.json(res)
		}

		let response = await cache.match(cacheKey);

		if (response) {
			return response;
		}

		// Not in cache, fetch from R2
		const object = await env.BUCKET_APP.get(key);

		if (!object) {
			// Handle all routes under /jeelyton-tool/
			if (key.startsWith('jeelyton-tool/')) {
				const githubPath = key.replace(/^jeelyton-tool\//, '');
				const githubUrl = `https://github.com/jeelyton/jeelyton-tools/${githubPath}`;
				
				// Fetch directly from GitHub
				const response = await fetch(githubUrl);
				
				// Create new response with the same body and status
				const newResponse = new Response(response.body, {
					status: response.status,
					statusText: response.statusText,
					headers: response.headers
				});

				// save to bucket
				const clonedResponse = newResponse.clone();
				const arrayBuffer = await clonedResponse.arrayBuffer();
				await env.BUCKET_APP.put(key, arrayBuffer, {
					httpMetadata: {
						contentType: newResponse.headers.get('content-type') ?? undefined
					}
				});
				return newResponse;
			}
			return Response.json({ message: "Object not found"}, { status: 404 });
		}

		const headers = new Headers();
		headers.set("Content-Type", object.httpMetadata?.contentType || "application/octet-stream");
		headers.set("Cache-Control", "max-age=300");
		// headers.set("Cache-Control", "public, max-age=31536000, immutable");
		if (object.etag) {
			headers.set("ETag", object.etag);
		}

		response = new Response(object.body, {
			headers,
			status: 200
		});

		// Store in cache
		ctx.waitUntil(cache.put(cacheKey, response.clone()));
		return response;
	}
} satisfies ExportedHandler<Env>;

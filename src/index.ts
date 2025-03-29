import { DocumentNode, parse, print, visit } from 'graphql';

export interface Env {
	ORIGIN: string;
}

async function sha256(message: string) {
	// encode as UTF-8
	const msgBuffer = await new TextEncoder().encode(message);
	// hash the message
	const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
	// convert bytes to hex string
	return [...new Uint8Array(hashBuffer)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// List every top level query in the request that has the @cached directive.
export function queriesWithCacheDirectives(ast: DocumentNode) {
	let queriesWithCache: Map<string, { ttl: number | null; queryText: string }> = new Map();

	visit(ast, {
		// Visit all top-level query nodes.
		OperationDefinition(node) {
			// This can be null if the query is unnamed.
			const queryName = node.name?.value || '';

			// Check if the operation has a @cached directive
			const cachedDirective = node.directives?.find((directive) => directive.name.value === 'cached');

			if (cachedDirective) {
				// Extract TTL argument if present
				const ttlArg = cachedDirective.arguments?.find((arg) => arg.name.value === 'ttl');
				const ttlValue = ttlArg && ttlArg.value && ttlArg.value.kind === 'IntValue' ? parseInt(ttlArg.value.value) : null;

				queriesWithCache.set(queryName, {
					ttl: ttlValue,
					queryText: print(node),
				});
			}
		},
	});

	return queriesWithCache;
}

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const remote = env.ORIGIN;

		// Parse the request body containing the graphql query.
		const requestBody = (await request.clone().json()) as { query: string; operationName?: string; variables: any };

		const ast = parse(requestBody.query);

		const queriesToCache = queriesWithCacheDirectives(ast);
		const queryToCache = queriesToCache.get(requestBody.operationName ?? '');

		// If the query in operationName is not marked as cached, then return
		// a response directly from the origin.
		if (!queryToCache) {
			return await fetch(remote, {
				body: request.body,
				method: 'POST',
				headers: request.headers,
			});
		}

		// Check the cache for this request.

		// Hash the query, variables and important headers.
		const vary = {
			op: requestBody.operationName ?? '',
			query: queryToCache.queryText,
			vars: requestBody.variables,
			headers: {
				authorization: request.headers.get('authorization') ?? '',
				'x-hasura-admin-secret': request.headers.get('x-hasura-admin-secret') ?? '',
			},
		};
		const key = await sha256(JSON.stringify(vary));

		const cacheUrl = new URL(remote + '/__cached/' + key);

		// Check whether the value is already available in the cache
		let cachedResponse = await caches.default.match(cacheUrl);
		if (cachedResponse) {
			const newResponse = new Response(cachedResponse.body, cachedResponse);

			newResponse.headers.append('x-worker-query-cache', 'HIT');
			newResponse.headers.append('x-worker-query-cache-key', key);

			// Return the cached data.
			return newResponse;
		}

		// Send a request to the origin.
		const origin = await fetch(remote, {
			body: request.body,
			method: 'POST',
			headers: request.headers,
		});

		// Clone the response so that it's no longer immutable
		const newResponse = new Response(origin.body, origin);

		// Cache API respects Cache-Control headers. Setting s-max-age to 10
		// will limit the response to be in cache for 10 seconds max
		newResponse.headers.append('Cache-Control', `s-maxage=${Math.min(queryToCache.ttl ?? 5, 300)}`);

		// Cache the response.
		await caches.default.put(cacheUrl, newResponse.clone());

		newResponse.headers.append('x-worker-query-cache', 'MISS');
		newResponse.headers.append('x-worker-query-cache-key', key);

		// Send it back to the client.
		return newResponse;
	},
};

// test/index.spec.ts
import { env, createExecutionContext, waitOnExecutionContext, SELF } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import worker, { queriesWithCacheDirectives } from '../src/index';
import { parse, print, visit } from 'graphql';

// For now, you'll need to do something like this to get a correctly-typed
// `Request` to pass to `worker.fetch()`.
const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

// Sample GraphQL query with @cached directive at the operation level
const query = `
  query getUser @cached(ttl: 300) {
    user {
      id
      name
    }
  }

  query getPosts @cached(ttl: 600) {
    posts {
      id
      title
    }
  }

  query noCacheQuery {
    comments {
      id
      text
    }
  }
`;

describe('GraphQL proxy worker', () => {
	it('parses the query for cached directives', async () => {
		const ast = parse(query);

		const queriesToCache = queriesWithCacheDirectives(ast);

		// It's possible to have multiple queries sent in a request. Only one
		// will execute based off the operationName parameter in the request
		// body.

		expect(queriesToCache).toEqual(
			new Map([
				[
					'getUser',
					{
						ttl: 300,
						queryText: `query getUser @cached(ttl: 300) {
  user {
    id
    name
  }
}`,
					},
				],
				[
					'getPosts',
					{
						ttl: 600,
						queryText: `query getPosts @cached(ttl: 600) {
  posts {
    id
    title
  }
}`,
					},
				],
			])
		);
	});
});

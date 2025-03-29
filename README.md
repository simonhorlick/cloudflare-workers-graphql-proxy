# Cloudflare workers graphql gateway

This is a transparent caching proxy for API requests.

## How does it work?

This is an extremely simple, and hence extremely fast proxy. We parse the
graphql query from the request, check for `@cached` directives on the top level
operation. Then transparently cache the response.

## Deployment

```
npm run dev
```

Deploy the function:

```
npm run deploy
```

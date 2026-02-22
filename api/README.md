# API (Hono) — Deploy to Vercel & Cloudflare Workers

This `./api` folder is a standalone Hono-based HTTP API intended to be deployed separately from your static site (e.g. GitHub Pages). 
Same codebase can run on **Vercel** and **Cloudflare Workers**.

## Install

```bash
npm install
````

## Run locally

### Cloudflare Workers (Wrangler)

Start dev server:

```bash
npx wrangler dev
```

Test:

```bash
curl http://localhost:8787/ping
```

### Vercel 

Local Vercel dev (requires auth):

```bash
npx vercel dev
```

Test:

```bash
curl http://localhost:3000/ping
```

## Deploy

### Cloudflare Workers (Wrangler)

Login once:

```bash
npx wrangler login
```

Add secrets (example):

```bash
npx wrangler secret put API_KEY
```

Deploy:

```bash
npx wrangler deploy
```

### Vercel

Login once:

```bash
npx vercel
```

Add secrets (example):

```bash
npx vercel env add API_KEY production
npx vercel env update API_KEY production
```

Deploy:

```bash
npx vercel --prod
```

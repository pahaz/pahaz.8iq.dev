import { Hono } from 'hono'
import { cors } from 'hono/cors'

const app = new Hono()

app.use('*', cors({ origin: '*' }))

app.get('/ping', (c) => c.json({ ok: true, ts: Date.now() }))

export default app

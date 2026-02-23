import { Hono } from 'hono'
import { cors } from 'hono/cors'
import lifeCalendar from './life-calender/route'

const app = new Hono()

app.use('*', cors({ origin: '*' }))

app.get('/ping', (c) => c.json({ ok: true, ts: Date.now() }))
app.route('/life-calendar', lifeCalendar)

export default app

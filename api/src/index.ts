import { Hono } from 'hono'
import { cors } from 'hono/cors'
import lifeCalendar from './life-calender/route'
import svg2png from './svg2png/route'

const app = new Hono()

app.use('*', cors({ origin: '*' }))

app.get('/ping', (c) => c.json({ ok: true, ts: Date.now() }))
app.route('/life-calendar', lifeCalendar)
app.route('/svg2png', svg2png)

export default app

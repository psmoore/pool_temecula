# Temecula Aquatics — unofficial preview

A mock-up of [temeculaca.gov/327/Aquatics](https://temeculaca.gov/327/Aquatics) showing both City of Temecula
pools (Margarita Rec Center and the Ronald J. Parks Community Rec Center) on one live
[Pool Relay](https://www.poolrelay.com) schedule: a "what's in the water now" finder with a map, a lane
calendar per pool, program cards, and the closure notice.

Not operated by or affiliated with the City of Temecula. Schedules were read from temeculaca.gov and the
city's Rec1 class catalog on October 21, 2026.

- `index.html` — the page, with the pool list in `window.POOLS`
- `finder.js` — reads the shared Pool Relay view and builds the "now" board and map
- `style.css` — page chrome and finder styles

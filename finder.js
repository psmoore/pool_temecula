// The pool finder: both Temecula pools' sessions, read live from one Pool Relay schedule.
//
// The city's site answers "where can I swim?" with a program page per activity, each listing
// both pools in its own format, plus an announcement telling you to disregard half of it.
// Here the answer is computed: which pool is in the water right now, for what, on how many
// lanes, until when, and what opens next. The same data draws every calendar on the site.
//
//   <div id="finder" data-view="TOKEN">  the citywide board on the home page
//   <div id="today" data-view="TOKEN" data-pool="slug">  one pool's day, on its own page
//
// Pool facts (photo, area, address, which page) come from pools.js (window.POOLS).
(function () {
  const TZ = "America/Los_Angeles";
  const POOLS = window.POOLS || [];
  const API = "https://www.poolrelay.com/api/public/views/";

  // ── Time, in the pools' own zone ─────────────────────────────────────────────
  const parts = (d) => Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(d).map((p) => [p.type, p.value]));
  const P = parts(new Date());
  const TODAY = `${P.year}-${P.month}-${P.day}`;
  const NOW = +P.hour * 60 + +P.minute;
  const addDays = (iso, n) => { const d = new Date(iso + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const mins = (hhmm) => { const [h, m] = hhmm.split(":").map(Number); return h * 60 + m; };
  const clock = (hhmm) => {
    let [h, m] = hhmm.split(":").map(Number); const ap = h >= 12 && h < 24 ? "pm" : "am"; h = h % 12 || 12;
    return m ? `${h}:${String(m).padStart(2, "0")}${ap}` : `${h}${ap}`;
  };
  const span = (a, b) => {
    const ap = (t) => (+t.split(":")[0] >= 12 ? "pm" : "am");
    return ap(a) === ap(b) ? `${clock(a).replace(/[ap]m$/, "")}–${clock(b)}` : `${clock(a)}–${clock(b)}`;
  };
  const weekday = (iso, style = "long") => new Date(iso + "T12:00:00Z").toLocaleDateString("en-US", { weekday: style, timeZone: "UTC" });
  const monthDay = (iso) => new Date(iso + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  // ── What a session is, for filtering and color ───────────────────────────────
  const KINDS = {
    lap: { label: "Lap & gentle swim", re: /lap|aqua jog/i },
    rec: { label: "Public swim", re: /rec|open swim|family|diving/i },
    fit: { label: "Water fitness", re: /fitness|aerobic|aqua(?!tic)|exercise|zumba/i },
    learn: { label: "Lessons & Masters", re: /lesson|learn|level|parent|team|polo|artistic|synchro|dive team|masters|junior lifeguard|lifeguard/i },
  };
  function kindsOf(o, groupName) {
    const names = (o.groupIds || []).map((g) => groupName[g] || "").join(" ") + " " + o.title;
    const ks = [];
    if (/lesson|learn|level|parent|team|polo|artistic|synchro|masters|lifeguard/i.test(names)) ks.push("learn");
    if (/fitness|aerobic|aqua (fit|zumba|exercise)|water exercise|aqua jog/i.test(names)) ks.push("fit");
    if (/lap/i.test(names)) ks.push("lap");
    if (/rec|open swim|public swim|family (swim|night)|diving board/i.test(names)) ks.push("rec");
    return ks.length ? ks : ["other"];
  }
  const swatch = (ks) => ks.length > 1
    ? `style="background:linear-gradient(90deg,var(--${ks[0]}) 50%,var(--${ks[1]}) 50%)"`
    : `class="k-${ks[0]}"`;

  // ── Reading the schedule ─────────────────────────────────────────────────────
  // A board can read several schedules (comma-separated tokens) and merge them by pool.
  async function load(views, from, to) {
    const all = await Promise.all(String(views).split(",").map((v) => loadOne(v.trim(), from, to)));
    return Object.assign({}, ...all);
  }
  async function loadOne(view, from, to) {
    // ?preview reads a local copy of the planned schedule instead of the live one.
    const r = await fetch(/[?&]preview\b/.test(location.search) ? new URL("preview-data.json", document.querySelector('script[src$="finder.js"]').src).href
      : `${API}${view}/project?from=${from}&to=${to}`);
    if (!r.ok) throw new Error(String(r.status));
    const { occurrences, facilities, groups } = await r.json();
    // Which facility and pool every area belongs to, and how many lanes each pool has.
    const facOf = {}, poolOf = {}, isLane = {}, lanesIn = {};
    const walk = (n, fac, pool) => {
      facOf[n.id] = fac; if (pool) poolOf[n.id] = pool;
      if (n.type === "lane") { isLane[n.id] = true; if (pool) lanesIn[pool] = (lanesIn[pool] || 0) + 1; }
      (n.children || []).forEach((c) => walk(c, fac, n.type === "pool" ? n.id : pool));
    };
    (facilities || []).forEach((f) => walk(f, f.longName, null));
    // Pool Relay geocodes each facility from its address; use that for the map pin.
    for (const f of facilities || []) {
      const p = POOLS.find((x) => x.facility === f.longName);
      if (p && f.latitude != null) { p.lat = f.latitude; p.lng = f.longitude; }
    }
    const groupName = {};
    const gwalk = (g) => { groupName[g.id] = g.longName; (g.children || []).forEach(gwalk); };
    (groups || []).forEach(gwalk);
    const byFac = {};
    for (const o of occurrences) {
      const fac = facOf[o.areaIds?.[0]]; if (!fac) continue;
      const lanes = o.areaIds.filter((a) => isLane[a]);
      const pool = poolOf[o.areaIds[0]];
      const total = pool ? lanesIn[pool] || 0 : 0;
      const ev = {
        ...o, fac, kinds: o.allDay ? [] : kindsOf(o, groupName),
        laneText: !lanes.length || !total ? "" : lanes.length >= total ? `all ${total} lanes` : `${lanes.length} of ${total} lanes`,
      };
      (byFac[fac] ||= []).push(ev);
    }
    // One row per session: a booking on several lanes arrives once; drop exact repeats.
    for (const f in byFac) {
      const seen = new Set();
      byFac[f] = byFac[f].filter((o) => { const k = `${o.date}|${o.start}|${o.end}|${o.title}`; if (seen.has(k)) return false; seen.add(k); return true; })
        .sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
      // A session whose lane count changes as lessons come and go is stored as back-to-back
      // blocks. A swimmer reads it as one session: "3–6pm, 4 to 8 lanes".
      const merged = [];
      for (const o of byFac[f]) {
        const prev = merged.findLast?.((p) => p.date === o.date && p.title === o.title && !p.allDay) ?? null;
        if (prev && !o.allDay && prev.end === o.start) {
          prev.end = o.end; prev.parts.push(o);
        } else merged.push({ ...o, parts: [o] });
      }
      for (const m of merged) {
        if (m.parts.length < 2) continue;
        const counts = m.parts.map((p) => +(p.laneText.match(/^(\d+)|all (\d+)/) || []).slice(1).find(Boolean) || 0);
        const total = (m.parts[0].laneText.match(/(\d+) lanes$/) || [])[1];
        const lo = Math.min(...counts), hi = Math.max(...counts);
        if (total && lo !== hi) m.laneText = `${lo}–${hi} of ${total} lanes`;
      }
      byFac[f] = merged.sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
    }
    return byFac;
  }

  // Which sessions a pool has on a day, and what that means for a swimmer.
  function dayOf(pool, events, day, kind) {
    const evs = events || [];
    const closure = evs.find((o) => o.allDay && o.date <= day && (o.endDate || o.date) >= day && /clos/i.test(o.title));
    const sessions = closure ? [] : evs.filter((o) => !o.allDay && o.date === day && (kind === "any" || o.kinds.includes(kind)));
    const isToday = day === TODAY;
    // When several sessions are on at once, name the one most swimmers come for.
    const rank = (o) => (o.kinds.includes("lap") || o.kinds.includes("rec") ? 0 : o.kinds.includes("fit") ? 1 : 2);
    const byInterest = (a, b) => mins(a.start) - mins(b.start) || rank(a) - rank(b);
    const live = (isToday ? sessions.filter((o) => mins(o.start) <= NOW && NOW < mins(o.end)) : []).sort((a, b) => rank(a) - rank(b));
    const later = (isToday ? sessions.filter((o) => mins(o.start) > NOW) : sessions).slice().sort(byInterest);
    let state, line;
    if (closure) {
      state = "shut";
      // An open-ended closure is stored with a placeholder end; say so rather than print it.
      const openEnded = /until a reopening date is announced/i.test(closure.description || "");
      const until = openEnded ? ", no reopening date yet" : closure.endDate && closure.endDate !== closure.date ? ` through ${monthDay(closure.endDate)}` : "";
      line = `${closure.title}${until}`;
    } else if (live.length) {
      state = "open";
      const o = live[0];
      const part = (o.parts || [o]).find((p) => mins(p.start) <= NOW && NOW < mins(p.end)) || o;
      line = `In the water now: ${o.title}${part.laneText ? `, ${part.laneText}` : ""}, until ${clock(o.end)}`;
    } else if (later.length) {
      state = isToday ? "soon" : "open";
      const o = later[0];
      line = isToday ? `Opens ${clock(o.start)} for ${o.title}` : `${o.title} from ${clock(o.start)}`;
    } else {
      state = "shut";
      const any = evs.some((o) => !o.allDay);
      const next = evs.find((o) => !o.allDay && o.date > day && (kind === "any" || o.kinds.includes(kind)));
      const what = kind === "any" ? "" : ` ${KINDS[kind].label.toLowerCase()}`; // eslint-disable-line
      line = !any ? "No hours published"
        : isToday && sessions.length ? `Done for today${next ? `. Next: ${weekday(next.date)} ${clock(next.start)}` : ""}`
        : `No${what} sessions ${isToday ? "today" : weekday(day)}${next ? `. Next: ${weekday(next.date)} ${clock(next.start)}` : ""}`;
    }
    return { state, line, sessions, live, closure };
  }

  // A day as a bar from 5am to 10pm, so pools can be compared at a glance.
  const T0 = 5 * 60, T1 = 22 * 60;
  function timeline(sessions, day) {
    const pct = (m) => Math.max(0, Math.min(100, ((m - T0) / (T1 - T0)) * 100));
    const bars = sessions.map((o) => {
      const l = pct(mins(o.start)), w = pct(mins(o.end)) - l;
      const ks = o.kinds;
      const bg = ks.length > 1 ? `linear-gradient(180deg,var(--${ks[0]}) 50%,var(--${ks[1]}) 50%)` : `var(--${ks[0]})`;
      return `<i style="left:${l}%;width:${w}%;background:${bg}" title="${esc(o.title)} ${span(o.start, o.end)}"></i>`;
    }).join("");
    const now = day === TODAY && NOW > T0 && NOW < T1 ? `<span class="nowline" style="left:${pct(NOW)}%"></span>` : "";
    return `<div class="tl" aria-hidden="true">${bars}${now}</div>`;
  }

  function sessionList(sessions, day) {
    return `<ul class="sess">${sessions.map((o) => {
      const cls = day === TODAY ? (mins(o.end) <= NOW ? "past" : mins(o.start) <= NOW ? "now" : "") : "";
      return `<li class="${cls}"><span class="t">${span(o.start, o.end)}</span><span class="k" ${swatch(o.kinds)}></span>` +
        `<span>${esc(o.title)}${o.laneText ? ` <span class="n">${esc(o.laneText)}</span>` : ""}</span></li>`;
    }).join("")}</ul>`;
  }

  const miles = (a, b) => {
    const R = 3958.8, rad = Math.PI / 180;
    const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  };

  // ── One pool's page ─────────────────────────────────────────────────────────
  const single = document.getElementById("today");
  if (single) {
    const pool = POOLS.find((p) => p.slug === single.dataset.pool);
    load(single.dataset.view, TODAY, addDays(TODAY, 14)).then((byFac) => {
      const evs = byFac[pool.facility] || [];
      const d = dayOf(pool, evs, TODAY, "any");
      single.innerHTML = `<div class="pool"><div>
        <p class="state ${d.state}" style="margin-top:0"><span class="dot"></span>${esc(d.line)}</p>
        ${d.sessions.length ? timeline(d.sessions, TODAY) + `<div class="tlscale"><span>5am</span><span>noon</span><span>5pm</span><span>10pm</span></div>` + sessionList(d.sessions, TODAY) : ""}
      </div></div>`;
    }).catch(() => { single.innerHTML = `<p class="muted">The live schedule didn't load. The calendar below has every session.</p>`; });
    return;
  }

  // ── The citywide finder ─────────────────────────────────────────────────────
  const root = document.getElementById("finder");
  if (!root) return;
  const state = { day: "now", kind: "any", area: "all", me: null };
  const days = Array.from({ length: 7 }, (_, i) => addDays(TODAY, i));
  const dayChips = [["now", "Right now"], [TODAY, "Today"], ...days.slice(1).map((d, i) => [d, i === 0 ? "Tomorrow" : weekday(d, "short")])];
  const areas = ["all", ...Array.from(new Set(POOLS.filter((p) => p.kind === "yearRound").map((p) => p.area))).sort()];

  const chipRow = (name, items, cur) => `<div class="chips" role="group">${items.map(([v, l]) =>
    `<button type="button" class="chip" data-${name}="${v}" aria-pressed="${v === cur}">${esc(l)}</button>`).join("")}</div>`;
  root.innerHTML = `
    <div class="bar">
      <fieldset><legend>When</legend>${chipRow("day", dayChips, state.day)}</fieldset>
      <fieldset><legend>To do</legend>${chipRow("kind", [["any", "Anything"], ...Object.entries(KINDS).map(([k, v]) => [k, v.label])], state.kind)}</fieldset>
      ${areas.length > 2 ? `<fieldset><legend>Where</legend>${chipRow("area", areas.map((a) => [a, a === "all" ? (root.dataset.allLabel || "Everywhere") : a]), state.area)}
        <div class="chips" style="margin-top:6px"><button type="button" class="chip near" data-near aria-pressed="false">📍 Nearest to me</button></div></fieldset>` : ""}
    </div>
    <div class="summary" aria-live="polite"><span class="muted">Loading every pool's schedule…</span></div>
    <div class="split"><ol class="results"></ol><div id="map" role="region" aria-label="Map of pools"></div></div>
    <div class="legend"><span class="k-lap">Lap &amp; gentle swim</span><span class="k-rec">Public swim</span><span class="k-fit">Water fitness</span><span class="k-learn">Lessons &amp; Masters</span></div>`;
  const list = root.querySelector(".results");
  const summary = root.querySelector(".summary");

  let map = null, markers = {};
  function drawMap(rows) {
    if (!window.L) return;
    if (!map) {
      map = L.map("map", { scrollWheelZoom: false }).setView(JSON.parse(root.dataset.center || "[34.03,-118.35]"), +(root.dataset.zoom || 10));
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 18, attribution: "© OpenStreetMap contributors" }).addTo(map);
    }
    Object.values(markers).forEach((m) => m.remove()); markers = {};
    const color = { open: "#1f8a4c", soon: "#c27c0e", shut: "#8a8278" };
    for (const r of rows) {
      const m = L.circleMarker([r.p.lat, r.p.lng], {
        radius: r.p.kind === "yearRound" ? (r.d.state === "shut" ? 6 : 9) : 4,
        color: "#fff", weight: 1.5, fillColor: color[r.d.state], fillOpacity: r.p.kind === "yearRound" ? 0.95 : 0.5,
      }).addTo(map);
      m.bindPopup(`<b>${esc(r.p.name)}</b><br>${esc(r.d.line)}<br><a href="${esc(r.p.href)}">Hours and details</a>`);
      m.on("click", () => { const el = document.getElementById("p-" + r.p.slug); if (el) { el.classList.add("hl"); el.scrollIntoView({ block: "nearest", behavior: "smooth" }); setTimeout(() => el.classList.remove("hl"), 1600); } });
      markers[r.p.slug] = m;
    }
    if (state.me) {
      markers.__me = L.circleMarker([state.me.lat, state.me.lng], { radius: 7, color: "#fff", weight: 2, fillColor: "#2f6fb3", fillOpacity: 1 }).addTo(map).bindPopup("You are here");
    }
  }

  let byFac = null;
  function render() {
    const day = state.day === "now" ? TODAY : state.day;
    const yr = POOLS.filter((p) => p.kind === "yearRound" && (state.area === "all" || p.area === state.area));
    const rows = yr.map((p) => {
      const d = p.facility ? dayOf(p, byFac[p.facility], day, state.kind)
        : { state: "shut", line: p.closedNote || "Closed", sessions: [], live: [] };
      return { p, d, dist: state.me ? miles(state.me, p) : null };
    });
    const rank = { open: 0, soon: 1, shut: 2 };
    rows.sort((a, b) => {
      if (state.day === "now" || day === TODAY) { const r = rank[a.d.state] - rank[b.d.state]; if (r) return r; }
      else { const r = (a.d.state === "shut") - (b.d.state === "shut"); if (r) return r; }
      if (state.me) return a.dist - b.dist;
      const sa = a.d.live[0]?.end || a.d.sessions.find((o) => day !== TODAY || mins(o.end) > NOW)?.start || "99";
      const sb = b.d.live[0]?.end || b.d.sessions.find((o) => day !== TODAY || mins(o.end) > NOW)?.start || "99";
      return sa.localeCompare(sb) || a.p.name.localeCompare(b.p.name);
    });
    const shown = state.day === "now" ? rows.filter((r) => r.d.state === "open") : rows.filter((r) => r.d.state !== "shut");
    const rest = rows.filter((r) => !shown.includes(r));
    const what = state.kind === "any" ? "" : ` for ${KINDS[state.kind].label.toLowerCase()}`;
    const where = state.area === "all" ? "" : ` in ${state.area}`;
    const when = state.day === "now" ? `right now (${clock(`${P.hour}:${P.minute}`)})` : day === TODAY ? "today" : `on ${weekday(day)}, ${monthDay(day)}`;
    summary.innerHTML = `<b>${shown.length} of ${rows.length} pools</b><span>open${what}${where} ${when}.</span>` +
      (state.day === "now" && !shown.length ? `<span class="muted">Try “Today” to see what opens later.</span>` : "");

    const card = (r) => {
      const { p, d } = r;
      const ses = d.sessions;
      return `<li class="pool" id="p-${p.slug}">
        <div class="ph" ${p.photo ? `style="background-image:url('${esc(p.photo)}')"` : ""} role="img" aria-label=""></div>
        <div>
          <h3><a href="${esc(p.href)}">${esc(p.name)}</a></h3>
          <div class="where">${esc(p.area)} · ${esc(p.address.replace(/, CA \d{5}$/, ""))}${r.dist != null ? ` · <b>${r.dist.toFixed(1)} mi</b>` : ""}</div>
          <p class="state ${d.state}"><span class="dot"></span>${esc(d.line)}</p>
          ${ses.length ? timeline(ses, day) + sessionList(ses, day) : ""}
        </div></li>`;
    };
    list.innerHTML = (shown.length ? shown.map(card).join("") : `<li class="empty">No pool${where} matches. ${rest.length ? "The closest options are below." : ""}</li>`) +
      (rest.length ? `<li class="later-h">${state.day === "now" ? "Not open right now" : "No matching sessions that day"} · ${rest.length}</li>` + rest.map(card).join("") : "");
    drawMap(rows.concat(state.area === "all" ? POOLS.filter((p) => p.kind !== "yearRound").map((p) => ({ p, d: { state: "shut", line: p.closedNote || "Closed until summer" } })) : []));
  }

  root.addEventListener("click", (e) => {
    const b = e.target.closest("button.chip"); if (!b) return;
    if (b.hasAttribute("data-near")) {
      if (state.me) { state.me = null; b.setAttribute("aria-pressed", "false"); b.textContent = "📍 Nearest to me"; render(); return; }
      b.textContent = "📍 Finding you…";
      navigator.geolocation?.getCurrentPosition((pos) => {
        state.me = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        b.setAttribute("aria-pressed", "true"); b.textContent = "📍 Nearest first";
        render();
        if (map) map.setView([state.me.lat, state.me.lng], 12);
      }, () => { b.textContent = "📍 Location unavailable"; });
      return;
    }
    for (const k of ["day", "kind", "area"]) {
      if (b.dataset[k] !== undefined) {
        state[k] = b.dataset[k];
        root.querySelectorAll(`[data-${k}]`).forEach((x) => x.setAttribute("aria-pressed", String(x.dataset[k] === state[k])));
      }
    }
    if (byFac) render();
  });

  load(root.dataset.view, TODAY, addDays(TODAY, 7))
    .then((d) => { byFac = d; render(); })
    .catch(() => { summary.innerHTML = `<span>The live schedule didn't load. Each pool's page has its calendar.</span>`; });
})();

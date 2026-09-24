(() => {
  "use strict";

  const STORAGE_KEY = "das-rad-v1";
  const HOLD_MS = 1500;          // how long the secret spot must be held
  const MAX_CHOICES = 24;
  const PALETTE = [
    { fill: "#d63a2b", text: "#efe8d8", shape: "circle" },
    { fill: "#f2b41c", text: "#151515", shape: "square" },
    { fill: "#1f4f9e", text: "#efe8d8", shape: "circle" },
    { fill: "#151515", text: "#efe8d8", shape: "square" },
  ];
  const SPARE = { fill: "#efe8d8", text: "#151515", shape: "circle" };

  const $ = (id) => document.getElementById(id);
  const rotor = $("rotor");
  const svg = $("wheel");
  const spinBtn = $("spin");
  const hub = $("hub");
  const result = $("result");
  const resultValue = $("resultValue");
  const choicesEl = $("choices");
  const historyEl = $("history");
  const addForm = $("addForm");
  const addInput = $("addInput");
  const workshop = $("workshop");
  const weightsEl = $("weights");

  let state = load() || {
    items: ["Red", "Yellow", "Blue", "Circle", "Square", "Triangle"].map((label) => ({ label, weight: 50 })),
    history: [],
  };
  let rotation = 0;
  let spinning = false;

  // ---------- persistence ----------

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (!Array.isArray(data.items) || data.items.length < 1) return null;
      return {
        items: data.items
          .filter((i) => i && typeof i.label === "string")
          .map((i) => ({ label: i.label.slice(0, 40), weight: clamp(Number(i.weight) || 0, 0, 100) })),
        history: Array.isArray(data.history) ? data.history.slice(0, 8) : [],
      };
    } catch {
      return null;
    }
  }

  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* storage unavailable */ }
  }

  // ---------- helpers ----------

  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

  function colorFor(i, n) {
    // avoid two equal colours meeting where the last slice touches the first
    if (n > 1 && i === n - 1 && i % PALETTE.length === 0) return SPARE;
    return PALETTE[i % PALETTE.length];
  }

  function polar(r, deg) {
    const rad = (deg * Math.PI) / 180;
    return [r * Math.sin(rad), -r * Math.cos(rad)];
  }

  function el(tag, attrs = {}, ns = false) {
    const node = ns ? document.createElementNS("http://www.w3.org/2000/svg", tag) : document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    return node;
  }

  function truncate(s, max) { return s.length > max ? s.slice(0, max - 1) + "…" : s; }

  function probabilities() {
    const total = state.items.reduce((s, i) => s + i.weight, 0);
    if (total <= 0) return state.items.map(() => 1 / state.items.length);
    return state.items.map((i) => i.weight / total);
  }

  // ---------- wheel ----------

  function drawWheel() {
    svg.replaceChildren();
    const n = state.items.length;
    const R = 96;
    const slice = 360 / n;
    const fontSize = clamp(15 - n * 0.35, 6.5, 13);
    const maxChars = n > 14 ? 10 : 14;

    state.items.forEach((item, i) => {
      const c = colorFor(i, n);
      const a0 = i * slice;
      const a1 = a0 + slice;
      let shape;
      if (n === 1) {
        shape = el("circle", { r: R }, true);
      } else {
        const [x0, y0] = polar(R, a0);
        const [x1, y1] = polar(R, a1);
        shape = el("path", {
          d: `M0 0 L${x0} ${y0} A${R} ${R} 0 ${slice > 180 ? 1 : 0} 1 ${x1} ${y1} Z`,
        }, true);
      }
      shape.setAttribute("fill", c.fill);
      shape.setAttribute("stroke", "#151515");
      shape.setAttribute("stroke-width", "1.6");
      svg.appendChild(shape);

      const mid = a0 + slice / 2;
      // keep labels on the left half upright by flipping them
      const flip = mid > 180;
      const g = el("g", { transform: `rotate(${flip ? mid + 90 : mid - 90})` }, true);
      const text = el("text", {
        x: flip ? -(R - 10) : R - 10,
        y: 0,
        "text-anchor": flip ? "start" : "end",
        "dominant-baseline": "central",
        fill: c.text,
        "font-size": fontSize,
        "font-weight": 700,
        "font-family": "Jost, Futura, sans-serif",
        "letter-spacing": "0.04em",
      }, true);
      text.textContent = truncate(item.label.toUpperCase(), maxChars);
      g.appendChild(text);
      svg.appendChild(g);
    });

    // outer ring + ticks
    svg.appendChild(el("circle", { r: R, fill: "none", stroke: "#151515", "stroke-width": 4 }, true));
    for (let i = 0; i < n; i++) {
      const [x, y] = polar(R + 0.5, i * slice);
      svg.appendChild(el("circle", { cx: x, cy: y, r: 2.4, fill: "#efe8d8", stroke: "#151515", "stroke-width": 1.2 }, true));
    }
  }

  // ---------- lists ----------

  function drawChoices() {
    choicesEl.replaceChildren();
    const n = state.items.length;
    state.items.forEach((item, i) => {
      const c = colorFor(i, n);
      const li = el("li");
      const sw = el("span", { class: `swatch ${c.shape}` });
      sw.style.background = c.fill;
      const label = el("span", { class: "label", title: item.label });
      label.textContent = item.label;
      const rm = el("button", { class: "remove", type: "button", "aria-label": `Remove ${item.label}` });
      rm.textContent = "×";
      rm.disabled = spinning || n <= 2;
      rm.addEventListener("click", () => {
        state.items.splice(i, 1);
        commit();
      });
      li.append(sw, label, rm);
      choicesEl.appendChild(li);
    });
    addInput.disabled = n >= MAX_CHOICES;
    addInput.placeholder = n >= MAX_CHOICES ? "Wheel is full" : "Add a choice";
  }

  function drawHistory() {
    historyEl.replaceChildren();
    if (!state.history.length) {
      const li = el("li", { class: "empty" });
      li.textContent = "No spins yet";
      historyEl.appendChild(li);
      return;
    }
    state.history.forEach((h) => {
      const li = el("li");
      li.textContent = h;
      historyEl.appendChild(li);
    });
  }

  function drawWeights() {
    weightsEl.replaceChildren();
    const n = state.items.length;
    const probs = probabilities();
    state.items.forEach((item, i) => {
      const c = colorFor(i, n);
      const li = el("li");
      const sw = el("span", { class: `swatch ${c.shape}` });
      sw.style.background = c.fill;
      const name = el("span", { class: "name", title: item.label });
      name.textContent = item.label;
      const pct = el("span", { class: "pct" });
      pct.textContent = formatPct(probs[i]);
      const range = el("input", {
        type: "range", min: 0, max: 100, step: 1, value: item.weight,
        "aria-label": `Weight for ${item.label}`,
      });
      range.addEventListener("input", () => {
        item.weight = Number(range.value);
        refreshPcts();
        save();
      });
      li.append(sw, name, pct, range);
      weightsEl.appendChild(li);
    });
  }

  function refreshPcts() {
    const probs = probabilities();
    weightsEl.querySelectorAll(".pct").forEach((p, i) => { p.textContent = formatPct(probs[i]); });
  }

  function formatPct(p) {
    const v = p * 100;
    return (v > 0 && v < 1 ? v.toFixed(1) : Math.round(v)) + "%";
  }

  function commit() {
    save();
    drawWheel();
    drawChoices();
    if (workshop.open) drawWeights();
  }

  // ---------- spinning ----------

  function pickIndex() {
    const probs = probabilities();
    let r = Math.random();
    for (let i = 0; i < probs.length; i++) {
      r -= probs[i];
      if (r < 0 && probs[i] > 0) return i;
    }
    // floating point leftovers: last slice with any chance
    for (let i = probs.length - 1; i >= 0; i--) if (probs[i] > 0) return i;
    return 0;
  }

  function spin() {
    if (spinning || state.items.length < 2) return;
    spinning = true;
    spinBtn.disabled = true;
    hub.disabled = true;
    drawChoices();

    const n = state.items.length;
    const slice = 360 / n;
    const winner = pickIndex();
    // land somewhere natural inside the winning slice, never on an edge
    const target = winner * slice + slice * (0.12 + Math.random() * 0.76);
    const current = ((rotation % 360) + 360) % 360;
    const delta = (((-target - current) % 360) + 360) % 360;
    const turns = 5 + Math.floor(Math.random() * 3);
    rotation += turns * 360 + delta;

    rotor.classList.add("spinning");
    rotor.style.transform = `rotate(${rotation}deg)`;

    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      rotor.removeEventListener("transitionend", finish);
      spinning = false;
      spinBtn.disabled = false;
      hub.disabled = false;
      const label = state.items[winner].label;
      resultValue.textContent = label;
      result.classList.remove("pop");
      void result.offsetWidth;
      result.classList.add("pop");
      state.history = [label, ...state.history].slice(0, 8);
      save();
      drawHistory();
      drawChoices();
    };
    rotor.addEventListener("transitionend", finish);
    setTimeout(finish, 6000);
  }

  spinBtn.addEventListener("click", spin);
  hub.addEventListener("click", spin);
  document.addEventListener("keydown", (e) => {
    if (e.code === "Space" && document.activeElement === document.body && !workshop.open) {
      e.preventDefault();
      spin();
    }
  });

  addForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const label = addInput.value.trim();
    if (!label || state.items.length >= MAX_CHOICES || spinning) return;
    // new entries join at the average weight so existing odds keep their shape
    const avg = state.items.reduce((s, i) => s + i.weight, 0) / state.items.length;
    state.items.push({ label, weight: Math.round(avg) });
    addInput.value = "";
    commit();
  });

  // ---------- the secret ----------
  // Hold the full stop at the end of "Form follows function." for 1.5 s.

  const stop = $("stop");
  let holdTimer = null;
  const cancelHold = () => { clearTimeout(holdTimer); holdTimer = null; };
  stop.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    cancelHold();
    holdTimer = setTimeout(openWorkshop, HOLD_MS);
  });
  ["pointerup", "pointerleave", "pointercancel"].forEach((t) => stop.addEventListener(t, cancelHold));
  stop.addEventListener("contextmenu", (e) => e.preventDefault());

  function openWorkshop() {
    cancelHold();
    if (workshop.open) return;
    drawWeights();
    workshop.showModal();
  }

  $("closeWorkshop").addEventListener("click", () => workshop.close());
  $("equalize").addEventListener("click", () => {
    state.items.forEach((i) => { i.weight = 50; });
    save();
    drawWeights();
  });
  workshop.addEventListener("click", (e) => {
    if (e.target === workshop) workshop.close(); // click on backdrop
  });

  // ---------- go ----------
  drawWheel();
  drawChoices();
  drawHistory();
})();

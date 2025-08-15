// -------- 0) Detect bottom view & prep scaling --------
const params = new URLSearchParams(window.location.search);
if (params.get("view") === "bottom") {
  document.body.classList.add("bottom");
}

// Center + scale the 1920×1080 viewport to any monitor size
function fitViewport() {
  const vp = document.getElementById("viewport");
  if (!vp) return;
  const scale = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
  vp.style.transform = `scale(${scale})`;
  vp.style.left = ((window.innerWidth  - 1920 * scale) / 2) + 'px';
  vp.style.top  = ((window.innerHeight - 1080 * scale) / 2) + 'px';
  vp.style.position = 'absolute';
}
window.addEventListener('resize', fitViewport);
fitViewport();

// -------- 1) Your visualization code (unchanged except for size + append target) --------
d3.csv("Grouped_Music_Dataset.csv").then(data => {
  // --- Fixed canvas to fit two stacked 1080p screens ---
  const width  = 1920;         // monitor width
  const height = 2160;         // 1080 + 1080

  // Scale from your original base height 2000 -> 2160
  const S = height / 2000;     // = 1.08

  // Your constants (scaled where needed)
  const radius       = 380 * S;
  const groupCenterY = Math.round(395 * S);
  const groundY      = Math.round(1500 * S);

  const pileDotRadius = 4;
  const pileSpacingX  = 9;
  const pileSpacingY  = 9 * S;

  const startYear = 1996;
  const endYear   = 2024;
  const totalMonths = (endYear - startYear + 1) * 12;

  let pauseStarted = false;
  let pauseStartTime = null;
  const pauseDurationMs = 70000;
  let lastResetTime = performance.now();
  let isScrubbingManually = false;

  // Prepare categories and type2
  const filtered = data.filter(d => d.Last_Live_Capture && d.Grouped_Category && d.Grouped_Category.trim());
  const categories = Array.from(new Set(filtered.map(d => d.Grouped_Category.trim()))).sort();

  const categoryToType2 = {};
  filtered.forEach(d => {
    const cat = d.Grouped_Category.trim();
    const t2  = d.type2?.trim() || "Unknown";
    if (!categoryToType2[cat]) categoryToType2[cat] = new Set();
    categoryToType2[cat].add(t2);
  });

  function getCategoryStats(category, allData) {
    const sites = allData.filter(d => d.Grouped_Category.trim() === category);
    if (sites.length === 0) return null;

    const num = sites.length;
    const type2s = sites.map(d => d.type2 || "Unknown");
    const modeType2 = type2s.sort((a,b) => type2s.filter(v=>v===a).length - type2s.filter(v=>v===b).length).pop();

    const lifespans = sites.map(d => {
      const first = new Date(d.First_Live_Capture);
      const last  = new Date(d.Last_Live_Capture);
      return (last - first) / (1000 * 60 * 60 * 24 * 365.25);
    }).filter(x => !isNaN(x));
    const avgLifespan = lifespans.length ? (lifespans.reduce((a,b)=>a+b,0)/lifespans.length) : null;

    const lastYears = sites.map(d => (d.Last_Live_Capture ? new Date(d.Last_Live_Capture).getFullYear() : null)).filter(x => x);
    const earliest = Math.min(...lastYears);
    const latest   = Math.max(...lastYears);

    const yearCounts = {};
    lastYears.forEach(y => { yearCounts[y] = (yearCounts[y]||0)+1; });
    const maxYear = Object.keys(yearCounts).reduce((a,b)=> yearCounts[a]>yearCounts[b]?a:b, null);

    return {
      num,
      modeType2,
      avgLifespan: avgLifespan ? avgLifespan.toFixed(1) : "–",
      earliest,
      latest,
      maxYear,
      maxLoss: maxYear ? yearCounts[maxYear] : null
    };
  }

  function getMonthIndex(dateStr) {
    if (!dateStr) return null;
    const dt = new Date(dateStr);
    return (dt.getFullYear() - startYear) * 12 + dt.getMonth();
  }

  // Falling set
  const toFall = filtered.filter(d => {
    const lastYear = new Date(d.Last_Live_Capture).getFullYear();
    return lastYear <= 2024;
  }).sort((a,b) => getMonthIndex(a.Last_Live_Capture) - getMonthIndex(b.Last_Live_Capture));

  // Triangle pile
  const N = toFall.length;
  const numRows = Math.ceil((-1 + Math.sqrt(1 + 8 * N)) / 2);
  let dotIndex = 0;
  for (let row = numRows - 1; row >= 0; row--) {
    const dotsInRow = row + 1;
    for (let col = 0; col < dotsInRow && dotIndex < N; col++, dotIndex++) {
      toFall[dotIndex].pileRow     = row;
      toFall[dotIndex].pileCol     = col;
      toFall[dotIndex].pileRowDots = dotsInRow;
      toFall[dotIndex].numRows     = numRows;
    }
  }
  filtered.forEach(d => {
    if (!toFall.includes(d)) {
      d.pileRow = d.pileCol = d.pileRowDots = d.numRows = null;
    }
  });

  // Points
  const points = filtered.map((d, i) => {
    const phi = Math.acos(1 - 2 * Math.random());
    const theta = 2 * Math.PI * Math.random();
    const r = radius * (0.7 + Math.random() * 0.4);
    const x = r * Math.sin(phi) * Math.cos(theta);
    const y = r * Math.sin(phi) * Math.sin(theta);
    const z = r * Math.cos(phi);

    const lastMonthIndex = getMonthIndex(d.Last_Live_Capture);

    let debugFirstFaller = false;
    if (d.Last_Live_Capture) {
      const year = +d.Last_Live_Capture.slice(0,4);
      if (year <= 2000) debugFirstFaller = true;
    }

    return {
      id: d.id,
      title: d.title,
      genre: d.type2 || "Unknown",
      type2: d.type2 || "Unknown",
      category: d.Grouped_Category || "Unknown",
      first_seen: d.First_Live_Capture,
      last_seen:  d.Last_Live_Capture,
      lastMonthIndex,
      x, y, z,
      debugFirstFaller,
      flicker: Math.random() < 0.1,
      phase: Math.random() * 100,
      flickerSpeed: 100 + Math.random() * 200,
      baseOpacity: d3.scaleLinear().domain([-radius, radius]).range([0.15, 0.8])(z),
      baseSize:    d3.scaleLinear().domain([-radius, radius]).range([1.5, 5])(z),
      hasFallen: false,
      fallY: 0,
      fallStartMonth: null,
      pileRow: d.pileRow,
      pileCol: d.pileCol,
      pileRowDots: d.pileRowDots,
      numRows: d.numRows,
      fallFade: 1
    };
  });

  // Links/strings
  const links = [], strings = [];
  const maxLinks = 1500, maxStrings = 300;
  for (let i = 0; i < points.length; i++) {
    for (let j = 0; j < 3; j++) {
      const k = Math.floor(Math.random() * points.length);
      if (i !== k) {
        if (links.length < maxLinks && Math.random() < 0.05) {
          links.push({ source: points[i], target: points[k], phase: Math.random() * 100 });
        }
        if (strings.length < maxStrings && Math.random() < 0.01) {
          strings.push({ source: points[i], target: points[k], phase: Math.random() * 100 });
        }
      }
    }
  }

  // --- SVG (fixed size) ---
  const svg = d3.create("svg")
    .attr("viewBox", [0, 0, width, height])
    .style("width",  width + "px")
    .style("height", height + "px")
    .style("background", "#0a0a0a")
    .style("display", "block");

  
  // Append to the clipped viewport (IMPORTANT)
  document.getElementById("viewport").appendChild(svg.node());

  // Click-catcher
  svg.append("rect")
    .attr("x",0).attr("y",0)
    .attr("width", width).attr("height", height)
    .attr("fill","transparent")
    .style("cursor","default")
    .on("click", () => {
      selectedPoint  = null;
      selectedFrozen = null;
      tooltip.style("opacity", 0);
    });

  const g = svg.append("g").attr("transform", `translate(${width/2}, ${groupCenterY})`);

  // Ground line
  g.append("line")
    .attr("x1", -radius * 1.2)
    .attr("x2",  radius * 1.2)
    .attr("y1",  groundY)
    .attr("y2",  groundY)
    .attr("stroke", "#eee")
    .attr("stroke-width", 2)
    .attr("opacity", 0.2);

  // Bottom-left time label
  const timeLabel = svg.append("text")
    .attr("x", 20)
    .attr("y", height - 20)
    .attr("fill", "#cccccc")
    .attr("font-size", "14px")
    .attr("font-family", "monospace")
    .attr("opacity", 0.8)
    .text("January 1996");

  // Tooltip div
  const tooltip = d3.select("#tooltip");

  // Gradients/filters
  const defs = svg.append("defs");

    const flickerGlow = defs.append("filter")
  .attr("id", "flicker-glow")
  .attr("x", "-50%").attr("y", "-50%")
  .attr("width", "200%").attr("height", "200%");

flickerGlow.append("feGaussianBlur")
  .attr("in", "SourceGraphic")
  .attr("stdDeviation", 4)
  .attr("result", "blur");

flickerGlow.append("feMerge")
  .selectAll("feMergeNode")
  .data(["blur", "SourceGraphic"])
  .enter()
  .append("feMergeNode")
  .attr("in", d => d);


  const grad = defs.append("linearGradient")
    .attr("id", "capsule-gradient")
    .attr("x1","0%").attr("x2","100%")
    .attr("y1","0%").attr("y2","0%");
  grad.append("stop").attr("offset","0%").attr("stop-color","#00ffe7").attr("stop-opacity",0.85);
  grad.append("stop").attr("offset","100%").attr("stop-color","#0055ff").attr("stop-opacity",0.9);

  const glow = defs.append("filter")
    .attr("id","glow")
    .attr("x","-50%").attr("y","-50%")
    .attr("width","200%").attr("height","200%")
    .attr("filterUnits","objectBoundingBox");
  glow.append("feGaussianBlur").attr("in","SourceAlpha").attr("stdDeviation",6).attr("result","blur");
  glow.append("feOffset").attr("dx",0).attr("dy",0).attr("in","blur").attr("result","offsetBlur");
  glow.append("feFlood").attr("flood-color","#ffffff").attr("flood-opacity",0.8).attr("result","color");
  glow.append("feComposite").attr("in","color").attr("in2","offsetBlur").attr("operator","in").attr("result","glowShape");
  glow.append("feMerge").call(f => {
    f.append("feMergeNode").attr("in","glowShape");
    f.append("feMergeNode").attr("in","SourceGraphic");
  });

  // Extra glow just for selected capsules
const capsuleGlow = defs.append("filter")
  .attr("id", "capsule-glow")
  .attr("x", "-100%").attr("y", "-100%")
  .attr("width", "300%").attr("height", "300%");

// soft neon-ish outer glow
capsuleGlow.append("feGaussianBlur")
  .attr("in", "SourceGraphic")
  .attr("stdDeviation", 6)
  .attr("result", "blurA");

// faint cyan drop shadow to lift off background
capsuleGlow.append("feDropShadow")
  .attr("dx", 0).attr("dy", 5)
  .attr("stdDeviation", 3.5)
  .attr("flood-color", "#16e6ff")
  .attr("flood-opacity", 0.8);

// merge the glow+source
const cm = capsuleGlow.append("feMerge");
cm.append("feMergeNode").attr("in", "blurA");
cm.append("feMergeNode").attr("in", "SourceGraphic");


  // Capsules UI
  const capsuleGroup = svg.append("g").attr("transform","translate(20, 32)");
  const capsuleHeight = 36, capsuleSpacing = 20, capsulePaddingX = 28;
  const type2CapsuleHeight = 28, type2CapsuleSpacing = 28, type2CapsulePaddingX = 18;

  let selectedCategory = null;
  let selectedType2 = null;

  // --- minimal sync for bottom: re-apply selection regularly ---
const isBottom = (new URLSearchParams(window.location.search).get("view") === "bottom");

let lastCatSeen = null;
let lastT2Seen  = null;

function readSelectionFromStorage() {
  // read current values (top writes these)
  const cat = localStorage.getItem("vizCategory") || "";
  const t2  = localStorage.getItem("vizType2") || "";
  return {
    cat: cat ? cat : null,
    t2:  t2  ? t2  : null
  };
}

function maybeApplySelection() {
  const { cat, t2 } = readSelectionFromStorage();

  // Only change if different from what we’re showing
  if (cat !== lastCatSeen || t2 !== lastT2Seen) {
    lastCatSeen = cat;
    lastT2Seen  = t2;

    selectedCategory = cat;
    selectedType2    = t2;

    // redraw highlights immediately
    if (typeof updateCategoryHighlight === "function") {
      if (dots) updateCategoryHighlight();
    }
  }
}

// Bottom: refresh selection on a timer + on focus (covers missed events)
if (isBottom) {
  // 1) Poll every 1000 ms (cheap & robust)
  setInterval(maybeApplySelection, 1000);

  // 2) Also when the window/tab gains focus
  window.addEventListener("focus", maybeApplySelection);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") maybeApplySelection();
  });
}

// Also adopt any existing selection at startup (both top & bottom)



  function drawCapsules() {
    capsuleGroup.selectAll("*").remove();

    if (!selectedCategory) {
      categories.forEach((category, i) => {
        const capsule = capsuleGroup.append("g")
          .style("cursor","pointer")
          .attr("transform", `translate(0, ${i * (capsuleHeight + capsuleSpacing)})`)
          .on("click", () => {
            selectedCategory = category;
            // broadcast selection to the other window
            console.log("Broadcasting category:", selectedCategory); // debug
            localStorage.setItem("vizCategory", selectedCategory || "");
            localStorage.setItem("vizType2", ""); // clear type2 when picking a new category

            const stats = getCategoryStats(category, filtered);
            if (stats) {
              d3.select("#category-stats").html(`
                <div style="font-weight:bold;font-size:25px;letter-spacing:0.3px;color:#fff;">${category}</div>
                <div style="margin:7px 0 2px 0;opacity:0.88;">Websites: <b>${stats.num}</b></div>
                <div style="margin-bottom:2px;opacity:0.88;">Most common type: <b>${stats.modeType2}</b></div>
                <div style="margin-bottom:2px;opacity:0.88;">Average lifespan: <b>${stats.avgLifespan} yrs</b></div>
                <div style="margin-bottom:2px;opacity:0.88;">Earliest disappeared: <b>${stats.earliest}</b></div>
                <div style="margin-bottom:2px;opacity:0.88;">Latest disappeared: <b>${stats.latest}</b></div>
                <div style="margin-bottom:2px;opacity:0.88;">Peak year of loss: <b>${stats.maxYear} (${stats.maxLoss})</b></div>
              `).style("display","block");
            } else {
              d3.select("#category-stats").style("display","none");
            }

            selectedType2 = null;
            drawCapsules();
          });

        const text = capsule.append("text")
          .text(category)
          .attr("dy", "0.35em")
          .attr("x", capsulePaddingX)
          .attr("y", capsuleHeight / 2)
          .attr("text-anchor", "start")
          .attr("font-family", "Inter, sans-serif")
          .attr("font-size", "16px")
          .attr("font-weight", 700)
          .attr("fill", "#b6e3ef")
          .attr("pointer-events", "none");

        const textWidth = text.node().getBBox().width;
        const fullWidth = textWidth + capsulePaddingX * 2;

        const rect = capsule.insert("rect", "text")
          .attr("rx", capsuleHeight / 2)
          .attr("height", capsuleHeight)
          .attr("width", fullWidth)
          .attr("fill", "#151D21")
          .attr("stroke", category === selectedCategory ? "#00ffe7" : "#7fe6f6")
          .attr("stroke-width", category === selectedCategory ? 5 : 2)
          // use SVG filter for consistency and stronger visual
          .attr("filter", category === selectedCategory ? "url(#capsule-glow)" : null)
          .attr("pointer-events", "all");


        capsule.on("mouseover", function () {
          if (selectedCategory !== category) {
            rect.attr("fill", "url(#capsule-gradient)");
            text.attr("fill", "#fff");
          }
        });
        capsule.on("mouseout", function () {
          rect.attr("fill", "#151D21");
          text.attr("fill", "#b6e3ef");
        });
      });
    } else {
      const backBtn = capsuleGroup.append("g")
        .style("cursor","pointer")
        .attr("transform","translate(0,0)")
        .on("click", () => {
          selectedCategory = null;
          selectedType2   = null;
            // NEW: broadcast clears so the other window resets too
          localStorage.setItem("vizCategory", "");
          localStorage.setItem("vizType2", "");
          drawCapsules();
          d3.select("#sliding-ambiguity-text").style("display","none");
          d3.select("#sliding-inner").style("left","-370px");
          d3.select("#category-stats").style("display","none");
        });
      backBtn.append("rect").attr("width",60).attr("height",26).attr("rx",13)
        .attr("fill","#191d24").attr("stroke","#00ffe7").attr("stroke-width",2);
      backBtn.append("text").text("← Back").attr("x",30).attr("y",15)
        .attr("text-anchor","middle")
        .attr("font-family","Inter, sans-serif").attr("font-size","13px")
        .attr("fill","#b6e3ef").attr("dominant-baseline","middle");

      const type2s = Array.from(categoryToType2[selectedCategory]).sort();
      type2s.forEach((type2, i) => {
        const capsule = capsuleGroup.append("g")
          .style("cursor","pointer")
          .attr("transform", `translate(0, ${(i+1) * (type2CapsuleHeight + type2CapsuleSpacing)})`)
          .on("click", () => {
            selectedType2 = type2;
            // broadcast selection to the other window
            console.log("Broadcasting type2:", selectedType2); // debug
            localStorage.setItem("vizType2", selectedType2 || "");


            if (selectedType2 && selectedType2.toLowerCase().trim() === "music") {
              d3.select("#sliding-ambiguity-text").style("display","block");
              setTimeout(()=> d3.select("#sliding-inner").style("left","0px"), 10);
            } else {
              d3.select("#sliding-ambiguity-text").style("display","none");
              d3.select("#sliding-inner").style("left","-370px");
            }
            drawCapsules();
          });

        const text = capsule.append("text")
          .text(type2)
          .attr("dy","0.35em")
          .attr("x", type2CapsulePaddingX)
          .attr("y", type2CapsuleHeight/2)
          .attr("text-anchor","start")
          .attr("font-family","Inter, sans-serif")
          .attr("font-size","14px")
          .attr("font-weight",700)
          .attr("fill","#b6e3ef")
          .attr("pointer-events","none");

        const textWidth = text.node().getBBox().width;
        const fullWidth = textWidth + type2CapsulePaddingX * 2;

        const rect = capsule.insert("rect","text")
          .attr("rx", type2CapsuleHeight/2)
          .attr("height", type2CapsuleHeight)
          .attr("width", fullWidth)
          .attr("fill", "#151D21")
          .attr("stroke", type2 === selectedType2 ? "#00ffe7" : "#7fe6f6")
          .attr("stroke-width", type2 === selectedType2 ? 5 : 2)
          .attr("filter", type2 === selectedType2 ? "url(#capsule-glow)" : null)
          .attr("pointer-events","all");
          


        capsule.on("mouseover", function(){
          if (selectedType2 !== type2) {
            rect.attr("fill","url(#capsule-gradient)");
            text.attr("fill","#fff");
          }
        });
        capsule.on("mouseout", function(){
          rect.attr("fill","#151D21");
          text.attr("fill","#b6e3ef");
        });
      });
    }
  }
  drawCapsules();

  // Lines & dots
  const lines = g.selectAll("line.link")
    .data(links)
    .join("line")
    .attr("stroke","#77ccff")
    .attr("stroke-width",0.4)
    .attr("opacity",0.05);

  let dots = g.selectAll("circle")
    .data(points)
    .join("circle");

  let selectedPoint = null;
  let selectedFrozen = null;

  dots.on("click", function (event, d) {
    event.stopPropagation();
    selectedPoint  = d;
    selectedFrozen = { x: d._drawX, y: d._drawY, z: d._drawZ };

    const formatDate = d3.timeFormat("%b %Y");
    const parseDate  = d3.timeParse("%Y-%m-%d");
    const firstDate  = d.first_seen ? parseDate(d.first_seen) : null;
    const lastDate   = d.last_seen  ? parseDate(d.last_seen)  : null;
    const formattedFirst = firstDate ? formatDate(firstDate) : "–";
    const formattedLast  = lastDate  ? formatDate(lastDate)  : "–";
    const lifespan = (firstDate && lastDate)
      ? `${((lastDate - firstDate) / (1000*60*60*24*365.25)).toFixed(1)} years`
      : "–";

    const tooltip = d3.select("#tooltip");
    tooltip
      .style("opacity", 1)
      .html(`
        <div class="tooltip-header">
          <img src="icons8-close-window-50-2.png" />
          <img src="icons8-maximize-window-50-2.png" />
          <img src="icons8-minimize-window-50-2.png" />
          <span class="tooltip-title">${d.title}</span>
        </div>
        <div class="tooltip-content">
          <div><strong>Genre:</strong> ${d.genre || "Unknown"} | ${d.category || "Uncategorized"}</div>
          <div><strong>First seen:</strong> ${formattedFirst}</div>
          <div><strong>Last seen:</strong> ${formattedLast}</div>
          <div><strong>Lifespan:</strong> ${lifespan}</div>
        </div>
      `)
      .style("left", (event.pageX + 12) + "px")
      .style("top",  (event.pageY - 10) + "px");

    d3.select(this).raise();
  });

  // Scrubber
  const scrubberWidth = 420, scrubberHeight = 26, scrubberMargin = 60, knobRadius = 12;

  const scrubberGroup = svg.append("g")
    .attr("transform", `translate(${width - scrubberWidth - scrubberMargin},${scrubberMargin})`)
    .style("cursor", "pointer")
    .style("user-select", "none");

  scrubberGroup.append("rect")
    .attr("x", 0).attr("y", (scrubberHeight-knobRadius)/2)
    .attr("rx", 12).attr("width", scrubberWidth).attr("height", knobRadius)
    .attr("fill", "#444");

  const fillRect = scrubberGroup.append("rect")
    .attr("x", 0).attr("y", (scrubberHeight-knobRadius)/2)
    .attr("rx", 12).attr("width", 0).attr("height", knobRadius)
    .attr("fill", "#22e0ff");
    

  const knob = scrubberGroup.append("image")
    .attr("class","scrubber-music-knob")
    .attr("xlink:href","music-note.png")
    .attr("x", -knobRadius)
    .attr("y", -knobRadius)
    .attr("width",  knobRadius * 2.2)
    .attr("height", knobRadius * 2 + 10);

  // Decorative note bits
  knob.append("ellipse").attr("cx",0).attr("cy",10).attr("rx",knobRadius).attr("ry",knobRadius*0.85)
    .attr("fill","#22e0ff").attr("stroke","#fff").attr("stroke-width",2).attr("filter","url(#glow)");
  knob.append("rect").attr("x",-2).attr("y",-18).attr("width",4).attr("height",28).attr("rx",2)
    .attr("fill","#fff").attr("stroke","#22e0ff").attr("stroke-width",0.7);
  knob.append("path").attr("d","M2,-18 Q18,-26 2,-8")
    .attr("fill","none").attr("stroke","#22e0ff").attr("stroke-width",3).attr("stroke-linecap","round");

  // Start/end labels
  scrubberGroup.append("text").attr("x",0).attr("y",-6).attr("fill","#bbb").attr("font-size",13).attr("font-family","monospace").text("Jan 1996");
  scrubberGroup.append("text").attr("x",scrubberWidth).attr("y",-6).attr("fill","#bbb").attr("font-size",13).attr("font-family","monospace").attr("text-anchor","end").text("Dec 2024");

  const scrubberTimeLabel = scrubberGroup.append("text")
    .attr("x", scrubberWidth/2).attr("y", scrubberHeight + 25)
    .attr("fill","#b6e3ef").attr("font-size","14px").attr("font-family","monospace").attr("font-weight",500)
    .attr("opacity",1).attr("text-anchor","middle")
    .text("January 1996");

  // Scrubbing logic
  let dragging = false, scrubMonth = 0;
  const speed = 2;
  let offsetMonths = 0;

    // --- SYNC HELPERS (localStorage across top/bottom windows) ---
  let lastBroadcastedMonth = null;

  function applySyncedTime(newMonth) {
    if (!isFinite(newMonth)) return;
    // Align animation so that this month shows immediately and continues smoothly
    const now = performance.now();
    offsetMonths = newMonth - ((now - lastResetTime) / 1000) * speed;
    scrubMonth = newMonth;
    updateScrubberUI();
  }

window.addEventListener("storage", (e) => {
  // For debugging
  //console.log("Storage event:", e.key, "->", e.newValue);

  // Time sync
  if (e.key === "vizTime") {
    const m = parseFloat(e.newValue);
    if (!isNaN(m) && m !== scrubMonth) {
      applySyncedTime(m);
    }
  }

  // Category sync
  if (e.key === "vizCategory") {
    selectedCategory = e.newValue || null;
    console.log("Received category:", selectedCategory);
    if (dots) updateCategoryHighlight();  // Force redraw instantly
  }

  // Type2 sync
  if (e.key === "vizType2") {
    selectedType2 = e.newValue || null;
    console.log("Received type2:", selectedType2);
    if (dots) updateCategoryHighlight();// Force redraw instantly
  }
});


  scrubberGroup.on("mousedown", function(event){
    dragging = true; isScrubbingManually = true;
    setScrub(d3.pointer(event, this)[0]); event.preventDefault();
  });
  d3.select(window).on("mousemove", (event) => { if (dragging) setScrub(d3.pointer(event, scrubberGroup.node())[0]); });
  d3.select(window).on("mouseup", () => {
  if (isScrubbingManually) {
    isScrubbingManually = false;
    lastResetTime = performance.now();
    offsetMonths = scrubMonth;
  }
});


    function setScrub(x) {
    x = Math.max(0, Math.min(x, scrubberWidth));
    const frac = x / scrubberWidth;
    scrubMonth = Math.round(frac * (totalMonths - 1));
    updateScrubberUI();

    // Broadcast to the other window while dragging
    if (scrubMonth !== lastBroadcastedMonth) {
      localStorage.setItem("vizTime", String(scrubMonth));
      lastBroadcastedMonth = scrubMonth;
    }
  }


  function updateScrubberUI() {
    const frac = scrubMonth / (totalMonths - 1);
    knob.attr("transform", `translate(${frac * scrubberWidth},${scrubberHeight/2})`);
    fillRect.attr("width", frac * scrubberWidth);
    scrubberTimeLabel.text(getTimeLabel(scrubMonth));
  }

    // On load, if another window already set a time, adopt it
  const bootSync = localStorage.getItem("vizTime");
  if (bootSync !== null) {
    const m = parseFloat(bootSync);
    if (!isNaN(m)) applySyncedTime(m);
  }

  updateScrubberUI();


  // NEW: also adopt any existing selection on boot
  const bootCategory = localStorage.getItem("vizCategory") || "";
  const bootType2    = localStorage.getItem("vizType2")    || "";
  selectedCategory   = bootCategory ? bootCategory : null;
  selectedType2      = bootType2    ? bootType2    : null;
  updateCategoryHighlight();


  function getMonthYear(monthIdx) {
    const year = startYear + Math.floor(monthIdx / 12);
    const monthIndex = monthIdx % 12;
    return { monthIndex, year, total: monthIdx };
  }
  function getTimeLabel(monthIdx) {
    const { monthIndex, year } = getMonthYear(monthIdx);
    const monthNames = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    return `${monthNames[monthIndex]} ${year}`;
  }

  // Animation
  let maxMonthSeen = 0;

/*function updateCategoryHighlightSingle(d) {
  // Is this dot within 3 months of disappearing?
  let inWindow = false;
  if (!d.hasFallen && d.lastMonthIndex != null) {
    const monthsLeft = d.lastMonthIndex - scrubMonth;
    inWindow = (monthsLeft <= 3 && monthsLeft >= 0);
  }

  // Category/type match
  let match = true;
  if (selectedCategory && !selectedType2) match = d.category === selectedCategory;
  if (selectedType2) match = d.type2 === selectedType2;

  // Base opacity from depth + category filter
  const base = d.baseOpacity * (match ? 1 : 0.1);

  // Strong blink (square wave) during the 3 months before fall
  // ~7 Hz: on for 140ms, off for 140ms
  let opacity = base;
  if (inWindow) {
    const on = (Math.floor(performance.now() / 140) % 2) === 0;
    opacity = on ? 1.0 : base * 0.2;  // bright ON, very dim OFF
  }

  // Fade if fallen
  if (d.hasFallen) opacity *= (d.fallFade ?? 0.35);

  // Selected point is always fully visible
  if (selectedPoint === d) opacity = 1.0;

  return Math.max(0, Math.min(1, opacity));
}*/





function updateCategoryHighlight() {
  if (!dots) return; 
  dots
    //.attr("fill-opacity", d => updateCategoryHighlightSingle(d))
    //.attr("fill", d => d.debugFirstFaller ? "red" : "#aaffff");
    .attr("fill", "#aaffff");

}

maybeApplySelection();

  function animate(now) {
    const t = now - lastResetTime;
    const rawMonth = ((t / 1000) * speed + offsetMonths);
    const realMonthsElapsed = Math.floor(rawMonth);
    let displayedMonthsElapsed;
    const currentMonth = realMonthsElapsed;

    if (realMonthsElapsed >= totalMonths - 1 && !isScrubbingManually) {
      if (!pauseStarted) { pauseStarted = true; }
      if (!pauseStartTime) pauseStartTime = performance.now();

      const timePaused = performance.now() - pauseStartTime;
      if (timePaused < pauseDurationMs) {
        displayedMonthsElapsed = totalMonths - 1;
      } else {
        // reset
        pauseStarted = false; pauseStartTime = null; offsetMonths = 0; lastResetTime = performance.now();
        points.forEach(p => { p.hasFallen = false; p.fallStartMonth = null; p.fallFade = 1; });
      }
    } else {
      pauseStarted = false;
      displayedMonthsElapsed = realMonthsElapsed;
    }

        // Always use this frame’s value of realMonthsElapsed for everything
scrubMonth = displayedMonthsElapsed;
updateScrubberUI();

// Sync across windows (but only if animation is running, not during manual scrub)
if (!isScrubbingManually && scrubMonth !== lastBroadcastedMonth) {
  localStorage.setItem("vizTime", String(scrubMonth));
  lastBroadcastedMonth = scrubMonth;
}


    if (displayedMonthsElapsed > maxMonthSeen) maxMonthSeen = displayedMonthsElapsed;

    timeLabel.text(getTimeLabel(displayedMonthsElapsed));
    scrubberTimeLabel.text(getTimeLabel(displayedMonthsElapsed));

    const fallDuration = 1.2;
    const fps = 60;
    const fallFrames = Math.round(fallDuration * fps);

    points.forEach(p => {
      if (selectedPoint === p && selectedFrozen) {
        p._drawX = selectedFrozen.x; p._drawY = selectedFrozen.y; p._drawZ = selectedFrozen.z; p.fallFade = 1;
        return;
      }
      if (!p.hasFallen && p.lastMonthIndex != null && realMonthsElapsed >= p.lastMonthIndex && p.lastMonthIndex < totalMonths) {
        p.hasFallen = true; p.fallY = 0; p.fallStartMonth = Math.max(p.lastMonthIndex, 0);
      }
      if (p.hasFallen) {
        let sinceFall = Math.max(0, Math.min(realMonthsElapsed - p.fallStartMonth, fallFrames));
        let tNorm = sinceFall / fallFrames;
        const ease = 1 - Math.pow(1 - tNorm, 3);

        p.fallFade = 1 - 0.65 * tNorm;
        if (tNorm >= 1) p.fallFade = 0.35;

        const rowDots = p.pileRowDots;
        const pileX = (p.pileCol - (rowDots - 1) / 2) * pileSpacingX;
        const pileY = groundY - (p.numRows - 1 - p.pileRow) * pileSpacingY;

        p._drawX = p.x + (pileX - p.x) * ease;
        p._drawY = p.y + (pileY - p.y) * ease;
        p._drawZ = p.z;
      } else {
        const rotY = Math.sin(t / 7000) * 0.5;
        const rotX = Math.cos(t / 5000) * 0.5;
        const rx = p.x * Math.cos(rotY) - p.z * Math.sin(rotY);
        const rz = p.x * Math.sin(rotY) + p.z * Math.cos(rotY);
        const ry = p.y * Math.cos(rotX) - rz * Math.sin(rotX);
        const finalZ = p.y * Math.sin(rotX) + rz * Math.cos(rotX);
        p._drawX = rx; p._drawY = ry; p._drawZ = finalZ; p.fallFade = 1;
      }
    });

    dots
  .attr("cx", d => d._drawX)
  .attr("cy", d => d._drawY)
  .attr("r", d => {
  //const baseR = d.debugFirstFaller ? 7 : 4.5;
  const baseR = 4.5;
  const monthsLeft = d.lastMonthIndex - scrubMonth;

  if (
    d.lastMonthIndex != null &&
    d.lastMonthIndex < 348 &&
    monthsLeft <= 3 &&
    monthsLeft >= 0
  ) {
    // Slow inward pulse: 0.6x to 1x of base size, with easing
    const t = performance.now() / 800; // Lower = slower pulse
    const raw = Math.sin(t + d.phase); // base wave
    const eased = raw < 0
      ? 1 + 0.3 * raw // Shrink to 70% and pause slightly at low
      : 1;            // Hold full size when above baseline

    return baseR * eased;
  }

  return (selectedPoint === d) ? baseR + 1 : baseR;
})




  .attr("stroke", d => (selectedPoint === d) ? "#fff" : "none")
  .attr("stroke-width", d => (selectedPoint === d) ? 1.5 : 0)
  .attr("fill-opacity", d => {
  let match = true;
  if (selectedCategory && !selectedType2) match = d.category === selectedCategory;
  if (selectedType2) match = d.type2 === selectedType2;

  let opacity = d.baseOpacity * (match ? 1 : 0.1);

  if (d.hasFallen) opacity *= (d.fallFade ?? 0.35);
  if (selectedPoint === d) opacity = 1;

  return opacity;
})



/*.attr("filter", d => {
  const monthsLeft = d.lastMonthIndex - scrubMonth;

  if (
    d.lastMonthIndex != null &&
    d.lastMonthIndex < 348 &&
    monthsLeft <= 3 &&
    monthsLeft >= 0
  ) {
    return "url(#flicker-glow)";
  }

  return null;
})*/





  //.attr("fill", d => d.debugFirstFaller ? "red" : "#aaffff");
  .attr("fill", "#aaffff");




    lines
      .attr("x1", d => d.source._drawX)
      .attr("y1", d => d.source._drawY)
      .attr("x2", d => d.target._drawX)
      .attr("y2", d => d.target._drawY)
      .attr("stroke-opacity", d => 0.02 + 0.03 * Math.sin(now / 1000 + d.phase));

    function getSphereBoundary(p, radius, mult = 1.1) {
      const d = Math.sqrt(p._drawX*p._drawX + p._drawY*p._drawY + p._drawZ*p._drawZ);
      if (d === 0) return { x: 0, y: 0 };
      return { x: p._drawX / d * radius * mult, y: p._drawY / d * radius * mult };
    }

    const liveStrings = strings.filter(d => !(d.source.hasFallen && d.target.hasFallen));
    const curves = g.selectAll(".string")
      .data(liveStrings, d => `${d.source.id}-${d.target.id}`)
      .join(
        enter => enter.append("path")
          .attr("class","string")
          .attr("fill","none")
          .attr("stroke","#aaccff")
          .attr("stroke-opacity",0.1)
          .attr("stroke-width",1.0)
          .attr("stroke-linecap","round"),
        update => update,
        exit => exit.remove()
      );

    curves
      .attr("d", d => {
        function endpoint(p) {
          if (!p.hasFallen) return { x: p._drawX, y: p._drawY };
          const dlen = Math.sqrt(p._drawX*p._drawX + p._drawY*p._drawY + p._drawZ*p._drawZ);
          if (dlen < radius) return { x: p._drawX, y: p._drawY };
          return getSphereBoundary(p, radius);
        }
        const p1 = endpoint(d.source);
        const p2 = endpoint(d.target);
        const mx = (p1.x + p2.x) / 2 + Math.sin(now / 800 + d.phase) * 10;
        const my = (p1.y + p2.y) / 2 + Math.cos(now / 800 + d.phase) * 10;
        return `M${p1.x},${p1.y} Q${mx},${my} ${p2.x},${p2.y}`;
      })
      .attr("stroke-opacity", d => 0.06 + 0.06 * Math.abs(Math.sin(now / 1200 + d.phase)));

    requestAnimationFrame(animate);
  }

  requestAnimationFrame(animate);
});



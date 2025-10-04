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
  vp.style.left = ((window.innerWidth - 1920 * scale) / 2) + 'px';
  vp.style.top = ((window.innerHeight - 1080 * scale) / 2) + 'px';
  vp.style.position = 'absolute';
}
window.addEventListener('resize', fitViewport);
fitViewport();

// -------- 1) Your visualization code (unchanged except for size + append target) --------
d3.csv("Grouped_Music_Dataset.csv").then(data => {
  // --- Fixed canvas to fit two stacked 1080p screens ---
  const width = 1920;         // monitor width
  const height = 2160;         // 1080 + 1080

  // Scale from your original base height 2000 -> 2160
  const S = height / 2000;     // = 1.08

  // Your constants (scaled where needed)
  const radius = 370 * S;
  // Adjust positioning for bottom view - move visualization up
  const isBottomView = (new URLSearchParams(window.location.search).get("view") === "bottom");
  const groupCenterY = isBottomView ? Math.round(100 + radius) : Math.round(150 + radius); // Move up more for bottom view
  const groundY = Math.round(1500 * S);
  const groundLineY = groundY + 8; // Move ground line below the points (6px radius + 2px buffer)

  const pileDotRadius = 4;
  const pileSpacingX = 14; // Increased to prevent overlap (point diameter is 12px)
  const pileSpacingY = 9 * S;

  const startYear = 1996;
  const endYear = 2024;
  const totalMonths = (endYear - startYear + 1) * 12;

  let pauseStarted = false;
  let pauseStartTime = null;
  const pauseDurationMs = 70000;
  let lastResetTime = performance.now();
  let isScrubbingManually = false;
  let lastPauseTime = null;
  const autoResumeDelay = 60000; // 1 minute in milliseconds

  // Prepare categories and type2
  const filtered = data.filter(d => d.Last_Live_Capture && d.Grouped_Category && d.Grouped_Category.trim());

  // Filter out date entries and invalid categories, keep only valid category names
  const validCategories = filtered
    .map(d => d.Grouped_Category.trim())
    .filter(cat => {
      // Filter out date patterns (YYYY-MM-DD format)
      if (/^\d{4}-\d{2}-\d{2}$/.test(cat)) return false;
      // Filter out other invalid entries
      if (cat === "No archived live version" || cat === "Error after 5 retries") return false;
      // Filter out location names and other non-category entries
      if (cat.includes('"') || cat.includes(".") || cat.length < 3) return false;
      return true;
    });

  const categories = Array.from(new Set(validCategories)).sort();

  const categoryToType2 = {};
  filtered.forEach(d => {
    const cat = d.Grouped_Category.trim();
    const t2 = d.type2?.trim() || "Unknown";
    if (!categoryToType2[cat]) categoryToType2[cat] = new Set();
    categoryToType2[cat].add(t2);
  });

  function getCategoryStats(category, allData) {
    const sites = allData.filter(d => d.Grouped_Category.trim() === category);
    if (sites.length === 0) return null;

    const num = sites.length;
    const type2s = sites.map(d => d.type2 || "Unknown");
    const modeType2 = type2s.sort((a, b) => type2s.filter(v => v === a).length - type2s.filter(v => v === b).length).pop();

    const lifespans = sites.map(d => {
      const first = new Date(d.First_Live_Capture);
      const last = new Date(d.Last_Live_Capture);
      return (last - first) / (1000 * 60 * 60 * 24 * 365.25);
    }).filter(x => !isNaN(x));
    const avgLifespan = lifespans.length ? (lifespans.reduce((a, b) => a + b, 0) / lifespans.length) : null;

    const lastYears = sites.map(d => (d.Last_Live_Capture ? new Date(d.Last_Live_Capture).getFullYear() : null)).filter(x => x);
    const earliest = Math.min(...lastYears);
    const latest = Math.max(...lastYears);

    const yearCounts = {};
    lastYears.forEach(y => { yearCounts[y] = (yearCounts[y] || 0) + 1; });
    const maxYear = Object.keys(yearCounts).reduce((a, b) => yearCounts[a] > yearCounts[b] ? a : b, null);

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
  }).sort((a, b) => getMonthIndex(a.Last_Live_Capture) - getMonthIndex(b.Last_Live_Capture));

  // Triangle pile
  const N = toFall.length;
  const numRows = Math.ceil((-1 + Math.sqrt(1 + 8 * N)) / 2);
  let dotIndex = 0;
  for (let row = numRows - 1; row >= 0; row--) {
    const dotsInRow = row + 1;
    for (let col = 0; col < dotsInRow && dotIndex < N; col++, dotIndex++) {
      toFall[dotIndex].pileRow = row;
      toFall[dotIndex].pileCol = col;
      toFall[dotIndex].pileRowDots = dotsInRow;
      toFall[dotIndex].numRows = numRows;
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
    const firstMonthIndex = getMonthIndex(d.First_Live_Capture);

    let debugFirstFaller = false;
    if (d.Last_Live_Capture) {
      const year = +d.Last_Live_Capture.slice(0, 4);
      if (year <= 2000) debugFirstFaller = true;
    }

    // Calculate actual lifespan from data
    const lifespanMonths = lastMonthIndex !== null && firstMonthIndex !== null
      ? Math.max(1, lastMonthIndex - firstMonthIndex)
      : 12; // Default to 1 year if data is missing

    // Pre-calculate pile positions for performance
    let pileX = 0, pileY = 0;
    if (d.pileRow !== null && d.pileCol !== null) {
      const rowDots = d.pileRowDots;
      pileX = (d.pileCol - (rowDots - 1) / 2) * pileSpacingX;
      pileY = groundY - (d.numRows - 1 - d.pileRow) * pileSpacingY;
    }

    return {
      id: d.id,
      title: d.title,
      genre: d.type2 || "Unknown",
      type2: d.type2 || "Unknown",
      category: d.Grouped_Category || "Unknown",
      first_seen: d.First_Live_Capture,
      last_seen: d.Last_Live_Capture,
      lastMonthIndex,
      x, y, z,
      debugFirstFaller,
      flicker: Math.random() < 0.1,
      phase: Math.random() * 100,
      flickerSpeed: 100 + Math.random() * 200,
      // Use consistent very slow fall duration for all points
      fallDuration: 24.0, // 12 months (1 year) duration for all points
      fallDelay: 0, // No artificial delay - use actual data timing
      lifespanMonths,
      baseOpacity: d3.scaleLinear().domain([-radius, radius]).range([0.15, 0.8])(z),
      baseSize: d3.scaleLinear().domain([-radius, radius]).range([1.5, 5])(z),
      hasFallen: false,
      fallY: 0,
      fallStartMonth: null,
      pileRow: d.pileRow,
      pileCol: d.pileCol,
      pileRowDots: d.pileRowDots,
      numRows: d.numRows,
      fallFade: 1,
      // Pre-calculated pile positions
      pileX,
      pileY
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
    .style("width", width + "px")
    .style("height", height + "px")
    .style("background", "#0a0a0a")
    .style("display", "block");


  // Append to the clipped viewport (IMPORTANT)
  document.getElementById("viewport").appendChild(svg.node());

  // Click-catcher
  svg.append("rect")
    .attr("x", 0).attr("y", 0)
    .attr("width", width).attr("height", height)
    .attr("fill", "transparent")
    .style("cursor", "default")
    .on("click", () => {
      selectedPoint = null;
      selectedFrozen = null;
      tooltip.style("opacity", 0);
    });

  const g = svg.append("g").attr("transform", `translate(${width / 2}, ${groupCenterY})`);

  // Ground line
  g.append("line")
    .attr("x1", -radius * 1.4)
    .attr("x2", radius * 1.4)
    .attr("y1", groundLineY)
    .attr("y2", groundLineY)
    .attr("stroke", "#eee")
    .attr("stroke-width", 2)
    .attr("opacity", 0.2);

  // Tooltip div
  const tooltip = d3.select("#tooltip");

  // Event delegation for tooltip close button
  document.addEventListener("click", function (e) {
    if (e.target && e.target.id === "tooltip-close-btn") {
      e.stopPropagation();
      e.preventDefault();
      console.log("Tooltip close button clicked"); // Debug log
      tooltip.style("opacity", 0);
      selectedPoint = null;
      selectedFrozen = null;
    }
  });

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
    .attr("x1", "0%").attr("x2", "100%")
    .attr("y1", "0%").attr("y2", "0%");
  grad.append("stop").attr("offset", "0%").attr("stop-color", "#00ffe7").attr("stop-opacity", 0.85);
  grad.append("stop").attr("offset", "100%").attr("stop-color", "#0055ff").attr("stop-opacity", 0.9);

  const glow = defs.append("filter")
    .attr("id", "glow")
    .attr("x", "-50%").attr("y", "-50%")
    .attr("width", "200%").attr("height", "200%")
    .attr("filterUnits", "objectBoundingBox");
  glow.append("feGaussianBlur").attr("in", "SourceAlpha").attr("stdDeviation", 6).attr("result", "blur");
  glow.append("feOffset").attr("dx", 0).attr("dy", 0).attr("in", "blur").attr("result", "offsetBlur");
  glow.append("feFlood").attr("flood-color", "#ffffff").attr("flood-opacity", 0.8).attr("result", "color");
  glow.append("feComposite").attr("in", "color").attr("in2", "offsetBlur").attr("operator", "in").attr("result", "glowShape");
  glow.append("feMerge").call(f => {
    f.append("feMergeNode").attr("in", "glowShape");
    f.append("feMergeNode").attr("in", "SourceGraphic");
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


  // Button container is now handled in HTML/CSS

  let selectedCategory = null;
  let selectedType2 = null;

  // --- minimal sync for bottom: re-apply selection regularly ---
  const isBottom = (new URLSearchParams(window.location.search).get("view") === "bottom");

  let lastCatSeen = null;
  let lastT2Seen = null;

  function readSelectionFromStorage() {
    // read current values (top writes these)
    const cat = localStorage.getItem("vizCategory") || "";
    const t2 = localStorage.getItem("vizType2") || "";
    return {
      cat: cat ? cat : null,
      t2: t2 ? t2 : null
    };
  }

  function maybeApplySelection() {
    const { cat, t2 } = readSelectionFromStorage();

    // Only change if different from what we’re showing
    if (cat !== lastCatSeen || t2 !== lastT2Seen) {
      lastCatSeen = cat;
      lastT2Seen = t2;

      selectedCategory = cat;
      selectedType2 = t2;

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
    const buttonContainer = document.getElementById("button-container");
    buttonContainer.innerHTML = "";

    if (!selectedCategory) {
      categories.forEach((category, i) => {
        const button = document.createElement("button");
        button.className = "category-button";
        button.textContent = category;
        button.style.marginTop = i === 0 ? "0" : "20px";

        button.addEventListener("click", () => {
          selectedCategory = category;
          // broadcast selection to the other window
          console.log("Broadcasting category:", selectedCategory);
          localStorage.setItem("vizCategory", selectedCategory || "");
          localStorage.setItem("vizType2", ""); // clear type2 when picking a new category

          // Hide tooltip and clear selected point when category is selected
          tooltip.style("opacity", 0);
          selectedPoint = null;
          selectedFrozen = null;

          const stats = getCategoryStats(category, filtered);
          if (stats) {
            d3.select("#category-stats").html(`
              <div style="display: flex; flex-direction: column; height: 100%; justify-content: space-between;">
                <div style="text-align: left; position: relative;">
                  <div style="font-family: 'Neue Haas Grotesk Display Pro', sans-serif; font-size: 25px; font-weight: 600; color: #FFF;">${category}</div>
                  <button id="stats-close-btn" style="position: absolute; top: 5px; right: 5px; background: #000000; border: 1px solid #FFF; color: #FFF; font-size: 24px; cursor: pointer; padding: 0; width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; border-radius: 8px;">×</button>
                </div>
                <div>
                  <span style="font-family: 'Neue Haas Grotesk Display Pro', sans-serif; font-size: 25px; font-weight: 600; color: #FFF;">${stats.num}</span>
                  <span style="font-family: 'Neue Haas Grotesk Display Pro', sans-serif; font-size: 18px; font-weight: 500; color: #FFF; margin-left: 8px;">WEBSITES</span>
                </div>
                <div>
                  <div style="font-family: 'Neue Haas Grotesk Display Pro', sans-serif; font-size: 18px; font-weight: 500; color: #FFF; margin-bottom: 4px;">Most common type:</div>
                  <div style="font-family: 'Neue Haas Grotesk Display Pro', sans-serif; font-size: 25px; font-weight: 600; color: #FFF;">${stats.modeType2.replace(/^MUSIC\s*:\s*/i, '') || 'MUSIC'}</div>
                </div>
                <div>
                  <div style="font-family: 'Neue Haas Grotesk Display Pro', sans-serif; font-size: 18px; font-weight: 500; color: #FFF; margin-bottom: 4px;">Average lifespan:</div>
                  <div style="font-family: 'Neue Haas Grotesk Display Pro', sans-serif; font-size: 25px; font-weight: 600; color: #FFF;">${stats.avgLifespan} yrs</div>
                </div>
                <div style="display: flex; justify-content: space-between;">
                  <div style="flex: 1;">
                    <div style="font-family: 'Neue Haas Grotesk Display Pro', sans-serif; font-size: 18px; font-weight: 500; color: #FFF; margin-bottom: 4px;">First disappeared:</div>
                    <div style="font-family: 'Neue Haas Grotesk Display Pro', sans-serif; font-size: 25px; font-weight: 600; color: #FFF;">${stats.earliest}</div>
                  </div>
                  <div style="width: 1px; background: #FFF; margin: 0 16px;"></div>
                  <div style="flex: 1;">
                    <div style="font-family: 'Neue Haas Grotesk Display Pro', sans-serif; font-size: 18px; font-weight: 500; color: #FFF; margin-bottom: 4px;">Latest disappeared:</div>
                    <div style="font-family: 'Neue Haas Grotesk Display Pro', sans-serif; font-size: 25px; font-weight: 600; color: #FFF;">${stats.latest}</div>
                  </div>
                </div>
              </div>
            `).style("display", "block");

            // Add close button event listener for stats panel (with a small delay to ensure DOM is ready)
            setTimeout(() => {
              const closeBtn = document.getElementById("stats-close-btn");
              if (closeBtn) {
                closeBtn.addEventListener("click", (e) => {
                  e.stopPropagation();
                  selectedCategory = null;
                  selectedType2 = null;
                  localStorage.setItem("vizCategory", "");
                  localStorage.setItem("vizType2", "");
                  d3.select("#category-stats").style("display", "none");
                  drawCapsules();
                });
              }
            }, 10);
          } else {
            d3.select("#category-stats").style("display", "none");
          }

          selectedType2 = null;
          drawCapsules();
        });

        buttonContainer.appendChild(button);
      });
    } else {
      // Back button
      const backButton = document.createElement("button");
      backButton.className = "back-button";
      backButton.textContent = "← Back";
      backButton.style.marginTop = "0";

      backButton.addEventListener("click", () => {
        selectedCategory = null;
        selectedType2 = null;
        localStorage.setItem("vizCategory", "");
        localStorage.setItem("vizType2", "");
        drawCapsules();
        d3.select("#sliding-ambiguity-text").style("display", "none");
        d3.select("#sliding-inner").style("left", "-370px");
        d3.select("#category-stats").style("display", "none");
      });

      buttonContainer.appendChild(backButton);

      // Type2 buttons
      const type2s = Array.from(categoryToType2[selectedCategory]).sort();
      type2s.forEach((type2, i) => {
        const button = document.createElement("button");
        button.className = "type2-button";
        // Remove "MUSIC : " prefix from type2 values (but keep "MUSIC" if it's standalone)
        const displayText = type2.replace(/^MUSIC\s*:\s*/i, '') || 'MUSIC';
        button.textContent = displayText;
        button.style.marginTop = "20px";

        button.addEventListener("click", () => {
          selectedType2 = type2;
          console.log("Broadcasting type2:", selectedType2);
          localStorage.setItem("vizType2", selectedType2 || "");

          // Hide tooltip and clear selected point when type2 is selected
          tooltip.style("opacity", 0);
          selectedPoint = null;
          selectedFrozen = null;

          if (selectedType2 && selectedType2.toLowerCase().trim() === "music") {
            d3.select("#sliding-ambiguity-text").style("display", "block");
            setTimeout(() => d3.select("#sliding-inner").style("left", "0px"), 10);
          } else {
            d3.select("#sliding-ambiguity-text").style("display", "none");
            d3.select("#sliding-inner").style("left", "-370px");
          }
          drawCapsules();
        });

        buttonContainer.appendChild(button);
      });
    }
  }
  drawCapsules();

  // Lines & dots
  const lines = g.selectAll("line.link")
    .data(links)
    .join("line")
    .attr("stroke", "#77ccff")
    .attr("stroke-width", 0.4)
    .attr("opacity", 0.05);

  let dots = g.selectAll("circle")
    .data(points)
    .join("circle")
    .style("cursor", "pointer");

  let selectedPoint = null;
  let selectedFrozen = null;

  // Add hover effects for better clickability
  dots.on("mouseover", function (event, d) {
    d3.select(this).attr("r", 8); // Slightly larger on hover
  });

  dots.on("mouseout", function (event, d) {
    if (selectedPoint !== d) {
      d3.select(this).attr("r", 6); // Return to normal size
    }
  });

  dots.on("click", function (event, d) {
    event.stopPropagation();

    // Check if this point is highlighted (not greyed out)
    let match = true;
    if (selectedCategory && !selectedType2) {
      match = d.category === selectedCategory;
    }
    if (selectedType2) {
      match = d.type2 === selectedType2;
    }

    // Only allow clicking on highlighted points when a category is selected
    if (selectedCategory && !match) {
      return; // Don't show tooltip for greyed-out points
    }

    selectedPoint = d;
    selectedFrozen = { x: d._drawX, y: d._drawY, z: d._drawZ };

    const formatDate = d3.timeFormat("%b %Y");
    const parseDate = d3.timeParse("%Y-%m-%d");
    const firstDate = d.first_seen ? parseDate(d.first_seen) : null;
    const lastDate = d.last_seen ? parseDate(d.last_seen) : null;
    const formattedFirst = firstDate ? formatDate(firstDate) : "–";
    const formattedLast = lastDate ? formatDate(lastDate) : "–";
    const lifespan = (firstDate && lastDate)
      ? `${((lastDate - firstDate) / (1000 * 60 * 60 * 24 * 365.25)).toFixed(1)} years`
      : "–";

    const tooltip = d3.select("#tooltip");

    // Position tooltip based on view and category selection
    if (isBottomView) {
      // Bottom view: center vertically on the right side
      tooltip
        .style("top", "50%")
        .style("transform", "translateY(-50%)")
        .style("right", "20px");
    } else if (!selectedCategory) {
      // Top view with no category: where stats panel would be
      tooltip
        .style("top", "180px")
        .style("right", "20px")
        .style("transform", "none");
    } else {
      // Top view with category: under stats panel (existing position)
      tooltip
        .style("top", "620px")
        .style("right", "20px")
        .style("transform", "none");
    }

    tooltip
      .style("opacity", 1)
      .html(`
        <div style="display: flex; flex-direction: column; height: 100%; justify-content: space-between; position: relative;">
          <button id="tooltip-close-btn" style="position: absolute; top: 5px; right: 5px; background: #000000; border: 1px solid #FFF; color: #FFF; font-size: 24px; cursor: pointer; padding: 0; width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; z-index: 1000; border-radius: 8px;" onclick="console.log('Button clicked directly')">×</button>
          <div>
            <div style="font-family: 'Neue Haas Grotesk Display Pro', sans-serif; font-size: 35px; font-weight: 600; color: #FFF; margin-bottom: 16px;">${d.title}</div>
            <div style="margin-bottom: 20px;">
              <div style="font-family: 'Neue Haas Grotesk Display Pro', sans-serif; font-size: 18px; font-weight: 500; color: #FFF; margin-bottom: 4px;">GENRE</div>
              <div style="font-family: 'Neue Haas Grotesk Display Pro', sans-serif; font-size: 25px; font-weight: 600; color: #FFF;">${(d.genre || "Unknown").replace(/^MUSIC\s*:\s*/i, '')}</div>
            </div>
            <div style="margin-bottom: 20px;">
              <div style="font-family: 'Neue Haas Grotesk Display Pro', sans-serif; font-size: 18px; font-weight: 500; color: #FFF; margin-bottom: 4px;">LIFE SPAN</div>
              <div style="font-family: 'Neue Haas Grotesk Display Pro', sans-serif; font-size: 25px; font-weight: 600; color: #FFF;">${lifespan}</div>
            </div>
          </div>
          <div style="display: flex; justify-content: space-between;">
            <div style="flex: 1;">
              <div style="font-family: 'Neue Haas Grotesk Display Pro', sans-serif; font-size: 18px; font-weight: 500; color: #FFF; margin-bottom: 4px;">First seen:</div>
              <div style="font-family: 'Neue Haas Grotesk Display Pro', sans-serif; font-size: 25px; font-weight: 600; color: #FFF;">${formattedFirst}</div>
            </div>
            <div style="width: 1px; background: #FFF; margin: 0 16px;"></div>
            <div style="flex: 1;">
              <div style="font-family: 'Neue Haas Grotesk Display Pro', sans-serif; font-size: 18px; font-weight: 500; color: #FFF; margin-bottom: 4px;">Last seen:</div>
              <div style="font-family: 'Neue Haas Grotesk Display Pro', sans-serif; font-size: 25px; font-weight: 600; color: #FFF;">${formattedLast}</div>
            </div>
          </div>
        </div>
      `);


    d3.select(this).raise();
  });

  // HTML Timeline Slider
  const timelineContainer = document.getElementById("timeline-container");
  const timelineHandle = document.getElementById("timeline-handle");
  const timelineFill = document.getElementById("timeline-fill");
  const currentDateLabel = document.getElementById("current-date");

  // Hide timeline on bottom view
  if (isBottomView && timelineContainer) {
    timelineContainer.style.display = "none";
  }

  // Hide current date on bottom view
  if (isBottomView && currentDateLabel) {
    currentDateLabel.style.display = "none";
  }
  const startDateLabel = document.getElementById("start-date");
  const endDateLabel = document.getElementById("end-date");
  const timelineTrack = document.querySelector(".timeline-track");
  const playPauseBtn = document.getElementById("play-pause-btn");

  // Get dynamic timeline width
  function getTimelineWidth() {
    return timelineTrack.offsetWidth;
  }

  // Scrubbing logic
  let dragging = false, scrubMonth = 0;
  const speed = 2;
  let offsetMonths = 0;
  let isPaused = false;

  // --- SYNC HELPERS (localStorage across top/bottom windows) ---
  let lastBroadcastedMonth = null;

  function applySyncedTime(newMonth) {
    if (isPaused) return; // ignore external time updates while paused
    if (!isFinite(newMonth)) return;
    // Align animation so that this month shows immediately and continues smoothly
    const now = performance.now();
    offsetMonths = newMonth - ((now - lastResetTime) / 1000) * speed;
    scrubMonth = newMonth;
    updateTimelineUI();
  }

  window.addEventListener("storage", (e) => {
    // For debugging
    //console.log("Storage event:", e.key, "->", e.newValue);

    // Time sync
    if (e.key === "vizTime") {
      if (isPaused || dragging) return; // do not move the scrubber while paused or dragging
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


  // Timeline event handlers
  timelineTrack.addEventListener("mousedown", function (event) {
    dragging = true;
    isScrubbingManually = true;
    lastResetTime = performance.now();
    setScrub(event.offsetX);
    event.preventDefault();
  });

  document.addEventListener("mousemove", (event) => {
    if (dragging) {
      const rect = timelineTrack.getBoundingClientRect();
      const x = event.clientX - rect.left;
      setScrub(x);
    }
  });

  document.addEventListener("mouseup", () => {
    if (dragging) {
      dragging = false;
      isScrubbingManually = false;
      const now = performance.now();
      offsetMonths = scrubMonth;
      lastResetTime = now;
    }
  });

  function setScrub(x) {
    const timelineWidth = getTimelineWidth();
    x = Math.max(0, Math.min(x, timelineWidth));
    const frac = x / timelineWidth;
    scrubMonth = Math.round(frac * (totalMonths - 1));
    updateTimelineUI();

    // Update offset to match the scrubbed position
    offsetMonths = scrubMonth;
    // Reset animation time to match scrubbed position
    animationStartTime = performance.now();
    pausedTime = 0;

    // If paused, immediately update the animation to show the new position
    if (isPaused) {
      displayedMonthsElapsed = scrubMonth;
      // Force update of all points to reflect the new time position
      points.forEach(p => {
        const pointTime = p.lastMonthIndex;
        if (pointTime !== null && pointTime <= scrubMonth) {
          p.hasFallen = true;
          p.fallFade = Math.max(0, 1 - (scrubMonth - pointTime) * 0.01);
        } else {
          p.hasFallen = false;
          p.fallFade = 1;
        }
      });
    }

    // Broadcast to the other window while dragging
    if (scrubMonth !== lastBroadcastedMonth) {
      localStorage.setItem("vizTime", String(scrubMonth));
      lastBroadcastedMonth = scrubMonth;
    }
  }

  let lastUpdateMonth = -1; // Track last updated month to avoid unnecessary updates

  function updateTimelineUI() {
    // Only update if the month has actually changed
    if (scrubMonth !== lastUpdateMonth) {
      const frac = scrubMonth / (totalMonths - 1);

      // Disable transitions during manual dragging or pause for immediate response
      if (dragging || isPaused) {
        // Freeze visually while paused or scrubbing
        timelineHandle.style.transition = 'none';
        timelineFill.style.transition = 'none';
      } else {
        timelineHandle.style.transition = 'left 0.6s linear';
        timelineFill.style.transition = 'transform 0.6s linear';
      }

      // Use left positioning for handle and scaleX for fill
      timelineHandle.style.left = `${frac * 100}%`;
      timelineFill.style.transform = `scaleX(${frac})`;
      timelineFill.style.transformOrigin = 'left';

      // Only update date label if not paused
      if (!isPaused) {
        currentDateLabel.textContent = getTimeLabel(scrubMonth);
      }

      lastUpdateMonth = scrubMonth;
    }
  }

  // Clear any stored time to ensure fresh start
  localStorage.removeItem("vizTime");

  // Ensure slider starts at the beginning
  scrubMonth = 0;

  // Initialize timeline labels
  startDateLabel.textContent = getTimeLabel(0);
  endDateLabel.textContent = getTimeLabel(totalMonths - 1);
  updateTimelineUI();

  // Play/Pause button functionality
  playPauseBtn.addEventListener("click", () => {
    const nowTs = performance.now();
    isPaused = !isPaused;

    if (isPaused) {
      // Entering pause: remember when we paused so we can offset master time on resume
      playPauseBtn.classList.add("paused");
      lastPauseTime = nowTs;
    } else {
      // Leaving pause: shift the master clock forward by the paused duration
      // so that (now - lastResetTime) ignores time spent paused.
      playPauseBtn.classList.remove("paused");
      if (lastPauseTime != null) {
        const pausedDuration = nowTs - lastPauseTime;
        // Advance lastResetTime by the paused duration to "freeze" elapsed time
        lastResetTime += pausedDuration;
        lastPauseTime = null;
      }

      // Also ensure the scrubber reflects the current logical time immediately
      // without a jump due to any pending CSS transition.
      // (No month change here; we only refresh UI positioning.)
      updateTimelineUI();
    }
  });


  // Reset category selection and tooltip on page refresh
  localStorage.setItem("vizCategory", "");
  localStorage.setItem("vizType2", "");
  selectedCategory = null;
  selectedType2 = null;

  // Hide tooltip on refresh
  tooltip.style("opacity", 0);

  updateCategoryHighlight();


  function getMonthYear(monthIdx) {
    const year = startYear + Math.floor(monthIdx / 12);
    const monthIndex = monthIdx % 12;
    return { monthIndex, year, total: monthIdx };
  }
  function getTimeLabel(monthIdx) {
    const { monthIndex, year } = getMonthYear(monthIdx);
    const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    return `${monthNames[monthIndex]} ${year}`;
  }

  // Animation
  let maxMonthSeen = 0;

  function animate(now) {
    // If paused, just render current state without updating time
    if (isPaused) {
      dots
        .attr("cx", d => d._drawX)
        .attr("cy", d => d._drawY)
        .attr("r", d => {
          const baseR = 6.0;
          const monthsLeft = d.lastMonthIndex - scrubMonth;
          if (
            !d.hasFallen &&
            d.lastMonthIndex != null &&
            d.lastMonthIndex < 348 &&
            monthsLeft <= 3 &&
            monthsLeft >= 0
          ) {
            const time = now / 800;
            const raw = Math.sin(time + d.phase);
            const eased = raw < 0 ? 1 + 0.3 * raw : 1;
            return baseR * eased;
          }
          return (selectedPoint === d) ? baseR + 2 : baseR;
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
        .attr("fill", "#aaffff");

      requestAnimationFrame(animate);
      return;
    }

    // Only calculate time if not paused
    let displayedMonthsElapsed = scrubMonth; // Default to current scrubMonth when paused
    let t = 0; // Default to 0 when paused

    if (!isPaused) {
      t = now - lastResetTime;
      const rawMonth = ((t / 1000) * speed + offsetMonths);
      const realMonthsElapsed = Math.floor(rawMonth);
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
          points.forEach(p => { p.hasFallen = false; p.fallStartTime = null; p.fallFade = 1; });
        }
      } else {
        pauseStarted = false;
        displayedMonthsElapsed = realMonthsElapsed;
      }

      // Update scrubMonth and timeline
      scrubMonth = displayedMonthsElapsed;
      updateTimelineUI();
    }

    // Sync across windows (but only if animation is running, not during manual scrub)
    if (!isScrubbingManually && scrubMonth !== lastBroadcastedMonth) {
      localStorage.setItem("vizTime", String(scrubMonth));
      lastBroadcastedMonth = scrubMonth;
    }

    if (displayedMonthsElapsed > maxMonthSeen) maxMonthSeen = displayedMonthsElapsed;

    // Update current date label but throttle it (only if not paused)
    if (!isPaused && Math.floor(now / 100) % 5 === 0) {
      const newTimeLabel = getTimeLabel(scrubMonth);
      if (currentDateLabel.textContent !== newTimeLabel) {
        currentDateLabel.textContent = newTimeLabel;
      }
    }

    // Smooth falling animation with continuous time
    const continuousTime = isPaused ? scrubMonth : ((now - lastResetTime) / 1000) * speed + offsetMonths; // Use current scrubMonth when paused

    points.forEach(p => {
      if (selectedPoint === p && selectedFrozen) {
        p._drawX = selectedFrozen.x; p._drawY = selectedFrozen.y; p._drawZ = selectedFrozen.z; p.fallFade = 1;
        return;
      }

      // Check if point should start falling using actual data timing
      if (!p.hasFallen && p.lastMonthIndex != null && continuousTime >= p.lastMonthIndex && p.lastMonthIndex < totalMonths) {
        p.hasFallen = true;
        p.fallStartTime = continuousTime; // Store continuous time for smooth animation
      }

      if (p.hasFallen) {
        // Use continuous time for smooth interpolation
        const timeSinceFall = Math.max(0, continuousTime - p.fallStartTime);
        const tNorm = Math.min(timeSinceFall / p.fallDuration, 1);
        const ease = 1 - (1 - tNorm) * (1 - tNorm); // Gentle quadratic ease-out

        p.fallFade = 1 - 0.65 * tNorm;
        if (tNorm >= 1) p.fallFade = 0.35;

        // Use pre-calculated pile positions with smooth interpolation
        p._drawX = p.x + (p.pileX - p.x) * ease;
        p._drawY = p.y + (p.pileY - p.y) * ease;
        p._drawZ = p.z;
      } else {
        // Use cached rotation values for non-falling points
        const rotY = Math.sin(t / 20000) * 0.5;
        const rotX = Math.cos(t / 15000) * 0.5;
        const rx = p.x * Math.cos(rotY) - p.z * Math.sin(rotY);
        const rz = p.x * Math.sin(rotY) + p.z * Math.cos(rotY);
        const ry = p.y * Math.cos(rotX) - rz * Math.sin(rotX);
        const finalZ = p.y * Math.sin(rotX) + rz * Math.cos(rotX);
        p._drawX = rx; p._drawY = ry; p._drawZ = finalZ; p.fallFade = 1;
      }
    });

    // Smooth falling animation parameters (now using per-point variation)
    dots
      .attr("cx", d => d._drawX)
      .attr("cy", d => d._drawY)
      .attr("r", d => {
        const baseR = 6.0; // Increased from 4.5 to 6.0 for easier clicking
        const monthsLeft = d.lastMonthIndex - scrubMonth;

        if (
          !d.hasFallen && // Only pulse points that haven't fallen yet
          d.lastMonthIndex != null &&
          d.lastMonthIndex < 348 &&
          monthsLeft <= 3 &&
          monthsLeft >= 0
        ) {
          // Slow inward pulse: 0.6x to 1x of base size, with easing
          const t = now / 800; // Use cached 'now' for better performance
          const raw = Math.sin(t + d.phase); // base wave
          const eased = raw < 0
            ? 1 + 0.3 * raw // Shrink to 70% and pause slightly at low
            : 1;            // Hold full size when above baseline

          return baseR * eased;
        }

        return (selectedPoint === d) ? baseR + 2 : baseR;
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
      .attr("fill", "#aaffff");

    lines
      .attr("x1", d => d.source._drawX)
      .attr("y1", d => d.source._drawY)
      .attr("x2", d => d.target._drawX)
      .attr("y2", d => d.target._drawY)
      .attr("stroke-opacity", d => 0.02 + 0.03 * Math.sin(now / 1000 + d.phase));

    function getSphereBoundary(p, radius, mult = 1.1) {
      const d = Math.sqrt(p._drawX * p._drawX + p._drawY * p._drawY + p._drawZ * p._drawZ);
      if (d === 0) return { x: 0, y: 0 };
      return { x: p._drawX / d * radius * mult, y: p._drawY / d * radius * mult };
    }

    const liveStrings = strings.filter(d => !(d.source.hasFallen && d.target.hasFallen));
    const curves = g.selectAll(".string")
      .data(liveStrings, d => `${d.source.id}-${d.target.id}`)
      .join(
        enter => enter.append("path")
          .attr("class", "string")
          .attr("fill", "none")
          .attr("stroke", "#aaccff")
          .attr("stroke-opacity", 0.1)
          .attr("stroke-width", 1.0)
          .attr("stroke-linecap", "round"),
        update => update,
        exit => exit.remove()
      );

    curves
      .attr("d", d => {
        function endpoint(p) {
          if (!p.hasFallen) return { x: p._drawX, y: p._drawY };
          const dlen = Math.sqrt(p._drawX * p._drawX + p._drawY * p._drawY + p._drawZ * p._drawZ);
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

  // Fast easing function (replaces Math.pow for better performance)
  function fastEaseOutCubic(t) {
    const t1 = 1 - t;
    return 1 - t1 * t1 * t1;
  }

  // Cache rotation calculations
  let lastRotationTime = 0;
  let cachedRotY = 0, cachedRotX = 0;
  let cachedCosY = 1, cachedSinY = 0, cachedCosX = 1, cachedSinX = 0;

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
});

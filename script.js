d3.csv("Grouped_Music_Dataset.csv").then(data => {
  const width = 1400;
  const height = 1600;
  const radius = 280;
  const groupCenterY = 395;
  const groundY = 900;

  const pileDotRadius = 2.5;
  const pileSpacingX = 7;
  const pileSpacingY = 7;

  const startYear = 1996;
  const endYear = 2024;
  const totalMonths = (endYear - startYear + 1) * 12;

  // Prepare categories and type2
  const filtered = data.filter(d => d.Last_Live_Capture && d.Grouped_Category && d.Grouped_Category.trim());
  const categories = Array.from(new Set(filtered.map(d => d.Grouped_Category.trim()))).sort();

  // Map for Grouped_Category -> type2s
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
  const modeType2 = type2s.sort((a,b) =>
    type2s.filter(v=>v===a).length - type2s.filter(v=>v===b).length
  ).pop();
  const lifespans = sites.map(d => {
    const first = new Date(d.First_Live_Capture);
    const last = new Date(d.Last_Live_Capture);
    return (last - first) / (1000 * 60 * 60 * 24 * 365.25); // years
  }).filter(x => !isNaN(x));
  const avgLifespan = lifespans.length ? (lifespans.reduce((a,b) => a+b, 0) / lifespans.length) : null;
  const lastYears = sites.map(d => (d.Last_Live_Capture ? new Date(d.Last_Live_Capture).getFullYear() : null)).filter(x => x);
  const earliest = Math.min(...lastYears);
  const latest = Math.max(...lastYears);

  // Find largest loss year
  const yearCounts = {};
  lastYears.forEach(y => { yearCounts[y] = (yearCounts[y]||0)+1; });
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

  //  pile assignment 
  const N = filtered.length;
  const numRows = Math.ceil((-1 + Math.sqrt(1 + 8 * N)) / 2);

  let dotIndex = 0;
  for (let row = 0; row < numRows; row++) {
    const dotsInRow = row + 1;
    for (let col = 0; col < dotsInRow && dotIndex < N; col++, dotIndex++) {
      filtered[dotIndex].pileRow = row;
      filtered[dotIndex].pileCol = col;
      filtered[dotIndex].pileRowDots = dotsInRow;
      filtered[dotIndex].numRows = numRows;
    }
  }

  const points = filtered.map((d, i) => {
    //  sphere position
    const phi = Math.acos(1 - 2 * Math.random());
    const theta = 2 * Math.PI * Math.random();
    const r = radius * (0.6 + Math.random() * 0.4);
    const x = r * Math.sin(phi) * Math.cos(theta);
    const y = r * Math.sin(phi) * Math.sin(theta);
    const z = r * Math.cos(phi);

    const lastMonthIndex = getMonthIndex(d.Last_Live_Capture);

    let debugFirstFaller = false;
    if (d.Last_Live_Capture) {
      const year = +d.Last_Live_Capture.slice(0, 4);
      if (year <= 2000) debugFirstFaller = true;
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
      baseOpacity: d3.scaleLinear().domain([-radius, radius]).range([0.15, 0.8])(z),
      baseSize: d3.scaleLinear().domain([-radius, radius]).range([1.5, 5])(z),
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

  // Selection state
  let selectedCategory = null;
  let selectedType2 = null;

  //  strings
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

  const svg = d3.create("svg")
    .attr("viewBox", [0, 0, width, height])
    .style("background", "#0a0a0a")
    .style("width", "100%")
    .style("height", "auto");

  const g = svg.append("g")
    .attr("transform", `translate(${width / 2}, ${groupCenterY})`);

  // Ground line
  g.append("line")
    .attr("x1", -radius * 1.2)
    .attr("x2", radius * 1.2)
    .attr("y1", groundY)
    .attr("y2", groundY)
    .attr("stroke", "#eee")
    .attr("stroke-width", 2)
    .attr("opacity", 0.2);

  // Bottom left time label
  const timeLabel = svg.append("text")
    .attr("x", 20)
    .attr("y", height - 20)
    .attr("fill", "#cccccc")
    .attr("font-size", "14px")
    .attr("font-family", "monospace")
    .attr("opacity", 0.8)
    .text("January 1996");

  //  Tooltip (using external div) 
  const tooltip = d3.select("#tooltip");

  //  Capsule gradient and glow 
  const defs = svg.append("defs");
  const grad = defs.append("linearGradient")
    .attr("id", "capsule-gradient")
    .attr("x1", "0%").attr("x2", "100%")
    .attr("y1", "0%").attr("y2", "0%");
  grad.append("stop").attr("offset", "0%").attr("stop-color", "#00ffe7").attr("stop-opacity", 0.85);
  grad.append("stop").attr("offset", "100%").attr("stop-color", "#0055ff").attr("stop-opacity", 0.9);

  const glow = defs.append("filter")
    .attr("id", "glow")
    .attr("x", "-50%")
    .attr("y", "-50%")
    .attr("width", "200%")
    .attr("height", "200%")
    .attr("filterUnits", "objectBoundingBox");
  glow.append("feGaussianBlur")
    .attr("in", "SourceAlpha")
    .attr("stdDeviation", 6)
    .attr("result", "blur");
  glow.append("feOffset").attr("dx", 0).attr("dy", 0).attr("in", "blur").attr("result", "offsetBlur");
  glow.append("feFlood").attr("flood-color", "#ffffff").attr("flood-opacity", 0.8).attr("result", "color");
  glow.append("feComposite").attr("in", "color").attr("in2", "offsetBlur").attr("operator", "in").attr("result", "glowShape");
  glow.append("feMerge").call(f => {
    f.append("feMergeNode").attr("in", "glowShape");
    f.append("feMergeNode").attr("in", "SourceGraphic");
  });

  // capsule buttons: Grouped_Category or type2
  const capsuleGroup = svg.append("g").attr("transform", "translate(20, 32)");
  const capsuleHeight = 36;
  const capsuleSpacing = 20;
  const capsulePaddingX = 28;

  const type2CapsuleHeight = 28;
  const type2CapsuleSpacing = 28;
  const type2CapsulePaddingX = 18;

  function drawCapsules() {
    capsuleGroup.selectAll("*").remove();

    if (!selectedCategory) {
      categories.forEach((category, i) => {
        const capsule = capsuleGroup.append("g")
          .style("cursor", "pointer")
          .attr("transform", `translate(0, ${i * (capsuleHeight + capsuleSpacing)})`)
          .on("click", () => {
            selectedCategory = category;


const stats = getCategoryStats(category, filtered);
if (stats) {
  d3.select("#category-stats").html(`
    <div style="font-weight:bold;font-size:25
    px;letter-spacing:0.3px;color:#fff;">${category}</div>
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
          .attr("stroke-width", category === selectedCategory ? 3 : 2)
          .style("filter", "drop-shadow(0 2px 8px rgba(22,230,255,0.09))")
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
      // Sub-level: Show type2 capsules for selectedCategory
        const backBtn = capsuleGroup.append("g")
          .style("cursor", "pointer")
          .attr("transform", `translate(0, 0)`)
          .on("click", () => {
            selectedCategory = null;
            selectedType2 = null;
            drawCapsules();
            // HIDE SLIDING NOTE
            d3.select("#sliding-ambiguity-text").style("display", "none");
            d3.select("#sliding-inner").style("left", "-370px");
            d3.select("#category-stats").style("display","none");
          });
      backBtn.append("rect")
        .attr("width", 60)
        .attr("height", 26)
        .attr("rx", 13)
        .attr("fill", "#191d24")
        .attr("stroke", "#00ffe7")
        .attr("stroke-width", 2);
      backBtn.append("text")
        .text("← Back")
        .attr("x", 30)
        .attr("y", 15)
        .attr("text-anchor", "middle")
        .attr("font-family", "Inter, sans-serif")
        .attr("font-size", "13px")
        .attr("fill", "#b6e3ef")
        .attr("dominant-baseline", "middle");

      const type2s = Array.from(categoryToType2[selectedCategory]).sort();
      type2s.forEach((type2, i) => {
        const capsule = capsuleGroup.append("g")
          .style("cursor", "pointer")
          .attr("transform", `translate(0, ${(i+1) * (type2CapsuleHeight + type2CapsuleSpacing)})`)
          .on("click", () => {
            selectedType2 = type2;
            // SLIDING AMBIGUITY NOTE for "music"
            if(selectedType2 && selectedType2.toLowerCase().trim() === "music") {
              d3.select("#sliding-ambiguity-text").style("display", "block");
              setTimeout(() => {
                d3.select("#sliding-inner").style("left", "0px");
              }, 10);
            } else {
              d3.select("#sliding-ambiguity-text").style("display", "none");
              d3.select("#sliding-inner").style("left", "-370px");
            }
            drawCapsules();
          });


        const text = capsule.append("text")
          .text(type2)
          .attr("dy", "0.35em")
          .attr("x", type2CapsulePaddingX)
          .attr("y", type2CapsuleHeight / 2)
          .attr("text-anchor", "start")
          .attr("font-family", "Inter, sans-serif")
          .attr("font-size", "14px")
          .attr("font-weight", 700)
          .attr("fill", "#b6e3ef")
          .attr("pointer-events", "none");

        const textWidth = text.node().getBBox().width;
        const fullWidth = textWidth + type2CapsulePaddingX * 2;

        const rect = capsule.insert("rect", "text")
          .attr("rx", type2CapsuleHeight / 2)
          .attr("height", type2CapsuleHeight)
          .attr("width", fullWidth)
          .attr("fill", "#151D21")
          .attr("stroke", type2 === selectedType2 ? "#00ffe7" : "#7fe6f6")
          .attr("stroke-width", type2 === selectedType2 ? 3 : 2)
          .style("filter", "drop-shadow(0 2px 8px rgba(22,230,255,0.09))")
          .attr("pointer-events", "all");

        capsule.on("mouseover", function () {
          if (selectedType2 !== type2) {
            rect.attr("fill", "url(#capsule-gradient)");
            text.attr("fill", "#fff");
          }
        });
        capsule.on("mouseout", function () {
          rect.attr("fill", "#151D21");
          text.attr("fill", "#b6e3ef");
        });
      });
    }
  }
  document.getElementById("vis").appendChild(svg.node());
  drawCapsules();

  // DOTS, LINES, CURVES
  const lines = g.selectAll("line.link")
    .data(links)
    .join("line")
    .attr("stroke", "#77ccff")
    .attr("stroke-width", 0.4)
    .attr("opacity", 0.05);


  const dots = g.selectAll("circle")
    .data(points)
    .join("circle");

  dots
    .on("mouseover", (event, d) => {
      tooltip
        .style("opacity", 1)
        .html(`<b>${d.title}</b><br>First seen: ${d.first_seen}<br>Last seen: ${d.last_seen}`);
    })
    .on("mousemove", (event) => {
      tooltip
        .style("left", (event.pageX + 10) + "px")
        .style("top", (event.pageY) + "px");
    })
    .on("mouseout", () => {
      tooltip.style("opacity", 0);
    });

  // Scrubber Block with date label below
  const scrubberWidth = 420;
  const scrubberHeight = 26;
  const scrubberMargin = 30;
  const knobRadius = 12;

  const scrubberGroup = svg.append("g")
    .attr("transform", `translate(${width - scrubberWidth - scrubberMargin},${scrubberMargin})`)
    .style("cursor", "pointer")
    .style("user-select", "none");

  scrubberGroup.append("rect")
    .attr("x", 0)
    .attr("y", (scrubberHeight-knobRadius)/2)
    .attr("rx", 12)
    .attr("width", scrubberWidth)
    .attr("height", knobRadius)
    .attr("fill", "#444");

  const fillRect = scrubberGroup.append("rect")
    .attr("x", 0)
    .attr("y", (scrubberHeight-knobRadius)/2)
    .attr("rx", 12)
    .attr("width", 0)
    .attr("height", knobRadius)
    .attr("fill", "#22e0ff");

  //const knob = scrubberGroup.append("circle")
    //.attr("cy", scrubberHeight/2)
   // .attr("r", knobRadius)
   // .attr("fill", "#22e0ff")
   // .attr("stroke", "#fff")
   // .attr("stroke-width", 2)
   // .attr("filter", "url(#glow)")
   // .attr("cx", 0);

   const knob = scrubberGroup.append("image")
  .attr("class", "scrubber-music-knob")
  .attr("xlink:href", "music-note.png")    // or .svg
  .attr("x", -knobRadius)
  .attr("y", -knobRadius)
  .attr("width", knobRadius * 2.2)
  .attr("height", knobRadius * 2 + 10);    // adjust as needed


// SVG music note path
knob.append("ellipse")
  .attr("cx", 0)
  .attr("cy", 10)   // move lower for a more "music note" feel
  .attr("rx", knobRadius)
  .attr("ry", knobRadius * 0.85)
  .attr("fill", "#22e0ff")
  .attr("stroke", "#fff")
  .attr("stroke-width", 2)
  .attr("filter", "url(#glow)");

  knob.append("rect")
  .attr("x", -2)
  .attr("y", -18)
  .attr("width", 4)
  .attr("height", 28)
  .attr("rx", 2)
  .attr("fill", "#fff")
  .attr("stroke", "#22e0ff")
  .attr("stroke-width", 0.7);

  // Note flag (eighth note style)
knob.append("path")
  .attr("d", "M2,-18 Q18,-26 2,-8")  // adjust as desired
  .attr("fill", "none")
  .attr("stroke", "#22e0ff")
  .attr("stroke-width", 3)
  .attr("stroke-linecap", "round");


  // Start/end date labels above
  scrubberGroup.append("text")
    .attr("x", 0)
    .attr("y", -6)
    .attr("fill", "#bbb")
    .attr("font-size", 13)
    .attr("font-family", "monospace")
    .text("Jan 1996");
  scrubberGroup.append("text")
    .attr("x", scrubberWidth)
    .attr("y", -6)
    .attr("fill", "#bbb")
    .attr("font-size", 13)
    .attr("font-family", "monospace")
    .attr("text-anchor", "end")
    .text("Dec 2024");

  // Centered, large date label below the scrubber
  const scrubberTimeLabel = scrubberGroup.append("text")
    .attr("x", scrubberWidth / 2)
    .attr("y", scrubberHeight + 25)
    .attr("fill", "#b6e3ef")
    .attr("font-size", "14px")
    .attr("font-family", "monospace")
    .attr("font-weight", 500)
    .attr("opacity", 1)
    .attr("text-anchor", "middle")
    .text("January 1996");

  // Scrubbing interaction
  let dragging = false;
  let scrubMonth = 0;
  const speed = 2;
  let offsetMonths = 0;
  const startTime = performance.now();

  scrubberGroup.on("mousedown", function(event) {
    dragging = true;
    setScrub(d3.pointer(event, this)[0]);
    event.preventDefault();
  });
  d3.select(window).on("mousemove", function(event) {
    if (dragging) {
      setScrub(d3.pointer(event, scrubberGroup.node())[0]);
    }
  });
  d3.select(window).on("mouseup", function() {
    if (dragging) {
      dragging = false;
      const now = performance.now();
      const elapsedSeconds = (now - startTime) / 1000;
      offsetMonths = scrubMonth - Math.floor(elapsedSeconds * speed);
      if (offsetMonths < 0) offsetMonths += totalMonths;
    }
  });

  function setScrub(x) {
    x = Math.max(0, Math.min(x, scrubberWidth));
    const frac = x / scrubberWidth;
    scrubMonth = Math.round(frac * (totalMonths-1));
    updateScrubberUI();
  }
  function updateScrubberUI() {
    const frac = scrubMonth / (totalMonths-1);
    knob.attr("transform", `translate(${frac * scrubberWidth},${scrubberHeight/2})`);

    fillRect.attr("width", frac * scrubberWidth);
    // Update the label below the scrubber
    scrubberTimeLabel.text(getTimeLabel(scrubMonth));
  }

  //  Utility functions for date
  function getMonthYear(monthIdx) {
    const year = startYear + Math.floor(monthIdx / 12);
    const monthIndex = monthIdx % 12;
    return { monthIndex, year, total: monthIdx };
  }
  function getTimeLabel(monthIdx) {
    const { monthIndex, year } = getMonthYear(monthIdx);
    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return `${monthNames[monthIndex]} ${year}`;
  }

  let maxMonthSeen = 0;

  //  Animation Loop 
  function animate(now) {
    let monthsElapsed;
    if (dragging) {
      monthsElapsed = scrubMonth;
    } else {
      const t = now - startTime;
      monthsElapsed = Math.floor(((t / 1000) * speed + offsetMonths) % totalMonths);
      scrubMonth = monthsElapsed;
      updateScrubberUI();
    }

    if (monthsElapsed > maxMonthSeen) maxMonthSeen = monthsElapsed;

    // Update BOTH labels
    timeLabel.text(getTimeLabel(monthsElapsed));
    scrubberTimeLabel.text(getTimeLabel(monthsElapsed));

    const fallDuration = 1.2;
    const fps = 60;
    const fallFrames = Math.round(fallDuration * fps);

    //  Calculate pile positions for fallen dots
    points.forEach(p => {
      if (!p.hasFallen && p.lastMonthIndex != null && maxMonthSeen >= p.lastMonthIndex) {
        p.hasFallen = true;
        p.fallY = 0;
        p.fallStartMonth = Math.max(p.lastMonthIndex, 0);
      }
      if (p.hasFallen) {
        // Animate: move to triangle pile
        let sinceFall = Math.max(0, Math.min(monthsElapsed - p.fallStartMonth, fallFrames));
        let tNorm = sinceFall / fallFrames;
        const ease = 1 - Math.pow(1 - tNorm, 3);

        // Fade during fall (from 1 to 0.35 as it falls, stays 0.35 after landing)
        p.fallFade = 1 - 0.65 * tNorm;
        if (tNorm >= 1) p.fallFade = 0.35;

        // pile positions: center row, base row at groundY
        const rowDots = p.pileRowDots;
        const pileX = (p.pileCol - (rowDots - 1) / 2) * pileSpacingX;
        const pileY = groundY - (p.numRows - 1 - p.pileRow) * pileSpacingY;

        p._drawX = p.x + (pileX - p.x) * ease;
        p._drawY = p.y + (pileY - p.y) * ease;
        p._drawZ = p.z;
      } else {
        // Rotating sphere logic
        const t = now - startTime;
        const rotY = Math.sin(t / 4000) * 0.5;
        const rotX = Math.cos(t / 3000) * 0.5;
        const rx = p.x * Math.cos(rotY) - p.z * Math.sin(rotY);
        const rz = p.x * Math.sin(rotY) + p.z * Math.cos(rotY);
        const ry = p.y * Math.cos(rotX) - rz * Math.sin(rotX);
        const finalZ = p.y * Math.sin(rotX) + rz * Math.cos(rotX);
        p._drawX = rx;
        p._drawY = ry;
        p._drawZ = finalZ;
        p.fallFade = 1;
      }
    });

    dots
      .attr("cx", d => d._drawX)
      .attr("cy", d => d._drawY)
      .attr("r", d => {
        // Small and fixed
        return d.hasFallen ? pileDotRadius : (d.debugFirstFaller ? 7 : 2.5);
      })
      .attr("fill-opacity", d => {
        const flicker = d.flicker && !d.hasFallen ? 0.4 + 0.4 * Math.abs(Math.sin(now / d.flickerSpeed + d.phase)) : 1;
        let match = true;
        if (selectedCategory && !selectedType2) match = d.category === selectedCategory;
        if (selectedType2) match = d.type2 === selectedType2;
        let opacity = flicker * d.baseOpacity * (match ? 1 : 0.1);
        if (d.hasFallen) opacity *= (d.fallFade ?? 0.35);
        return opacity;
      })
      .attr("fill", d => d.debugFirstFaller ? "red" : "#aaffff");

    lines
      .attr("x1", d => d.source._drawX)
      .attr("y1", d => d.source._drawY)
      .attr("x2", d => d.target._drawX)
      .attr("y2", d => d.target._drawY)
      .attr("stroke-opacity", d => 0.02 + 0.03 * Math.sin(now / 1000 + d.phase));

    // Helper function: Pin to sphere boundary
function getSphereBoundary(p, radius, mult = 1.1) {
  const d = Math.sqrt(p._drawX*p._drawX + p._drawY*p._drawY + p._drawZ*p._drawZ);
  if (d === 0) return { x: 0, y: 0 };
  return {
    x: p._drawX / d * radius * mult,
    y: p._drawY / d * radius * mult
  };
}

// Only keep strings where at least one endpoint is still not-fallen
const liveStrings = strings.filter(
  d => !(d.source.hasFallen && d.target.hasFallen)
);

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
    // For each endpoint, if fallen & below sphere, pin to sphere surface, else follow dot
    function endpoint(p) {
      if (!p.hasFallen) return { x: p._drawX, y: p._drawY };
      const dlen = Math.sqrt(p._drawX*p._drawX + p._drawY*p._drawY + p._drawZ*p._drawZ);
      if (dlen < radius) {
        return { x: p._drawX, y: p._drawY };
      } else {
        return getSphereBoundary(p, radius);
      }
    }
    const p1 = endpoint(d.source);
    const p2 = endpoint(d.target);

    // Wavy control point
    const mx = (p1.x + p2.x) / 2 + Math.sin(now / 800 + d.phase) * 10;
    const my = (p1.y + p2.y) / 2 + Math.cos(now / 800 + d.phase) * 10;
    return `M${p1.x},${p1.y} Q${mx},${my} ${p2.x},${p2.y}`;
  })
  .attr("stroke-opacity", d => 0.06 + 0.06 * Math.abs(Math.sin(now / 1200 + d.phase)));


    requestAnimationFrame(animate);
  }

  requestAnimationFrame(animate);
});


## Visualizing Digital Disappearance: A Non-Linear Temporal Study of Music Websites in the Scottish Web Archive

'python -m http.server 8000' to run the code

or

http://127.0.0.1:5500/index.html?view=top

http://127.0.0.1:5500/index.html?view=bottom


scrubberGroup.on("mousedown", function(event){
  dragging = true;
  isScrubbingManually = true;
  lastResetTime = performance.now(); // ✅ important for timeline sync
  setScrub(d3.pointer(event, this)[0]);
  event.preventDefault();
});


scrubberGroup.on("mousedown", function(event){
  dragging = true;
  isScrubbingManually = true;
  lastResetTime = performance.now(); // critical
  setScrub(d3.pointer(event, this)[0]);
  event.preventDefault();
});


d3.select(window).on("mousemove", (event) => {
  if (dragging) {
    setScrub(d3.pointer(event, scrubberGroup.node())[0]);
  }
});


d3.select(window).on("mouseup", () => {
  if (dragging) {
    dragging = false;
    isScrubbingManually = false;
    const now = performance.now();
    const elapsedSeconds = (now - lastResetTime) / 1000;
    offsetMonths = scrubMonth - elapsedSeconds * speed;
  }
});

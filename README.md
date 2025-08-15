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

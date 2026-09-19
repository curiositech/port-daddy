# D3.js Streaming & High-Frequency Update Recipes

## 1. The Declarative General Update Pattern (`selection.join`)

Modern D3 (v6+) eliminates the verbose `.enter().append().merge().exit().remove()` boilerplate in favor of `selection.join()`:

```javascript
svg.selectAll("circle.agent-node")
  .data(nodes, d => d.id) // Key function binds physical identity
  .join(
    enter => enter.append("circle")
      .attr("class", "agent-node")
      .attr("r", 0)
      .attr("cx", d => d.x)
      .attr("cy", d => d.y)
      .attr("fill", d => d.color)
      .call(enter => enter.transition().duration(250).attr("r", 6)),
    update => update
      .call(update => update.transition().duration(250)
        .attr("cx", d => d.x)
        .attr("cy", d => d.y)
        .attr("fill", d => d.color)),
    exit => exit
      .call(exit => exit.transition().duration(200)
        .attr("r", 0)
        .remove())
  );
```

## 2. Sliding Window Time-Series Buffer

For high-frequency telemetry streams ($> 10$ Hz), allocating new arrays on every tick causes garbage collector pauses. Maintain a pre-allocated circular ring buffer:

```javascript
class RingBuffer {
  constructor(capacity) {
    this.capacity = capacity;
    this.buffer = new Float64Array(capacity);
    this.cursor = 0;
    this.size = 0;
  }

  push(val) {
    this.buffer[this.cursor] = val;
    this.cursor = (this.cursor + 1) % this.capacity;
    if (this.size < this.capacity) this.size++;
  }

  toArray() {
    const out = new Float64Array(this.size);
    const start = (this.cursor - this.size + this.capacity) % this.capacity;
    for (let i = 0; i < this.size; i++) {
      out[i] = this.buffer[(start + i) % this.capacity];
    }
    return out;
  }
}
```

## 3. Dynamic Axis Transitions Without Jump Cuts

When time series advance, do not re-render axis text abruptly. Translate the `<g class="axis">` smoothly using `d3.transition`:

```javascript
const t = svg.transition().duration(250).ease(d3.easeLinear);

xScale.domain([tMin, tMax]);

gXAxis.transition(t).call(d3.axisBottom(xScale).ticks(5));
pathLine.transition(t).attr("d", lineGenerator(data));
```

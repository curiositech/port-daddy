# Root erratum to Luna order-method supplement

The research supplement planning-B06-order-algorithms-corrections.md, SHA d1c4af4c22a9721b63544821c40d926568762ae69b74c84727639b37f15e2714, contains a faulty constructed concatenation trace. With arcs c→x→a→b and cover {[a,b],[x],[c]}, reversed DFS from a encounters x, already the endpoint of singleton [x], before c. Its reported connector to c is not the shown endpoint-search procedure.

Use the independently checked five-node fixture instead: arcs a→x,c→x,x→b,x→d, cover {[a,x,b],[c],[d]}. At the iteration for [d], reverse search visits x, which is an interior member rather than an endpoint, then c, an endpoint. Join [c] and [d] to produce [c,d]; x remains assigned to [a,x,b]. This demonstrates legal membership versus witness traversal for that chosen iteration. A search order that instead joins another eligible chain must be recorded explicitly.

This correction was sent to the owning Terra before authoring. The other source claims still require source-labelled review; the report is research evidence, not bundle acceptance.

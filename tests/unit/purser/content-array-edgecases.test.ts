real answer' => 'real answer'.

Ok.

Also test orphan closer: 'half a thought</think>the actual answer' => 'half a thoughtthe actual answer'? Wait stripThinkTags replaces '</think>' with '' and trims. So 'half a thought</think>the actual answer' -> 'half a thoughtthe actual answer' (no space). But in earlier tests they expected 'half a thoughtthe actual answer'? In diff they had 'half a thought</think>the actual answer' -> 'half a thoughtthe actual answer'. Yes.

So test that.

Ok.

Also test that nested multiple blocks: 'real answer' => 'real answer'.

Ok.

Also test that stripThinkTags handles nested free multiple blocks: same as above.

Also test that stripThinkTags handles nested with content after: 'c</think>real answer' => 'real answer'.

Ok.

Also test that stripThinkTags handles orphan closer: 'half a thought</think>the actual answer' => 'half a thoughtthe actual answer'.

Ok.

Also test that stripThinkTags handles no tags: 'hello world' => 'hello world'.

Also test that stripThinkTags handles only tags: '' => ''.

Also test that stripThinkTags handles incomplete: 'c' => ''? Let's see: inner replaced, leaving 'c</think>...'? Actually replace inner first: replace /c</think>', it matches ''? Wait the regex is non-greedy but stops at the first closing tag due to negative lookahead. So it will match ''? Let's test: It will match from first  that doesn't have . So after first pass, replace that, leaving 'c</think>'. Then next pass matches '' -> replace. Leaves 'c</think>'. Next pass matches nothing. Then replace unclosed opener:  -> '' -> 'c'. Trim. So result 'c'. So nested incomplete yields 'c' not empty. Good.

But we don't need to test that.

Ok.

Now tests for content precedence: create tests.

Also test that content array with mixed parts: [ {text: 'part1 '}, {text: 42}, {text: 'part2'} ] => 'part1 part2'.

Ok.

Also test that content array with part.text string but also part.type missing? It still reads.

Ok.

Also test that content array with part object missing text? It ignores.

Ok.

Also test that content array with part null? It ignores.

Ok.

Also test that content array with empty array returns empty.

Ok.

Also test that content array with string 'hello' returns 'hello'.

Ok.

Also test that content array with array of objects but part.text contains think tags: 'answer' => 'answer'.

Ok.

Also test that content array with string containing think tags: 'hello ' => 'hello '.

Ok.

Also test that content array with string containing nested think tags: 'hello  outer</think>' => 'hello '.

Ok.

Also test that content array with string containing orphan closer: 'hello</think>' => 'hello'.

Ok.

Ok.

Also test that content array with string containing incomplete opener: 'hello
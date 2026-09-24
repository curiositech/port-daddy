# Actor semantics and recovery overlay

Agha's model organizes concurrent computation around sending messages, creating actors, and replacing behavior. A deployed request/reply path adds correlation, storage, retry, and authorization rules outside those semantics. For a request `j17`, persist `accepted|completed|unknown`; if a deadline expires, query that record before retry. A repeated `j17` is safe only when the application declares deduplication and retry authority. This recovery procedure is a constructed overlay.

Agha 1986 is the primary model record: <https://mitpress.mit.edu/9780262511414/actors/>. Agha et al. 1992 give open-system operational semantics and equivalence under fairness assumptions: <https://osl.cs.illinois.edu/publications/conf/concur/AghaMST92.html>. Neither proves deployment delivery or supervision behavior.

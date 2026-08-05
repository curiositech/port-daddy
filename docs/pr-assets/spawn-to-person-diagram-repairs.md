# Spawn-to-Person diagram repair proof

The contact sheet and animated tour record the post-repair geometry from the
35-page A4 standalone PDF. The review covered every page, with close inspection
of the three corrected TikZ figures:

- page 14: role-versus-person boundary and continuity organs;
- page 15: staged transition from spawn to accountable person;
- page 16: reputation evidence flow and judge boundary.

Artifacts:

- `spawn-to-person-diagram-repairs.jpg` — selected-page contact sheet, SHA-256
  `c3ec92cc47207eaad8f5d05f6a1a937e3a6f9e192228fac835c9459ed1209c41`;
- `spawn-to-person-diagram-tour.gif` — full visual tour, SHA-256
  `13f3c4952b6e5954e4fa57d0ecce0489af854efec442bd182f8883b851d0d1f2`;
- `website-v2/public/whitepaper/spawn-to-person-whitepaper.pdf` — CI-regenerated
  35-page source artifact, SHA-256
  `c98d07339bf56fd7693c263c7d0c526c2ca6975423108129e69443d45282dc5b`.

The checksums bind this proof record to the generated artifact at the reviewed
head. They are expected to change if the PDF is rebuilt from a later commit,
even when the visible page geometry is unchanged.

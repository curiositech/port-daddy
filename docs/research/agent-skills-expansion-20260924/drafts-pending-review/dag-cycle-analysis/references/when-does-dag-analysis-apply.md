# Preconditions

Use a simple underlying graph plus a consistent partial order and pairwise
orientation metadata. Test acyclicity first. SCCs diagnose a violation of the
DAG input premise; they do not replace the paper's cycle-basis analysis. A
source/sink orientation changes if the supplied ordering metadata changes.

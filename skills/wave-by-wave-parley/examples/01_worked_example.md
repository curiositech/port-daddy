# Constructed worked checkpoint

Revision 4 had scan, patch-X and publish. Scan returned evidence h1 of an API
break. R7 is high, so the checkpoint holds; it does not promote patch-X. Revision
5 records the hold and adds inspect-call-sites. Its h2 can reduce R7 only after
a compatible-contract/test review. Publish retains its approval dependency even
when R7 becomes low. A failed or partial inspection returns to hold.

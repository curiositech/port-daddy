------------------------- MODULE AdmissionRevision -------------------------
EXTENDS Naturals, Integers
CONSTANT BindRevision
VARIABLES revision, conflict, checkedRevision, certificate, admitted, badAdmission, rejected
vars == <<revision, conflict, checkedRevision, certificate, admitted, badAdmission, rejected>>
Init == /\ revision = 0 /\ conflict = FALSE /\ checkedRevision = -1
        /\ certificate = FALSE /\ admitted = FALSE /\ badAdmission = FALSE /\ rejected = FALSE
Check == /\ checkedRevision' = revision /\ certificate' = ~conflict
         /\ UNCHANGED <<revision, conflict, admitted, badAdmission, rejected>>
ChangeModel == /\ revision = 0 /\ revision' = 1 /\ conflict' = TRUE
               /\ UNCHANGED <<checkedRevision, certificate, admitted, badAdmission, rejected>>
Admit == /\ certificate /\ (~BindRevision \/ checkedRevision = revision)
         /\ admitted' = TRUE /\ badAdmission' = (badAdmission \/ conflict)
         /\ UNCHANGED <<revision, conflict, checkedRevision, certificate, rejected>>
RejectStale == /\ certificate /\ BindRevision /\ checkedRevision # revision
               /\ rejected' = TRUE
               /\ UNCHANGED <<revision, conflict, checkedRevision, certificate, admitted, badAdmission>>
Next == Check \/ ChangeModel \/ Admit \/ RejectStale
Spec == Init /\ [][Next]_vars
TypeOK == /\ revision \in 0..1 /\ checkedRevision \in -1..1
          /\ conflict \in BOOLEAN /\ certificate \in BOOLEAN
          /\ admitted \in BOOLEAN /\ badAdmission \in BOOLEAN /\ rejected \in BOOLEAN
SafeAdmission == ~badAdmission
NoAdmission == ~admitted
NoStaleRejection == ~rejected
=============================================================================

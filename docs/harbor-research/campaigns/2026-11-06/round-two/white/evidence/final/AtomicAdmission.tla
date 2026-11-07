-------------------------- MODULE AtomicAdmission --------------------------
EXTENDS Naturals, Integers

\* One opaque token, one row and at most two environmental dispatch writes.
\* Issuance is abstract checking; it has no protected effect. Commit is the
\* whole synchronous SQLite transaction. The two-step mutant splits it.
\* Scenario 0 explores all represented interferences; numbered scenarios
\* isolate concrete controls. Fault 0 is the intended implementation.
CONSTANTS Scenario, Fault
VARIABLES token, revision, rowExists, content, policy, model, epoch,
          decision, complete, operation, checkedRevision, checkedPolicy,
          checkedModel, checkedEpoch, checkedOperation, validated,
          writes, deleted, recreated, effectCount, badEffect, rejected
vars == <<token, revision, rowExists, content, policy, model, epoch,
          decision, complete, operation, checkedRevision, checkedPolicy,
          checkedModel, checkedEpoch, checkedOperation, validated,
          writes, deleted, recreated, effectCount, badEffect, rejected>>

Init == /\ token = 0 /\ revision = 0 /\ rowExists = TRUE /\ content = 0
        /\ policy = 0 /\ model = 0 /\ epoch = 0
        /\ decision = 0 /\ complete = FALSE /\ operation = 0
        /\ checkedRevision = -1 /\ checkedPolicy = -1
        /\ checkedModel = -1 /\ checkedEpoch = -1 /\ checkedOperation = -1
        /\ validated = FALSE /\ writes = 0 /\ deleted = FALSE
        /\ recreated = FALSE /\ effectCount = 0 /\ badEffect = FALSE
        /\ rejected = FALSE

Issue == /\ token = 0
         /\ token' = 1
         /\ decision' \in (IF Scenario = 0 THEN 1..3
                            ELSE IF Scenario = 9 THEN {2}
                            ELSE IF Scenario = 10 THEN {3} ELSE {1})
         /\ complete' \in (IF Scenario = 0 THEN BOOLEAN
                            ELSE {Scenario # 13})
         /\ checkedRevision' = revision /\ checkedPolicy' = policy
         /\ checkedModel' = model /\ checkedEpoch' = epoch
         /\ checkedOperation' = operation
         /\ UNCHANGED <<revision, rowExists, content, policy, model, epoch,
                        operation, validated, writes, deleted, recreated,
                        effectCount, badEffect, rejected>>

Write == /\ Scenario \in {0, 2, 3, 8, 14}
         /\ token = 1 /\ effectCount = 0 /\ rowExists
         /\ writes < (IF Scenario \in {2, 8} THEN 1 ELSE 2)
         /\ (Scenario # 8 \/ validated)
         /\ content' = 1 - content /\ writes' = writes + 1
         /\ revision' = IF Fault = 6 THEN revision ELSE revision + 1
         /\ UNCHANGED <<token, rowExists, policy, model, epoch, decision,
                        complete, operation, checkedRevision, checkedPolicy,
                        checkedModel, checkedEpoch, checkedOperation,
                        validated, deleted, recreated, effectCount,
                        badEffect, rejected>>

Delete == /\ Scenario \in {0, 4} /\ token = 1 /\ effectCount = 0
          /\ rowExists /\ writes = 0
          /\ rowExists' = FALSE /\ deleted' = TRUE /\ writes' = 1
          /\ revision' = IF Fault = 6 THEN revision ELSE revision + 1
          /\ UNCHANGED <<token, content, policy, model, epoch, decision,
                         complete, operation, checkedRevision, checkedPolicy,
                         checkedModel, checkedEpoch, checkedOperation,
                         validated, recreated, effectCount, badEffect, rejected>>

Recreate == /\ Scenario \in {0, 4} /\ token = 1 /\ effectCount = 0
            /\ ~rowExists /\ deleted /\ ~recreated
            /\ rowExists' = TRUE /\ recreated' = TRUE /\ writes' = 2
            /\ revision' = IF Fault = 6 THEN revision ELSE revision + 1
            /\ UNCHANGED <<token, content, policy, model, epoch, decision,
                           complete, operation, checkedRevision, checkedPolicy,
                           checkedModel, checkedEpoch, checkedOperation,
                           validated, deleted, effectCount, badEffect, rejected>>

PolicyChange == /\ Scenario \in {0, 5, 7} /\ token = 1 /\ effectCount = 0
                /\ policy = 0 /\ epoch < 2
                /\ policy' = 1 /\ epoch' = epoch + 1
                /\ UNCHANGED <<token, revision, rowExists, content, model,
                               decision, complete, operation, checkedRevision,
                               checkedPolicy, checkedModel, checkedEpoch,
                               checkedOperation, validated, writes, deleted,
                               recreated, effectCount, badEffect, rejected>>

ModelChange == /\ Scenario \in {0, 6} /\ token = 1 /\ effectCount = 0
               /\ model = 0 /\ epoch < 2
               /\ model' = 1 /\ epoch' = epoch + 1
               /\ UNCHANGED <<token, revision, rowExists, content, policy,
                              decision, complete, operation, checkedRevision,
                              checkedPolicy, checkedModel, checkedEpoch,
                              checkedOperation, validated, writes, deleted,
                              recreated, effectCount, badEffect, rejected>>

RestorePolicy == /\ Scenario \in {0, 7} /\ token = 1 /\ effectCount = 0
                      /\ policy = 1 /\ epoch < 2
                      /\ policy' = 0 /\ epoch' = epoch + 1
                      /\ UNCHANGED <<token, revision, rowExists, content,
                                     model, decision, complete,
                                     operation, checkedRevision, checkedPolicy,
                                     checkedModel, checkedEpoch,
                                     checkedOperation, validated, writes,
                                     deleted, recreated, effectCount,
                                     badEffect, rejected>>

SubstituteRequest == /\ Scenario \in {0, 12} /\ token = 1 /\ effectCount = 0
                     /\ operation = 0 /\ operation' = 1
                     /\ UNCHANGED <<token, revision, rowExists, content,
                                    policy, model, epoch, decision, complete,
                                    checkedRevision, checkedPolicy, checkedModel,
                                    checkedEpoch, checkedOperation, validated,
                                    writes, deleted, recreated, effectCount,
                                    badEffect, rejected>>

\* Faults remove a whole protection, not a redundant individual comparison:
\* 1 revision binding; 2 authority tuple; 3 atomicity; 4 decision/completeness;
\* 5 request binding; 6 dispatch trigger clock; 7 refreshing admission around
\* old caller-owned rollback snapshots after an await instead of preserving
\* the opaque rollback token minted by the successful preparation.
Guard == /\ token = 1 /\ rowExists
         /\ (Fault = 1 \/ revision = checkedRevision)
         /\ (Fault = 2 \/ /\ policy = checkedPolicy
                          /\ model = checkedModel /\ epoch = checkedEpoch)
         /\ (Fault = 4 \/ (decision = 1 /\ complete))
         /\ (Fault = 5 \/ operation = checkedOperation)

\* The oracle counts actual interference separately from the clock, so a
\* missing trigger cannot make its own inaccurate revision appear correct.
CorrectAtEffect == /\ token = 1 /\ rowExists /\ writes = 0
                   /\ revision = checkedRevision /\ policy = checkedPolicy
                   /\ model = checkedModel /\ epoch = checkedEpoch
                   /\ decision = 1 /\ complete
                   /\ operation = checkedOperation

Validate == /\ token = 1 /\ ~validated /\ Guard
            /\ (Scenario = 8 \/ Fault = 3)
            /\ validated' = TRUE
            /\ UNCHANGED <<token, revision, rowExists, content, policy, model,
                           epoch, decision, complete, operation,
                           checkedRevision, checkedPolicy, checkedModel,
                           checkedEpoch, checkedOperation, writes, deleted,
                           recreated, effectCount, badEffect, rejected>>

RefreshStaleRollback == /\ Scenario = 14 /\ Fault = 7 /\ token = 1
                       /\ writes = 2 /\ checkedRevision # revision
                       /\ checkedRevision' = revision
                       /\ UNCHANGED <<token, revision, rowExists, content,
                                      policy, model, epoch, decision, complete,
                                      operation, checkedPolicy, checkedModel,
                                      checkedEpoch, checkedOperation, validated,
                                      writes, deleted, recreated, effectCount,
                                      badEffect, rejected>>

Ready == CASE Scenario \in {2, 8} -> writes = 1
           [] Scenario = 3 -> writes = 2 /\ ~deleted
           [] Scenario = 4 -> recreated
           [] Scenario = 5 -> policy = 1
           [] Scenario = 6 -> model = 1
           [] Scenario = 7 -> epoch = 2 /\ policy = 0
           [] Scenario = 12 -> operation = 1
           [] Scenario = 14 -> writes = 2 /\ (Fault # 7 \/ checkedRevision = revision)
           [] OTHER -> TRUE

Commit == /\ Ready /\ token = 1
          /\ (IF Fault = 3 THEN validated ELSE Guard)
          /\ token' = 2 /\ effectCount' = effectCount + 1
          /\ revision' = IF Scenario = 15 THEN revision ELSE revision + 1
          /\ badEffect' = (badEffect \/ ~CorrectAtEffect)
          /\ UNCHANGED <<rowExists, content, policy, model, epoch, decision,
                         complete, operation, checkedRevision, checkedPolicy,
                         checkedModel, checkedEpoch, checkedOperation,
                         validated, writes, deleted, recreated, rejected>>

Reject == /\ Ready /\ token = 1 /\ ~Guard
          /\ token' = 2 /\ rejected' = TRUE
          /\ UNCHANGED <<revision, rowExists, content, policy, model, epoch,
                         decision, complete, operation, checkedRevision,
                         checkedPolicy, checkedModel, checkedEpoch,
                         checkedOperation, validated, writes, deleted,
                         recreated, effectCount, badEffect>>

RejectReplay == /\ Scenario \in {0, 11, 15} /\ token = 2
                /\ effectCount = 1 /\ ~rejected /\ rejected' = TRUE
                /\ UNCHANGED <<token, revision, rowExists, content, policy,
                               model, epoch, decision, complete, operation,
                               checkedRevision, checkedPolicy, checkedModel,
                               checkedEpoch, checkedOperation, validated,
                               writes, deleted, recreated, effectCount,
                               badEffect>>

Next == Issue \/ Write \/ Delete \/ Recreate \/ PolicyChange \/ ModelChange
        \/ RestorePolicy \/ SubstituteRequest \/ Validate \/ RefreshStaleRollback \/ Commit
        \/ Reject \/ RejectReplay
Spec == Init /\ [][Next]_vars

TypeOK == /\ token \in 0..2 /\ revision \in 0..3 /\ rowExists \in BOOLEAN
          /\ content \in 0..1 /\ policy \in 0..1 /\ model \in 0..1
          /\ epoch \in 0..2 /\ decision \in 0..3 /\ complete \in BOOLEAN
          /\ operation \in 0..1 /\ checkedRevision \in -1..2
          /\ checkedPolicy \in -1..1 /\ checkedModel \in -1..1
          /\ checkedEpoch \in -1..2 /\ checkedOperation \in -1..1
          /\ validated \in BOOLEAN /\ writes \in 0..2
          /\ deleted \in BOOLEAN /\ recreated \in BOOLEAN
          /\ effectCount \in 0..1 /\ badEffect \in BOOLEAN
          /\ rejected \in BOOLEAN
SafeAdmission == ~badEffect
NoAdmission == effectCount = 0
NoRejection == ~rejected
=============================================================================

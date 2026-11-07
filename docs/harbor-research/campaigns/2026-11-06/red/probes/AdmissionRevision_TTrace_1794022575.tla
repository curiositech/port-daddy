---- MODULE AdmissionRevision_TTrace_1794022575 ----
EXTENDS AdmissionRevision, Sequences, TLCExt, Toolbox, Naturals, TLC

_expression ==
    LET AdmissionRevision_TEExpression == INSTANCE AdmissionRevision_TEExpression
    IN AdmissionRevision_TEExpression!expression
----

_trace ==
    LET AdmissionRevision_TETrace == INSTANCE AdmissionRevision_TETrace
    IN AdmissionRevision_TETrace!trace
----

_inv ==
    ~(
        TLCGet("level") = Len(_TETrace)
        /\
        admitted = (FALSE)
        /\
        checkedRevision = (0)
        /\
        rejected = (TRUE)
        /\
        certificate = (TRUE)
        /\
        badAdmission = (FALSE)
        /\
        revision = (1)
        /\
        conflict = (TRUE)
    )
----

_init ==
    /\ revision = _TETrace[1].revision
    /\ rejected = _TETrace[1].rejected
    /\ certificate = _TETrace[1].certificate
    /\ conflict = _TETrace[1].conflict
    /\ badAdmission = _TETrace[1].badAdmission
    /\ admitted = _TETrace[1].admitted
    /\ checkedRevision = _TETrace[1].checkedRevision
----

_next ==
    /\ \E i,j \in DOMAIN _TETrace:
        /\ \/ /\ j = i + 1
              /\ i = TLCGet("level")
        /\ revision  = _TETrace[i].revision
        /\ revision' = _TETrace[j].revision
        /\ rejected  = _TETrace[i].rejected
        /\ rejected' = _TETrace[j].rejected
        /\ certificate  = _TETrace[i].certificate
        /\ certificate' = _TETrace[j].certificate
        /\ conflict  = _TETrace[i].conflict
        /\ conflict' = _TETrace[j].conflict
        /\ badAdmission  = _TETrace[i].badAdmission
        /\ badAdmission' = _TETrace[j].badAdmission
        /\ admitted  = _TETrace[i].admitted
        /\ admitted' = _TETrace[j].admitted
        /\ checkedRevision  = _TETrace[i].checkedRevision
        /\ checkedRevision' = _TETrace[j].checkedRevision

\* Uncomment the ASSUME below to write the states of the error trace
\* to the given file in Json format. Note that you can pass any tuple
\* to `JsonSerialize`. For example, a sub-sequence of _TETrace.
    \* ASSUME
    \*     LET J == INSTANCE Json
    \*         IN J!JsonSerialize("AdmissionRevision_TTrace_1794022575.json", _TETrace)

=============================================================================

 Note that you can extract this module `AdmissionRevision_TEExpression`
  to a dedicated file to reuse `expression` (the module in the 
  dedicated `AdmissionRevision_TEExpression.tla` file takes precedence 
  over the module `AdmissionRevision_TEExpression` below).

---- MODULE AdmissionRevision_TEExpression ----
EXTENDS AdmissionRevision, Sequences, TLCExt, Toolbox, Naturals, TLC

expression == 
    [
        \* To hide variables of the `AdmissionRevision` spec from the error trace,
        \* remove the variables below.  The trace will be written in the order
        \* of the fields of this record.
        revision |-> revision
        ,rejected |-> rejected
        ,certificate |-> certificate
        ,conflict |-> conflict
        ,badAdmission |-> badAdmission
        ,admitted |-> admitted
        ,checkedRevision |-> checkedRevision
        
        \* Put additional constant-, state-, and action-level expressions here:
        \* ,_stateNumber |-> _TEPosition
        \* ,_revisionUnchanged |-> revision = revision'
        
        \* Format the `revision` variable as Json value.
        \* ,_revisionJson |->
        \*     LET J == INSTANCE Json
        \*     IN J!ToJson(revision)
        
        \* Lastly, you may build expressions over arbitrary sets of states by
        \* leveraging the _TETrace operator.  For example, this is how to
        \* count the number of times a spec variable changed up to the current
        \* state in the trace.
        \* ,_revisionModCount |->
        \*     LET F[s \in DOMAIN _TETrace] ==
        \*         IF s = 1 THEN 0
        \*         ELSE IF _TETrace[s].revision # _TETrace[s-1].revision
        \*             THEN 1 + F[s-1] ELSE F[s-1]
        \*     IN F[_TEPosition - 1]
    ]

=============================================================================



Parsing and semantic processing can take forever if the trace below is long.
 In this case, it is advised to uncomment the module below to deserialize the
 trace from a generated binary file.

\*
\*---- MODULE AdmissionRevision_TETrace ----
\*EXTENDS AdmissionRevision, IOUtils, TLC
\*
\*trace == IODeserialize("AdmissionRevision_TTrace_1794022575.bin", TRUE)
\*
\*=============================================================================
\*

---- MODULE AdmissionRevision_TETrace ----
EXTENDS AdmissionRevision, TLC

trace == 
    <<
    ([admitted |-> FALSE,checkedRevision |-> -1,rejected |-> FALSE,certificate |-> FALSE,badAdmission |-> FALSE,revision |-> 0,conflict |-> FALSE]),
    ([admitted |-> FALSE,checkedRevision |-> 0,rejected |-> FALSE,certificate |-> TRUE,badAdmission |-> FALSE,revision |-> 0,conflict |-> FALSE]),
    ([admitted |-> FALSE,checkedRevision |-> 0,rejected |-> FALSE,certificate |-> TRUE,badAdmission |-> FALSE,revision |-> 1,conflict |-> TRUE]),
    ([admitted |-> FALSE,checkedRevision |-> 0,rejected |-> TRUE,certificate |-> TRUE,badAdmission |-> FALSE,revision |-> 1,conflict |-> TRUE])
    >>
----


=============================================================================

---- CONFIG AdmissionRevision_TTrace_1794022575 ----
CONSTANTS
    BindRevision = TRUE

INVARIANT
    _inv

CHECK_DEADLOCK
    \* CHECK_DEADLOCK off because of PROPERTY or INVARIANT above.
    FALSE

INIT
    _init

NEXT
    _next

CONSTANT
    _TETrace <- _trace

ALIAS
    _expression
=============================================================================
\* Generated on Fri Nov 06 19:36:15 PST 2026
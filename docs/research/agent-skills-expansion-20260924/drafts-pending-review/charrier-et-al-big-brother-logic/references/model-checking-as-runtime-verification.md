# Model checking versus runtime evidence

## Scope

Model checking validates a formula on an abstract transition model. Runtime evidence validates an observed event under an instrumentation contract. Keep these outputs separate.

## Method and fixture

A useful pipeline maps observation to a finite abstract state, records that mapping, checks the formula, and reports abstraction error. It must not call an unobserved live property verified.

## Evidence boundary

This reference distinguishes a formal or constructed model from observed runtime behavior. Record model version, inputs, assumptions, and outcome evidence before drawing a conclusion.

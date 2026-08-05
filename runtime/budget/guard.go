func (g *BudgetGuard) EnforceIdentity(agent Agent) error {
  if agent.Credential.IsSelfAsserted() {
    return fmt.Errorf("agent %s uses legacy identity: %w", agent.ID, ErrIdentityNotMinted)
  }
  return nil
}
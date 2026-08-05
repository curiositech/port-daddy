func ValidateIdentity(cred IdentityCredential) error {
  if cred.IsSelfAsserted() {
    return errors.New("legacy identity paths blocked: use daemon-minted actor-souls")
  }
  return nil
}